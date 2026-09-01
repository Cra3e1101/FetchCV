from __future__ import annotations

import sys

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from applyos_agent.workspace_tools import register_workspace_tools
from applyos_api.main import create_app
from applyos_domain.models import AgentRun, Approval, Candidate, Job
from applyos_harness.approval import ApprovalService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission


def seed(session):
    candidate = Candidate(name="Workspace candidate")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="Example", role="Analyst")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume_tailoring", current_stage="created")
    session.add(run)
    session.flush()
    return run


def execute(gateway, run, name, arguments):
    return gateway.execute(tool_name=name, run=run, arguments=arguments, granted_permissions={ToolPermission.READ}, idempotency_key=f"test:{name}")


def test_workspace_tools_read_search_and_fixed_commands(database, tmp_path):
    workspace = tmp_path / "workspace"
    (workspace / "notes").mkdir(parents=True)
    (workspace / "notes" / "resume.md").write_text("Python data analysis\nProduct metrics\n", encoding="utf-8")
    (workspace / "profile.json").write_text('{"name":"FetchCV"}', encoding="utf-8")
    with database.session() as session:
        run = seed(session)
        gateway = register_workspace_tools(ToolGateway(session, workspace_root=workspace))
        listed = execute(gateway, run, "list_workspace_files", {})
        assert [item["path"] for item in listed["data"]["files"]] == ["notes/resume.md", "profile.json"]
        read = execute(gateway, run, "read_workspace_file", {"path": "notes/resume.md"})
        assert "data analysis" in read["data"]["text"]
        searched = execute(gateway, run, "search_workspace_text", {"query": "metrics"})
        assert searched["data"]["matches"][0]["line"] == 2
        checked = execute(gateway, run, "run_workspace_command", {"command": "validate_json", "path": "profile.json"})
        assert checked["data"]["result"]["valid"] is True


def test_workspace_tools_reject_escape_hidden_and_binary(database, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    outside = tmp_path.parent / "outside-secret.txt"
    outside.write_text("secret", encoding="utf-8")
    (workspace / ".secret").write_text("hidden", encoding="utf-8")
    (workspace / "image.png").write_bytes(b"png")
    try:
        (workspace / "escape").symlink_to(outside)
    except OSError as exc:
        if sys.platform == "win32" and getattr(exc, "winerror", None) == 1314:
            pytest.skip("Windows symlink test requires Developer Mode or elevated privileges")
        raise
    with database.session() as session:
        run = seed(session)
        gateway = register_workspace_tools(ToolGateway(session, workspace_root=workspace))
        for path in ("../outside-secret.txt", ".secret", "escape", "image.png"):
            with pytest.raises(HarnessError):
                execute(gateway, run, "read_workspace_file", {"path": path})


def test_workspace_mutations_require_exact_approval_and_keep_backups(database, tmp_path):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    with database.session() as session:
        run = seed(session)
        gateway = register_workspace_tools(ToolGateway(session, workspace_root=workspace))
        permissions = {ToolPermission.READ, ToolPermission.CONFIRMED_WRITE, ToolPermission.DELETE}

        def mutate(name, arguments, key):
            return gateway.execute(tool_name=name, run=run, arguments=arguments, granted_permissions=permissions, idempotency_key=key)

        write_arguments = {"path": "notes/plan.md", "content": "first", "overwrite": False}
        with pytest.raises(HarnessError, match="需要用户审批"):
            mutate("write_workspace_file", write_arguments, "write:first")
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "workspace_write", Approval.status == "pending"))
        assert approval is not None
        assert approval.decision_payload["items"][0]["arguments"] == write_arguments
        ApprovalService(session).approve_action(approval_id=approval.id, approved_by="tester")
        result = mutate("write_workspace_file", write_arguments, "write:first")
        assert result["data"]["path"] == "notes/plan.md"
        assert (workspace / "notes" / "plan.md").read_text() == "first"

        changed_arguments = {"path": "notes/plan.md", "content": "second", "overwrite": True}
        with pytest.raises(HarnessError, match="需要用户审批"):
            mutate("write_workspace_file", changed_arguments, "write:second")
        changed_approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "workspace_write", Approval.status == "pending"))
        assert changed_approval is not None and changed_approval.target_id != approval.target_id
        ApprovalService(session).approve_action(approval_id=changed_approval.id, approved_by="tester")
        changed = mutate("write_workspace_file", changed_arguments, "write:second")
        assert changed["data"]["backup_path"].startswith(".fetchcv-history/")
        assert (workspace / "notes" / "plan.md").read_text() == "second"

        move_arguments = {"source_path": "notes/plan.md", "destination_path": "notes/final.md"}
        with pytest.raises(HarnessError, match="需要用户审批"):
            mutate("move_workspace_file", move_arguments, "move")
        move_approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "workspace_move", Approval.status == "pending"))
        ApprovalService(session).approve_action(approval_id=move_approval.id, approved_by="tester")
        mutate("move_workspace_file", move_arguments, "move")
        assert (workspace / "notes" / "final.md").exists()

        delete_arguments = {"path": "notes/final.md"}
        with pytest.raises(HarnessError, match="需要用户审批"):
            mutate("delete_workspace_file", delete_arguments, "delete")
        delete_approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "workspace_delete", Approval.status == "pending"))
        ApprovalService(session).approve_action(approval_id=delete_approval.id, approved_by="tester")
        deleted = mutate("delete_workspace_file", delete_arguments, "delete")
        assert deleted["data"]["recoverable"] is True
        assert not (workspace / "notes" / "final.md").exists()


def test_workspace_approval_api_executes_only_the_requested_action(database, tmp_path, monkeypatch):
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("FETCHCV_WORKSPACE_ROOT", str(workspace))
    monkeypatch.setenv("FETCHCV_DISABLE_TASK_WORKER", "1")
    with database.session() as session:
        run = seed(session)
        run_id = run.id
        gateway = register_workspace_tools(ToolGateway(session, workspace_root=workspace))
        arguments = {"path": "approved/note.md", "content": "approved content", "overwrite": False}
        with pytest.raises(HarnessError):
            gateway.execute(
                tool_name="write_workspace_file",
                run=run,
                arguments=arguments,
                granted_permissions={ToolPermission.CONFIRMED_WRITE},
                idempotency_key="api-write",
            )
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "workspace_write"))
        approval_id = approval.id

    with TestClient(create_app(database)) as client:
        response = client.post(
            f"/api/agent-runs/{run_id}/approvals/{approval_id}/decision",
            json={"decision": "approved", "decided_by": "tester"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["decision_payload"]["result"]["data"]["path"] == "approved/note.md"
        assert (workspace / "approved" / "note.md").read_text() == "approved content"
