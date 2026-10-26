from __future__ import annotations

from hashlib import sha256
import base64
from io import BytesIO
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select
from PIL import Image

from applyos_api.main import create_app
from applyos_domain.models import Candidate, Fact, MaterialAsset, ResumeVersion
from integrations.resume_import.formats import read_document
from integrations.resume_pdf.importer import PdfResumeImporter


TEX_RESUME = r"""\documentclass{ctexart}
\newcommand{\resumeSection}[1]{#1}
\begin{document}
\begin{tikzpicture}[remember picture,overlay]
\node {\mbox{\fontsize{18pt}{18pt}\selectfont\bfseries 测试同学}\par
\mbox{24岁 | 男 | 中共党员 | 13800138000 | test@example.com | https://example.com}\par
\makebox[\textwidth][c]{擅长数据分析与团队协作。}};
\end{tikzpicture}
\resumeSection{教育背景}
\tripleEntry[0.2mm]{示例大学{\mdseries（211）}}{统计学 | 硕士 | GPA:3.5\,/\,4}{2024.09--2027.06}
\begin{resumeItems}\keyitem{国家奖学金}{两次}\end{resumeItems}
\resumeSection{实习经验}
\tripleEntry{示例科技有限公司}{数据分析师}{2026.03--至今}
\begin{resumeItems}\item 使用\textbf{Python}优化分析流程，效率提升\textbf{20\%}。\end{resumeItems}
\resumeSection{项目经历}
\projectEntry{数据分析项目}{竞赛国一}{2025.06--2025.10}
{\songti\textbf{项目概述：}分析用户行为。}\par
\begin{resumeItems}\item 用 SQL 处理数据。\end{resumeItems}
\resumeSection[1.5mm]{工作技能}
\begin{tabularx}{\textwidth}{XX}数据分析： & SQL\enspace|\enspace Python \\
其他技能： & LaTeX\end{tabularx}
\end{document}
"""


JSON_RESUME = {
    "basics": {"name": "Alex Example", "label": "Data Analyst", "email": "alex@example.com", "summary": "I build analytics tools.", "url": "https://example.com"},
    "education": [{"institution": "Example University", "area": "Statistics", "studyType": "Master", "startDate": "2024-09", "endDate": "2027-06", "score": "3.5/4"}],
    "work": [{"name": "Example Company", "position": "Data Analyst", "startDate": "2026-03", "endDate": "2026-06", "highlights": ["Built an analytics workflow.", "Reduced query time by 20%."]}],
    "skills": [{"name": "Analytics", "keywords": ["Python", "SQL"]}],
}


def _docx(path: Path, *, extra: dict[str, str] | None = None) -> Path:
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    xml = f'''<w:document xmlns:w="{ns}"><w:body>
      <w:p><w:r><w:t>Alex Example</w:t></w:r></w:p>
      <w:p><w:r><w:t>alex@example.com 13800138000</w:t></w:r></w:p>
      <w:p><w:r><w:t>Education</w:t></w:r></w:p>
      <w:tbl><w:tr><w:tc><w:p><w:r><w:t>Example University</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Master of Statistics</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>2024.09--2027.06</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
      <w:p><w:r><w:t>Experience</w:t></w:r></w:p>
      <w:p><w:r><w:t>Example Company Data Analyst 2026.03--2026.06</w:t></w:r></w:p>
      <w:p><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>Built analytics tools.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Second Company Analyst 2025.03--2025.06</w:t></w:r></w:p>
      <w:p><w:r><w:t>Worked with SQL and Python.</w:t></w:r></w:p>
      <w:p><w:r><w:t>Skills</w:t></w:r></w:p><w:p><w:r><w:t>Python SQL Tableau</w:t></w:r></w:p>
    </w:body></w:document>'''
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("word/document.xml", xml)
        for key, value in (extra or {}).items():
            archive.writestr(key, value)
    return path


@pytest.mark.parametrize("source_format", ["docx", "tex", "json"])
def test_uniform_import_preserves_source_and_builds_reviewable_resume(database, tmp_path, monkeypatch, source_format):
    import integrations.resume_pdf.importer as module

    monkeypatch.setattr(module, "artifact_root", lambda *parts: tmp_path.joinpath("artifacts", *parts))
    source = tmp_path / f"resume.{source_format}"
    if source_format == "docx":
        _docx(source)
    elif source_format == "tex":
        source.write_text(TEX_RESUME, encoding="utf-8")
    else:
        source.write_text(json.dumps(JSON_RESUME), encoding="utf-8")
    original = source.read_bytes()
    with TestClient(create_app(database)) as client:
        response = client.post("/api/imports/resume/preview", json={"source_path": str(source)})
        assert response.status_code == 200, response.text
        preview = response.json()
        assert preview["source_format"] == source_format
        assert preview["page_count"] is None
        assert preview["recognition_mode"] == "local"
        assert preview["experiences"]
        assert preview["profile"]["email"] not in preview["outbound_preview"]
        with database.session() as session:
            assert session.scalar(select(Candidate)) is None
        response = client.post("/api/imports/resume", json={"source_path": str(source), "reviewed_preview": {"source_sha256": preview["source_sha256"], "profile": preview["profile"], "experiences": preview["experiences"]}})
        assert response.status_code == 200, response.text
        result = response.json()
        with database.session() as session:
            resume = session.get(ResumeVersion, result["resume_id"])
            material = session.get(MaterialAsset, resume.content_json["source_asset_id"])
            assert resume.pdf_path is None
            assert resume.content_json["source"]["type"] == source_format
            assert material.kind == f"resume_{source_format}"
            assert material.mime_type == preview["mime_type"]
            assert Path(material.source_path).read_bytes() == original
            assert material.metadata_json["sha256"] == sha256(original).hexdigest()
            snapshot = resume.content_json["editor_snapshot"]
            assert snapshot["template"] == "didi"
            assert len(snapshot["sections"]) >= 3
            assert all(not fact.verified for fact in session.scalars(select(Fact)))
            if source_format == "tex":
                assert snapshot["profile"]["website"] == "https://example.com"
                assert snapshot["profile"]["summary"] == "擅长数据分析与团队协作。"
                assert [section["id"] for section in snapshot["sections"]] == ["education", "internship", "project", "skills"]
        duplicate = client.post("/api/imports/resume", json={"source_path": str(source)}).json()
        assert duplicate["duplicate"] is True
        assert duplicate["resume_id"] == result["resume_id"]
        assert source.read_bytes() == original


def test_tex_known_macros_keep_fields_and_do_not_execute_or_follow_sources(tmp_path):
    secret = tmp_path / "secret.tex"
    secret.write_text("EXTERNAL_PRIVATE_DATA", encoding="utf-8")
    source = tmp_path / "resume.tex"
    source.write_text(TEX_RESUME.replace(r"\end{document}", r"\input{secret.tex}\write18{touch injected-file}" + "\n" + r"\end{document}"), encoding="utf-8")
    parsed = read_document(source, source.read_bytes())
    assert "EXTERNAL_PRIVATE_DATA" not in parsed.text
    assert not (tmp_path / "injected-file").exists()
    education, experience, project, skills = parsed.experiences
    assert education["start_date"] == "2024-09" and education["end_date"] == "2027-06"
    assert "GPA:3.5 / 4" in education["role"]
    assert experience["end_date"] == "至今"
    assert "20%" in experience["summary"]
    assert project["title"] == "数据分析项目" and project["role"] == "竞赛国一"
    assert "SQL | Python" in skills["summary"]
    assert "Python" in parsed.bold_phrases
    assert all("\n\n" not in item["summary"] for item in parsed.experiences)
    assert len(experience["summary"].splitlines()) == 1


def test_tex_rich_text_keeps_local_emphasis_and_normal_weight_metadata(tmp_path):
    source = tmp_path / "resume.tex"
    source.write_text(TEX_RESUME.replace(
        r"\keyitem{国家奖学金}{两次}", r"\keyitem{研究生国家奖学金}{（2次），国家奖学金。}",
    ).replace(
        r"\mdseries（211）", r"\mdseries （211）",
    ).replace(
        r"{统计学 | 硕士", r"{\hphantom{数}统计学 | 硕士",
    ).replace(
        r"{数据分析师}{2026.03", r"{智能产品部-\textbf{数据分析师}}{2026.03",
    ).replace(
        r"使用\textbf{Python}优化分析流程，效率提升\textbf{20\%}。",
        r"使用\textbf{Python}优化流程，Python用于分析。\textbf{粗体{\mdseries 正常}粗体}，正常。",
    ), encoding="utf-8")
    parsed = read_document(source, source.read_bytes())
    education, experience, _, skills = parsed.experiences

    assert education["details"]["meta_rich"]["title"] == '<strong>示例大学</strong><span style="font-weight:400">（211）</span>'
    assert education["details"]["meta_rich"]["roleLeadingPhantomEm"] == 1
    assert "数" not in education["details"]["meta_rich"]["role"]
    assert "3.5\u2009/\u20094" in education["details"]["meta_rich"]["role"]
    assert education["details"]["rich_body"] == "• <strong>研究生国家奖学金</strong>（2次），国家奖学金。"
    assert experience["details"]["meta_rich"]["role"] == "智能产品部-<strong>数据分析师</strong>"
    assert experience["details"]["rich_body"] == "• 使用<strong>Python</strong>优化流程，Python用于分析。<strong>粗体</strong>正常<strong>粗体</strong>，正常。"
    assert "<strong>Python</strong>" not in skills["details"]["rich_body"]
    assert experience["summary"] == "• 使用Python优化流程，Python用于分析。粗体正常粗体，正常。"


def test_tex_rich_text_escapes_markup_and_keeps_scoped_groups(tmp_path):
    source = tmp_path / "resume.tex"
    source.write_text(r"""\begin{document}
\resumeSection{工作技能}
\begingroup\bfseries Bold \textmd{normal} \textbf{<script>alert(1)</script>}\endgroup normal
\href{javascript:alert(1)}{<img src=x onerror=alert(1)>}\input{secret.tex}
\end{document}""", encoding="utf-8")
    parsed = read_document(source, source.read_bytes())
    rich = parsed.experiences[0]["details"]["rich_body"]
    assert rich == '<strong>Bold </strong>normal<strong> &lt;script&gt;alert(1)&lt;/script&gt;</strong>normal<br>&lt;img src=x onerror=alert(1)&gt;'
    assert "javascript:" not in rich
    assert "secret.tex" not in rich


def test_tex_rich_text_preserves_explicit_spacing_without_changing_plain_evidence(tmp_path):
    source = tmp_path / "resume.tex"
    source.write_text(r"""\begin{document}
\resumeSection{工作技能}
结果 \textbf{ Prompt 优化}；Python\enspace|\enspace SQL \enspace|\enspace LaTeX。
\end{document}""", encoding="utf-8")
    parsed = read_document(source, source.read_bytes())
    record = parsed.experiences[0]
    assert record["summary"] == "结果 Prompt 优化；Python | SQL | LaTeX。"
    assert record["details"]["rich_body"] == "结果 <strong> Prompt 优化</strong>；Python\u2002|\u2002SQL \u2002|\u2002LaTeX。"


def test_json_snapshot_import_strips_markup_and_preserves_fields(database, tmp_path):
    source = tmp_path / "snapshot.json"
    source.write_text(json.dumps({"editor_snapshot": {"profile": {"name": "Tester"}, "sections": [{"id": "project", "title": "项目经历", "items": [{"fields": {"projectName": "Analytics", "role": "Developer", "timeRange": {"start": "2025-03", "current": True}}, "body": "<strong>Python</strong><br>Built a dashboard."}]}]}}), encoding="utf-8")
    result = PdfResumeImporter(database).preview(source)
    item = result["experiences"][0]
    assert item["title"] == "Analytics"
    assert item["role"] == "Developer"
    assert item["end_date"] == "至今"
    assert item["summary"] == "Python\nBuilt a dashboard."


def test_docx_table_and_multiple_entries_keep_dates(database, tmp_path):
    result = PdfResumeImporter(database).preview(_docx(tmp_path / "resume.docx"))
    assert len([item for item in result["experiences"] if item["kind"] == "experience"]) == 2
    assert result["experiences"][0]["start_date"] == "2024-09"
    assert result["experiences"][0]["organization"] == "Example University"
    assert result["experiences"][0]["role"] == "Master of Statistics"
    assert result["experiences"][1]["role"] == "Data Analyst"
    assert result["profile"]["name"] == "Alex Example"


def test_unrecognized_tex_layout_keeps_body_available_for_review(database, tmp_path):
    source = tmp_path / "custom.tex"
    source.write_text(r"\begin{document}\name{Example Person}\par Custom research background\par Built a tool with SQL.\end{document}", encoding="utf-8")
    result = PdfResumeImporter(database).preview(source)
    assert result["experiences"][0]["kind"] == "other"
    assert "Built a tool with SQL." in result["experiences"][0]["summary"]


def test_changed_source_cannot_be_imported_using_old_review(database, tmp_path):
    source = tmp_path / "resume.json"
    source.write_text(json.dumps(JSON_RESUME), encoding="utf-8")
    importer = PdfResumeImporter(database)
    preview = importer.preview(source)
    source.write_text(json.dumps({**JSON_RESUME, "basics": {**JSON_RESUME["basics"], "name": "Changed Name"}}), encoding="utf-8")
    with pytest.raises(ValueError, match="当前文件不匹配"):
        importer.import_file(source, reviewed_preview={"source_sha256": preview["source_sha256"], "experiences": preview["experiences"]})
    with database.session() as session:
        assert session.scalar(select(Candidate)) is None


def test_outbound_preview_is_the_complete_redacted_payload(database, tmp_path):
    source = tmp_path / "long.json"
    payload = {**JSON_RESUME, "work": [{**JSON_RESUME["work"][0], "summary": "Measured analytics. " * 2000}]}
    source.write_text(json.dumps(payload), encoding="utf-8")
    preview = PdfResumeImporter(database).preview(source)
    assert len(preview["outbound_preview"]) == preview["outbound_text_length"] == 30000
    assert preview["outbound_truncated"] is True
    assert "alex@example.com" not in preview["outbound_preview"]


@pytest.mark.parametrize("filename,content,match", [
    ("resume.doc", b"old binary Word", "另存为 .docx"),
    ("resume.json", b"[]", "根节点必须是对象"),
    ("resume.json", b'{"random":1}', "JSON Resume"),
    ("resume.json", b'{"workbench":{}}', "迁移旧工作区"),
    ("resume.docx", b"invalid zip", "有效的 .docx"),
    ("resume.pdf", b"invalid pdf", "无法读取 PDF"),
    ("resume.tex", b"", "没有可读取"),
])
def test_invalid_resume_formats_have_actionable_errors(database, tmp_path, filename, content, match):
    source = tmp_path / filename
    source.write_bytes(content)
    with pytest.raises(ValueError, match=match):
        PdfResumeImporter(database).preview(source)


def test_docx_rejects_unsafe_archive_and_entity_definitions(tmp_path):
    source = _docx(tmp_path / "unsafe.docx", extra={"../outside.xml": "no"})
    with pytest.raises(ValueError, match="无效或加密"):
        read_document(source, source.read_bytes())
    with ZipFile(source, "w") as archive:
        archive.writestr("word/document.xml", '<!DOCTYPE x [<!ENTITY e "payload">]><x/>')
    with pytest.raises(ValueError, match="XML 声明"):
        read_document(source, source.read_bytes())


def test_oversized_resume_is_rejected_before_parsing(database, tmp_path):
    source = tmp_path / "large.tex"
    with source.open("wb") as stream:
        stream.truncate(20 * 1024 * 1024 + 1)
    with pytest.raises(ValueError, match="20MB"):
        PdfResumeImporter(database).preview(source)


def _photo_bytes(color="navy", image_format="JPEG"):
    stream = BytesIO()
    Image.new("RGB", (80, 120), color).save(stream, format=image_format)
    return stream.getvalue()


def test_tex_import_keeps_local_photo_and_rechecks_image_revision(database, tmp_path, monkeypatch):
    import integrations.resume_pdf.importer as module

    monkeypatch.setattr(module, "artifact_root", lambda *parts: tmp_path.joinpath("artifacts", *parts))
    images = tmp_path / "images"
    images.mkdir()
    photo = images / "portrait.jpg"
    photo.write_bytes(_photo_bytes())
    source = tmp_path / "resume.tex"
    source.write_text(TEX_RESUME.replace(r"\begin{document}", r"\begin{document}\includegraphics[width=2cm]{images/portrait.jpg}"), encoding="utf-8")
    importer = PdfResumeImporter(database)
    preview = importer.preview(source)
    assert preview["_photo"].startswith("data:image/jpeg;base64,")
    assert "base64" not in preview["outbound_preview"]
    imported = importer.import_file(source)
    with database.session() as session:
        snapshot = session.get(ResumeVersion, imported["resume_id"]).content_json["editor_snapshot"]
        assert snapshot["profile"]["showPhoto"] is True
        assert snapshot["profile"]["photo"] == preview["_photo"]
    photo.write_bytes(_photo_bytes("green"))
    changed = importer.preview(source)
    assert changed["source_sha256"] == preview["source_sha256"]
    assert changed["source_photo_sha256"] != preview["source_photo_sha256"]
    with pytest.raises(ValueError, match="头像已变化"):
        importer.import_file(source, reviewed_preview={"source_sha256": preview["source_sha256"], "source_photo_sha256": preview["source_photo_sha256"], "experiences": preview["experiences"]})


@pytest.mark.parametrize("reference", ["../outside.jpg", "https://example.com/photo.jpg", "/outside.jpg", r"C:\outside.jpg", r"\portraitname.jpg"])
def test_tex_photo_never_reads_outside_source_directory(tmp_path, reference):
    source_dir = tmp_path / "source"
    source_dir.mkdir()
    (tmp_path / "outside.jpg").write_bytes(_photo_bytes())
    source = source_dir / "resume.tex"
    source.write_text(TEX_RESUME.replace(r"\begin{document}", r"\begin{document}\includegraphics{" + reference + "}"), encoding="utf-8")
    document = read_document(source, source.read_bytes())
    assert document.photo == ""
    assert document.warnings


def test_invalid_local_photo_is_ignored_without_losing_resume(tmp_path):
    source = tmp_path / "resume.tex"
    (tmp_path / "photo.jpg").write_bytes(b"<svg onload='bad'>not a jpeg</svg>")
    source.write_text(TEX_RESUME.replace(r"\begin{document}", r"\begin{document}\includegraphics{photo.jpg}"), encoding="utf-8")
    document = read_document(source, source.read_bytes())
    assert not document.photo
    assert len(document.experiences) == 4
    assert document.warnings


def test_docx_only_uses_embedded_photo_and_keeps_bold(tmp_path):
    source = _docx(tmp_path / "resume.docx")
    with ZipFile(source, "a") as archive:
        archive.writestr("word/media/image1.jpeg", _photo_bytes())
        archive.writestr("word/_rels/document.xml.rels", '<Relationships><Relationship Target="https://example.com/private.jpg" TargetMode="External"/></Relationships>')
    document = read_document(source, source.read_bytes())
    assert document.photo.startswith("data:image/jpeg;base64,")
    assert "Built analytics tools." in document.bold_phrases


def test_json_snapshot_keeps_checked_photo_and_bold_text(database, tmp_path):
    data_uri = "data:image/png;base64," + base64.b64encode(_photo_bytes(image_format="PNG")).decode("ascii")
    source = tmp_path / "resume.json"
    payload = {"profile": {"name": "Alex", "photo": data_uri}, "sections": [{"id": "project", "title": "Projects", "items": [{"fields": {"projectName": "Tool"}, "body": "Built <strong>Python</strong> tools."}]}]}
    source.write_text(json.dumps(payload), encoding="utf-8")
    document = read_document(source, source.read_bytes())
    assert document.photo == data_uri
    assert document.bold_phrases == ["Python"]
    preview = PdfResumeImporter(database).preview(source)
    assert "base64" not in preview["outbound_preview"]
    assert preview["_photo"] == data_uri
    payload["profile"]["showPhoto"] = False
    source.write_text(json.dumps(payload), encoding="utf-8")
    assert read_document(source, source.read_bytes()).photo == ""


@pytest.mark.parametrize("image", ["https://example.com/photo.png", "data:image/svg+xml;base64,PHN2Zz4=", "data:image/png;base64,bm90LWFuLWltYWdl"])
def test_json_photo_does_not_load_external_or_invalid_images(tmp_path, image):
    source = tmp_path / "resume.json"
    source.write_text(json.dumps({**JSON_RESUME, "basics": {**JSON_RESUME["basics"], "image": image}}), encoding="utf-8")
    document = read_document(source, source.read_bytes())
    assert document.photo == ""
    assert document.warnings
