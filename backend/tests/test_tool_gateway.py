from pathlib import Path

import pytest
from pydantic import BaseModel
from sqlalchemy import select

from applyos_domain.enums import RunStatus
from applyos_domain.models import AgentRun, AgentRunStep, Candidate, Job, ToolInvocation
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
        second = gateway.execute(tool_name="echo_write", run=run, arguments=args, granted_permissions={ToolPermission.DRAFT_WRITE}, idempotency_key="new-host-call-id")
        assert first == second == {"value": "ok", "calls": 1}
        assert calls["count"] == 1
        invocation = session.scalar(select(ToolInvocation).where(ToolInvocation.run_id == run.id, ToolInvocation.tool_name == "echo_write"))
        assert invocation is not None
        assert invocation.operation_id.startswith("op_")
        assert invocation.status == "completed"

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


def test_gateway_never_replays_an_unsettled_side_effect(database, tmp_path: Path):
    with database.session() as session:
        candidate, job, run = _context(session)
        calls = {"count": 0}

        def handler(_context, payload):
            calls["count"] += 1
            return {"value": payload.value, "calls": calls["count"]}

        gateway = ToolGateway(session, workspace_root=tmp_path)
        gateway.register(ToolSpec(
            name="external_write",
            input_model=EchoInput,
            output_model=EchoOutput,
            permission=ToolPermission.DRAFT_WRITE,
            allowed_stages={PipelineStage.DRAFT_GENERATING},
            handler=handler,
            read_only=False,
            side_effect=True,
        ))
        arguments = {"candidate_id": candidate.id, "job_id": job.id, "value": "once"}
        operation_id, arguments_hash = gateway._operation_identity(
            run=run,
            stage=PipelineStage.DRAFT_GENERATING,
            tool_name="external_write",
            arguments=arguments,
        )
        session.add(ToolInvocation(
            operation_id=operation_id,
            run_id=run.id,
            tool_name="external_write",
            stage=PipelineStage.DRAFT_GENERATING.value,
            arguments_hash=arguments_hash,
            arguments_summary=arguments,
            provider_call_id="host-before-crash",
            status="running",
        ))
        session.commit()

        with pytest.raises(HarnessError) as stopped:
            gateway.execute(
                tool_name="external_write",
                run=run,
                arguments=arguments,
                granted_permissions={ToolPermission.DRAFT_WRITE},
                idempotency_key="host-after-restart",
            )
        assert stopped.value.code == "tool_outcome_unknown"
        assert calls["count"] == 0
        assert session.scalar(select(ToolInvocation).where(ToolInvocation.operation_id == operation_id)).status == "running"  # Only host reconciliation may declare an active claim orphaned.


@pytest.mark.parametrize("scope,expected", [("local_transactional", "failed"), ("local_with_read_cache", "failed"), ("external", "outcome_unknown")])
def test_failed_effect_is_settled_and_retry_requires_proof(database, tmp_path, scope, expected):
    with database.session() as session:
        candidate, job, run = _context(session)
        original_name = candidate.name
        calls = []
        def handler(context, payload):
            calls.append(1)
            if len(calls) == 1:
                candidate.name = "must rollback"
                session.flush()
                raise ValueError("synthetic failure")
            return {"value": payload.value, "calls": len(calls)}
        gateway = ToolGateway(session, workspace_root=tmp_path)
        gateway.register(ToolSpec(name="settlement", input_model=EchoInput, output_model=EchoOutput,
            permission=ToolPermission.DRAFT_WRITE, allowed_stages={PipelineStage.DRAFT_GENERATING},
            handler=handler, side_effect=True, read_only=False, effect_scope=scope))
        args=dict(tool_name="settlement",run=run,arguments={"candidate_id":candidate.id,"job_id":job.id,"value":"ok"},
                  granted_permissions={ToolPermission.DRAFT_WRITE},idempotency_key="call-1")
        with pytest.raises(HarnessError):gateway.execute(**args)
        row=session.scalar(select(ToolInvocation).where(ToolInvocation.run_id==run.id))
        assert row.status==expected
        assert candidate.name==original_name
        if scope=="external":
            with pytest.raises(HarnessError,match="结果未知"):gateway.execute(**args)
            assert len(calls)==1
            row.status="retry_authorized"  # Same durable state written by the user resolution endpoint.
            session.commit()
        assert gateway.execute(**args)["calls"]==2
        assert row.status=="completed"
        assert row.error_json["attempt"]==2
        assert gateway.execute(**args)["calls"]==2
        assert len(calls)==2


def test_rollback_approval_endpoint_executes_the_scoped_restore(database, tmp_path):
    from fastapi.testclient import TestClient
    from applyos_api.main import create_app
    from applyos_domain.models import ResumeVersion, Approval
    from applyos_harness.versioning import VersionService
    with database.session() as session:
        candidate,job,run=_context(session)
        resume=ResumeVersion(candidate_id=candidate.id,job_id=job.id,name="restore",content_json={"text":"before"});session.add(resume);session.flush()
        snap=VersionService(session).snapshot_entity(resume,run_id=run.id,reason="test before")
        resume.content_json={"text":"after"};session.flush()
        run_id,resume_id,snapshot_id=run.id,resume.id,snap.id
    with TestClient(create_app(database)) as client:
        requested=client.post(f"/api/pi/runs/{run_id}/tools/rollback_version_snapshot",json={"arguments":{"snapshot_id":snapshot_id},"idempotency_key":"rollback-test-call"})
        assert requested.status_code==403,requested.text
        with database.session() as session:
            approval=session.scalar(select(Approval).where(Approval.run_id==run_id,Approval.action_type=="rollback_version_snapshot"))
            approval_id=approval.id
        decided=client.post(f"/api/agent-runs/{run_id}/approvals/{approval_id}/decision",json={"decision":"approved","decided_by":"test_user"})
        assert decided.status_code==200,decided.text
    with database.session() as session:assert session.get(ResumeVersion,resume_id).content_json=={"text":"before"}
