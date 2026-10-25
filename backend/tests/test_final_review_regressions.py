import time
import json
import pytest
from concurrent.futures import ThreadPoolExecutor
from threading import Event

from fastapi.testclient import TestClient

from applyos_api.main import create_app


def test_parallel_chat_network_io_does_not_hold_sqlite_write_lock(database, monkeypatch):
    from integrations.web import WebClient
    entered, release = Event(), Event()
    calls = []

    def slow_search(self, query, **kwargs):
        calls.append(query)
        entered.set()
        release.wait(8)
        return []

    monkeypatch.setattr(WebClient, "search", slow_search)
    with TestClient(create_app(database)) as client, ThreadPoolExecutor(max_workers=4) as pool:
        client.patch("/api/settings/permissions", json={"web_access": "allow"})
        chat = client.post("/api/conversations").json()["id"]
        boot = client.post(f"/api/pi/conversations/{chat}/turns", json={
            "content": "synthetic", "provider": {"model": "synthetic"}}).json()
        endpoint = f"/api/pi/chat-tools/{boot['user']['id']}/search_web"
        body = {"arguments": {"query": "first"}, "idempotency_key": "parallel-first"}
        first = pool.submit(client.post, endpoint, json=body)
        assert entered.wait(3)
        try:
            write = pool.submit(client.post, "/api/conversations")
            assert write.result(timeout=3).status_code == 200
            duplicate = pool.submit(client.post, endpoint, json=body)
            assert duplicate.result(timeout=3).json()["code"] == "tool_call_running"
            second = pool.submit(client.post, endpoint, json={
                "arguments": {"query": "second"}, "idempotency_key": "parallel-second"})
            deadline = time.monotonic() + 3
            while len(calls) < 2 and time.monotonic() < deadline:
                time.sleep(.01)
            assert len(calls) == 2
        finally:
            release.set()
        assert first.result(timeout=4).status_code == 200
        assert second.result(timeout=4).status_code == 200
        saved = client.get(f"/api/conversations/{chat}").json()["messages"][0]["metadata_json"]
        assert {r["status"] for r in saved["tool_receipts"].values()} == {"completed"}


@pytest.mark.parametrize("new_job", [False, True])
def test_unknown_effect_blocks_revision_alias_stage_and_replacement_run(database, tmp_path, new_job):
    from pydantic import BaseModel
    from applyos_domain.models import Candidate, Job, AgentRun, ToolInvocation
    from applyos_harness.permissions import ToolGateway, ToolSpec, ToolPermission
    from applyos_harness.state_machine import PipelineStage
    from applyos_harness.errors import HarnessError
    class Empty(BaseModel):
        pass
    with database.session() as session:
        candidate = Candidate(name="synthetic")
        session.add(candidate); session.flush()
        job = Job(candidate_id=candidate.id, company="synthetic", role="synthetic", jd_raw="test")
        session.add(job); session.flush()
        old = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="test", current_stage="created")
        session.add(old); session.flush()
        session.add(ToolInvocation(run_id=old.id, operation_id="old-operation", tool_name="old-mcp-alias",
            stage="created", arguments_hash="a"*64, status="outcome_unknown"))
        replacement_job_id = job.id
        if new_job:
            another = Job(candidate_id=candidate.id, company="other", role="other", jd_raw="test")
            session.add(another); session.flush()
            replacement_job_id = another.id
        replacement = AgentRun(candidate_id=candidate.id, job_id=replacement_job_id, run_type="test", current_stage="draft_generating")
        session.add(replacement); session.commit()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        gateway.register(ToolSpec(name="new-alias", input_model=Empty, output_model=Empty,
            permission=ToolPermission.DRAFT_WRITE, allowed_stages=set(PipelineStage),
            revision="changed-revision", side_effect=True, read_only=False,
            handler=lambda *args: pytest.fail("unresolved operation must block handler")))
        with pytest.raises(HarnessError) as exc:
            gateway.execute(tool_name="new-alias", run=replacement, arguments={},
                granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="new-call")
        assert exc.value.code == "tool_outcome_unknown"
        run_id = replacement.id
    with TestClient(create_app(database)) as client:
        response = client.post(f"/api/pi/runs/{run_id}/tasks",
            json={"kind": "start", "host_id": "synthetic-host", "provider": {"model": "synthetic"}})
        assert response.json()["code"] == "tool_outcome_unknown"


def test_pdf_pages_are_parsed_and_editor_invalidates_old_report(database, tmp_path, monkeypatch):
    from io import BytesIO
    from reportlab.pdfgen.canvas import Canvas
    from applyos_domain.models import Candidate, Fact, ResumeVersion, QualityReport
    from applyos_harness.validation import grounded_claim
    from applyos_harness.versioning import canonical_hash
    monkeypatch.setenv("FETCHCV_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    source = "I organized order data."
    with database.session() as session:
        candidate = Candidate(name="synthetic")
        session.add(candidate); session.flush()
        fact = Fact(candidate_id=candidate.id, category="synthetic", content=source,
                    verified=True, version=1, allowed_outputs=["resume"])
        session.add(fact); session.flush()
        content = {"claims": [grounded_claim(fact).model_dump(mode="json")],
                   "verification_status": "verified",
                   "editor_snapshot": {"profile": {}, "sections": [{"id": "experience", "title": "",
                       "visible": True, "items": [{"body": source, "fields": {}}]}]}}
        resume = ResumeVersion(candidate_id=candidate.id, name="synthetic", source_fact_ids=[fact.id],
                               content_json=content, content_hash=canonical_hash(content))
        session.add(resume); session.flush()
        ident, content_hash = resume.id, resume.content_hash
    buffer = BytesIO()
    writer = Canvas(buffer, pagesize=(595, 842))
    for _ in range(3):
        writer.drawString(40, 800, source)
        writer.showPage()
    writer.save()
    headers = {"x-fetchcv-page-count": "1", "X-FetchCV-Resume-Hash": content_hash}
    with TestClient(create_app(database)) as client:
        assert client.put(f"/api/resumes/{ident}/pdf", content=b"%PDF-not-a-pdf", headers=headers).status_code == 422
        response = client.put(f"/api/resumes/{ident}/pdf", content=buffer.getvalue(),
                              headers=headers)
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["page_count"] == 3
        assert data["quality_report"]["status"] == "blocked"
        assert any(c["code"] == "page_count" and not c["passed"] for c in data["quality_report"]["checks"])
        saved = client.patch(f"/api/resumes/{ident}/editor", json={"editor_snapshot": {"profile": {}, "sections": []}})
        assert saved.status_code == 200, saved.text
    with database.session() as session:
        assert session.get(ResumeVersion, ident).pdf_path is None
        report = session.get(QualityReport, data["quality_report"]["id"])
        assert str(report.status) == "pending"
        assert any(c.get("status") == "stale" for c in report.checks)


def test_control_token_cannot_sign_web_approval(monkeypatch):
    import base64, hashlib, hmac
    from applyos_agent.host_approval import verify_host_approval
    from applyos_harness.errors import HarnessError
    monkeypatch.setenv("FETCHCV_CONTROL_TOKEN", "renderer-visible")
    monkeypatch.setenv("FETCHCV_APPROVAL_KEY", "host-only")
    claim = {"message_id": "m", "tool": "search_web", "call_id": "call", "arguments": {}, "expires_at": time.time()+60}
    encoded = base64.urlsafe_b64encode(json.dumps(claim).encode()).decode().rstrip("=")
    def signed(key):
        return encoded+"."+hmac.new(key, ("fetchcv-web-approval-v1:"+encoded).encode(), hashlib.sha256).hexdigest()
    args = dict(message_id="m", tool_name="search_web", call_id="call", arguments={})
    with pytest.raises(HarnessError):
        verify_host_approval(signed(b"renderer-visible"), **args)
    verify_host_approval(signed(b"host-only"), **args)


def test_four_verified_secondary_sources_are_ready_but_limited():
    from types import SimpleNamespace
    from applyos_agent.interview_evidence import ready_for_brief, evidence_status
    sources = [SimpleNamespace(id=str(i), source_url=f"https://example.com/{i}", status="analyzed", extracted_questions=[{"question": "synthetic"}], platform="nowcoder") for i in range(4)]
    assert not ready_for_brief(sources)
    for source in sources:
        source.raw_text = f"Synthetic interview {source.id}: describe the project."
        source.extracted_questions = [{"question": "synthetic", "evidence_quote": source.raw_text}]
    assert ready_for_brief(sources)
    assert evidence_status(sources) == "limited"


def test_delete_chat_cleans_its_archive_only(database):
    from sqlalchemy import select
    from applyos_domain.models import ToolResultArchive
    from applyos_agent.result_archive import archive_result
    with TestClient(create_app(database)) as client:
        chat = client.post("/api/conversations").json()["id"]
        with database.session() as session:
            archive_result(session, "chat:"+chat, {"text": "delete"})
            archive_result(session, "chat:other", {"text": "keep"})
        assert client.delete(f"/api/conversations/{chat}").status_code == 200
        assert client.get(f"/api/conversations/{chat}").status_code == 404
    with database.session() as session:
        assert list(session.scalars(select(ToolResultArchive.scope))) == ["chat:other"]


def test_workspace_first_result_keeps_fact_summaries_without_portrait(database, tmp_path):
    from applyos_domain.models import Candidate, Fact, Job, ResumeVersion, AgentRun
    from applyos_agent.pi_domain_tools import build_pi_task_gateway
    from applyos_agent.config import AgentSettings, RuntimeMode
    from applyos_harness.permissions import ToolPermission
    with database.session() as session:
        candidate = Candidate(name="synthetic"); session.add(candidate); session.flush()
        job = Job(candidate_id=candidate.id, company="synthetic", role="synthetic", jd_raw="JD"*30000)
        session.add(job); session.flush()
        facts = [Fact(candidate_id=candidate.id, category="experience", content=f"fact-{i} "+"材料"*100, verified=True) for i in range(120)]
        session.add_all(facts)
        resume = ResumeVersion(candidate_id=candidate.id, name="synthetic", content_json={
            "editor_snapshot": {"profile": {"photo": "data:image/png;base64,"+"x"*200000, "name": "synthetic"}, "sections": []}})
        session.add(resume)
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="test", current_stage="created")
        session.add(run);session.flush()
        gateway = build_pi_task_gateway(session, settings=AgentSettings(runtime=RuntimeMode.MOCK, workspace_root=tmp_path, allow_mock_runtime=True))
        result = gateway.execute(tool_name="inspect_application_workspace", run=run, arguments={},
            granted_permissions=set(ToolPermission), idempotency_key="inspect-synthetic")
        assert len(result["data"]["fact_summaries"]) == 120
        assert all(item["text"] for item in result["data"]["fact_summaries"])
        assert "base64" not in json.dumps(result)


def test_desktop_additive_schema_creates_archive_and_chats_without_touching_rows(database):
    from sqlalchemy import inspect
    from applyos_domain.models import Candidate, ToolResultArchive
    from applyos_domain.conversations import Conversation, ConversationMessage
    with database.session() as session:
        candidate = Candidate(name="preserved"); session.add(candidate);session.flush()
        ident = candidate.id
    ConversationMessage.__table__.drop(database.engine)
    Conversation.__table__.drop(database.engine)
    ToolResultArchive.__table__.drop(database.engine)
    database.create_schema()
    tables = set(inspect(database.engine).get_table_names())
    assert {"conversation_messages", "conversations", "tool_result_archives"} <= tables
    with database.session() as session:
        assert session.get(Candidate, ident).name == "preserved"
