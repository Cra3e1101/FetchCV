from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import select

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.engine import AgentEngine
from applyos_agent.schemas import RuntimeToolCall, RuntimeTurnResult
from applyos_agent.tools import register_pipeline_tools
from applyos_domain.enums import RunStatus, StepStatus
from applyos_domain.models import AgentRunStep, Approval, Candidate, Fact, Job, RewriteProposal
from applyos_harness.approval import ApprovalService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway
from applyos_harness.pipeline import MockPipeline


class StageAwareRuntime:
    def __init__(self):
        self.calls = []
        self.turn = 0

    def generate(self, **_):
        raise AssertionError("AgentEngine should use complete_turn")

    async def stream_text(self, **_) -> AsyncIterator[dict]:
        if False:
            yield {}

    def complete_turn(self, *, messages, tools, session_id=None, **_):
        self.turn += 1
        available = [item.name for item in tools]
        self.calls.append({"available": available, "messages": messages})
        selected = next((name for name in available if name != "inspect_job_context"), None)
        if selected is None:
            return RuntimeTurnResult(text="等待用户操作", session_id=session_id)
        return RuntimeTurnResult(
            tool_calls=[RuntimeToolCall(id=f"call-{self.turn}", name=selected, arguments={})],
            finish_reason="tool_calls",
            session_id=session_id,
            usage={"runtime": "scripted", "model": "stage-aware"},
        )


class FixedRuntime(StageAwareRuntime):
    def __init__(self, tool_calls):
        super().__init__()
        self.fixed_tool_calls = tool_calls

    def complete_turn(self, **kwargs):
        self.turn += 1
        self.calls.append({"available": [item.name for item in kwargs["tools"]], "messages": kwargs["messages"]})
        calls = self.fixed_tool_calls if self.turn == 1 else [RuntimeToolCall(id=f"normal-{self.turn}", name=next(item.name for item in kwargs["tools"] if item.name != "inspect_job_context"), arguments={})]
        return RuntimeTurnResult(tool_calls=calls, finish_reason="tool_calls", usage={"runtime": "scripted"})


def _seed(session, *, jd="负责数据分析、Python 和业务指标优化"):
    candidate = Candidate(name="Agent 候选人")
    session.add(candidate)
    session.flush()
    facts = [
        Fact(candidate_id=candidate.id, category="experience", content="在产品实习中完成漏斗分析", verified=True, allowed_outputs=["resume", "portfolio"]),
        Fact(candidate_id=candidate.id, category="project", content="使用 Python 构建数据清洗流程", verified=True, allowed_outputs=["resume", "portfolio"]),
    ]
    session.add_all(facts)
    job = Job(candidate_id=candidate.id, company="目标公司", role="数据分析师", jd_raw=jd)
    session.add(job)
    session.flush()
    return candidate, facts, job


def _engine(session, tmp_path, runtime):
    pipeline = MockPipeline(session)
    gateway = ToolGateway(session, workspace_root=tmp_path)
    register_pipeline_tools(gateway, pipeline)
    settings = AgentSettings(runtime=RuntimeMode.MOCK, model="scripted", workspace_root=tmp_path, max_turns=4, allow_mock_runtime=True)
    return AgentEngine(session, runtime=runtime, pipeline=pipeline, gateway=gateway, settings=settings)


def _approval(session, run_id, action):
    return session.scalar(select(Approval).where(Approval.run_id == run_id, Approval.action_type == action))


def test_agent_loop_executes_model_tool_model_and_persists_real_results(database, tmp_path):
    with database.session() as session:
        candidate, facts, job = _seed(session)
        runtime = StageAwareRuntime()
        engine = _engine(session, tmp_path, runtime)
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="agent-loop-e2e")

        first = engine.run(run)
        assert first.stop_reason == "approval_required"
        assert run.current_stage == "awaiting_fact_review"
        ApprovalService(session).approve_action(
            approval_id=_approval(session, run.id, "confirm_relevant_facts").id,
            approved_by="tester",
            payload={"fact_ids": [fact.id for fact in facts]},
        )

        second = engine.run(run)
        assert second.stop_reason == "approval_required"
        assert run.current_stage == "awaiting_user_review"
        proposals = list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all())
        ApprovalService(session).review_proposals(
            approval_id=_approval(session, run.id, "apply_resume_changes").id,
            approved_by="tester",
            decisions=[{"proposal_id": item.id, "decision": "accepted"} for item in proposals],
        )

        third = engine.run(run)
        assert third.stop_reason == "approval_required"
        assert run.current_stage == "awaiting_publish_approval"
        ApprovalService(session).approve_action(
            approval_id=_approval(session, run.id, "publish_assets").id,
            approved_by="tester",
        )

        final = engine.run(run)
        assert final.stop_reason == "ready_to_publish"
        assert run.current_stage == "ready_to_publish"
        expected_tools = [
            "validate_run_input",
            "analyze_job",
            "match_candidate_experiences",
            "generate_resume_strategy",
            "propose_resume_rewrites",
            "apply_approved_resume_changes",
            "validate_resume",
            "build_portfolio_preview",
            "run_consistency_checks",
            "finalize_publish_ready",
        ]
        steps = list(session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence)).all())
        tool_steps = [step for step in steps if step.event_type == "tool" and step.status == StepStatus.COMPLETED]
        assert [step.tool_calls[0]["tool_name"] for step in tool_steps] == expected_tools
        assert all("result" in step.tool_calls[0] for step in tool_steps)
        assert len([step for step in steps if step.event_type == "model_turn" and step.status == StepStatus.COMPLETED]) == len(expected_tools)
        for tool_step in tool_steps:
            assert any(step.event_type == "model_turn" and step.sequence < tool_step.sequence for step in steps)


def test_agent_cannot_call_tool_outside_current_stage(database, tmp_path):
    with database.session() as session:
        candidate, _, job = _seed(session)
        runtime = FixedRuntime([RuntimeToolCall(id="bad-stage", name="analyze_job", arguments={})])
        engine = _engine(session, tmp_path, runtime)
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="stage-denied")

        outcome = engine.run(run)
        assert outcome.stop_reason == "tool_error"
        assert run.status == RunStatus.FAILED
        failure = session.scalar(select(AgentRunStep).where(AgentRunStep.run_id == run.id, AgentRunStep.error_code == "tool_stage_denied"))
        assert failure is not None


def test_duplicate_tool_call_is_rejected_without_duplicate_side_effect(database, tmp_path):
    with database.session() as session:
        candidate, _, job = _seed(session)
        duplicate_calls = [
            RuntimeToolCall(id="duplicate-1", name="validate_run_input", arguments={}),
            RuntimeToolCall(id="duplicate-2", name="validate_run_input", arguments={}),
        ]
        engine = _engine(session, tmp_path, FixedRuntime(duplicate_calls))
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="duplicate-call")

        outcome = engine.run(run)
        assert outcome.stop_reason == "approval_required"
        steps = list(session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id)).all())
        successful = [step for step in steps if step.event_type == "tool" and step.status == StepStatus.COMPLETED and step.tool_calls[0]["tool_name"] == "validate_run_input"]
        rejected = [step for step in steps if step.event_type == "tool_rejected" and step.error_code == "duplicate_tool_call"]
        assert len(successful) == 1
        assert len(rejected) == 1


def test_failed_tool_can_retry_from_persisted_stage(database, tmp_path):
    with database.session() as session:
        candidate, _, job = _seed(session, jd="")
        engine = _engine(session, tmp_path, StageAwareRuntime())
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="tool-retry")

        failed = engine.run(run)
        assert failed.stop_reason == "tool_error"
        assert run.status == RunStatus.FAILED
        assert run.resume_stage == "input_validating"

        job.jd_raw = "负责数据分析和 Python"
        retried = engine.retry(run)
        assert retried.stop_reason == "approval_required"
        assert run.current_stage == "awaiting_fact_review"
        assert session.scalar(select(AgentRunStep).where(AgentRunStep.run_id == run.id, AgentRunStep.event_type == "recovery")) is not None


def test_runtime_failure_is_persisted_instead_of_leaving_run_running(database, tmp_path):
    class FailingRuntime(StageAwareRuntime):
        def complete_turn(self, **_):
            raise HarnessError("provider_connection_error", "provider unavailable", retryable=True)

    with database.session() as session:
        candidate, _, job = _seed(session)
        engine = _engine(session, tmp_path, FailingRuntime())
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="runtime-failure")

        outcome = engine.run(run)
        assert outcome.stop_reason == "model_error"
        assert run.status == RunStatus.FAILED
        assert session.scalar(select(AgentRunStep).where(AgentRunStep.run_id == run.id, AgentRunStep.event_type == "model_turn", AgentRunStep.status == StepStatus.FAILED)) is not None
