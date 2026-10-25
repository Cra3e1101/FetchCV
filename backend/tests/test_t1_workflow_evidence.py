"""Independent synthetic adoption/export attacks, separate from claim labels."""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

import pytest
from sqlalchemy import select

from applyos_domain.models import AgentRun, Approval, Candidate, Fact, Job, ResumeVersion, RewriteProposal
from applyos_harness.approval import ApprovalService
from applyos_harness.errors import HarnessError
from applyos_harness.validation import grounded_claim


@pytest.fixture
def isolated_t1_runtime(tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_DATABASE_URL", f"sqlite:///{(tmp_path / 'synthetic.db').as_posix()}")
    monkeypatch.setenv("FETCHCV_SETTINGS_FILE", str(tmp_path / "settings.json"))
    monkeypatch.setenv("FETCHCV_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    monkeypatch.setenv("FETCHCV_WORKSPACE_ROOT", str(tmp_path / "workspace"))
    monkeypatch.setenv("FETCHCV_AGENT_RUNTIME", "mock")
    monkeypatch.setenv("FETCHCV_ALLOW_MOCK_RUNTIME", "1")
    # API business endpoints must be ready; this never starts an Agent turn.
    monkeypatch.setenv("FETCHCV_DESKTOP_STARTUP_GATE", "0")
    return tmp_path


def _synthetic_resume(session, source="整理订单项目的数据。"):
    candidate = Candidate(name="合成候选人甲")
    session.add(candidate)
    session.flush()
    fact = Fact(candidate_id=candidate.id, category="synthetic_t1_only", content=source, verified=True, version=3, allowed_outputs=["resume", "interview_answer"])
    session.add(fact)
    session.flush()
    claim = grounded_claim(fact)
    resume = ResumeVersion(candidate_id=candidate.id, name="合成简历", source_fact_ids=[fact.id], content_json={
        "claims": [claim.model_dump(mode="json")],
        "verification_status": "verified",
        "editor_snapshot": {"profile": {"name": candidate.name}, "sections": [
            {"id": "experience", "title": "经历", "visible": True, "items": [{"body": source, "fields": {}}]},
        ]},
    })
    session.add(resume)
    session.flush()
    return candidate, fact, resume


@pytest.mark.parametrize("target", ["body", "metaRight", "fields.role", "fields.company", "section.title", "profile.title"])
def test_safe_claim_metadata_cannot_launder_negative_excerpt(isolated_t1_runtime, database, target):
    from applyos_harness.gates import require_resume_exportable
    with database.session() as session:
        _, _, resume = _synthetic_resume(session, "不精通SQL。")
        content = deepcopy(resume.content_json)
        snapshot = content["editor_snapshot"]
        item = snapshot["sections"][0]["items"][0]
        if target.startswith("fields."):
            item["fields"][target.split(".")[1]] = "精通SQL"
        elif target == "section.title":
            snapshot["sections"][0]["title"] = "精通SQL"
        elif target == "profile.title":
            snapshot["profile"]["title"] = "精通SQL"
        else:
            item[target] = "精通SQL"
        resume.content_json = content
        session.flush()
        with pytest.raises(HarnessError):
            require_resume_exportable(session, resume)


def test_direct_export_rechecks_stale_deleted_unverified_facts(isolated_t1_runtime, database):
    from applyos_harness.gates import require_resume_exportable
    with database.session() as session:
        _, fact, resume = _synthetic_resume(session)
        require_resume_exportable(session, resume)
        fact.version += 1
        session.flush()
        with pytest.raises(HarnessError):
            require_resume_exportable(session, resume)
        fact.version -= 1
        fact.verified = False
        session.flush()
        with pytest.raises(HarnessError):
            require_resume_exportable(session, resume)
        session.delete(fact)
        session.flush()
        with pytest.raises(HarnessError):
            require_resume_exportable(session, resume)


@pytest.mark.parametrize("route", ["docx", "pdf", "render", "upload_pdf"])
def test_manual_editor_cannot_export_unsupported_personal_body(isolated_t1_runtime, database, route):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    with database.session() as session:
        candidate, fact, resume = _synthetic_resume(session)
        job = Job(candidate_id=candidate.id, company="合成公司", role="合成岗位", jd_raw="整理订单项目的数据。")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, current_stage="created", run_type="artifact_validation")
        session.add(run)
        session.flush()
        resume.job_id = job.id
        run_id, resume_id = run.id, resume.id
        edited = deepcopy(resume.content_json["editor_snapshot"])
        edited["sections"][0]["items"][0]["body"] = "主导开发数据库，提升转化率90%。"
    with TestClient(create_app(database)) as client:
        saved = client.patch(f"/api/resumes/{resume_id}/editor", json={"editor_snapshot": edited})
        assert saved.status_code == 200, saved.text
        saved_content = saved.json()["content_json"]
        assert saved_content.get("verification_status") != "verified", saved_content
        if route == "render":
            response = client.post(f"/api/resumes/{resume_id}/render", json={"run_id": run_id})
        elif route == "upload_pdf":
            response = client.put(f"/api/resumes/{resume_id}/pdf", content=b"%PDF-1.4\nsynthetic-t1-only", headers={"Content-Type": "application/pdf"})
        else:
            response = client.get(f"/api/resumes/{resume_id}/{route}")
        assert response.status_code in {400, 409, 422}, response.text
        assert "evidence" in response.text.lower() or "verified" in response.text.lower(), response.text


def _prepare_review(session, tmp_path, *, before=None):
    from applyos_agent.config import AgentSettings, RuntimeMode
    from applyos_agent.pi_domain_tools import build_pi_task_gateway
    from applyos_harness.permissions import ToolPermission
    candidate, fact, base = _synthetic_resume(session, "整理订单项目的数据。保留原型状态。")
    job = Job(candidate_id=candidate.id, company="合成公司", role="合成数据岗位", jd_raw="整理订单项目的数据。")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent", current_stage="awaiting_fact_review")
    session.add(run)
    session.flush()
    approval = ApprovalService(session).request(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id)
    ApprovalService(session).approve_action(approval_id=approval.id, approved_by="synthetic-user", payload={"fact_ids": [fact.id]})
    gateway = build_pi_task_gateway(session, settings=AgentSettings(runtime=RuntimeMode.MOCK, workspace_root=tmp_path, allow_mock_runtime=True))
    arguments = {
        "strategy": {"positioning": "突出已确认的数据整理经历", "selected_fact_ids": [fact.id]},
        "patches": [{"section": "experience", "before": before or fact.content,
                     "after": "整理订单项目的数据。", "reason": "保留完整支持原句。", "jd_evidence": ["整理订单项目的数据。"],
                     "fact_ids": [fact.id], "evidence": [{"evidence_type": "candidate_fact", "candidate_id": candidate.id,
                       "fact_id": fact.id, "fact_version": fact.version, "source_quote": "整理订单项目的数据。"}],
                     "action": "整理", "object": "订单项目的数据", "metrics": [], "status": "", "risk_level": "low"}],
        "summary": "合成测试改写。",
    }
    result = gateway.execute(tool_name="prepare_resume_review", run=run, arguments=arguments,
                             granted_permissions=set(ToolPermission), idempotency_key="synthetic-t1-prepare")
    return candidate, fact, base, run, result


def test_prepare_rejects_model_supplied_before_not_in_current_resume(isolated_t1_runtime, database):
    with database.session() as session:
        with pytest.raises(HarnessError) as caught:
            _prepare_review(session, isolated_t1_runtime, before="模型伪造的原简历内容。")
        assert caught.value.code == "resume_before_not_found"


@pytest.mark.parametrize("mutation", ["fact_version", "source_resume", "proposal_after", "edited_after"])
def test_adoption_revalidates_after_approval(isolated_t1_runtime, database, mutation):
    from applyos_harness.pipeline import MockPipeline
    with database.session() as session:
        _, fact, base, run, _ = _prepare_review(session, isolated_t1_runtime)
        proposal = session.scalar(select(RewriteProposal).where(RewriteProposal.run_id == run.id))
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "apply_resume_changes"))
        assert proposal is not None and approval is not None
        ApprovalService(session).review_proposals(approval_id=approval.id, approved_by="synthetic-user",
            expected_revision=int((approval.decision_payload.get("draft") or {}).get("revision") or 0),
            expected_target_content_hash=approval.decision_payload["target_content_hash"],
            decisions=[{"proposal_id": proposal.id, "decision": "accepted"}])
        if mutation == "fact_version":
            fact.version += 1
        elif mutation == "source_resume":
            base.content_json = {**base.content_json, "text": "审批后修改过的当前简历。"}
        elif mutation == "proposal_after":
            proposal.after = "独立开发数据库并提升转化率90%。"
        else:
            proposal.edited_after = "独立开发数据库并提升转化率90%。"
        session.flush()
        with pytest.raises(HarnessError):
            MockPipeline(session)._apply_approved_changes(run)


def test_edited_acceptance_cannot_launder_new_personal_fact(isolated_t1_runtime, database):
    with database.session() as session:
        _, _, _, run, _ = _prepare_review(session, isolated_t1_runtime)
        proposal = session.scalar(select(RewriteProposal).where(RewriteProposal.run_id == run.id))
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "apply_resume_changes"))
        with pytest.raises(HarnessError):
            ApprovalService(session).review_proposals(approval_id=approval.id, approved_by="synthetic-user",
                expected_revision=int((approval.decision_payload.get("draft") or {}).get("revision") or 0),
                expected_target_content_hash=approval.decision_payload["target_content_hash"], decisions=[{
                "proposal_id": proposal.id, "decision": "edited_accepted", "edited_after": "独立开发数据库并提升转化率90%。",
            }])


def _save_answer(session, tmp_path, mutation=""):
    from applyos_agent.application_tools import register_application_tools
    from applyos_harness.permissions import ToolGateway, ToolPermission
    candidate, fact, _ = _synthetic_resume(session)
    job = Job(candidate_id=candidate.id, company="合成公司", role="合成数据岗位", jd_raw="使用 SQL 分析订单数据。")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent", current_stage="created")
    session.add(run)
    session.flush()
    claim = grounded_claim(fact).model_dump(mode="json")
    arguments = {"question": "请介绍数据整理经历。", "answer": fact.content,
                 "personal_claims": [claim],
                 "job_references": [{"evidence_type": "job_description", "source_id": job.id, "source_quote": "使用 SQL 分析订单数据。"}],
                 "practice_advice": ["建议练习使用 SQL 查询合成订单数据。"]}
    if mutation == "uncovered_answer":
        arguments["answer"] += "主导数据库研发并提升转化率90%。"
    elif mutation == "empty_claims":
        arguments["personal_claims"] = []
    elif mutation == "unsupported_claim":
        claim["text"] = arguments["answer"] = "主导数据库研发并提升转化率90%。"
        claim["action"], claim["object"], claim["metrics"] = "主导", "数据库研发", ["90%"]
    elif mutation == "jd_as_personal":
        claim["text"] = arguments["answer"] = "使用 SQL 分析订单数据。"
        claim["evidence"][0]["evidence_type"] = "job_description"
        claim["evidence"][0]["source_quote"] = job.jd_raw
    elif mutation == "personal_as_advice_claim":
        claim["claim_type"] = "general_advice"
        claim["text"] = arguments["answer"] = "我曾主导数据库研发。"
        claim["evidence"] = []
    elif mutation == "personal_voice_practice":
        arguments["practice_advice"] = ["建议写我曾主导数据库研发。"]
    elif mutation == "implicit_fabrication_practice":
        arguments["practice_advice"] = ["建议在个人答案中写：曾主导数据库研发。"]
    elif mutation == "stale_fact":
        fact.version += 1
        session.flush()
    elif mutation == "foreign_fact":
        foreign = Candidate(name="合成候选人乙")
        session.add(foreign)
        session.flush()
        fact.candidate_id = foreign.id
        session.flush()
    elif mutation == "caller_verified":
        claim["text"] = arguments["answer"] = "我曾主导数据库研发。"
        claim["verification_status"] = "verified"
    gateway = register_application_tools(ToolGateway(session, workspace_root=tmp_path))
    result = gateway.execute(tool_name="save_interview_answer", run=run, arguments=arguments,
                             granted_permissions={ToolPermission.READ, ToolPermission.DRAFT_WRITE},
                             idempotency_key="synthetic-t1-answer")
    return candidate, fact, job, result


@pytest.mark.parametrize("mutation", [
    "uncovered_answer", "empty_claims", "unsupported_claim", "jd_as_personal",
    "personal_as_advice_claim", "personal_voice_practice", "implicit_fabrication_practice",
    "stale_fact", "foreign_fact", "caller_verified",
])
def test_personal_interview_answer_draft_cannot_be_ready_without_support(isolated_t1_runtime, database, mutation):
    with database.session() as session:
        _, _, _, result = _save_answer(session, isolated_t1_runtime, mutation)
        assert result["data"]["status"] == "needs_evidence", result
        assert result["data"]["claim_contract"]["needs_evidence"] is True
        assert result["data"]["claim_contract"]["issues"]


def test_fully_grounded_interview_answer_is_ready_with_separate_practice(isolated_t1_runtime, database):
    with database.session() as session:
        _, _, _, result = _save_answer(session, isolated_t1_runtime)
        assert result["data"]["status"] == "ready", result
        assert result["data"]["claim_contract"]["verification_status"] == "verified"
        assert result["data"]["job_references"][0]["support_status"] == "reference_only"


@pytest.mark.parametrize("scope", ["candidate", "job"])
@pytest.mark.parametrize("mutation", ["fact_version", "unverified"])
def test_saved_ready_interview_answer_is_not_current_after_fact_revision(isolated_t1_runtime, database, scope, mutation):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    with database.session() as session:
        candidate, fact, job, result = _save_answer(session, isolated_t1_runtime)
        assert result["data"]["status"] == "ready", result
        candidate_id, job_id = candidate.id, job.id
        answer_id = result["data"]["interview_answer_id"]
        if mutation == "fact_version":
            fact.version += 1
        else:
            fact.verified = False
        session.flush()
    path = f"/api/candidates/{candidate_id}/library" if scope == "candidate" else f"/api/jobs/{job_id}/workspace"
    with TestClient(create_app(database)) as client:
        response = client.get(path)
        assert response.status_code == 200, response.text
        material = next(item for item in response.json()["materials"] if item["id"] == answer_id)
        assert material["status"] != "ready", material
        contract = material["metadata_json"]["claim_contract"]
        assert contract["verification_status"] != "verified", contract
        assert contract["needs_evidence"] is True


def test_pdf_snapshot_hash_header_is_allowed_by_browser_preflight(isolated_t1_runtime, database):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    with TestClient(create_app(database)) as client:
        response = client.options("/api/resumes/synthetic/pdf", headers={
            "Origin": "null", "Access-Control-Request-Method": "PUT",
            "Access-Control-Request-Headers": "content-type,x-fetchcv-resume-hash",
        })
        assert response.status_code == 200, response.text
        assert "x-fetchcv-resume-hash" in response.headers.get("access-control-allow-headers", "").lower()


@pytest.mark.parametrize("mutation", ["stale_snapshot_hash", "unsupported_pdf_text"])
def test_uploaded_pdf_cannot_claim_evidence_from_a_different_document(isolated_t1_runtime, database, mutation):
    from io import BytesIO
    from fastapi.testclient import TestClient
    from reportlab.pdfgen.canvas import Canvas
    from applyos_api.main import create_app
    from applyos_harness.versioning import canonical_hash
    with database.session() as session:
        _, _, resume = _synthetic_resume(session, "I organized order data.")
        resume.content_hash = canonical_hash(resume.content_json)
        resume_id, content_hash = resume.id, resume.content_hash
    pdf = BytesIO()
    canvas = Canvas(pdf)
    canvas.drawString(40, 800, "I led database development and improved conversion by 90%.")
    canvas.save()
    expected_hash = "0" * 64 if mutation == "stale_snapshot_hash" else content_hash
    with TestClient(create_app(database)) as client:
        response = client.put(f"/api/resumes/{resume_id}/pdf", content=pdf.getvalue(), headers={
            "Content-Type": "application/pdf", "X-FetchCV-Resume-Hash": expected_hash,
        })
        assert response.status_code in {400, 409, 422}, response.text
        downloaded = client.get(f"/api/resumes/{resume_id}/pdf")
        assert downloaded.status_code != 200, downloaded.text


@pytest.mark.parametrize("filename", ["resume.pdf", "resume-ats.docx"])
@pytest.mark.parametrize("prefix", ["resumes", "RESUMES", "resumes%5C"])
def test_resume_artifacts_cannot_bypass_api_evidence_gate(isolated_t1_runtime, database, filename, prefix):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    root = isolated_t1_runtime / "artifacts" / "resumes" / "synthetic-resume"
    root.mkdir(parents=True)
    (root / filename).write_bytes(b"synthetic-private-artifact-not-for-static-export")
    separator = "" if prefix.endswith("%5C") else "/"
    with TestClient(create_app(database)) as client:
        response = client.get(f"/artifacts/{prefix}{separator}synthetic-resume/{filename}")
        assert response.status_code == 403, (response.status_code, response.text)


def test_layout_only_edit_keeps_grounded_docx_exportable(isolated_t1_runtime, database):
    from io import BytesIO
    from zipfile import ZipFile
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    with database.session() as session:
        _, _, resume = _synthetic_resume(session)
        resume_id = resume.id
        snapshot = deepcopy(resume.content_json["editor_snapshot"])
        snapshot["settings"] = {"fontSize": 15, "lineHeight": 1.4}
    with TestClient(create_app(database)) as client:
        saved = client.patch(f"/api/resumes/{resume_id}/editor", json={"editor_snapshot": snapshot})
        assert saved.status_code == 200, saved.text
        assert saved.json()["content_json"]["verification_status"] == "verified", saved.text
        response = client.get(f"/api/resumes/{resume_id}/docx")
        assert response.status_code == 200, response.text
        with ZipFile(BytesIO(response.content)) as document:
            xml = document.read("word/document.xml").decode("utf-8")
        assert "整理订单项目的数据" in xml


@pytest.mark.parametrize("forged_metadata", [False, True])
def test_generic_material_create_cannot_self_declare_verified_interview_answer(isolated_t1_runtime, database, forged_metadata):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    with database.session() as session:
        candidate, _, _ = _synthetic_resume(session)
        candidate_id = candidate.id
    metadata = {
        "question": "介绍个人经历。", "answer": "我曾主导数据库研发。", "personal_claims": [],
        "verification_status": "verified", "status": "ready", "content": "个人答案（已核验）：我曾主导数据库研发。",
        "claim_contract": {"verification_status": "verified", "needs_evidence": False, "claims": [], "issues": []},
    } if forged_metadata else {}
    with TestClient(create_app(database)) as client:
        created = client.post(f"/api/candidates/{candidate_id}/materials", json={
            "kind": "interview_answer", "name": "合成伪造ready答案", "metadata_json": metadata,
        })
        assert created.status_code == 201, created.text
        material_id = created.json()["id"]
        assert created.json()["status"] != "ready", created.text
        response = client.get(f"/api/candidates/{candidate_id}/library")
        assert response.status_code == 200, response.text
        material = next(item for item in response.json()["materials"] if item["id"] == material_id)
        assert material["status"] != "ready", material
        assert material["metadata_json"]["claim_contract"]["needs_evidence"] is True


@pytest.mark.parametrize("source", [
    "未使用SQL。", "只完成订单项目原型。尚未上线。", "I am not able to deploy the service.",
])
def test_complete_qualified_or_negative_body_remains_exportable(isolated_t1_runtime, database, source):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    from applyos_harness.gates import require_resume_exportable
    with database.session() as session:
        _, _, resume = _synthetic_resume(session, source)
        require_resume_exportable(session, resume)
        resume_id = resume.id
    with TestClient(create_app(database)) as client:
        response = client.get(f"/api/resumes/{resume_id}/docx")
        assert response.status_code == 200, response.text
