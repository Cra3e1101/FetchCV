from collections import Counter
from contextlib import contextmanager
from datetime import datetime
import re

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, select

from applyos_agent.context import ContextManager
from applyos_api.main import create_app
from applyos_domain.enums import ApprovalStatus, QualityStatus, StepStatus
from applyos_domain.models import (
    AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, AgentTask, Approval, Candidate,
    Experience, Fact, InterviewSource, Job, JobProfile, MaterialAsset, QualityReport, ResumeVersion,
)


@contextmanager
def record_reads(database):
    reads = []

    def capture(_connection, cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            reads.append({
                "sql": statement,
                "columns": [column[0] for column in cursor.description or []],
            })

    event.listen(database.engine, "after_cursor_execute", capture)
    try:
        yield reads
    finally:
        event.remove(database.engine, "after_cursor_execute", capture)


def seed_workspace(database, *, with_run):
    with database.session() as session:
        candidate = Candidate(name="合成切换测试")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="合成公司", role="数据分析", jd_raw="熟悉 SQL")
        session.add(job)
        session.flush()
        if with_run:
            run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume")
            resume = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="测试简历",
                                   content_json={"editor_snapshot": {"sections": [{"id": "skills", "items": [{"body": "SQL"}]}]}})
            session.add_all([run, resume, JobProfile(job_id=job.id, hard_requirements=["熟悉 SQL"], keywords=["SQL"])])
            session.flush()
            session.add_all([
                AgentRunStep(run_id=run.id, stage="test", agent_name="synthetic", sequence=1, event_type="model_turn"),
                AgentTask(run_id=run.id, status="completed", result_json={"checkpoint": {"test": True}}),
                Approval(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id),
                QualityReport(run_id=run.id, target_type="resume", target_id=resume.id, status=QualityStatus.PASSED),
                AgentMessage(candidate_id=candidate.id, job_id=job.id, run_id=run.id, role="user", content="待重新发送的问题",
                             metadata_json={"delivery_status": "failed"}),
            ])
        return candidate.id, job.id


@pytest.mark.parametrize("with_run", [False, True])
def test_workspace_reuses_rows_and_skips_context_rebuild_without_snapshot(database, monkeypatch, with_run):
    _, job_id = seed_workspace(database, with_run=with_run)

    def unexpected_pinned(*_args, **_kwargs):
        pytest.fail("A workspace without a stored context snapshot must not rebuild its fingerprint")

    monkeypatch.setattr(ContextManager, "pinned", unexpected_pinned)
    with TestClient(create_app(database)) as client, record_reads(database) as reads:
        response = client.get(f"/api/jobs/{job_id}/workspace")
    assert response.status_code == 200
    workspace = response.json()
    counts = Counter(match.group(1) for read in reads
                     if (match := re.search(r"\bfrom\s+([a-z_]+)", read["sql"].lower())))
    # The UI and both evaluators consume the same rows in this request. Reading
    # them again adds latency and JSON decoding without any fresher evidence.
    for table in ("job_profiles", "agent_messages"):
        assert counts[table] == 1, (table, counts)
    if with_run:
        for table in ("agent_run_steps", "agent_tasks", "approvals", "quality_reports", "agent_context_snapshots"):
            assert counts[table] == 1, (table, counts)
        checks = {check["code"]: check for check in workspace["run_evaluation"]["checks"]}
        assert checks["model_trace"]["status"] == "passed"
        assert checks["message_delivery"]["status"] == "warning"
        assert checks["human_control"]["status"] == "pending"
        assert checks["context_current"]["status"] == "passed"
        assert workspace["ats_readiness"]["keywords"] == [{"text": "SQL", "matched": True}]
    else:
        assert workspace["run_evaluation"]["status"] == "not_started"
        assert workspace["ats_readiness"]["status"] == "not_ready"
        assert counts["agent_context_snapshots"] == 0


def test_workspace_source_preview_is_projected_without_loading_full_body(database):
    candidate_id, job_id = seed_workspace(database, with_run=False)
    raw_text = "中文📎" * 400 + "只在详情出现的尾部" * 3000
    with database.session() as session:
        source = InterviewSource(
            candidate_id=candidate_id, job_id=job_id, platform="nowcoder", company="合成公司", role="数据分析",
            title="合成长文", source_url="https://example.com/interview", url_hash="a" * 64,
            content_hash="b" * 64, raw_text=raw_text, summary="合成摘要", tags=["SQL", "面试"],
            extracted_questions=[{"question": "如何检查 SQL?", "evidence_quote": "中文📎"}],
            metadata_json={"nested": {"status": "captured"}}, author="合成作者",
        )
        session.add(source)
        session.flush()
        source_id = source.id
    with TestClient(create_app(database)) as client:
        with record_reads(database) as reads:
            response = client.get(f"/api/jobs/{job_id}/workspace")
        assert response.status_code == 200
        preview = response.json()["interview_sources"][0]
        full_response = client.get(f"/api/interview-sources/{source_id}")
        assert full_response.status_code == 200
        full = full_response.json()
    assert full["raw_text"] == raw_text
    expected = {key: value for key, value in full.items()
                if key not in {"raw_text", "content_hash", "url_hash", "review_content_hash"}}
    expected["text_preview"] = raw_text[:800]
    assert preview == expected
    source_reads = [read for read in reads if re.search(r"\bfrom\s+interview_sources\b", read["sql"].lower())]
    assert len(source_reads) == 1
    assert "raw_text" not in source_reads[0]["columns"], "Full captured text must stay out of the list query result"
    assert "text_preview" in source_reads[0]["columns"]


def test_workspace_reuses_current_rows_without_losing_historical_context_checks(database):
    candidate_id, job_id = seed_workspace(database, with_run=True)
    with database.session() as session:
        job = session.get(Job, job_id)
        run = session.scalar(select(AgentRun).where(AgentRun.job_id == job_id))
        old_run = AgentRun(candidate_id=candidate_id, job_id=job_id, run_type="resume",
                           created_at=datetime(2020, 1, 1))
        fact = Fact(candidate_id=candidate_id, category="experience", content="已核验的 SQL 经历", verified=True)
        session.add_all([
            old_run, fact, Experience(candidate_id=candidate_id, kind="experience", title="合成经历"),
            MaterialAsset(candidate_id=candidate_id, kind="attachment", name="完整项目材料"),
            ResumeVersion(candidate_id=candidate_id, name="基础简历", content_json={"profile": "合成简历"}),
        ])
        session.flush()
        historical_approval = Approval(run_id=old_run.id, action_type="apply_resume_changes", target_type="job",
                                       target_id=job_id, status=ApprovalStatus.APPROVED, decision_payload={"keep": "SQL"})
        historical_failure = AgentRunStep(run_id=old_run.id, stage="review", agent_name="synthetic", sequence=1,
                                          status=StepStatus.FAILED, error_code="source_unreachable")
        session.add_all([historical_approval, historical_failure])
        session.flush()
        pinned = ContextManager(session).pinned(job)
        assert historical_approval.id in [item["id"] for item in pinned["explicit_memory"]["approvals"]]
        assert historical_failure.id in [item["step_id"] for item in pinned["operational_memory"]["verified_failures"]]
        snapshot = AgentContextSnapshot(job_id=job_id, run_id=run.id, version=1, summary="完整历史摘要" * 1000,
                                        pinned_context=pinned, compacted_message_ids=["historical-message"])
        session.add(snapshot)
        session.flush()
        snapshot_id, fact_id, approval_id = snapshot.id, fact.id, historical_approval.id

    def context_status(client):
        response = client.get(f"/api/jobs/{job_id}/workspace")
        assert response.status_code == 200
        return next(item["status"] for item in response.json()["run_evaluation"]["checks"] if item["code"] == "context_current")

    with TestClient(create_app(database)) as client:
        with record_reads(database) as reads:
            assert context_status(client) == "passed"
        counts = Counter(match.group(1) for read in reads
                         if (match := re.search(r"\bfrom\s+([a-z_]+)", read["sql"].lower())))
        assert counts["resume_versions"] == 2  # All job versions and all base versions, read once each.
        assert counts["facts"] == counts["material_assets"] == counts["agent_messages"] == 1
        snapshot_read = next(read for read in reads if "FROM agent_context_snapshots" in read["sql"])
        assert "summary" not in snapshot_read["columns"]
        assert "compacted_message_ids" not in snapshot_read["columns"]

        # A historical run's approval remains part of the live fingerprint.
        with database.session() as session:
            session.get(Approval, approval_id).decision_payload = {"keep": "SQL 和 Python"}
        assert context_status(client) == "warning"
        with database.session() as session:
            session.get(AgentContextSnapshot, snapshot_id).pinned_context = ContextManager(session).pinned(session.get(Job, job_id))
        assert context_status(client) == "passed"

        # Reusing rows must never turn the fingerprint check into a stale cache.
        with database.session() as session:
            session.get(Fact, fact_id).content = "新增并核验的 Python 经历"
        assert context_status(client) == "warning"
