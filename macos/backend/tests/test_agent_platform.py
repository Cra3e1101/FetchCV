from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from applyos_agent.context import ContextManager
from applyos_agent.mcp_tools import McpManager, register_mcp_tools
from applyos_agent.skills import SkillLoader
from applyos_agent.task_queue import AgentTaskWorker, TaskQueue
from applyos_api.main import create_app
from applyos_domain.models import AgentMessage, AgentRun, AgentSkill, AgentTask, Approval, Candidate, Fact, Job, McpServerConfig, QueuedAgentMessage, ResumeVersion, VersionSnapshot
from applyos_domain.enums import RunStatus
from applyos_harness.errors import HarnessError
from applyos_harness.approval import ApprovalService
from applyos_harness.permissions import ToolGateway, ToolPermission


def _seed(session):
    candidate = Candidate(name="平台测试")
    session.add(candidate)
    session.flush()
    fact = Fact(candidate_id=candidate.id, category="experience", content="使用 Python 分析业务数据", verified=True, allowed_outputs=["resume"])
    job = Job(candidate_id=candidate.id, company="示例公司", role="数据分析师", jd_raw="使用 Python 分析业务指标")
    session.add_all([fact, job])
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume_tailoring", status=RunStatus.CREATED, current_stage="created")
    session.add(run)
    session.flush()
    return candidate, job, run


def test_context_compaction_keeps_pinned_job_and_early_history(database):
    with database.session() as session:
        candidate, job, run = _seed(session)
        for index in range(15):
            session.add(AgentMessage(candidate_id=candidate.id, job_id=job.id, run_id=run.id, role="user" if index % 2 == 0 else "assistant", content=f"历史事实 {index}"))
        session.flush()
        manager = ContextManager(session, recent_message_limit=4)
        payload = json.loads(manager.conversation_context(job=job, run=run, include_job_context=True))
        assert "历史事实 0" in payload["compacted_history"]
        assert payload["pinned"]["job"]["jd"] == job.jd_raw
        assert payload["pinned"]["verified_facts"][0]["content"] == "使用 Python 分析业务数据"
        assert len(payload["recent_messages"]) == 4


def test_task_queue_survives_worker_recreation_and_supports_controls(database):
    with database.session() as session:
        _, _, run = _seed(session)
        task = TaskQueue(session).enqueue(run, kind="start")
        task_id = task.id
    worker = AgentTaskWorker(database, worker_id="worker-a")
    result = worker.process_once()
    assert result and result.item_id == task_id
    with database.session() as session:
        stored = session.get(AgentTask, task_id)
        assert stored.status == "paused"
        TaskQueue(session).resume(stored)
    replacement = AgentTaskWorker(database, worker_id="worker-b")
    assert replacement.process_once() is not None

    with database.session() as session:
        run = session.get(AgentRun, run.id)
        task = TaskQueue(session).enqueue(run, kind="resume")
        TaskQueue(session).request_cancel(task)
        assert task.status == "cancelled"


def test_queued_messages_keep_order_and_are_processed(database, monkeypatch):
    monkeypatch.setattr(
        "applyos_agent.task_queue.AgentService.converse",
        lambda self, job, content, **kwargs: {"message": f"answered:{content}", "intent": "discuss", "suggested_actions": [], "runtime": {}},
    )
    with database.session() as session:
        _, job, run = _seed(session)
        queue = TaskQueue(session)
        first = queue.enqueue_message(job=job, run=run, content="第一个通用问题", thinking_level="fast")
        second = queue.enqueue_message(job=job, run=run, content="第二个通用问题", thinking_level="balanced")
        first_id, second_id = first.id, second.id
    worker = AgentTaskWorker(database)
    assert worker.process_once().item_id == first_id
    assert worker.process_once().item_id == second_id
    with database.session() as session:
        messages = list(session.scalars(select(QueuedAgentMessage).order_by(QueuedAgentMessage.sequence)).all())
        assert [item.status for item in messages] == ["completed", "completed"]
        assert all(item.result_message_id for item in messages)


def test_skill_loader_stays_inside_roots_and_preserves_enabled_state(database, tmp_path, monkeypatch):
    root = tmp_path / "skills"
    valid = root / "resume-review"
    valid.mkdir(parents=True)
    (valid / "SKILL.md").write_text("---\nname: resume-review\ndescription: Review a resume safely\n---\n# Instructions\nKeep facts intact.\n", encoding="utf-8")
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "SKILL.md").write_text("secret", encoding="utf-8")
    (root / "escape").symlink_to(outside, target_is_directory=True)
    monkeypatch.setenv("FETCHCV_SKILL_ROOTS", str(root))
    with database.session() as session:
        loader = SkillLoader(session, project_root=tmp_path / "project")
        skills = loader.sync()
        assert [item.name for item in skills] == ["resume-review"]
        skills[0].enabled = False
    with database.session() as session:
        skills = SkillLoader(session, project_root=tmp_path / "project").sync()
        assert skills[0].enabled is False
        assert "Keep facts intact" in SkillLoader(session, project_root=tmp_path / "project").read(skills[0])


def test_mcp_requires_approval_and_registers_only_read_only_tools(database):
    fixture = Path(__file__).parent / "fixtures" / "mcp_echo_server.py"
    with database.session() as session:
        server = McpServerConfig(name="echo", command=sys.executable, args_json=[str(fixture)], status="unconfigured")
        session.add(server)
        session.flush()
        manager = McpManager(session)
        with pytest.raises(HarnessError, match="批准"):
            manager.probe(server)
        server.approved = True
        tools = manager.probe(server)
        assert {item["name"]: item["read_only"] for item in tools} == {"echo": True, "mutate": False, "mutate_resume": False}
        server.allowed_tools = ["echo"]
        server.enabled = True
        result = manager.call(server, "echo", {"value": "hello"})
        assert "hello" in result["content"]
        with pytest.raises(HarnessError):
            manager.call(server, "mutate", {"value": "no"})


def test_mcp_write_tool_requires_global_scope_and_per_run_approval(database, tmp_path):
    fixture = Path(__file__).parent / "fixtures" / "mcp_echo_server.py"
    with database.session() as session:
        candidate, _, run = _seed(session)
        resume = ResumeVersion(candidate_id=candidate.id, name="Base", content_json={"sections": []})
        server = McpServerConfig(name="writer", command=sys.executable, args_json=[str(fixture)], approved=True)
        session.add_all([resume, server])
        session.flush()
        manager = McpManager(session)
        manager.probe(server)
        server.tool_policies = {
            "mutate_resume": {
                "mode": "write",
                "approved": True,
                "target_type": "resume",
                "target_id_argument": "resume_id",
                "scope": "fetchcv_version",
            }
        }
        server.enabled = True
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_mcp_tools(gateway, manager)
        tool_name = "mcp__writer__mutate_resume"
        arguments = {"resume_id": resume.id, "value": "updated"}

        with pytest.raises(HarnessError) as pending:
            gateway.execute(
                tool_name=tool_name,
                run=run,
                arguments=arguments,
                granted_permissions={ToolPermission.CONFIRMED_WRITE},
                idempotency_key="mcp-write-1",
            )
        assert pending.value.code == "approval_required"
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type.like("mcp_write:%")))
        assert approval is not None and approval.target_id == resume.id
        ApprovalService(session).approve_action(approval_id=approval.id, approved_by="tester")

        result = gateway.execute(
            tool_name=tool_name,
            run=run,
            arguments=arguments,
            granted_permissions={ToolPermission.CONFIRMED_WRITE},
            idempotency_key="mcp-write-1",
        )
        assert resume.id in result["data"]["content"]
        assert result["versioning"]["rollback_available"] is True
        assert session.get(VersionSnapshot, result["versioning"]["before_snapshot_id"]) is not None


def test_task_and_skill_api_are_additive(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_DISABLE_TASK_WORKER", "1")
    with TestClient(create_app(database)) as client:
        with database.session() as session:
            _, job, run = _seed(session)
            job_id, run_id = job.id, run.id
        created = client.post(f"/api/agent-runs/{run_id}/tasks", json={"kind": "start"})
        assert created.status_code == 202
        task_id = created.json()["id"]
        assert client.post(f"/api/agent-tasks/{task_id}/pause").json()["status"] == "paused"
        queued = client.post(f"/api/jobs/{job_id}/messages/queue", json={"content": "稍后回答", "thinking_level": "fast"})
        assert queued.status_code == 202
        workspace = client.get(f"/api/jobs/{job_id}/workspace").json()
        assert workspace["tasks"][0]["id"] == task_id
        assert workspace["queued_messages"][0]["content"] == "稍后回答"
