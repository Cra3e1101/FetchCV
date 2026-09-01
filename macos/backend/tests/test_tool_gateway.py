from pathlib import Path

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from applyos_domain.enums import RunStatus
from applyos_domain.models import AgentRun, AgentRunStep, Candidate, Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage


class EchoInput(BaseModel):
    candidate_id: str
    job_id: str
    output_path: str | None = None
    value: str


class EchoOutput(BaseModel):
    value: str
    calls: int


def _context(session):
    candidate = Candidate(name="工具测试")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="甲", role="分析师", jd_raw="JD")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="test", current_stage="draft_generating", status=RunStatus.RUNNING)
    session.add(run)
    session.flush()
    return candidate, job, run


def test_gateway_enforces_permission_scope_path_and_idempotency(database, tmp_path: Path):
    with database.session() as session:
        candidate, job, run = _context(session)
        calls = {"count": 0}

        def handler(context, payload):
            context.require(ToolPermission.DRAFT_WRITE)
            calls["count"] += 1
            return {"value": payload.value, "calls": calls["count"]}

        gateway = ToolGateway(session, workspace_root=tmp_path)
        gateway.register(
            ToolSpec(
                name="echo_write",
                input_model=EchoInput,
                output_model=EchoOutput,
                permission=ToolPermission.DRAFT_WRITE,
                allowed_stages={PipelineStage.DRAFT_GENERATING},
                handler=handler,
                read_only=False,
                side_effect=True,
                path_fields=("output_path",),
            )
        )
        args = {"candidate_id": candidate.id, "job_id": job.id, "output_path": str(tmp_path / "artifact.json"), "value": "ok"}
        first = gateway.execute(tool_name="echo_write", run=run, arguments=args, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="same")
        second = gateway.execute(tool_name="echo_write", run=run, arguments=args, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="same")
        assert first == second == {"value": "ok", "calls": 1}
        assert calls["count"] == 1

        with pytest.raises(HarnessError) as replay_permission_error:
            gateway.execute(tool_name="echo_write", run=run, arguments=args, granted_permissions={ToolPermission.READ}, idempotency_key="same")
        assert replay_permission_error.value.code == "tool_permission_denied"

        with pytest.raises(HarnessError) as permission_error:
            gateway.execute(tool_name="echo_write", run=run, arguments=args, granted_permissions={ToolPermission.READ}, idempotency_key="permission")
        assert permission_error.value.code == "tool_permission_denied"

        outside = {**args, "output_path": str(tmp_path.parent / "outside.json")}
        with pytest.raises(HarnessError) as path_error:
            gateway.execute(tool_name="echo_write", run=run, arguments=outside, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="outside")
        assert path_error.value.code == "path_outside_workspace"

        wrong_scope = {**args, "candidate_id": "other"}
        with pytest.raises(HarnessError) as scope_error:
            gateway.execute(tool_name="echo_write", run=run, arguments=wrong_scope, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="scope")
        assert scope_error.value.code == "tool_scope_mismatch"

        with pytest.raises(HarnessError) as unknown_error:
            gateway.execute(tool_name="unknown_tool", run=run, arguments={}, granted_permissions={ToolPermission.READ}, idempotency_key="unknown")
        assert unknown_error.value.code == "tool_not_registered"
        assert session.scalar(select(AgentRunStep).where(AgentRunStep.run_id == run.id, AgentRunStep.error_code == "tool_not_registered")) is not None

        with pytest.raises(HarnessError) as input_error:
            gateway.execute(tool_name="echo_write", run=run, arguments={}, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="invalid-input")
        assert input_error.value.code == "tool_input_invalid"

        def failing_handler(_context, _payload):
            raise ValueError("internal details must not escape")

        gateway.register(
            ToolSpec(
                name="failing_write",
                input_model=EchoInput,
                output_model=EchoOutput,
                permission=ToolPermission.DRAFT_WRITE,
                allowed_stages={PipelineStage.DRAFT_GENERATING},
                handler=failing_handler,
                read_only=False,
                side_effect=True,
            )
        )
        with pytest.raises(HarnessError) as execution_error:
            gateway.execute(tool_name="failing_write", run=run, arguments=args, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="handler-error")
        assert execution_error.value.code == "tool_execution_failed"
        assert "internal details" not in execution_error.value.message
        assert session.scalar(select(AgentRunStep).where(AgentRunStep.run_id == run.id, AgentRunStep.error_code == "tool_execution_failed")) is not None
