from __future__ import annotations

import base64
from io import BytesIO

from PIL import Image
from pypdf import PdfReader
import pytest

from applyos_domain.models import AgentRun, Candidate, Fact, Job, ResumeVersion
from applyos_harness.validation import grounded_claim
from integrations.resume.renderer import ResumeRenderer


def _photo():
    buffer = BytesIO()
    Image.new("RGB", (60, 80), "#dde5e1").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def sample_snapshot():
    return {
        "profile": {"name": "合成候选人", "phone": "13800000000", "email": "sample@example.invalid", "website": "https://example.invalid/portfolio", "summary": "熟悉数据分析与业务协作，关注可复查的研究过程。", "showPhoto": True, "photo": _photo()},
        "sections": [
            {"id": "education", "title": "教育背景", "items": [{"fields": {"school": "合成大学", "major": "数量经济学", "degree": "硕士", "gpa": "3.56/4", "timeRange": {"start": "2024.09", "end": "2027.06"}}, "body": "完成统计分析与研究方法课程。"}]},
            {"id": "internship", "title": "实习经验", "items": [{"fields": {"company": "用于检查长标题自动换行且不会截断任何字符的合成技术研究有限公司", "role": "策略运营与数据分析实习生", "timeRange": {"start": "2026.07", "current": True}}, "body": "<p><strong>指标体系：</strong>使用 SQL 建立业务分析底表，核对数据来源与统计口径。</p><p>梳理协作流程，维护可追溯的工作记录。</p>"}]},
            {"id": "project", "title": "项目经历", "items": [{"fields": {"projectName": "消费者意愿研究", "role": "数据分析", "timeRange": {"start": "2025.06", "end": "2025.10"}}, "body": "使用 Python 整理问卷结果并检查缺失值。\n横向对比统计模型，记录分析方法与适用边界。"}]},
            {"id": "skills", "title": "工作技能", "items": [{"body": "数据分析：SQL | Python | Tableau\n统计建模：假设检验 | 回归分析"}]},
            {"id": "hidden", "title": "隐藏模块", "visible": False, "items": [{"body": "这段内容不应出现在 PDF 中。"}]},
        ],
    }


def test_didi_pdf_retains_profile_metadata_photo_and_wrapped_content(tmp_path):
    candidate = Candidate(name="合成候选人")
    resume = ResumeVersion(candidate_id="synthetic", name="排版验证", content_json={"editor_snapshot": sample_snapshot()})
    output = tmp_path / "didi-sample.pdf"
    pages = ResumeRenderer._render_pdf(output, candidate, resume)
    reader = PdfReader(output)
    assert pages == len(reader.pages) == 1
    page = reader.pages[0]
    assert float(page.mediabox.width) == pytest.approx(595.276, abs=.01)
    assert float(page.mediabox.height) == pytest.approx(841.89, abs=.01)
    text = "".join(page.extract_text().split())
    for value in ["合成候选人", "sample@example.invalid", "https://example.invalid/portfolio", "数量经济学", "硕士", "3.56/4", "2024.09–2027.06", "2026.07–至今", "用于检查长标题自动换行且不会截断任何字符的合成技术研究有限公司", "指标体系：", "维护可追溯的工作记录。", "消费者意愿研究", "假设检验"]:
        assert value in text
    assert "<strong>" not in text
    assert "隐藏模块" not in text
    assert len(page.images) == 1
    sizes = []
    page.extract_text(visitor_text=lambda text, cm, tm, font, size: sizes.append(size) if text.strip() else None)
    # TeX uses 72.27 pt/in; the PDF coordinate system uses 72 pt/in.
    for tex_size in (10.2, 10.8, 14, 18):
        assert any(size == pytest.approx(tex_size * 72 / 72.27, abs=.002) for size in sizes)


def test_long_verified_resume_reports_and_stores_real_page_count(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_ARTIFACT_ROOT", str(tmp_path))
    source = "整理业务数据并检查统计口径，保留研究过程和复查记录。"
    with database.session() as session:
        candidate = Candidate(name="分页验证")
        session.add(candidate)
        session.flush()
        fact = Fact(candidate_id=candidate.id, category="experience", content=source, verified=True, version=1, allowed_outputs=["resume"])
        job = Job(candidate_id=candidate.id, company="合成公司", role="合成岗位")
        session.add_all([fact, job])
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="artifact_validation")
        session.add(run)
        session.flush()
        resume = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="长简历分页", source_fact_ids=[fact.id], content_json={"verification_status": "verified", "claims": [grounded_claim(fact).model_dump(mode="json")], "editor_snapshot": {"profile": {"name": candidate.name}, "sections": [{"id": "experience", "title": "经历", "items": [{"body": source} for _ in range(110)]}]}})
        session.add(resume)
        session.flush()
        artifact = ResumeRenderer(session).render(resume, run_id=run.id)
        reader = PdfReader(artifact.pdf_path)
        assert artifact.page_count == len(reader.pages) > 1
        assert resume.content_json["page_count"] == artifact.page_count
        assert resume.content_json["pdf_renderer"] == "didi-xelatex"
        assert resume.content_json["verification_status"] == "verified"
        text = "".join("".join(page.extract_text().split()) for page in reader.pages)
        assert text.count(source) == 110
