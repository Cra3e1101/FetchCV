from contextlib import contextmanager
from datetime import datetime, timedelta

from sqlalchemy import event

from applyos_agent import ats
from applyos_agent.ats import AtsReadinessEvaluator, AtsReadinessInputs
from applyos_agent.context import ContextManager
from applyos_agent.evaluation import AgentRunEvaluator, RunEvaluationInputs
from applyos_domain.enums import ApprovalStatus, QualityStatus
from applyos_domain.models import (
    AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, AgentTask,
    Approval, Candidate, Job, JobProfile, QualityReport, ResumeVersion,
)


@contextmanager
def capture_selects(database):
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", capture)
    try:
        yield statements
    finally:
        event.remove(database.engine, "before_cursor_execute", capture)


def seed(session):
    candidate = Candidate(name="Evaluation fixture")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="Fixture", role="Analyst", jd_raw="SQL 数据分析；Python 建模；跨团队协作")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume")
    profile = JobProfile(
        job_id=job.id, hard_requirements=["SQL 数据分析", "Python 建模", "跨团队协作"],
        keywords=["SQL", "SQL", "数据分析", "Python", "  "], business_context={"evidence": ["JD"]},
    )
    snapshot = {"sections": [
        {"id": "experience", "items": [
            {"id": f"item-{index}", "fields": {"organization": f"团队 {index}"},
             "body": "使用 SQL 完成数据分析，并与跨团队协作。 " + "可核验经历 " * 35}
            for index in range(6)
        ]},
        {"id": "skills", "items": [{"body": "SQL、Excel"}]},
        {"id": "education", "items": [{"body": "统计学"}]},
    ]}
    resume = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="Resume", content_json={"editor_snapshot": snapshot})
    session.add_all([run, profile, resume])
    session.flush()
    start = datetime(2026, 1, 1)
    tasks, approvals, reports, messages = [], [], [], []
    for index in range(7):
        created = start + timedelta(days=index)
        tasks.append(AgentTask(id=f"task-{index}", run_id=run.id, status="completed", created_at=created,
                               updated_at=start + timedelta(days=index // 2), result_json={"checkpoint": {"saved": True}}))
        approvals.append(Approval(id=f"approval-{index}", run_id=run.id, action_type="apply_resume_changes", target_type="resume",
                                  target_id=resume.id, status=ApprovalStatus.PENDING if index == 2 else ApprovalStatus.APPROVED,
                                  created_at=created, updated_at=created))
        reports.append(QualityReport(id=f"quality-{index}", run_id=run.id, target_type="resume", target_id=resume.id,
                                     status=QualityStatus.PASSED, created_at=created))
        messages.append(AgentMessage(id=f"message-{index}", candidate_id=candidate.id, job_id=job.id, role="user",
                                     content="fixture", metadata_json={"delivery_status": "failed"}, created_at=created, updated_at=created))
    messages.append(AgentMessage(id="assistant-failure", candidate_id=candidate.id, job_id=job.id, role="assistant", content="fixture",
                                 metadata_json={"delivery_status": "failed"}, created_at=start, updated_at=start))
    steps = [AgentRunStep(run_id=run.id, stage="review", agent_name="fixture", sequence=1, event_type="model_turn")]
    session.add_all([*tasks, *approvals, *reports, *messages, *steps])
    session.flush()
    return job, run, resume, RunEvaluationInputs(steps, tasks[::-1], approvals[::-1], reports[::-1], profile, resume, messages[::-1])


def checks_by_code(result):
    return {item["code"]: item for item in result["checks"]}


def test_preloaded_run_evaluation_matches_independent_reads_and_avoids_context_work(database, monkeypatch):
    def unexpected_pinned(*_args, **_kwargs):
        raise AssertionError("A missing context snapshot needs no fingerprint computation")

    monkeypatch.setattr(ContextManager, "pinned", unexpected_pinned)
    with database.session() as session:
        job, run, _resume, inputs = seed(session)
        with capture_selects(database) as independent_queries:
            independent = AgentRunEvaluator(session).evaluate(job=job, run=run)
        with capture_selects(database) as loaded_queries:
            loaded = AgentRunEvaluator(session).evaluate(job=job, run=run, inputs=inputs)
        assert loaded == independent
        assert len(independent_queries) == 8
        assert len(loaded_queries) == 1
        assert "LIMIT" in loaded_queries[0]
        checks = checks_by_code(loaded)
        assert checks["event_protocol"]["evidence"] == ["task:task-6", "task:task-5", "task:task-4", "task:task-3"]
        assert checks["human_control"]["evidence"] == [f"approval:approval-{i}" for i in range(6)]
        assert checks["quality_gate"]["evidence"] == [f"quality:quality-{i}" for i in range(4)]
        assert checks["message_delivery"]["evidence"] == [f"message:message-{i}" for i in range(4)]


def test_known_empty_run_inputs_do_not_fall_back_to_database_rows(database):
    with database.session() as session:
        job, run, _resume, _inputs = seed(session)
        empty = RunEvaluationInputs([], [], [], [], None, None, [])
        with capture_selects(database) as queries:
            result = AgentRunEvaluator(session).evaluate(job=job, run=run, inputs=empty)
        assert len(queries) == 1
        checks = checks_by_code(result)
        assert checks["job_evidence"]["status"] == "pending"
        assert checks["resume_lineage"]["status"] == "pending"
        assert checks["message_delivery"]["status"] == "passed"
        assert checks["human_control"]["evidence"] == []
        with capture_selects(database) as queries:
            assert AgentRunEvaluator(session).evaluate(job=job, run=None, inputs=empty)["status"] == "not_started"
        assert queries == []


def test_existing_latest_snapshot_still_checks_current_fingerprint(database, monkeypatch):
    calls = []
    monkeypatch.setattr(ContextManager, "pinned", lambda _self, job: calls.append(job.id) or {"source_fingerprint": "current"})
    with database.session() as session:
        job, run, _resume, inputs = seed(session)
        session.add_all([
            AgentContextSnapshot(id="snapshot-old", job_id=job.id, run_id=run.id, version=1, summary="", pinned_context={"source_fingerprint": "stale"}),
            AgentContextSnapshot(id="snapshot-latest", job_id=job.id, run_id=run.id, version=2, summary="", pinned_context={"source_fingerprint": "current"}),
        ])
        session.flush()
        result = AgentRunEvaluator(session).evaluate(job=job, run=run, inputs=inputs)
        assert calls == [job.id]
        assert checks_by_code(result)["context_current"] == {
            "code": "context_current", "label": "上下文与当前材料一致", "status": "passed", "evidence": ["context:snapshot-latest"],
        }


def test_preloaded_ats_matches_independent_reads_and_preserves_evidence(database):
    with database.session() as session:
        job, run, resume, inputs = seed(session)
        with capture_selects(database) as independent_queries:
            independent = AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume)
        with capture_selects(database) as loaded_queries:
            loaded = AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume,
                                                            inputs=AtsReadinessInputs(inputs.profile, inputs.reports))
        assert loaded == independent
        assert len(independent_queries) == 2
        assert loaded_queries == []
        assert loaded["requirements"][0]["evidence"] == ["SQL", "SQL", "数据分析"]
        assert len(loaded["requirements"][0]["resume_evidence"]) == 4
        assert [item["item_id"] for item in loaded["requirements"][0]["resume_evidence"]] == [f"item-{i}" for i in range(4)]
        assert loaded["requirements"][1]["support_status"] == "unsupported"
        assert "Python" in loaded["gaps"]


def test_known_empty_ats_inputs_are_authoritative(database):
    with database.session() as session:
        job, run, resume, inputs = seed(session)
        with capture_selects(database) as queries:
            missing = AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume, inputs=AtsReadinessInputs(None, []))
            empty_reports = AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume,
                                                                    inputs=AtsReadinessInputs(inputs.profile, []))
        assert queries == []
        assert missing["status"] == "not_ready"
        assert next(item for item in empty_reports["document_checks"] if item["code"] == "quality_gate")["passed"] is False


def test_ats_normalizes_whole_resume_and_prepares_items_once(database, monkeypatch):
    with database.session() as session:
        job, run, resume, inputs = seed(session)
        text = "\n".join(ats._flatten_strings(resume.content_json))
        normalized_calls, prepared_calls = [], []
        normalize, prepare = ats._normalized, ats._prepare_resume_evidence
        monkeypatch.setattr(ats, "_normalized", lambda value: normalized_calls.append(value) or normalize(value))
        monkeypatch.setattr(ats, "_prepare_resume_evidence", lambda snapshot: prepared_calls.append(snapshot) or prepare(snapshot))
        AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume, inputs=AtsReadinessInputs(inputs.profile, inputs.reports))
        assert normalized_calls.count(text) == 1
        assert len(prepared_calls) == 1
        inputs.profile.hard_requirements = ["Python 建模"]
        prepared_calls.clear()
        AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume, inputs=AtsReadinessInputs(inputs.profile, inputs.reports))
        assert prepared_calls == []
