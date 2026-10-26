"""Native XeLaTeX rendering of safe structured resume snapshots.

The only executable TeX is the application's fixed template. Imported LaTeX,
HTML attributes, file paths and hyperlinks are always treated as plain text.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile
import unicodedata
from dataclasses import dataclass
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image
from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject

from integrations.resume.latex_template import PREAMBLE
from integrations.resume.latex_runtime import BUNDLED_FONT_PREAMBLE, SYSTEM_FONT_PREAMBLE, GB1_UNICODE_MAP, LatexRuntime, XeLatexUnavailable, prepare_environment, resolve_runtime

RENDERER_VERSION = 4
RENDERER_NAME = "didi-xelatex"
_MAX_TEXT = 500_000
_TEX_ESCAPE = {"\\": r"\textbackslash{}", "{": r"\{", "}": r"\}", "$": r"\$", "&": r"\&", "#": r"\#", "%": r"\%", "_": r"\_", "^": r"\textasciicircum{}", "~": r"\textasciitilde{}", "\u2009": r"\,", "\u2002": r"\enspace{}", "\u2003": r"\quad{}"}


class XeLatexCompileError(RuntimeError):
    pass


def xelatex_executable() -> str | None:
    runtime = resolve_runtime()
    return str(runtime.executable) if runtime else None


def xelatex_available() -> bool:
    try:
        return xelatex_executable() is not None
    except XeLatexUnavailable:
        return False


def _text(value: Any) -> str:
    return str(value) if isinstance(value, (str, int, float)) and not isinstance(value, bool) else ""


def escape_tex(value: Any) -> str:
    text = _text(value).replace("\x00", "")
    text = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
    # Preserve the common formula notation emitted by the static TeX importer.
    parts = re.split(r"([A-Za-z]\^[0-9]+)", text)
    rendered = []
    for part in parts:
        if re.fullmatch(r"[A-Za-z]\^[0-9]+", part):
            letter, exponent = part.split("^")
            rendered.append(r"\(" + letter + "^{" + exponent + r"}\)")
        else:
            rendered.append("".join(_TEX_ESCAPE.get(char, r"\textsuperscript{2}" if char == "²" else r"\textsuperscript{3}" if char == "³" else char) for char in part))
    return "".join(rendered)


@dataclass
class _Part:
    text: str
    bold: bool | None = None
    italic: bool = False
    superscript: bool = False


class _RichLines(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.lines: list[list[_Part]] = [[]]
        self.stack: list[tuple[str, bool | None, bool, bool]] = []
        self.suppressed = 0

    def newline(self):
        if self.lines[-1]:
            self.lines.append([])

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in {"script", "style", "iframe", "object"}:
            self.suppressed += 1
        if self.suppressed:
            return
        if tag in {"p", "div", "li", "br", "tr"}:
            self.newline()
        style = dict(attrs).get("style", "") or ""
        weight = re.search(r"font-weight\s*:\s*(bold|normal|[1-9]00)", style, re.I)
        bold = tag in {"b", "strong"} or None
        if weight:
            bold = weight[1].lower() == "bold" or (weight[1].isdigit() and int(weight[1]) >= 600)
        if tag not in {"br", "img", "hr", "input"}:
            self.stack.append((tag, bold, tag in {"i", "em"}, tag == "sup"))

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in {"script", "style", "iframe", "object"} and self.suppressed:
            self.suppressed -= 1
            return
        if self.suppressed:
            return
        if tag in {"p", "div", "li", "tr"}:
            self.newline()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data):
        if self.suppressed:
            return
        for index, line in enumerate(data.replace("\r", "").split("\n")):
            if index:
                self.newline()
            if line:
                bold = next((s[1] for s in reversed(self.stack) if s[1] is not None), None)
                self.lines[-1].append(_Part(line, bold, any(s[2] for s in self.stack), any(s[3] for s in self.stack)))


def _lines(value: Any) -> list[list[_Part]]:
    parser = _RichLines()
    parser.feed(_text(value))
    parser.close()
    result = []
    for line in parser.lines:
        if not "".join(part.text for part in line).strip():
            continue
        line[0].text = re.sub(r"^\s*[•●·]\s*", "", line[0].text).lstrip()
        line[-1].text = line[-1].text.rstrip()
        result.append(line)
    return result


def _rich(parts: list[_Part], *, skill=False) -> str:
    result = []
    for part in parts:
        text = escape_tex(part.text)
        if skill and not any(char in part.text for char in ("\u2002", "\u2003")):
            text = re.sub(r"\s*\|\s*", r"\\enspace|\\enspace ", text)
        if part.superscript:
            text = r"\textsuperscript{" + text + "}"
        if part.italic:
            text = r"\textit{" + text + "}"
        if part.bold is True:
            text = r"\textbf{" + text + "}"
        elif part.bold is False:
            text = r"{\mdseries " + text + "}"
        result.append(text)
    return "".join(result)


def _inline(value: Any) -> str:
    return " ".join(_rich(line) for line in _lines(value))


def _plain(value: Any) -> str:
    return " ".join("".join(part.text for part in line) for line in _lines(value))


def rich_text_equivalent(rich: Any, plain: Any) -> bool:
    """Accept formatting only when it preserves the complete plain content."""
    def normalize(value):
        value = unicodedata.normalize("NFKC", _plain(value))
        value = re.sub(r"(?<=[A-Za-z])\^(?=\d)", "", value)
        return re.sub(r"\s+", "", value)
    return bool(_text(rich)) and normalize(rich) == normalize(plain)


def _number(value, default, minimum, maximum):
    try:
        value = float(value)
        return value if math.isfinite(value) and minimum <= value <= maximum else default
    except (ValueError, TypeError):
        return default


def _layout(snapshot: dict) -> dict[str, float]:
    settings = snapshot.get("settings") or {}
    layout = {"size": 10.2, "leading": 14.6, "margin": 12.7, "name": 18.0, "gap": .8}
    if settings.get("templatePreset") == "didi-v2":
        layout["size"] = _number(settings.get("fontSize"), 10.2 * 96 / 72.27, 10.5, 24) * 72.27 / 96
        layout["leading"] = layout["size"] * _number(settings.get("lineHeight"), 14.6 / 10.2 * 100, 105, 220) / 100
        layout["margin"] = _number(settings.get("margin"), 48, 24, 90) * 25.4 / 96
        layout["name"] = _number(settings.get("nameSize"), 18 * 96 / 72.27, 18, 56) * 72.27 / 96
        layout["gap"] = _number(settings.get("spacing"), .8 * 96 / 25.4, 0, 30) * 25.4 / 96
    return layout


def document_fingerprint(snapshot: dict) -> str:
    # Hash executable output rather than editor bookkeeping or migration keys.
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("profile"), dict):
        raise ValueError("简历缺少有效的结构化内容")
    profile = snapshot.get("profile") or {}
    photo = profile.get("photo") if profile.get("showPhoto") is not False else ""
    photo = photo if isinstance(photo, str) else ""
    filename = ("resume-photo.png" if photo.startswith("data:image/png;") else "resume-photo.jpg") if photo else ""
    runtime = resolve_runtime()
    source = build_tex(snapshot, photo_filename=filename, font_mode=runtime.font_mode if runtime else "system")
    runtime_key = runtime.fingerprint if runtime else "unavailable"
    value = f"{RENDERER_NAME}:{RENDERER_VERSION}\0{runtime_key}\0{source}\0{hashlib.sha256(photo.encode()).hexdigest()}"
    return hashlib.sha256(value.encode()).hexdigest()


def _date(value: Any) -> str:
    return re.sub(r"((?:19|20)\d{2})-(\d{2})(?:-\d{2})?", r"\1.\2", _plain(value))


def _metadata(section: dict, item: dict) -> tuple[str, str, str]:
    fields = item.get("fields") if isinstance(item.get("fields"), dict) else {}
    title = next((_inline(fields.get(key)) for key in ("school", "company", "projectName", "organization", "title") if fields.get(key)), "")
    role = " | ".join(_inline(fields.get(key)) for key in ("major", "degree", "role") if fields.get(key))
    gpa = _plain(fields.get("gpa"))
    if gpa:
        role += (" | " if role else "") + r"\mdseries GPA:" + escape_tex(gpa).replace("/", r"\,/\,")
    period = fields.get("timeRange")
    if isinstance(period, dict):
        date = "--".join(value for value in (_date(period.get("start")), "至今" if period.get("current") else _date(period.get("end"))) if value)
    else:
        date = re.sub(r"\s*(?:~|—|–)\s*", "--", _date(period or item.get("metaLeft")))
    if not title:
        title = _inline(item.get("metaRight") or item.get("title"))
    if not role:
        role = _inline(item.get("subtitle"))
    meta = item.get("metaRich") if isinstance(item.get("metaRich"), dict) else {}
    plain_title = next((fields.get(key) for key in ("school", "company", "projectName", "organization", "title") if fields.get(key)), item.get("metaRight") or item.get("title") or "")
    plain_role = " | ".join(_plain(fields.get(key)) for key in ("major", "degree", "role") if fields.get(key))
    if gpa:
        plain_role += (" | " if plain_role else "") + "GPA:" + gpa
    if rich_text_equivalent(meta.get("title"), plain_title):
        title = _inline(meta["title"])
    if rich_text_equivalent(meta.get("role"), plain_role or item.get("subtitle")):
        role = _inline(meta["role"])
        phantom = _number(meta.get("roleLeadingPhantomEm"), 0, 0, 3)
        if phantom:
            role = r"\hspace{" + f"{phantom:.6f}em" + "}" + role
    return title, role, escape_tex(date)


def _body(item: dict, *, project=False, education=False, custom_leading=None, size=10.2) -> str:
    lines = _lines(item.get("body") or item.get("content") or "")
    if not lines:
        return ""
    intro = []
    if project:
        while lines and re.match(r"^(?:项目概述|项目介绍|概述|背景|项目背景)[：:]", "".join(part.text for part in lines[0])):
            intro.append(r"{\songti " + _rich(lines.pop(0)) + r"}\par")
    result = []
    if custom_leading:
        result.append(r"\begingroup\fontsize{" + f"{size:.6f}pt" + "}{" + f"{custom_leading:.6f}pt" + r"}\selectfont")
    result.extend(intro)
    if lines:
        result.append(r"\begin{resumeItems}")
        result.extend(r"  \item " + _rich(line) for line in lines)
        result.append(r"\end{resumeItems}")
    if custom_leading:
        result.append(r"\endgroup")
    return "\n".join(result)


def _skills(items: list[dict], *, custom_leading: float | None = None, size: float = 10.2) -> str:
    rows = []
    for item in items:
        for parts in _lines(item.get("body") or ""):
            joined = "".join(part.text for part in parts)
            match = re.match(r"^([^：:]{1,16})[：:]\s*", joined)
            if match:
                cut = match.end()
                rest = []
                for part in parts:
                    if cut >= len(part.text):
                        cut -= len(part.text)
                    else:
                        rest.append(_Part(part.text[cut:], part.bold, part.italic, part.superscript))
                        cut = 0
                rows.append(escape_tex(match.group(1) + "：") + " & " + _rich(rest, skill=True))
            else:
                rows.append(r"\multicolumn{2}{@{}p{\textwidth}@{}}{" + _rich(parts, skill=True) + "}")
    if not rows:
        return ""
    spacing = r"\contentSpacing"
    if custom_leading is not None:
        spacing = r"\fontsize{" + f"{size:.6f}pt" + "}{" + f"{custom_leading:.6f}pt" + r"}\selectfont"
    return "\n".join([r"{\songti", r"\renewcommand{\arraystretch}{1.00}", spacing, r"\vspace{0.6mm}", r"\begin{tabularx}{\textwidth}{@{}>{\bfseries}p{5.2em}@{\hspace{0.55em}}X@{}}", " \\\\\n".join(rows), r"\end{tabularx}}"])


def build_tex(snapshot: dict, *, photo_filename: str = "", font_mode: str = "system") -> str:
    """Generate executable TeX only from fixed macros and escaped snapshot text."""
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("profile"), dict) or not isinstance(snapshot.get("sections"), list):
        raise ValueError("简历缺少有效的结构化内容")
    if snapshot.get("settings") is not None and not isinstance(snapshot["settings"], dict):
        raise ValueError("简历排版设置无效")
    if len(json.dumps({k: v for k, v in snapshot.items() if k != "profile"}, ensure_ascii=False)) > _MAX_TEXT * 4:
        raise ValueError("简历正文过长，无法排版")
    if photo_filename not in {"", "resume-photo.jpg", "resume-photo.png"}:
        raise ValueError("无效的头像资源")
    layout = _layout(snapshot)
    profile = snapshot["profile"]
    preamble = PREAMBLE
    if font_mode in {"bundled", "system"}:
        start = preamble.index(r"\IfFontExistsTF{Times New Roman}")
        finish = preamble.index(r"\newcommand{\songti}", start)
        preamble = preamble[:start] + (BUNDLED_FONT_PREAMBLE if font_mode == "bundled" else SYSTEM_FONT_PREAMBLE) + preamble[finish:]
    else:
        raise ValueError("无效的简历字体模式")
    if (snapshot.get("settings") or {}).get("templatePreset") == "didi-v2":
        preamble = preamble.replace("left=1.27cm,right=1.27cm", f"left={layout['margin']:.6f}mm,right={layout['margin']:.6f}mm")
        preamble = preamble.replace("14.40pt", f"{layout['leading'] - .2:.6f}pt").replace("10.2pt", f"{layout['size']:.6f}pt")
        preamble = preamble.replace("[0.8mm]", f"[{layout['gap']:.6f}mm]")
        scale = layout["size"] / 10.2
        for original in ("10.8", "11.3", "10.4", "10.9", "14"):
            preamble = preamble.replace("{" + original + "pt}", "{" + f"{float(original) * scale:.6f}pt" + "}")
        preamble = preamble.replace(r"\resumeSpacing[-2.5pt]", r"\fontsize{" + f"{layout['size']:.6f}pt" + "}{" + f"{11.9 * scale:.6f}pt" + r"}\selectfont")
    chunks = [preamble, r"\begin{document}", r"\begin{tikzpicture}[remember picture,overlay]"]
    if photo_filename and profile.get("showPhoto") is not False:
        chunks.extend([r"  \node[anchor=north east,inner sep=0pt]", r"    at ([xshift=-0.60cm,yshift=-0.20cm]current page.north east)", r"    {\includegraphics[width=2.30cm,height=3.07cm,keepaspectratio]{" + photo_filename + "}};"])
    contact = []
    age = _plain(profile.get("age"))
    if re.fullmatch(r"\d+", age):
        age += "岁"
    for value in [age, *[profile.get(key) for key in ("gender", "political", "phone", "email", "website", "arrival", "workYears", "location", "marital", "height", "weight", "ethnicity", "domicile")]]:
        if _plain(value) and _plain(value) != "不填":
            contact.append(_inline(value))
    for field in profile.get("custom") or []:
        if isinstance(field, dict) and field.get("value") and field.get("visible") is not False:
            contact.append((_inline(field.get("label")) + "：" if field.get("label") else "") + _inline(field["value"]))
    name_size = f"{layout['name']:.6f}".rstrip("0").rstrip(".")
    chunks.extend([r"  \node[anchor=north,inner sep=0pt,text width=\textwidth,align=center]", r"    at ([yshift=-0.70cm]current page.north)", r"    {\mbox{\fontsize{" + name_size + "pt}{" + name_size + r"pt}\selectfont\bfseries " + _inline(profile.get("name")) + r"}\par", r"     \vspace{2.40mm}", r"     \mbox{" + " | ".join(contact) + r"}\par"])
    if profile.get("summary"):
        chunks.append(r"     \makebox[\textwidth][c]{\mdseries " + _inline(profile["summary"]) + r"}\par")
    chunks.extend(["    };", r"\end{tikzpicture}", r"\vspace*{2.15cm}"])
    for section in snapshot["sections"]:
        if not isinstance(section, dict) or section.get("visible") is False:
            continue
        if not isinstance(section.get("items", []), list):
            raise ValueError("简历模块内容无效")
        items = [item for item in section.get("items", []) if isinstance(item, dict)]
        title = _inline(section.get("title") or section.get("tab") or "")
        if not items and not title:
            continue
        kind = str(section.get("id") or section.get("kind") or "")
        skill = kind in {"skill", "skills"} or "技能" in _plain(section.get("title"))
        education = kind == "education" or "教育" in _plain(section.get("title"))
        project = kind in {"project", "projects"} or "项目" in _plain(section.get("title"))
        chunks.append(r"\resumeSection" + ("[1.5mm]" if skill else "") + "{" + title + "}")
        if skill:
            leading = None
            if (snapshot.get("settings") or {}).get("templatePreset") == "didi-v2" and section.get("lineHeight"):
                leading = layout["size"] * _number(section["lineHeight"], layout["leading"] / layout["size"] * 100, 105, 220) / 100
            chunks.append(_skills(items, custom_leading=leading, size=layout["size"]))
            continue
        chunks.append(r"\begingroup")
        if education:
            chunks.extend([r"\renewcommand{\entryfont}{\eduEntryFont}", r"\educationSpacing"])
        else:
            chunks.append(r"\contentSpacing")
        for item in items:
            name, role, date = _metadata(section, item)
            if name or role or date:
                command = r"\projectEntry" if project else r"\tripleEntry[0.20mm]" if education else r"\tripleEntry"
                chunks.append(command + "{" + name + "}{" + role + "}{" + date + "}")
            leading = None
            if (snapshot.get("settings") or {}).get("templatePreset") == "didi-v2":
                if section.get("lineHeight"):
                    leading = layout["size"] * _number(section["lineHeight"], 14.6 / 10.2 * 100, 105, 220) / 100
                style = item.get("richStyle") if isinstance(item.get("richStyle"), dict) else {}
                custom = style.get("lineHeight")
                if custom:
                    leading = layout["size"] * _number(custom, layout["leading"] / layout["size"], 1.05, 2.2)
            chunks.append(_body(item, project=project, education=education, custom_leading=leading, size=layout["size"]))
        chunks.append(r"\endgroup")
    chunks.append(r"\end{document}")
    return "\n".join(chunks) + "\n"


def _write_photo(snapshot: dict, directory: Path) -> str:
    profile = snapshot.get("profile") or {}
    if profile.get("showPhoto") is False:
        return ""
    value = profile.get("photo")
    if not isinstance(value, str) or not value:
        return ""
    if len(value) > 7_000_000:
        raise ValueError("头像超过 5MB 限制")
    match = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)", value)
    if not match:
        raise ValueError("头像必须是内嵌 PNG 或 JPEG")
    try:
        raw = base64.b64decode(re.sub(r"\s+", "", match[2]), validate=True)
        if len(raw) > 5 * 1024 * 1024:
            raise ValueError("头像超过 5MB 限制")
        with Image.open(BytesIO(raw)) as image:
            if image.format not in {"PNG", "JPEG"} or image.width * image.height > 16_000_000:
                raise ValueError("头像格式或尺寸无效")
            image.verify()
    except (binascii.Error, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("头像图片无效") from exc
    filename = "resume-photo.png" if match[1] == "png" else "resume-photo.jpg"
    (directory / filename).write_bytes(raw)
    return filename


def _embed_cjk_unicode_map(path: Path, runtime: LatexRuntime) -> None:
    """Make standard Adobe GB1 text independently extractable by all readers.

    XeTeX's Fandol CFF font uses the predefined Adobe-GB1 character collection.
    Some readers supply its Unicode CMap; others (including pypdf) do not. Add
    the unmodified, bundled Adobe mapping only where an explicit map is absent.
    Page contents, font programs, metrics and existing Unicode maps are intact.
    """
    if runtime.font_mode != "bundled":
        return
    reader = PdfReader(path)

    def needs_mapping(font):
        if "/ToUnicode" in font or "FandolSong-" not in str(font.get("/BaseFont", "")):
            return False
        descendants = font.get("/DescendantFonts") or []
        if not descendants:
            return False
        info = descendants[0].get_object().get("/CIDSystemInfo", {})
        if hasattr(info, "get_object"):
            info = info.get_object()
        return info.get("/Registry") == "Adobe" and info.get("/Ordering") == "GB1"

    def fonts(document):
        for page in document.pages:
            resource_fonts = page["/Resources"].get_object().get("/Font", {})
            if hasattr(resource_fonts, "get_object"):
                resource_fonts = resource_fonts.get_object()
            for value in resource_fonts.values():
                yield value.get_object()

    if not any(needs_mapping(font) for font in fonts(reader)):
        return
    mapping = runtime.font_root / GB1_UNICODE_MAP if runtime.font_root else None
    if mapping is None or not mapping.is_file():
        raise XeLatexCompileError("内置中文字符映射缺失，请重新准备排版运行时。")
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    stream = DecodedStreamObject()
    stream.set_data(mapping.read_bytes())
    reference = writer._add_object(stream.flate_encode())
    for font in fonts(writer):
        if needs_mapping(font):
            font[NameObject("/ToUnicode")] = reference
    mapped = path.with_name("unicode.pdf")
    writer.write(mapped)
    os.replace(mapped, path)


def compile_snapshot(snapshot: dict, target_pdf: str | Path, *, timeout: float = 45) -> int:
    """Compile twice for TikZ anchors, atomically publish, and return real pages."""
    runtime = resolve_runtime()
    if runtime is None:
        raise XeLatexUnavailable("排版运行时未就绪，请先准备应用内置运行时。")
    target = Path(target_pdf).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fetchcv-latex-", dir=target.parent) as temporary:
        directory = Path(temporary)
        photo = _write_photo(snapshot, directory)
        (directory / "document.tex").write_text(build_tex(snapshot, photo_filename=photo, font_mode=runtime.font_mode), encoding="utf-8")
        # XeTeX needs the installed font/package search paths. Every input
        # command is application-owned; untrusted text has already been escaped.
        env = prepare_environment(runtime, directory)
        # Do not resolve this private junction back to the installed path: the
        # ASCII alias also prevents xdvipdfmx's Windows launch path from breaking.
        executable = directory / "runtime/bin/windows/xelatex.exe" if runtime.root is not None and os.name == "nt" else runtime.executable
        command = [str(executable), "-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "-file-line-error", "-jobname=resume", "document.tex"]
        commands = [command, command]
        if runtime.root is not None and os.name == "nt":
            # XeTeX's internal Windows pipe converts its absolute driver path
            # through the active code page. Launch that same driver directly
            # with Unicode Windows APIs so Chinese user-data paths also work.
            command.insert(1, "-no-pdf")
            commands.append([str(executable.with_name("xdvipdfmx.exe")), "-q", "-E", "-o", "resume.pdf", "resume.xdv"])
        try:
            for command in commands:
                result = subprocess.run(command, cwd=directory, env=env, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
                if result.returncode:
                    log = result.stdout.decode("utf-8", errors="replace")
                    if "I can't write on file" in log:
                        raise XeLatexCompileError("无法写入排版临时目录，请检查简历保存目录的权限。")
                    problem = next((line for line in log.splitlines() if line.startswith("!") or ("document.tex:" in line and "Error" in line)), "请检查模板所需字体与 LaTeX 宏包。")
                    raise XeLatexCompileError("简历排版失败：" + problem[:300])
        except subprocess.TimeoutExpired as exc:
            raise XeLatexCompileError("简历排版超时，请减少内容后重试。") from exc
        except OSError as exc:
            raise XeLatexUnavailable("无法启动排版组件，请检查应用安装是否完整。") from exc
        compiled = directory / "resume.pdf"
        if not compiled.is_file() or not compiled.read_bytes().startswith(b"%PDF-"):
            raise XeLatexCompileError("XeLaTeX 未生成有效的 PDF。")
        _embed_cjk_unicode_map(compiled, runtime)
        pages = len(PdfReader(compiled).pages)
        if not pages:
            raise XeLatexCompileError("简历 PDF 没有页面。")
        # The final move is atomic; parallel previews never expose partial PDFs.
        os.replace(compiled, target)
        return pages
