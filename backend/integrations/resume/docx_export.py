"""Generate a conservative, single-column ATS-friendly DOCX resume.

The canonical PDF remains the layout-faithful application artifact.  This
export intentionally avoids tables, text boxes, icons, columns and floating
objects so downstream parsers can read the document in natural order.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from html import unescape
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile

from applyos_domain.models import ResumeVersion


DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _plain(value: object) -> str:
    text = unescape(str(value or ""))
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</(?:p|div|li|h[1-6])>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\u00a0", " ").replace("\r", "")
    return re.sub(r"[ \t]+", " ", text).strip()


def _run(text: str, *, bold: bool = False, size: int = 21, color: str = "272725") -> str:
    props = [
        '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="等线"/>',
        f'<w:color w:val="{color}"/>',
        f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>',
    ]
    if bold:
        props.append("<w:b/><w:bCs/>")
    return f'<w:r><w:rPr>{"".join(props)}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _paragraph(
    text: str,
    *,
    bold: bool = False,
    size: int = 21,
    color: str = "272725",
    before: int = 0,
    after: int = 60,
    align: str | None = None,
    border: bool = False,
    bullet: bool = False,
) -> str:
    ppr = [f'<w:spacing w:before="{before}" w:after="{after}" w:line="276" w:lineRule="auto"/>']
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if border:
        ppr.append('<w:pBdr><w:bottom w:val="single" w:sz="5" w:space="3" w:color="D8D3CC"/></w:pBdr>')
    if bullet:
        ppr.append('<w:ind w:left="240" w:hanging="180"/>')
        text = f"• {text}"
    return f'<w:p><w:pPr>{"".join(ppr)}</w:pPr>{_run(text, bold=bold, size=size, color=color)}</w:p>'


def _first(mapping: dict, *keys: str) -> str:
    for key in keys:
        value = _plain(mapping.get(key))
        if value:
            return value
    return ""


def _document_xml(resume: ResumeVersion) -> str:
    snapshot = (resume.content_json or {}).get("editor_snapshot") or {}
    profile = snapshot.get("profile") or {}
    sections = snapshot.get("sections") or []
    body: list[str] = []

    name = _first(profile, "name", "fullName") or resume.name
    body.append(_paragraph(name, bold=True, size=34, before=0, after=80, align="center"))
    contact = [
        _first(profile, "phone", "mobile"),
        _first(profile, "email"),
        _first(profile, "location", "city"),
        _first(profile, "website", "portfolio", "github"),
    ]
    contact_line = "  |  ".join(item for item in contact if item)
    if contact_line:
        body.append(_paragraph(contact_line, size=19, color="5F605C", after=120, align="center"))

    summary = _first(profile, "summary", "objective", "headline")
    if summary:
        body.append(_paragraph("个人概述", bold=True, size=23, before=100, after=70, border=True))
        for line in filter(None, (_plain(item) for item in summary.split("\n"))):
            body.append(_paragraph(line, after=55))

    for section in sections:
        if not isinstance(section, dict):
            continue
        title = _first(section, "title", "name")
        items = section.get("items") or []
        if not title or not items:
            continue
        body.append(_paragraph(title, bold=True, size=23, before=120, after=70, border=True))
        for item in items:
            if not isinstance(item, dict):
                continue
            fields = item.get("fields") if isinstance(item.get("fields"), dict) else {}
            left = _first(item, "title", "metaRight") or _first(fields, "company", "school", "project", "title")
            right = _first(item, "metaLeft", "timeRange", "date") or _first(fields, "date", "timeRange")
            subtitle = _first(item, "subtitle") or _first(fields, "role", "degree", "major")
            heading = "  |  ".join(part for part in [left, subtitle, right] if part)
            if heading:
                body.append(_paragraph(heading, bold=True, size=21, before=55, after=35))
            raw_body = _first(item, "body", "description", "summary")
            for line in filter(None, (_plain(value) for value in raw_body.split("\n"))):
                cleaned = re.sub(r"^[•·▪◦\-—]+\s*", "", line)
                body.append(_paragraph(cleaned, after=35, bullet=True))

    if len(body) <= 2:
        body.append(_paragraph("当前简历没有可导出的结构化正文。", color="777872"))

    section_properties = (
        '<w:sectPr>'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="360" w:footer="360" w:gutter="0"/>'
        '<w:cols w:num="1" w:space="0"/>'
        '<w:docGrid w:linePitch="312"/>'
        '</w:sectPr>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{"".join(body)}{section_properties}</w:body></w:document>'
    )


def render_resume_docx(resume: ResumeVersion, output_path: Path) -> Path:
    """Write a valid OOXML DOCX without adding a heavyweight office runtime."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    created = datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
    parts = {
        "[Content_Types].xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
            '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
            '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
            '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
            '</Types>'
        ),
        "_rels/.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
            '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
            '</Relationships>'
        ),
        "word/document.xml": _document_xml(resume),
        "word/styles.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:eastAsia="等线"/>'
            '<w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>'
            '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
            '</w:styles>'
        ),
        "word/_rels/document.xml.rels": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '</Relationships>'
        ),
        "docProps/core.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
            'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" '
            'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
            f'<dc:title>{escape(resume.name)}</dc:title><dc:creator>FetchCV</dc:creator>'
            f'<dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>'
            '</cp:coreProperties>'
        ),
        "docProps/app.xml": (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">'
            '<Application>FetchCV</Application><AppVersion>1.0</AppVersion></Properties>'
        ),
    }
    pending = output_path.with_suffix(output_path.suffix + ".pending")
    with ZipFile(pending, "w", ZIP_DEFLATED) as archive:
        for name, content in parts.items():
            archive.writestr(name, content.encode("utf-8"))
    pending.replace(output_path)
    return output_path
