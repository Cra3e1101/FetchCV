from __future__ import annotations

from dataclasses import dataclass, field
import base64
import binascii
from html import escape, unescape
from io import BytesIO
import json
from pathlib import Path
import re
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile
from PIL import Image


MIME_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "tex": "application/x-tex",
    "json": "application/json",
}
MAX_SOURCE_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 500_000
MAX_PHOTO_BYTES = 5 * 1024 * 1024


@dataclass
class ResumeDocument:
    text: str
    page_count: int | None = None
    profile: dict[str, str] = field(default_factory=dict)
    experiences: list[dict[str, Any]] | None = None
    bold_phrases: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    photo: str = ""


def _checked_photo(raw: bytes, mime_hint: str = "") -> tuple[str, tuple[int, int]]:
    if not raw or len(raw) > MAX_PHOTO_BYTES:
        raise ValueError("图片大小必须在 5MB 以内")
    mime = "image/png" if raw.startswith(b"\x89PNG\r\n\x1a\n") else "image/jpeg" if raw.startswith(b"\xff\xd8\xff") else ""
    if not mime or (mime_hint and mime_hint != mime):
        raise ValueError("图片内容不是有效的 PNG 或 JPEG")
    try:
        with Image.open(BytesIO(raw)) as picture:
            width, height = picture.size
            if picture.format not in {"PNG", "JPEG"} or not 1 <= width <= 8192 or not 1 <= height <= 8192 or width * height > 16_000_000:
                raise ValueError("图片尺寸过大或格式无效")
            picture.verify()
    except (OSError, Image.DecompressionBombError) as exc:
        raise ValueError("图片内容不完整") from exc
    return f"data:{mime};base64,{base64.b64encode(raw).decode('ascii')}", (width, height)


def _pick_photo(candidates: list[tuple[str, bytes]], warnings: list[str]) -> str:
    valid = []
    for name, raw in candidates[:20]:
        try:
            data, (width, height) = _checked_photo(raw)
            if width >= 48 and height >= 48:
                valid.append((width <= height * 1.15, width * height, data))
        except ValueError:
            warnings.append(f"图片 {name} 未导入：仅支持 5MB 以内的有效 PNG/JPEG。")
    if not valid:
        return ""
    if len(valid) > 1:
        warnings.append("发现多张图片，已优先选择较大的竖向图片作为头像，可在编辑器中替换。")
    return max(valid, key=lambda item: (item[0], item[1]))[2]


def _json_photo(value: Any, warnings: list[str]) -> str:
    if not value:
        return ""
    if not isinstance(value, str) or len(value) > MAX_PHOTO_BYTES * 4 // 3 + 100:
        warnings.append("头像未导入：图片数据过大或格式无效。")
        return ""
    match = re.fullmatch(r"data:(image/(?:png|jpeg));base64,([A-Za-z0-9+/=\s]+)", value)
    if not match:
        warnings.append("头像未导入：仅支持内嵌 PNG/JPEG，不读取外部图片链接。")
        return ""
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match.group(2)), validate=True)
        return _checked_photo(raw, match.group(1))[0]
    except (ValueError, binascii.Error):
        warnings.append("头像未导入：图片内容或格式无效。")
        return ""


def _plain(value: Any) -> str:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return ""
    text = re.sub(r"<(?:br\s*/?|/(?:p|div|li))>", "\n", str(value), flags=re.I)
    return re.sub(r"[ \t]+", " ", unescape(re.sub(r"<[^>]+>", "", text))).strip()


def _record(kind: str, section: str, title: str, *, organization: str = "", role: str = "", start: str = "", end: str = "", summary: str = "", raw: str = "") -> dict[str, Any]:
    headline = " | ".join(value for value in (title, role, "--".join(value for value in (start, end) if value)) if value)
    content = "\n".join(value for value in (headline, summary) if value)
    return {
        "kind": kind, "section": section, "title": title, "organization": organization, "role": role,
        "start_date": start, "end_date": end, "summary": summary,
        "details": {"headline": headline, "raw_text": raw or content, "bullets": summary.splitlines()},
        "content": content,
    }


def _date_pair(value: str) -> tuple[str, str]:
    dates = re.findall(r"((?:19|20)\d{2})[-/.年](\d{1,2})", value)
    dates = [f"{year}-{int(month):02d}" for year, month in dates[:2]]
    return (dates[0] if dates else "", dates[1] if len(dates) > 1 else "至今" if re.search(r"至今|present|current", value, re.I) else "")


def read_docx(raw: bytes) -> ResumeDocument:
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    prefix = "{" + ns["w"] + "}"
    try:
        with ZipFile(BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 2000 or sum(item.file_size for item in infos) > 100 * 1024 * 1024:
                raise ValueError("Word 文件解压后过大")
            names = set()
            for item in infos:
                name = item.filename.replace("\\", "/")
                if name in names or name.startswith("/") or ":" in name or ".." in name.split("/") or item.flag_bits & 1:
                    raise ValueError("Word 文件包含无效或加密内容")
                if item.file_size > MAX_SOURCE_BYTES or item.file_size / max(1, item.compress_size) > 200:
                    raise ValueError("Word 文件压缩比例异常")
                names.add(name)
            xml = archive.read("word/document.xml")
            if b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                raise ValueError("Word 文件包含不支持的 XML 声明")
            body = ET.fromstring(xml).find("w:body", ns)
            if body is None:
                raise ValueError("Word 文件没有正文")
            bold = []

            def paragraph(node):
                output = []
                for element in node.iter():
                    if element.tag == prefix + "t":
                        output.append(element.text or "")
                    elif element.tag == prefix + "tab":
                        output.append(" ")
                    elif element.tag in {prefix + "br", prefix + "cr"}:
                        output.append("\n")
                for run in node.findall(".//w:r", ns):
                    strong = run.find("w:rPr/w:b", ns)
                    if strong is not None and strong.get(prefix + "val", "1") not in {"0", "false", "off"}:
                        phrase = "".join(part.text or "" for part in run.findall("w:t", ns)).strip()
                        if phrase:
                            bold.append(phrase)
                text = "".join(output).strip()
                if text and node.find("w:pPr/w:numPr", ns) is not None:
                    text = "• " + text
                return text

            lines = []
            for node in body:
                if node.tag == prefix + "p":
                    lines.append(paragraph(node))
                elif node.tag == prefix + "tbl":
                    for row in node.findall("w:tr", ns):
                        cells = ["\n".join(paragraph(p) for p in cell.findall(".//w:p", ns)) for cell in row.findall("w:tc", ns)]
                        lines.append("  ".join(cell for cell in cells if cell))
            warnings = []
            media = [item for item in infos if item.filename.startswith("word/media/") and Path(item.filename).suffix.lower() in {".png", ".jpg", ".jpeg"} and item.file_size <= MAX_PHOTO_BYTES][:20]
            candidates = [(item.filename.rsplit("/", 1)[-1], archive.read(item)) for item in media]
            photo = _pick_photo(candidates, warnings)
            return ResumeDocument(text="\n".join(lines), bold_phrases=bold, warnings=warnings, photo=photo)
    except (BadZipFile, KeyError, ET.ParseError) as exc:
        raise ValueError("无法读取 Word 文件，请使用有效的 .docx 文件") from exc


def _group(source: str, index: int, opening: str = "{", closing: str = "}") -> tuple[str, int]:
    while index < len(source) and source[index].isspace():
        index += 1
    if index >= len(source) or source[index] != opening:
        return "", index
    start, depth = index + 1, 1
    index += 1
    while index < len(source):
        if source[index] == "\\":
            index += 2
            continue
        if source[index] == opening:
            depth += 1
        elif source[index] == closing:
            depth -= 1
            if depth == 0:
                return source[start:index], index + 1
        index += 1
    raise ValueError("LaTeX 文件括号不完整，请检查源文件")


def _args(source: str, index: int, count: int) -> tuple[list[str], int]:
    while index < len(source) and source[index].isspace():
        index += 1
    if index < len(source) and source[index] == "[":
        _, index = _group(source, index, "[", "]")
    values = []
    for _ in range(count):
        value, index = _group(source, index)
        values.append(value)
    return values, index


_DROP_ARGUMENTS = {
    "fontsize": 2, "vspace": 1, "hspace": 1, "hphantom": 1, "phantom": 1,
    "setlength": 2, "renewcommand": 2, "newcommand": 2, "includegraphics": 1,
    "input": 1, "include": 1, "write": 1, "write18": 1, "openout": 1,
    "label": 1, "cite": 1, "needspace": 1, "rule": 2,
}


def _tex_runs(source: str, *, depth: int = 0, bold: bool = False, italic: bool = False, rich: bool = False) -> list[tuple[str, bool, bool]]:
    """Read supported formatting as scoped text runs, without evaluating TeX."""
    if depth > 80:
        raise ValueError("LaTeX 内容嵌套过深")
    output, index = [], 0
    groups = []

    def append(value: str):
        output.append((value, bold, italic))

    def nested(value: str, *, weight: bool | None = None, slant: bool | None = None):
        output.extend(_tex_runs(value, depth=depth + 1, bold=bold if weight is None else weight, italic=italic if slant is None else slant, rich=rich))

    while index < len(source):
        char = source[index]
        if char == "{":
            value, index = _group(source, index)
            nested(value)
        elif char == "\\":
            match = re.match(r"\\([a-zA-Z]+\*?|[^a-zA-Z])", source[index:])
            if not match:
                index += 1
                continue
            command = match.group(1).rstrip("*")
            index += len(match.group(0))
            # A control word consumes its delimiter spaces. Spaces inside an
            # argument (for example \textbf{ Prompt}) remain actual content.
            if command.isalpha():
                while index < len(source) and source[index] in " \t":
                    index += 1
            if command in {"%", "&", "_", "#", "$", "{", "}"}:
                append(command)
            elif command in {"\\", "par", "newline"}:
                append("\n")
            elif command == "item":
                append("\n• ")
            elif command == "keyitem":
                values, index = _args(source, index, 2)
                append("\n• ")
                nested(values[0], weight=True)
                nested(values[1])
            elif command in {"bfseries", "mdseries"}:
                bold = command == "bfseries"
            elif command in {"itshape", "upshape"}:
                italic = command == "itshape"
            elif command == "normalfont":
                bold, italic = False, False
            elif command == "begingroup":
                groups.append((bold, italic))
            elif command == "endgroup" and groups:
                bold, italic = groups.pop()
            elif command in _DROP_ARGUMENTS:
                _, index = _args(source, index, _DROP_ARGUMENTS[command])
            elif command in {"begin", "end"}:
                values, index = _args(source, index, 1)
                if values[0] in {"tabular", "tabularx"} and command == "begin":
                    _, index = _args(source, index, 2 if values[0] == "tabularx" else 1)
                append("\n")
            elif command == "href":
                values, index = _args(source, index, 2)
                nested(values[1])
            elif command in {"textbf", "textmd", "textit", "emph", "textnormal", "mbox", "url", "name", "email", "phone"}:
                values, index = _args(source, index, 1)
                nested(values[0], weight=True if command == "textbf" else False if command in {"textmd", "textnormal"} else None, slant=True if command in {"textit", "emph"} else False if command == "textnormal" else None)
            elif command == "makebox":
                while index < len(source) and source[index] == "[":
                    _, index = _group(source, index, "[", "]")
                values, index = _args(source, index, 1)
                nested(values[0])
            elif command in {"enspace", "quad", "qquad", ",", ";", " "}:
                append({"enspace": "\u2002", "quad": "\u2003", "qquad": "\u2003\u2003", ",": "\u2009"}.get(command, " ") if rich else " ")
            elif command == "LaTeX":
                append("LaTeX")
            elif command == "textbullet":
                append("• ")
            # Formatting commands and math delimiters have no textual content.
        elif char == "&":
            append(" ")
            index += 1
        else:
            append(char)
            index += 1
    return output


def _normalized_tex_runs(source: str, *, bold: bool = False, rich: bool = False) -> list[tuple[str, bool, bool]]:
    # Source indentation and blank lines around layout macros are not visible
    # paragraphs inside resumeItems. Keep semantic line boundaries, without
    # turning TeX formatting whitespace into extra HTML paragraphs.
    lines, line = [], []
    for text, weight, slant in _tex_runs(source, bold=bold, rich=rich):
        for char in text.replace("\r\n", "\n").replace("\r", "\n"):
            if char == "\n":
                while line and line[-1][0].isspace():
                    line.pop()
                if line:
                    lines.append(line)
                line = []
            elif char in " \t":
                if line and (line[-1][0] != " " or (rich and line[-1][1:] != (weight, slant))):
                    line.append((" ", weight, slant))
            else:
                line.append((char, weight, slant))
    while line and line[-1][0].isspace():
        line.pop()
    if line:
        lines.append(line)
    result = []
    for index, line in enumerate(lines):
        if index:
            result.append(("\n", False, False))
        result.extend(line)
    return result


def _tex_text(source: str) -> str:
    return "".join(text for text, _, _ in _normalized_tex_runs(source))


def _tex_rich(source: str, *, bold: bool = False) -> str:
    """Emit only escaped text and a small, locally scoped HTML vocabulary."""
    groups: list[tuple[list[str], bool, bool]] = []
    for text, weight, slant in _normalized_tex_runs(source, bold=bold, rich=True):
        if groups and groups[-1][1:] == (weight, slant):
            groups[-1][0].append(text)
        else:
            groups.append(([text], weight, slant))
    output = []
    for text, weight, slant in groups:
        value = escape("".join(text), quote=False).replace("\n", "<br>")
        if slant:
            value = f"<em>{value}</em>"
        if weight:
            value = f"<strong>{value}</strong>"
        elif bold:
            value = f'<span style="font-weight:400">{value}</span>'
        output.append(value)
    return "".join(output)


def read_tex(raw: bytes) -> ResumeDocument:
    try:
        source = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ValueError("LaTeX 简历请保存为 UTF-8 编码") from exc
    # Ignore comments and preamble definitions. The file is data, never compiled.
    source = re.sub(r"(?m)(?<!\\)%.*$", "", source)
    begin = re.search(r"\\begin\s*\{document\}", source)
    end = re.search(r"\\end\s*\{document\}", source)
    if begin:
        source = source[begin.end():end.start() if end else None]
    matches = list(re.finditer(r"\\(?:resumeSection|section\*?)\s*(?:\[[^\]]*\])?\s*\{", source))
    section_kinds = {"教育": "education", "实习": "experience", "工作经历": "experience", "工作经验": "experience", "项目": "project", "技能": "skill", "荣誉": "award", "奖项": "award", "校园": "campus", "科研": "research", "概述": "summary", "评价": "summary", "education": "education", "experience": "experience", "project": "project", "skills": "skill", "awards": "award", "summary": "summary", "research": "research"}
    header_source = source[:matches[0].start()] if matches else source
    header = []
    for match in re.finditer(r"\\(?:mbox|makebox|name|email|phone)\b", header_source):
        cursor = match.end()
        while cursor < len(header_source) and header_source[cursor] == "[":
            _, cursor = _group(header_source, cursor, "[", "]")
        values, _ = _args(header_source, cursor, 1)
        text = _tex_text(values[0])
        if text:
            header.append(text)
    if not header:
        header = [_tex_text(re.sub(r"\\begin\{tikzpicture\}.*?\\end\{tikzpicture\}", "", header_source, flags=re.S))]
    records, all_text = [], list(header)
    for index, match in enumerate(matches):
        title, body_start = _group(source, match.end() - 1)
        title = _tex_text(title)
        body = source[body_start:matches[index + 1].start() if index + 1 < len(matches) else len(source)]
        kind = next((value for key, value in section_kinds.items() if key in title.lower()), "other")
        all_text.append(title)
        entries = list(re.finditer(r"\\(?:tripleEntry|projectEntry|singleEntry)\b", body))
        if not entries:
            text = _tex_text(body)
            if text:
                record = _record(kind, title, title, summary=text)
                record["details"]["rich_body"] = _tex_rich(body)
                records.append(record)
                all_text.append(text)
            continue
        for item_index, entry in enumerate(entries):
            source_values, content_start = _args(body, entry.end(), 1 if entry.group(0).endswith("singleEntry") else 3)
            values = [_tex_text(value) for value in source_values]
            name, role, dates = (values + ["", ""])[:3]
            start, finish = _date_pair(dates)
            raw_body = body[content_start:entries[item_index + 1].start() if item_index + 1 < len(entries) else len(body)]
            summary = _tex_text(raw_body)
            record = _record(kind, title, name, organization=name if kind in {"education", "experience"} else "", role=role, start=start, end=finish, summary=summary)
            record["details"].update({
                "rich_body": _tex_rich(raw_body),
                "meta_rich": {
                    "title": _tex_rich(source_values[0], bold=True),
                    "role": _tex_rich(source_values[1]) if len(source_values) > 1 else "",
                },
            })
            # Preserve the known template's invisible CJK alignment cell as
            # bounded layout data; never carry arbitrary TeX into rendering.
            if len(source_values) > 1:
                phantom = re.match(r"\s*\\hphantom\s*\{([\u3400-\u9fff]{1,3})\}", source_values[1])
                if phantom:
                    record["details"]["meta_rich"]["roleLeadingPhantomEm"] = len(phantom.group(1))
            records.append(record)
            all_text.append(records[-1]["content"])
    bold = []
    for match in re.finditer(r"\\textbf\s*\{", source):
        value, _ = _group(source, match.end() - 1)
        value = _tex_text(value)
        if value:
            bold.append(value)
    warnings = []
    if re.search(r"\\(?:input|include)\b", source):
        warnings.append("已读取 TeX 正文；input/include 引用的其他文档未载入。")
    if not matches:
        warnings.append("未识别标准简历模块，请核对提取结果。")
        all_text = [_tex_text(source)]
    profile = {}
    contact = " | ".join(header)
    age = re.search(r"(?:^|[|\s])([1-9]\d)岁", contact)
    gender = re.search(r"(?:^|[|\s])(男|女)(?:[|\s]|$)", contact)
    political = re.search(r"中共(?:预备)?党员|共青团员|群众", contact)
    website = re.search(r"https?://[^\s|]+", contact)
    for key, value in (("age", age.group(1) if age else ""), ("gender", gender.group(1) if gender else ""), ("political", political.group(0) if political else ""), ("website", website.group(0) if website else "")):
        if value:
            profile[key] = value
    if len(header) > 2:
        profile["summary"] = header[-1]
    return ResumeDocument(text="\n".join(all_text), profile=profile, experiences=records if matches else None, bold_phrases=bold, warnings=warnings)


def _snapshot_records(snapshot: dict[str, Any]) -> tuple[dict[str, str], list[dict[str, Any]]]:
    profile = {key: _plain(value) for key, value in (snapshot.get("profile") or {}).items() if key in {"name", "title", "email", "phone", "age", "gender", "political", "arrival", "summary", "website", "location"}}
    kinds = {"education": "education", "internship": "experience", "experience": "experience", "work": "experience", "project": "project", "projects": "project", "skills": "skill", "skill": "skill", "self": "summary", "awards": "award", "campus": "campus", "research": "research"}
    records = []
    sections = snapshot.get("sections")
    if not isinstance(sections, list):
        raise ValueError("JSON 简历缺少 sections 数组")
    for section in sections:
        if not isinstance(section, dict) or not isinstance(section.get("items", []), list):
            raise ValueError("JSON 简历模块格式无效")
        kind = kinds.get(str(section.get("sectionType") or section.get("id") or ""), "other")
        label = _plain(section.get("title") or section.get("tab")) or "其他经历"
        for item in section.get("items", []):
            if not isinstance(item, dict) or not isinstance(item.get("fields", {}), dict):
                raise ValueError("JSON 简历条目格式无效")
            fields = item.get("fields") or {}
            organization = _plain(fields.get("school") or fields.get("company") or fields.get("organization"))
            title = _plain(fields.get("projectName") or organization or fields.get("title") or item.get("metaRight")) or label
            role = _plain(fields.get("major") or fields.get("role"))
            if fields.get("gpa"):
                role = f"{role} GPA:{_plain(fields['gpa'])}".strip()
            time = fields.get("timeRange")
            start, end = (_plain(time.get("start")), "至今" if time.get("current") else _plain(time.get("end"))) if isinstance(time, dict) else _date_pair(_plain(time or item.get("metaLeft")))
            summary = _plain(item.get("body")).replace("\r", "")
            if title or summary:
                records.append(_record(kind, label, title, organization=organization, role=role, start=start, end=end, summary=summary))
    return profile, records


def read_json(raw: bytes) -> ResumeDocument:
    try:
        payload = json.loads(raw.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError) as exc:
        raise ValueError("JSON 简历格式无效，请检查文件编码与结构") from exc
    if not isinstance(payload, dict):
        raise ValueError("JSON 简历根节点必须是对象")
    if "workbench" in payload:
        raise ValueError("这是旧版工作区文件，请使用“迁移旧工作区”导入")
    if isinstance(payload.get("content_json"), dict):
        payload = payload["content_json"]
    if isinstance(payload.get("editor_snapshot"), dict):
        payload = payload["editor_snapshot"]
    elif isinstance(payload.get("snapshot"), dict):
        payload = payload["snapshot"]
    warnings, photo, bold = [], "", []
    if "profile" in payload and "sections" in payload:
        if not isinstance(payload.get("profile"), dict):
            raise ValueError("JSON 简历 profile 必须是对象")
        profile, records = _snapshot_records(payload)
        photo = _json_photo(payload["profile"].get("photo"), warnings) if payload["profile"].get("showPhoto") is not False else ""
        for section in payload["sections"]:
            for item in section.get("items", []):
                body = item.get("body")
                if isinstance(body, str):
                    bold.extend(_plain(value) for value in re.findall(r"<(?:strong|b)\b[^>]*>(.*?)</(?:strong|b)>", body, flags=re.I | re.S) if _plain(value))
    elif isinstance(payload.get("basics"), dict):
        basics = payload["basics"]
        photo = _json_photo(basics.get("image"), warnings)
        location = basics.get("location") if isinstance(basics.get("location"), dict) else {}
        profile = {"name": _plain(basics.get("name")), "title": _plain(basics.get("label")), "email": _plain(basics.get("email")), "phone": _plain(basics.get("phone")), "summary": _plain(basics.get("summary")), "website": _plain(basics.get("url")), "location": _plain(location.get("city"))}
        records = []
        for key, kind, label in (("education", "education", "教育背景"), ("work", "experience", "工作经历"), ("projects", "project", "项目经历"), ("skills", "skill", "工作技能"), ("awards", "award", "荣誉奖项"), ("volunteer", "campus", "志愿经历"), ("publications", "research", "科研经历")):
            values = payload.get(key, [])
            if not isinstance(values, list):
                raise ValueError(f"JSON 简历 {key} 必须是数组")
            for value in values:
                if not isinstance(value, dict):
                    raise ValueError(f"JSON 简历 {key} 条目必须是对象")
                organization = _plain(value.get("institution") or value.get("name") or value.get("organization")) if kind in {"education", "experience", "campus"} else ""
                title = organization or _plain(value.get("name") or value.get("title")) or label
                role = _plain(value.get("position") or " | ".join(_plain(value.get(k)) for k in ("area", "studyType") if value.get(k)) or value.get("awarder"))
                highlights = value.get("highlights") or value.get("keywords") or []
                if not isinstance(highlights, list):
                    raise ValueError("JSON 简历 highlights/keywords 必须是数组")
                summary = "\n".join(part for part in [_plain(value.get("summary") or value.get("description")), *[_plain(item) for item in highlights]] if part)
                if value.get("score"):
                    role = f"{role} GPA:{_plain(value['score'])}".strip()
                records.append(_record(kind, label, title, organization=organization, role=role, start=_plain(value.get("startDate")), end=_plain(value.get("endDate")), summary=summary))
    else:
        raise ValueError("JSON 简历需使用 FetchCV 快照（profile + sections）或 JSON Resume（basics）格式")
    if len(records) > 200:
        raise ValueError("简历经历不能超过 200 项")
    text = "\n".join([*(value for value in profile.values() if value), *(record["section"] + "\n" + record["content"] for record in records)])
    return ResumeDocument(text=text, profile=profile, experiences=records, photo=photo, warnings=warnings, bold_phrases=bold)


def _tex_photo(path: Path, raw: bytes, warnings: list[str]) -> str:
    source = re.sub(r"(?m)(?<!\\)%.*$", "", raw.decode("utf-8-sig"))
    candidates = []
    root = path.parent.resolve()
    seen = set()
    for match in re.finditer(r"\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^{}]+)\}", source):
        reference = match.group(1).strip()
        if reference in seen:
            continue
        seen.add(reference)
        if len(seen) > 20:
            warnings.append("图片引用较多，仅检查前 20 张。")
            break
        if not reference or any(char in reference for char in "\\:$%#\x00") or Path(reference).is_absolute() or Path(reference).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
            warnings.append("已跳过不支持的图片引用；仅载入简历目录内的 PNG/JPEG。")
            continue
        try:
            image_path = (root / reference).resolve(strict=True)
            if not image_path.is_relative_to(root) or not image_path.is_file() or image_path.stat().st_size > MAX_PHOTO_BYTES:
                warnings.append("已跳过目录外或超过 5MB 的图片引用。")
                continue
            with image_path.open("rb") as stream:
                data = stream.read(MAX_PHOTO_BYTES + 1)
            candidates.append((image_path.name, data))
        except OSError:
            warnings.append("部分头像图片未找到，可在编辑器中重新添加。")
    return _pick_photo(candidates, warnings)


def read_document(path: Path, raw: bytes) -> ResumeDocument:
    readers = {".docx": read_docx, ".tex": read_tex, ".json": read_json}
    reader = readers.get(path.suffix.lower())
    if reader is None:
        raise ValueError("请选择 PDF、Word（.docx）、LaTeX（.tex）或 JSON 简历")
    document = reader(raw)
    if path.suffix.lower() == ".tex":
        document.photo = _tex_photo(path, raw, document.warnings)
    if not document.text.strip():
        raise ValueError("文件中没有可读取的简历正文")
    if len(document.text) > MAX_TEXT_CHARS:
        raise ValueError("简历正文过长，请缩减到 500,000 字以内")
    return document
