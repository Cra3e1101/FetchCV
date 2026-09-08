from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from applyos_api.main import create_app
from applyos_domain.enums import AssetStatus
from applyos_domain.models import Job, ResumeVersion
from applyos_harness.versioning import canonical_hash
from integrations.resume_pdf.importer import PdfResumeImporter


def _resume_pdf(path: Path) -> Path:
    page = canvas.Canvas(str(path))
    lines = [
        "Alex Chen",
        "Email: alex@example.com  Phone: 13950545605",
        "Education",
        "2024-09 - 2027-06 Zhongnan University Master of Statistics",
        "Experience",
        "2026-03 - 2026-06 Data Analyst Intern",
        "Built a review workflow for 3000 model outputs and improved quality.",
        "Projects",
        "2025-09 - 2025-10 Bearing fault diagnosis with Transformer models",
        "Skills",
        "Python SQL Tableau Power BI",
    ]
    y = 800
    for line in lines:
        page.drawString(60, y, line)
        y -= 28
    page.save()
    return path


def test_pdf_resume_preview_import_and_duplicate(database, tmp_path: Path, monkeypatch):
    import integrations.resume_pdf.importer as importer_module

    monkeypatch.setattr(importer_module, "artifact_root", lambda *parts: tmp_path.joinpath("artifacts", *parts))
    source = _resume_pdf(tmp_path / "Alex-Chen-resume.pdf")
    with TestClient(create_app(database)) as client:
        preview = client.post("/api/imports/resume-pdf/preview", json={"source_path": str(source)})
        assert preview.status_code == 200
        parsed = preview.json()
        assert parsed["page_count"] == 1
        assert parsed["profile"]["email"] == "alex@example.com"
        assert {item["key"] for item in parsed["sections"]} >= {"education", "experience", "project", "skill"}
        assert len(parsed["experiences"]) >= 4
        assert parsed["outbound_text_length"] > 0
        assert "alex@example.com" not in parsed["outbound_preview"]
        assert "<EMAIL_" in parsed["outbound_preview"]

        imported = client.post(
            "/api/imports/resume-pdf",
            json={"source_path": str(source), "candidate_name": "Alex Chen", "candidate_title": "Data Analyst"},
        )
        assert imported.status_code == 200
        result = imported.json()
        assert result["facts_created"] >= 4
        assert result["duplicate"] is False

        library = client.get(f"/api/candidates/{result['candidate_id']}/library").json()
        assert library["candidate"]["name"] == "Alex Chen"
        assert len(library["resumes"]) == 1
        assert len(library["facts"]) == result["facts_created"]
        assert len(library["experiences"]) == result["facts_created"]
        assert len(library["materials"]) == 1
        assert library["resumes"][0]["content_json"]["editor_snapshot"]["sections"]
        education = library["resumes"][0]["content_json"]["editor_snapshot"]["sections"][0]["items"][0]
        assert education["fields"]["timeRange"] == {"start": "2024-09", "end": "2027-06", "current": False}

        duplicate = client.post("/api/imports/resume-pdf", json={"source_path": str(source)}).json()
        assert duplicate["duplicate"] is True
        assert duplicate["resume_id"] == result["resume_id"]


def test_pdf_resume_import_uses_user_reviewed_fields_before_creating_facts(database, tmp_path: Path, monkeypatch):
    import integrations.resume_pdf.importer as importer_module

    monkeypatch.setattr(importer_module, "artifact_root", lambda *parts: tmp_path.joinpath("artifacts", *parts))
    source = _resume_pdf(tmp_path / "reviewed-resume.pdf")
    with TestClient(create_app(database)) as client:
        preview = client.post("/api/imports/resume-pdf/preview", json={"source_path": str(source), "ai_enhanced": False}).json()
        reviewed = [dict(item, _source_index=index) for index, item in enumerate(preview["experiences"])]
        reviewed[0] = {
            **reviewed[0],
            "title": "用户修正后的教育经历",
            "start_date": "2024-10",
            "review_status": "uncertain",
        }
        reviewed = reviewed[:-1]
        imported = client.post(
            "/api/imports/resume-pdf",
            json={
                "source_path": str(source),
                "ai_enhanced": False,
                "candidate_name": "Reviewed User",
                "reviewed_preview": {
                    "source_sha256": preview["source_sha256"],
                    "profile": {**preview["profile"], "name": "Reviewed User"},
                    "experiences": reviewed,
                },
            },
        )
        assert imported.status_code == 200
        result = imported.json()
        assert result["facts_created"] == len(reviewed)
        library = client.get(f"/api/candidates/{result['candidate_id']}/library").json()
        corrected = next(item for item in library["experiences"] if item["title"] == "用户修正后的教育经历")
        assert corrected["start_date"] == "2024-10"
        assert corrected["details_json"]["review_status"] == "uncertain"


def test_legacy_job_snapshot_rebases_on_source_layout_without_losing_body_edit(database, tmp_path: Path, monkeypatch):
    import integrations.resume_pdf.importer as importer_module

    monkeypatch.setattr(importer_module, "artifact_root", lambda *parts: tmp_path.joinpath("artifacts", *parts))
    source = Path(__file__).resolve().parents[2] / "test use" / "高子强的简历.pdf"
    if not source.exists():
        pytest.skip("private real-resume fixture is not present")
    imported = PdfResumeImporter(database).import_file(source)
    with database.session() as session:
        base = session.get(ResumeVersion, imported["resume_id"])
        legacy_snapshot = base.content_json["editor_snapshot"]
        legacy_snapshot = {
            **legacy_snapshot,
            "profile": {**legacy_snapshot["profile"], "gender": "女", "political": "群众", "birth": "2001-08", "showPhoto": False},
            "sections": [
                legacy_snapshot["sections"][0],
                legacy_snapshot["sections"][1],
                {**legacy_snapshot["sections"][3], "items": legacy_snapshot["sections"][3]["items"][1:]},
                legacy_snapshot["sections"][2],
            ],
        }
        internship = legacy_snapshot["sections"][1]["items"][0]
        internship["body"] = "用户确认的岗位化改写"
        for section in legacy_snapshot["sections"]:
            for item in section["items"]:
                time_range = item["fields"].get("timeRange", {})
                item["fields"]["timeRange"] = " ~ ".join(part for part in [time_range.get("start"), "至今" if time_range.get("current") else time_range.get("end")] if part)
        job = Job(candidate_id=imported["candidate_id"], company="目标公司", role="产品经理", jd_raw="负责产品分析")
        session.add(job)
        session.flush()
        resume = ResumeVersion(
            candidate_id=imported["candidate_id"],
            job_id=job.id,
            name="旧岗位版本",
            status=AssetStatus.DRAFT,
            content_json={"editor_snapshot": legacy_snapshot, "generation_mode": "model_assisted"},
        )
        resume.content_hash = canonical_hash(resume.content_json)
        session.add(resume)
        session.flush()
        resume_id = resume.id

    assert PdfResumeImporter(database).repair_imported_snapshots() >= 1
    with database.session() as session:
        repaired = session.get(ResumeVersion, resume_id)
        snapshot = repaired.content_json["editor_snapshot"]
        assert [section["id"] for section in snapshot["sections"]] == ["education", "internship", "skills", "project"]
        assert len(snapshot["sections"][3]["items"]) == 3
        assert "多维时频特征" in snapshot["sections"][3]["items"][0]["body"]
        assert snapshot["sections"][1]["items"][0]["body"] == "用户确认的岗位化改写"
        assert snapshot["profile"]["gender"] == "男"
        assert snapshot["profile"]["political"] == "中共党员"
        assert "birth" not in snapshot["profile"]
        assert snapshot["profile"]["showPhoto"] is True
        assert snapshot["sections"][0]["items"][0]["fields"]["timeRange"] == {"start": "2024-09", "end": "", "current": True}
        assert repaired.parent_version_id == imported["resume_id"]
