from __future__ import annotations

from copy import deepcopy
import hashlib

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import select

from applyos_api.main import create_app
from applyos_domain.enums import QualityStatus
from applyos_domain.models import Candidate, Fact, MaterialAsset, QualityReport, ResumeVersion, VersionSnapshot
from applyos_harness.validation import grounded_claim
from applyos_harness.versioning import canonical_hash


@pytest.fixture
def resume_routes(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    monkeypatch.setenv("FETCHCV_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("FETCHCV_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("FETCHCV_AGENT_RUNTIME", "mock")
    monkeypatch.setenv("FETCHCV_DESKTOP_STARTUP_GATE", "0")
    with TestClient(create_app(database)) as client:
        yield client


def _resume(database, tmp_path):
    source = tmp_path / "artifacts" / "resumes" / "imported" / "source.tex"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("\\documentclass{article}\n\\begin{document}Synthetic resume\\end{document}", encoding="utf-8")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    snapshot = {"profile": {"name": "合成候选人"}, "sections": [{"id": "skills", "title": "技能", "items": [{"body": "整理资料。", "fields": {"timeRange": {"start": "", "end": "", "current": False}}}]}], "settings": {"fontSize": 14}}
    with database.session() as session:
        candidate = Candidate(name="合成候选人")
        session.add(candidate)
        session.flush()
        material = MaterialAsset(candidate_id=candidate.id, kind="resume_tex", name="source.tex", source_path=str(source), mime_type="application/x-tex", metadata_json={"sha256": digest})
        session.add(material)
        session.flush()
        content = {"source_asset_id": material.id, "source": {"type": "tex", "sha256": digest}, "pdf_import_schema_version": 3, "verification_status": "unverified", "editor_snapshot": snapshot}
        resume = ResumeVersion(candidate_id=candidate.id, name="合成简历", content_json=content, content_hash=canonical_hash(content))
        session.add(resume)
        session.flush()
        return resume.id, material.id, source, snapshot


def test_unverified_import_has_readable_snapshot_and_distinct_original_download(resume_routes, database, tmp_path):
    resume_id, _, source, snapshot = _resume(database, tmp_path)
    response = resume_routes.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200
    assert response.json()["content_json"]["editor_snapshot"] == snapshot
    assert response.json()["content_hash"] == canonical_hash(response.json()["content_json"])
    assert response.json()["pdf_path"] is None
    original = resume_routes.get(f"/api/resumes/{resume_id}/source")
    assert original.status_code == 200, original.text
    assert original.content == source.read_bytes()
    assert original.headers["x-fetchcv-artifact-kind"] == "imported-source"
    assert original.headers["content-disposition"].startswith("attachment;")
    assert original.headers["etag"] == f'"{hashlib.sha256(original.content).hexdigest()}"'
    for suffix in ("pdf", "docx"):
        blocked = resume_routes.get(f"/api/resumes/{resume_id}/{suffix}")
        assert blocked.status_code == 422
        assert blocked.json()["code"] == "resume_export_unverified"
        assert isinstance(blocked.json()["message"], str)
    with database.session() as session:
        assert session.get(ResumeVersion, resume_id).content_json["verification_status"] == "unverified"


@pytest.mark.parametrize("change", ["bytes", "scope", "path", "binding"])
def test_original_download_checks_integrity_and_candidate_scope(resume_routes, database, tmp_path, change):
    resume_id, material_id, source, _ = _resume(database, tmp_path)
    with database.session() as session:
        material = session.get(MaterialAsset, material_id)
        if change == "bytes":
            source.write_text("changed", encoding="utf-8")
        elif change == "scope":
            other = Candidate(name="另一候选人")
            session.add(other)
            session.flush()
            material.candidate_id = other.id
        elif change == "path":
            outside = tmp_path / "outside.tex"
            outside.write_bytes(source.read_bytes())
            material.source_path = str(outside)
        else:
            material.metadata_json = {"sha256": "0" * 64}
    response = resume_routes.get(f"/api/resumes/{resume_id}/source")
    assert response.status_code in {404, 422}
    assert response.headers["content-type"].startswith("application/json")
    assert response.json()["code"].startswith("resume_source_")


def test_unchanged_save_keeps_pdf_quality_and_revision(resume_routes, database, tmp_path):
    resume_id, _, _, snapshot = _resume(database, tmp_path)
    with database.session() as session:
        resume = session.get(ResumeVersion, resume_id)
        content = {**resume.content_json, "pdf_semantic_hash": "bound-semantics", "pdf_sha256": "bound-bytes", "page_count": 1}
        resume.content_json = content
        resume.content_hash = canonical_hash(content)
        resume.pdf_path = "synthetic-saved.pdf"
        report = QualityReport(target_type="resume_version", target_id=resume_id, status=QualityStatus.PASSED, checks=[{"code": "pagination", "passed": True}])
        session.add(report)
        session.flush()
        original_hash, report_id = resume.content_hash, report.id
    response = resume_routes.patch(f"/api/resumes/{resume_id}/editor", json={"editor_snapshot": snapshot})
    assert response.status_code == 200, response.text
    assert response.json()["pdf_path"] == "synthetic-saved.pdf"
    assert response.json()["content_hash"] == original_hash
    assert response.json()["content_json"]["pdf_sha256"] == "bound-bytes"
    with database.session() as session:
        assert session.get(ResumeVersion, resume_id).pdf_path == "synthetic-saved.pdf"
        assert session.get(QualityReport, report_id).status == QualityStatus.PASSED
        assert session.scalars(select(VersionSnapshot).where(VersionSnapshot.target_id == resume_id)).all() == []


@pytest.mark.parametrize("verified", [True, False])
def test_layout_save_invalidates_pdf_without_relabeling_facts(resume_routes, database, tmp_path, verified):
    resume_id, _, _, snapshot = _resume(database, tmp_path)
    expected_status = "verified" if verified else "unverified"
    with database.session() as session:
        resume = session.get(ResumeVersion, resume_id)
        resume.content_json = {**resume.content_json, "verification_status": expected_status, "pdf_sha256": "old", "pdf_semantic_hash": "old", "page_count": 1}
        resume.pdf_path = "synthetic-saved.pdf"
    updated = deepcopy(snapshot)
    updated["settings"]["fontSize"] = 13
    response = resume_routes.patch(f"/api/resumes/{resume_id}/editor", json={"editor_snapshot": updated})
    assert response.status_code == 200, response.text
    content = response.json()["content_json"]
    assert content["verification_status"] == expected_status
    assert "pdf_sha256" not in content
    assert "pdf_semantic_hash" not in content
    with database.session() as session:
        assert session.get(ResumeVersion, resume_id).pdf_path is None


def test_text_save_requires_reverification(resume_routes, database, tmp_path):
    resume_id, _, _, snapshot = _resume(database, tmp_path)
    with database.session() as session:
        resume = session.get(ResumeVersion, resume_id)
        resume.content_json = {**resume.content_json, "verification_status": "verified"}
    updated = deepcopy(snapshot)
    updated["sections"][0]["items"][0]["body"] = "新增加的陈述。"
    response = resume_routes.patch(f"/api/resumes/{resume_id}/editor", json={"editor_snapshot": updated})
    assert response.status_code == 200, response.text
    assert response.json()["content_json"]["verification_status"] == "unverified"
    assert response.json()["content_json"]["verification_issues"][0]["code"] == "manual_content_changed"


def test_native_preview_does_not_publish_and_export_reuses_identical_pdf(resume_routes, database, tmp_path, monkeypatch):
    resume_id, _, _, _ = _resume(database, tmp_path)
    before = resume_routes.get(f"/api/resumes/{resume_id}").json()
    preview = resume_routes.get(f"/api/resumes/{resume_id}/preview.pdf")
    assert before == resume_routes.get(f"/api/resumes/{resume_id}").json()
    assert preview.status_code == 200, (preview.text, before, resume_routes.get(f"/api/resumes/{resume_id}").json()) if preview.status_code != 200 else ""
    assert preview.headers["content-type"].startswith("application/pdf")
    assert preview.headers["x-fetchcv-artifact-kind"] == "layout-preview"
    assert preview.content.startswith(b"%PDF-")
    assert resume_routes.get(f"/api/resumes/{resume_id}").json() == before
    assert resume_routes.post(f"/api/resumes/{resume_id}/pdf/render", headers={"X-FetchCV-Resume-Hash": before["content_hash"]}).status_code == 422
    with database.session() as session:
        resume = session.get(ResumeVersion, resume_id)
        fact = Fact(candidate_id=resume.candidate_id, category="skill", content="整理资料。", verified=True, version=1, allowed_outputs=["resume"])
        session.add(fact)
        session.flush()
        resume.source_fact_ids = [fact.id]
        resume.content_json = {**resume.content_json, "verification_status": "verified", "claims": [grounded_claim(fact).model_dump(mode="json")]}
        resume.content_hash = canonical_hash(resume.content_json)
    verified = resume_routes.get(f"/api/resumes/{resume_id}").json()
    stale = resume_routes.post(f"/api/resumes/{resume_id}/pdf/render", headers={"X-FetchCV-Resume-Hash": before["content_hash"]})
    assert stale.status_code == 422
    assert stale.json()["code"] == "resume_pdf_revision_mismatch"
    rendered = resume_routes.post(f"/api/resumes/{resume_id}/pdf/render", headers={"X-FetchCV-Resume-Hash": verified["content_hash"]})
    assert rendered.status_code == 200, rendered.text
    assert rendered.json()["resume"]["content_json"]["pdf_renderer"] == "didi-xelatex"
    assert resume_routes.get(f"/api/resumes/{resume_id}/pdf").content == preview.content
    assert resume_routes.get(f"/api/resumes/{resume_id}/preview.pdf").content == preview.content
    # Another editor can save while the compiler is running. Never bind an old
    # layout to the new revision, even if the underlying facts remain verified.
    import integrations.resume.native_artifacts as native
    original_preview = native.preview_artifact
    def concurrent_edit(resume):
        artifact = original_preview(resume)
        with database.session() as session:
            current = session.get(ResumeVersion, resume_id)
            content = deepcopy(current.content_json)
            content["editor_snapshot"]["settings"].update({"templatePreset": "didi-v2", "margin": 64})
            current.content_json = content
            current.content_hash = canonical_hash(content)
        return artifact
    monkeypatch.setattr(native, "preview_artifact", concurrent_edit)
    current = resume_routes.get(f"/api/resumes/{resume_id}").json()
    race = resume_routes.post(f"/api/resumes/{resume_id}/pdf/render", headers={"X-FetchCV-Resume-Hash": current["content_hash"]})
    assert race.status_code == 422
    assert race.json()["code"] == "resume_pdf_revision_mismatch"


def test_native_preview_compile_error_is_readable_without_changing_resume(resume_routes, database, tmp_path, monkeypatch):
    from integrations.resume.latex_renderer import XeLatexUnavailable
    def unavailable(*args, **kwargs):
        raise XeLatexUnavailable("未找到 XeLaTeX，请安装 TeX Live。")
    monkeypatch.setattr("integrations.resume.latex_renderer.compile_snapshot", unavailable)
    resume_id, _, _, _ = _resume(database, tmp_path)
    before = resume_routes.get(f"/api/resumes/{resume_id}").json()
    response = resume_routes.get(f"/api/resumes/{resume_id}/preview.pdf")
    assert response.status_code == 422
    assert response.json()["code"] == "resume_latex_failed"
    assert "XeLaTeX" in response.json()["message"]
    assert resume_routes.get(f"/api/resumes/{resume_id}").json() == before
