from __future__ import annotations

from zipfile import ZipFile

from applyos_domain.models import Candidate, ResumeVersion
from integrations.resume.docx_export import render_resume_docx


def test_docx_export_is_single_column_and_parser_friendly(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="张三")
        session.add(candidate)
        session.flush()
        resume = ResumeVersion(
            candidate_id=candidate.id,
            name="数据分析岗位简历",
            content_json={"editor_snapshot": {
                "profile": {"name": "张三", "phone": "13800000000", "email": "test@example.com"},
                "sections": [{"id": "experience", "title": "工作与实习", "items": [{
                    "metaLeft": "2025-01 ~ 2025-06",
                    "metaRight": "示例公司  数据分析实习生",
                    "body": "使用 SQL 完成业务数据分析\n搭建转化漏斗监控",
                }]}],
            }},
        )
        session.add(resume)
        session.flush()
        output = render_resume_docx(resume, tmp_path / "resume.docx")

    with ZipFile(output) as archive:
        names = set(archive.namelist())
        document = archive.read("word/document.xml").decode("utf-8")
    assert {"[Content_Types].xml", "word/document.xml", "word/styles.xml"}.issubset(names)
    assert "张三" in document
    assert "使用 SQL 完成业务数据分析" in document
    assert '<w:cols w:num="1"' in document
    assert "<w:tbl" not in document
    assert "txbxContent" not in document
