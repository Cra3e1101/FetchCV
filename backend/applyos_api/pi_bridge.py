from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.prompt_contract import INTERVIEW, build_system_prompt, build_prompt_sections
from applyos_domain.base import utc_now
from applyos_domain.enums import RunStatus, StepStatus
from applyos_domain.models import AgentMessage, AgentRun, AgentTask, Candidate, InterviewBrief, InterviewSource, Job, ToolInvocation
from applyos_harness.errors import HarnessError
from applyos_harness.policy import granted_permissions, permission_settings
from applyos_harness.state_machine import PipelineStage
from applyos_harness.trace import TraceService, redact_text

from .deps import get_session
from .turn_input import resolve_turn_input


router = APIRouter(prefix="/api/pi", tags=["pi-agent-runtime"])


class PiProviderIdentity(BaseModel):
    provider_name: str = Field(default="Custom provider", max_length=160)
    protocol: str = Field(default="openai", pattern="^(openai|anthropic)$")
    base_url: str = Field(default="", max_length=2048)
    model: str = Field(min_length=1, max_length=240)


class PiTurnStart(BaseModel):
    host_id: str | None = Field(default=None, max_length=120)
    content: str = Field(min_length=1, max_length=12000)
    thinking_level: str = Field(default="balanced", pattern="^(fast|balanced|deep)$")
    task_kind: str | None = Field(default=None, max_length=80)
    attachment_paths: list[str] = Field(default_factory=list, max_length=10)
    quoted_text: str | None = Field(default=None, max_length=4000)
    quoted_message_id: str | None = Field(default=None, max_length=80)
    provider: PiProviderIdentity


class PiToolExecution(BaseModel):
    arguments: dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str = Field(min_length=8, max_length=240)
    task_kind: str | None = Field(default=None, max_length=80)
    task_id: str | None = Field(default=None, max_length=80)
    tool_revision: str | None = Field(default=None, min_length=64, max_length=64)
    target_revision: str | None = Field(default=None, min_length=64, max_length=64)


INTERVIEW_RESEARCH_TOOLS = frozenset({
    "read_job_workspace_context",
    "search_interview_knowledge",
    "discover_interview_sources",
    "capture_interview_source",
    "analyze_interview_source",
    "collect_interview_ocr",
    "build_interview_brief",
    "read_skill",
})

ACTIVATE_INTERVIEW_RESEARCH_TOOL = {
    "name": "activate_interview_research",
    "description": (
        "当用户要查找面经、面试经验帖、归纳面试问题或准备某个岗位面试时，"
        "先调用此工具切换到可追溯的面试情报工作流。工作流会先完整检索小红书，"
        "再用牛客、知乎和 CSDN 的可读原文补充交叉验证。"
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reason": {
                "type": "string",
                "description": "用一句话说明为什么当前请求属于面试情报调研。",
                "maxLength": 500,
            },
        },
        "additionalProperties": False,
    },
    "read_only": True,
    "side_effect": False,
}


def _outbound_privacy_profile(session: Session, candidate_id: str) -> dict[str, Any]:
    candidate = session.get(Candidate, candidate_id)
    literals = []
    if candidate is not None:
        literals = [
            value.strip()
            for value in (candidate.name, candidate.email, candidate.phone, candidate.location)
            if isinstance(value, str) and value.strip()
        ]
    return {
        "mode": "redacted_remote",
        "literals": literals,
        "redacts": (["known_identity_literals"] if literals else []) + ["email", "phone", "identity_number", "local_path"],
        "identity_scope": "selected_candidate" if literals else "no_known_identity",
    }


def _turn_tool_definitions(gateway, run: AgentRun, task_kind: str | None) -> list[dict[str, Any]]:
    definitions = gateway.definitions(run)
    if task_kind != "interview_research":
        return [*[
            {**item, "description": item["description"] + " 本岗位涉及面经调研时，先调用 activate_interview_research 切换专用流程。"}
            if item["name"] == "search_web" else item for item in definitions
        ], ACTIVATE_INTERVIEW_RESEARCH_TOOL]
    # Interview research has a dedicated multi-source evidence pipeline.
    # Generic tools would bypass capture, quote verification and persistence.
    return [item for item in definitions if item["name"] in INTERVIEW_RESEARCH_TOOLS | {"read_tool_result", "read_workspace_file"}]


def _active_turn_message(session: Session, run: AgentRun) -> AgentMessage | None:
    return session.scalar(
        select(AgentMessage)
        .where(
            AgentMessage.run_id == run.id,
            AgentMessage.role == "user",
        )
        .order_by(AgentMessage.created_at.desc())
    )


def _effective_turn_task_kind(
    session: Session,
    run: AgentRun,
    requested_task_kind: str | None,
) -> str | None:
    if requested_task_kind:
        return requested_task_kind
    message = _active_turn_message(session, run)
    return (message.metadata_json or {}).get("task_kind") if message else None


class PiTurnComplete(BaseModel):
    content: str = Field(min_length=1)
    usage: dict[str, Any] = Field(default_factory=dict)
    processing_trace: list[dict[str, Any]] = Field(default_factory=list)
    tool_receipts: list[dict[str, Any]] = Field(default_factory=list, max_length=400)
    processing_duration_ms: int = Field(default=1, ge=1)
    task_kind: str | None = Field(default=None, max_length=80)


class PiTurnFailure(BaseModel):
    delivery_status: str = Field(pattern="^(failed|cancelled)$")
    message: str = Field(default="", max_length=2000)


class PiTaskStart(BaseModel):
    kind: str = Field(default="resume", max_length=80)
    host_id: str = Field(default="electron-pi-runtime", min_length=8, max_length=120)
    provider: PiProviderIdentity


class PiTaskComplete(BaseModel):
    content: str = Field(default="", max_length=30000)
    usage: dict[str, Any] = Field(default_factory=dict)
    processing_trace: list[dict[str, Any]] = Field(default_factory=list)
    tool_receipts: list[dict[str, Any]] = Field(default_factory=list, max_length=400)
    processing_duration_ms: int = Field(default=1, ge=1)


class PiTaskFailure(BaseModel):
    status: str = Field(default="failed", pattern="^(failed|paused|cancelled)$")
    message: str = Field(default="", max_length=2000)


class PiHostReconcile(BaseModel):
    host_id: str = Field(min_length=8, max_length=120)


class PiTaskCheckpoint(BaseModel):
    sequence: int = Field(ge=0)
    turn_number: int = Field(default=0, ge=0)
    phase: str = Field(default="running", max_length=80)
    partial_text: str = Field(default="", max_length=12000)
    processing_trace: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    tool_receipts: list[dict[str, Any]] = Field(default_factory=list, max_length=400)
    capability_fingerprint: str | None = Field(default=None, min_length=16, max_length=128)


@router.post("/hosts/reconcile")
def reconcile_host_tasks(payload: PiHostReconcile, session: Session = Depends(get_session)):
    from .conversations import recover_conversations
    recover_conversations(session)
    for message in session.scalars(select(AgentMessage).where(AgentMessage.role == "user", AgentMessage.metadata_json["delivery_status"].as_string() == "streaming")):
        if (message.metadata_json or {}).get("host_id") != payload.host_id:
            message.metadata_json = {**(message.metadata_json or {}), "delivery_status": "cancelled", "error": "上次桌面会话已结束，本轮已停止"}
    orphaned = list(session.scalars(select(AgentTask).where(AgentTask.status == "running")).all())
    recovered = 0
    uncertain = 0
    for task in orphaned:
        if (task.payload_json or {}).get("agent_runtime") != "pi" or task.locked_by == payload.host_id:
            continue
        run = session.get(AgentRun, task.run_id)
        session.execute(update(ToolInvocation).where(ToolInvocation.run_id == task.run_id, ToolInvocation.status == "running").values(status="outcome_unknown"))
        unknown = session.scalar(
            select(ToolInvocation).where(
                ToolInvocation.run_id == task.run_id,
                ToolInvocation.status == "outcome_unknown",
            )
        )
        task.status = "paused"
        task.locked_by = None
        task.error = "上次桌面进程已结束；可从最近检查点继续"
        task.result_json = {
            **(task.result_json or {}),
            "stop_reason": "host_restarted",
            "interrupted_at": utc_now().isoformat(),
        }
        if run is not None:
            if unknown is not None:
                run.status = RunStatus.BLOCKED
                run.error = "存在结果未知的外部操作，需要人工核对后继续"
                uncertain += 1
            elif run.status == RunStatus.RUNNING:
                run.status = RunStatus.PAUSED
                run.error = "桌面进程已重启；任务可从最近检查点继续"
                recovered += 1
    session.flush()
    return {"recovered": recovered, "outcome_unknown": uncertain}


class PiTaskSteer(BaseModel):
    content: str = Field(min_length=1, max_length=12000)
    attachment_paths: list[str] = Field(default_factory=list, max_length=10)
    quoted_text: str | None = Field(default=None, max_length=4000)
    quoted_message_id: str | None = Field(default=None, max_length=80)


class PiInputState(BaseModel):
    state: str = Field(pattern="^(consumed|cancelled|unconsumed)$")


class PiRequestSnapshot(BaseModel):
    sequence: int = Field(ge=1)
    record: dict[str, Any]


@router.post("/records/{kind}/{record_id}/requests")
def record_request(kind: str, record_id: str, payload: PiRequestSnapshot, session: Session = Depends(get_session)):
    record = session.get(AgentTask if kind == "task" else AgentMessage, record_id) if kind in {"task", "turn"} else None
    if record is None:
        raise HarnessError("runtime_record_not_found", "运行记录不存在")
    if kind == "task":
        if record.status != "running" or record.cancel_requested or record.pause_requested:
            raise HarnessError("runtime_record_inactive", "任务已停止，不能开始新模型请求")
        values = dict(record.result_json or {})
    else:
        if record.role != "user" or (record.metadata_json or {}).get("delivery_status") != "streaming":
            raise HarnessError("runtime_record_inactive", "对话已停止，不能开始新模型请求")
        values = dict(record.metadata_json or {})
    snapshots = list(values.get("request_snapshots") or [])
    if payload.sequence != len(snapshots) + 1:
        raise HarnessError("request_sequence_mismatch", "模型请求记录序号不连续")
    snapshots.append(payload.record)
    if len(snapshots) > 64 or len(json.dumps(snapshots, ensure_ascii=False).encode()) > 2 * 1024 * 1024:
        raise HarnessError("request_record_limit", "模型请求审计超过容量，已停止新请求")
    values["request_snapshots"] = snapshots
    if kind == "task":
        record.result_json = values
    else:
        record.metadata_json = values
    return {"sequence": payload.sequence, "saved": True}


@router.post("/inputs/{message_id}/state")
def settle_input(message_id: str, payload: PiInputState, session: Session = Depends(get_session)):
    message = session.get(AgentMessage, message_id)
    if message is None or (message.metadata_json or {}).get("steering_state") is None:
        raise HarnessError("steering_input_not_found", "补充输入不存在")
    values = dict(message.metadata_json or {})
    if values["steering_state"] == "accepted":
        values["steering_state"] = payload.state
        message.metadata_json = values
    elif values["steering_state"] != payload.state:
        raise HarnessError("input_state_conflict", "输入已结算，不能覆盖消费回执")
    return {"message": _message_row(message)}


def _capability_fingerprint(
    tools: list[dict[str, Any]],
    *,
    skills: str,
    permissions: dict[str, Any],
) -> str:
    """Bind durable checkpoints to the capability surface that created them."""
    payload = {
        "tools": tools,
        "skills": skills,
        "permissions": permissions,
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _require_job(session: Session, job_id: str) -> Job:
    job = session.get(Job, job_id)
    if job is None:
        raise HarnessError("job_not_found", "岗位不存在")
    return job


def _require_run(session: Session, run_id: str) -> AgentRun:
    run = session.get(AgentRun, run_id)
    if run is None:
        raise HarnessError("agent_run_not_found", "Agent 运行不存在")
    return run


def _message_row(message: AgentMessage) -> dict[str, Any]:
    return {
        "id": message.id,
        "candidate_id": message.candidate_id,
        "job_id": message.job_id,
        "run_id": message.run_id,
        "role": message.role,
        "content": message.content,
        "metadata_json": message.metadata_json or {},
        "created_at": message.created_at.isoformat() if message.created_at else None,
        "updated_at": message.updated_at.isoformat() if message.updated_at else None,
    }


def _task_row(task: AgentTask) -> dict[str, Any]:
    return {
        "id": task.id,
        "run_id": task.run_id,
        "kind": task.kind,
        "status": task.status,
        "priority": task.priority,
        "attempt": task.attempt,
        "max_attempts": task.max_attempts,
        "payload_json": task.payload_json or {},
        "result_json": task.result_json or {},
        "pause_requested": task.pause_requested,
        "cancel_requested": task.cancel_requested,
        "error": task.error,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
    }


def _runtime_settings(payload: PiProviderIdentity) -> AgentSettings:
    base = AgentSettings.from_env()
    return base.model_copy(update={
        "runtime": RuntimeMode.COMPATIBLE,
        "model": payload.model,
        "provider_name": payload.provider_name,
        "provider_protocol": payload.protocol,
        "provider_base_url": payload.base_url.rstrip("/"),
        "api_key_configured": True,
        # The Electron process owns the encrypted key. It is never copied into
        # this bridge response or persisted by the Python service.
        "provider_api_key": "",
    })


@router.post("/jobs/{job_id}/turns")
def start_turn(job_id: str, payload: PiTurnStart, session: Session = Depends(get_session)):
    from applyos_agent.capabilities import CapabilityMode, build_capability_gateway
    from applyos_agent.context import ContextManager
    from applyos_agent.skills import enabled_skill_catalog

    job = _require_job(session, job_id)
    session.execute(update(Job).where(Job.id == job.id).values(updated_at=Job.updated_at))
    settings = _runtime_settings(payload.provider)
    resolved_input = resolve_turn_input(session, job, payload, settings.workspace_root)
    run = session.scalar(select(AgentRun).where(AgentRun.job_id == job.id).order_by(AgentRun.created_at.desc()))
    if run is None:
        run = AgentRun(
            candidate_id=job.candidate_id,
            job_id=job.id,
            run_type="pi_agent",
            current_stage=PipelineStage.CREATED.value,
        )
        session.add(run)
        session.flush()

    session.execute(update(AgentRun).where(AgentRun.id == run.id).values(updated_at=utc_now()))
    active = session.scalar(select(AgentMessage).where(AgentMessage.job_id == job.id, AgentMessage.role == "user", AgentMessage.metadata_json["delivery_status"].as_string() == "streaming"))
    if active is not None:
        raise HarnessError("conversation_busy", "当前岗位对话正在生成，请先停止或等待完成")
    context_manager = ContextManager(session)
    # Keep durable compaction; only discard the unused legacy transcript string.
    context_manager.compact(job=job, run=run)
    quoted_text = (payload.quoted_text or "").strip()
    gateway = build_capability_gateway(session, settings=settings, mode=CapabilityMode.CONVERSATION)
    tools = _turn_tool_definitions(gateway, run, payload.task_kind)
    system_prompt = build_system_prompt(
        settings, tools=tools, workspace=True,
        interview=payload.task_kind == "interview_research",
        skills=enabled_skill_catalog(session), thinking_level=payload.thinking_level,
    )
    # Workspace identity is scoped context, not a second copy of the policy.
    system_prompt += "\n工具作用域（数据）：job_id=" + json.dumps(job.id)
    user_message = AgentMessage(
        candidate_id=job.candidate_id,
        job_id=job.id,
        run_id=run.id,
        role="user",
        content=payload.content.strip(),
        metadata_json={
            "host_id": payload.host_id,
            "thinking_level": payload.thinking_level,
            "task_kind": payload.task_kind,
            "context_scope": "agent",
            "delivery_status": "streaming",
            "attachment_paths": payload.attachment_paths,
            "quoted_text": quoted_text or None,
            "quoted_message_id": payload.quoted_message_id,
            "input_refs": resolved_input,
            "agent_runtime": "pi",
        },
    )
    session.add(user_message)
    session.flush()
    run.session_id = run.session_id or f"pi:{run.id}"

    # Pi receives native messages rather than one giant prompt containing the
    # whole transcript. The compacted summary remains a small synthetic context
    # message; recent user/assistant turns retain their native roles.
    history_rows = list(
        session.scalars(
            select(AgentMessage)
            .where(AgentMessage.job_id == job.id, AgentMessage.id != user_message.id)
            .order_by(AgentMessage.created_at.desc())
            .limit(context_manager.recent_message_limit)
        ).all()
    )
    history = [
        {"role": item.role, "content": item.content, "timestamp": int(item.created_at.timestamp() * 1000) if item.created_at else 0}
        for item in reversed(history_rows)
        if item.role in {"user", "assistant"} and item.content.strip()
    ]
    latest_snapshot = context_manager.latest(job.id, run.id)
    compacted_summary = latest_snapshot.summary if latest_snapshot else ""

    return {
        "job_id": job.id,
        "run_id": run.id,
        "session_id": run.session_id,
        "user": _message_row(user_message),
        "prompt": resolved_input["prompt"],
        "input_refs": resolved_input,
        "system_prompt": system_prompt,
        "system_prompt_sections": [{"text": "工具作用域（数据）：job_id=" + json.dumps(job.id)}] + build_prompt_sections(
            settings, skills=enabled_skill_catalog(session), thinking_level=payload.thinking_level,
        ),
        "history": history,
        "compacted_summary": compacted_summary,
        "outbound_privacy": _outbound_privacy_profile(session, job.candidate_id),
        "tools": tools,
    }


@router.post("/runs/{run_id}/tools/{tool_name}")
def execute_tool(run_id: str, tool_name: str, payload: PiToolExecution, session: Session = Depends(get_session)):
    from applyos_agent.capabilities import CapabilityMode, build_capability_gateway

    run = _require_run(session, run_id)
    settings = AgentSettings.from_env()
    gateway = build_capability_gateway(session, settings=settings, mode=CapabilityMode.CONVERSATION)
    effective_task_kind = _effective_turn_task_kind(session, run, payload.task_kind)
    if tool_name == "activate_interview_research":
        if effective_task_kind not in {None, "interview_research"}:
            raise HarnessError("agent_task_kind_conflict", "当前任务类型不能切换为面试调研")
        active_message = _active_turn_message(session, run)
        if active_message:
            active_message.metadata_json = {
                **(active_message.metadata_json or {}),
                "task_kind": "interview_research",
            }
        return {
            "tool_name": tool_name,
            "task_kind": "interview_research",
            "tools": _turn_tool_definitions(gateway, run, "interview_research"),
            "result": {
                "stage": run.current_stage or PipelineStage.CREATED.value,
                "status": run.status.value,
                "summary": "已切换到面试情报工作流；将先检索小红书，再用牛客等公开原文补充交叉验证。",
                "artifacts": [],
                "requires_user_action": False,
                "data": {"task_kind": "interview_research", "primary_platform": "xiaohongshu",
                         "workflow_guidance": INTERVIEW},
            },
        }
    if effective_task_kind == "interview_research" and tool_name not in INTERVIEW_RESEARCH_TOOLS | {"read_tool_result", "read_workspace_file"}:
        raise HarnessError(
            "interview_research_tool_not_allowed",
            "面试调研必须使用专用证据工具；通用网页工具不能绕过来源校验和知识入库",
        )
    try:
        result = gateway.execute(
            tool_name=tool_name,
            run=run,
            arguments=payload.arguments,
            granted_permissions=granted_permissions(permission_settings(session)),
            idempotency_key=payload.idempotency_key,
            tool_revision=payload.tool_revision,
            target_revision=payload.target_revision,
        )
    except HarnessError as exc:
        # Auto-requested approvals are intentional durable output, not a failed
        # transaction. Preserve them so the desktop can render the approval and
        # resume the exact idempotent tool call after the user decides.
        if exc.code == "approval_required":
            session.commit()
        raise
    from applyos_agent.result_archive import archive_result
    reference = archive_result(session, "run:" + run.id, result) if tool_name != "read_tool_result" else None
    return {"tool_name": tool_name, "result": result, "result_reference": reference}


@router.post("/runs/{run_id}/tasks")
def start_task(run_id: str, payload: PiTaskStart, session: Session = Depends(get_session)):
    from applyos_agent.pi_domain_tools import build_pi_task_gateway
    from applyos_agent.skills import enabled_skill_catalog
    from applyos_harness.state_machine import RunStateMachine

    run = _require_run(session, run_id)
    from applyos_harness.permissions import assert_no_unresolved_operations
    assert_no_unresolved_operations(session, run)
    if run.status == RunStatus.CANCELLED or run.current_stage in {PipelineStage.CANCELLED.value, PipelineStage.FROZEN.value}:
        raise HarnessError("terminal_state", "该运行已结束，请创建新运行", run_id=run.id)
    if payload.kind == "retry" and PipelineStage(run.current_stage or PipelineStage.CREATED) in {PipelineStage.FAILED, PipelineStage.BLOCKED}:
        RunStateMachine(session).recover(run, actor="user", reason="retry Pi-native task")
    previous = session.scalar(
        select(AgentTask)
        .where(AgentTask.run_id == run.id)
        .order_by(AgentTask.updated_at.desc())
    )
    if previous and previous.status == "running":
        if previous.locked_by == payload.host_id:
            raise HarnessError("agent_task_already_running", "当前 Agent 任务仍在运行", run_id=run.id, retryable=True)
        # The Pi loop lives in Electron. A different host id means the desktop
        # process restarted, so the old in-memory loop no longer exists. Keep
        # its durable checkpoint and release the orphaned lock before resuming.
        previous.status = "paused"
        previous.locked_by = None
        previous.error = "桌面进程已重启；任务可从最近检查点继续"
        previous.result_json = {
            **(previous.result_json or {}),
            "stop_reason": "host_restarted",
            "interrupted_at": utc_now().isoformat(),
        }
    task = AgentTask(
        run_id=run.id,
        kind=payload.kind,
        status="running",
        attempt=1,
        payload_json={"agent_runtime": "pi", "host_id": payload.host_id},
        started_at=utc_now(),
        locked_by=payload.host_id,
    )
    session.add(task)
    run.status = RunStatus.RUNNING
    run.started_at = run.started_at or utc_now()
    run.error = None
    settings = _runtime_settings(payload.provider)
    gateway = build_pi_task_gateway(session, settings=settings)
    tool_definitions = gateway.definitions(run)
    skill_summary = enabled_skill_catalog(session)
    capability_fingerprint = _capability_fingerprint(
        tool_definitions,
        skills=skill_summary,
        permissions=permission_settings(session),
    )
    task.payload_json = {
        **(task.payload_json or {}),
        "capability_fingerprint": capability_fingerprint,
        "provider_snapshot": {
            "provider_name": payload.provider.provider_name,
            "protocol": payload.provider.protocol,
            "base_url": payload.provider.base_url,
            "model": payload.provider.model,
        },
    }
    objective = {
        "start": "读取原简历与岗位 JD，推进到需要用户确认岗位理解和相关经历的节点。",
        "revision": "保留历史版本，基于当前岗位重新开始一轮简历优化。",
        "resume": "从用户已确认的节点继续，推进简历改写、验证与生成新版本。",
        "retry": "从最近失败或暂停的阶段恢复；先核对真实工具记录，避免重复副作用。",
    }.get(payload.kind, "推进当前岗位材料任务，直到完成或需要用户确认。")
    prior_checkpoint = (previous.result_json or {}).get("checkpoint") if previous else None
    prior_fingerprint = (prior_checkpoint or {}).get("capability_fingerprint")
    prior_checkpoint_compatible = not prior_fingerprint or prior_fingerprint == capability_fingerprint
    prompt = (
        f"任务目标：{objective}\n"
        f"当前业务状态：{run.current_stage or PipelineStage.CREATED.value}。\n"
        "先调用 inspect_application_workspace 按需读取真实材料，再根据当前状态选择一个高层领域工具。"
    )
    if prior_checkpoint and prior_checkpoint.get("lifecycle") != "settled" and previous.status != "completed":
        prompt += (
            "\n桌面进程曾中断。以下是最近持久化检查点，仅用于避免重复动作；"
            "必须重新读取工作区和工具记录验证后再继续：\n"
            "<untrusted_checkpoint>" + json.dumps(prior_checkpoint, ensure_ascii=False) + "</untrusted_checkpoint>"
        )
        if not prior_checkpoint_compatible:
            prompt += (
                "\nThe available tools, Skills, MCP connections, or permission policy changed "
                "after this checkpoint. Treat prior progress only as a hint; re-read the "
                "workspace and current tool definitions before any action."
            )
    system_prompt = build_system_prompt(settings, tools=tool_definitions, task=True, skills=skill_summary)
    session.flush()
    TraceService(session).record(
        run=run,
        stage=run.current_stage or PipelineStage.CREATED.value,
        agent_name="pi_agent_runtime",
        event_type="task_started",
        actor="user",
        output_refs=[f"task:{task.id}"],
    )
    return {
        "task": _task_row(task),
        "job_id": run.job_id,
        "run_id": run.id,
        "task_id": task.id,
        "session_id": run.session_id or f"pi:{run.id}",
        "prompt": prompt,
        "system_prompt": system_prompt,
        "system_prompt_sections": build_prompt_sections(settings, task=True, skills=skill_summary),
        "tools": tool_definitions,
        "prior_checkpoint": prior_checkpoint,
        "capability_fingerprint": capability_fingerprint,
        "prior_checkpoint_compatible": prior_checkpoint_compatible,
        "outbound_privacy": _outbound_privacy_profile(session, run.candidate_id),
    }


@router.post("/runs/{run_id}/task-tools/{tool_name}")
def execute_task_tool(run_id: str, tool_name: str, payload: PiToolExecution, session: Session = Depends(get_session)):
    from applyos_agent.pi_domain_tools import build_pi_task_gateway

    run = _require_run(session, run_id)
    task = session.scalar(select(AgentTask).where(AgentTask.run_id == run.id).order_by(AgentTask.created_at.desc()))
    if task is None or task.status != "running" or task.cancel_requested or task.pause_requested or run.status == RunStatus.CANCELLED:
        raise HarnessError("task_not_running", "任务已停止或正在停止，不能执行新工具", run_id=run.id)
    if payload.task_id != task.id:
        raise HarnessError("task_scope_mismatch", "工具调用不属于当前任务，请重新读取任务状态", run_id=run.id)
    gateway = build_pi_task_gateway(session, settings=AgentSettings.from_env())
    try:
        result = gateway.execute(
            tool_name=tool_name,
            run=run,
            arguments=payload.arguments,
            granted_permissions=granted_permissions(permission_settings(session), include_pipeline=True),
            idempotency_key=payload.idempotency_key,
            tool_revision=payload.tool_revision,
            target_revision=payload.target_revision,
        )
    except HarnessError as exc:
        if exc.code in {"approval_required", "publish_approval_required", "verified_fact_required"}:
            session.commit()
        raise
    from applyos_agent.result_archive import archive_result
    reference = archive_result(session, "run:" + run.id, result) if tool_name != "read_tool_result" else None
    return {"tool_name": tool_name, "result": result, "result_reference": reference, "stage": run.current_stage,
            "run_status": run.status.value, "tools": gateway.definitions(run)}


@router.get("/runs/{run_id}/task-tools")
def list_task_tools(run_id: str, session: Session = Depends(get_session)):
    from applyos_agent.pi_domain_tools import build_pi_task_gateway

    run = _require_run(session, run_id)
    gateway = build_pi_task_gateway(session, settings=AgentSettings.from_env())
    return {"stage": run.current_stage, "tools": gateway.definitions(run)}


@router.get("/tasks/{task_id}/control")
def task_control(task_id: str, session: Session = Depends(get_session)):
    task = session.get(AgentTask, task_id)
    if task is None:
        raise HarnessError("agent_task_not_found", "Agent 任务不存在")
    run = _require_run(session, task.run_id)
    signal = "cancel" if task.cancel_requested or run.status == RunStatus.CANCELLED else "pause" if task.pause_requested or task.status != "running" else None
    return {"signal": signal, "status": task.status}


@router.post("/tasks/{task_id}/checkpoint")
def checkpoint_task(task_id: str, payload: PiTaskCheckpoint, session: Session = Depends(get_session)):
    task = session.get(AgentTask, task_id)
    if task is None:
        raise HarnessError("agent_task_not_found", "Agent 任务不存在")
    if task.status != "running":
        return {"accepted": False, "task": _task_row(task)}
    current = (task.result_json or {}).get("checkpoint") or {}
    if int(current.get("sequence") or -1) > payload.sequence:
        return {"accepted": False, "task": _task_row(task)}
    checkpoint = {
        "lifecycle": "active",
        "sequence": payload.sequence,
        "turn_number": payload.turn_number,
        "phase": payload.phase,
        "partial_text": redact_text(payload.partial_text),
        "processing_trace": payload.processing_trace[-40:],
        "tool_receipts": payload.tool_receipts,
        "capability_fingerprint": (
            payload.capability_fingerprint
            or (task.payload_json or {}).get("capability_fingerprint")
        ),
        "saved_at": utc_now().isoformat(),
    }
    task.result_json = {**(task.result_json or {}), "runtime": "pi", "checkpoint": checkpoint}
    # Reassigning the JSON value plus this lightweight field guarantees an
    # updated heartbeat even on SQLite JSON implementations without mutation
    # tracking. It also makes orphan-host recovery deterministic.
    task.error = None
    session.flush()
    return {"accepted": True, "checkpoint": checkpoint}


@router.post("/runs/{run_id}/steer")
def steer_task(run_id: str, payload: PiTaskSteer, session: Session = Depends(get_session)):
    run = _require_run(session, run_id)
    if not run.job_id:
        raise HarnessError("job_context_not_found", "当前 Agent 运行没有岗位工作区")
    resolved_input = resolve_turn_input(session, _require_job(session, run.job_id), payload, AgentSettings.from_env().workspace_root)
    message = AgentMessage(
        candidate_id=run.candidate_id,
        job_id=run.job_id,
        run_id=run.id,
        role="user",
        content=payload.content.strip(),
        metadata_json={
            "delivery_status": "steered",
            "steering_state": "accepted",
            "agent_runtime": "pi",
            "attachment_paths": payload.attachment_paths,
            "quoted_text": (payload.quoted_text or "").strip() or None,
            "quoted_message_id": payload.quoted_message_id,
            "input_refs": resolved_input,
        },
    )
    session.add(message)
    session.flush()
    TraceService(session).record(
        run=run,
        stage=run.current_stage or "conversation",
        agent_name="pi_agent_runtime",
        event_type="message_steered",
        actor="user",
        input_refs=[f"message:{message.id}"],
    )
    return {"message": _message_row(message), "prompt": resolved_input["prompt"], "input_refs": resolved_input}


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: str, payload: PiTaskComplete, session: Session = Depends(get_session)):
    task = session.get(AgentTask, task_id)
    if task is None:
        raise HarnessError("agent_task_not_found", "Agent 任务不存在")
    run = _require_run(session, task.run_id)
    # A late completion must not undo a user stop or orphan-host recovery.
    if task.status != "running" or task.cancel_requested or task.pause_requested or run.status == RunStatus.CANCELLED:
        raise HarnessError("task_completion_rejected", "任务已停止或正在停止，不能提交完成结果", run_id=run.id)
    stage = PipelineStage(run.current_stage or PipelineStage.CREATED)
    needs_user = stage in {
        PipelineStage.AWAITING_FACT_REVIEW,
        PipelineStage.AWAITING_USER_REVIEW,
        PipelineStage.AWAITING_PUBLISH_APPROVAL,
        PipelineStage.BLOCKED,
        PipelineStage.FAILED,
    }
    business_complete = stage in {PipelineStage.READY_TO_PUBLISH, PipelineStage.PUBLISHED, PipelineStage.FROZEN}
    needs_user = needs_user or not business_complete
    task.status = "paused" if needs_user else "completed"
    prior_checkpoint = (task.result_json or {}).get("checkpoint")
    task.result_json = {
        **(task.result_json or {}),
        "stop_reason": "user_action_required" if needs_user else "completed",
        "stage": stage.value,
        "runtime": "pi",
        "processing_trace": payload.processing_trace,
        "tool_receipts": payload.tool_receipts,
        **({"checkpoint": {**prior_checkpoint, "lifecycle": "settled"}} if prior_checkpoint else {}),
    }
    task.locked_by = None
    task.pause_requested = False
    task.completed_at = None if task.status == "paused" else utc_now()
    run.status = RunStatus.PAUSED if needs_user else (RunStatus.COMPLETED if stage in {PipelineStage.READY_TO_PUBLISH, PipelineStage.PUBLISHED, PipelineStage.FROZEN} else RunStatus.PAUSED)
    if payload.content.strip() and run.job_id:
        session.add(AgentMessage(
            candidate_id=run.candidate_id,
            job_id=run.job_id,
            run_id=run.id,
            role="assistant",
            content=payload.content.strip(),
            metadata_json={
                "type": "agent_checkpoint" if needs_user else "agent_final",
                "checkpoint_stage": stage.value if needs_user else None,
                "runtime": {**payload.usage, "runtime": "pi"},
                "processing_trace": payload.processing_trace,
                "tool_receipts": payload.tool_receipts,
                "processing_duration_ms": payload.processing_duration_ms,
                "agent_runtime": "pi",
            },
        ))
    TraceService(session).record(
        run=run,
        stage=stage.value,
        agent_name="pi_agent_runtime",
        event_type=f"task_{task.status}",
        status=StepStatus.COMPLETED,
        output_refs=[f"task:{task.id}"],
        usage={**payload.usage, "runtime": "pi"},
    )
    return {"task": _task_row(task), "run": {"id": run.id, "status": run.status.value, "current_stage": run.current_stage}}


@router.post("/tasks/{task_id}/fail")
def fail_task(task_id: str, payload: PiTaskFailure, session: Session = Depends(get_session)):
    task = session.get(AgentTask, task_id)
    if task is None:
        raise HarnessError("agent_task_not_found", "Agent 任务不存在")
    run = _require_run(session, task.run_id)
    if task.status != "running":
        # An old host may finish after reconciliation started a new task.
        # Preserve its earlier receipt and never overwrite the current run.
        return {"task": _task_row(task)}
    stopped_status = "cancelled" if task.cancel_requested or run.status == RunStatus.CANCELLED else "paused" if task.pause_requested else payload.status
    task.status = stopped_status
    task.error = payload.message or None
    task.locked_by = None
    task.pause_requested = False
    task.cancel_requested = stopped_status == "cancelled"
    task.completed_at = utc_now() if stopped_status in {"failed", "cancelled"} else None
    run.status = RunStatus.CANCELLED if stopped_status == "cancelled" else RunStatus.PAUSED if stopped_status == "paused" else RunStatus.FAILED
    TraceService(session).record(
        run=run,
        stage=run.current_stage or "unknown",
        agent_name="pi_agent_runtime",
        event_type=f"task_{stopped_status}",
        status=StepStatus.FAILED if stopped_status == "failed" else StepStatus.COMPLETED,
        error=payload.message or None,
    )
    return {"task": _task_row(task)}


@router.post("/turns/{user_message_id}/complete")
def complete_turn(user_message_id: str, payload: PiTurnComplete, session: Session = Depends(get_session)):
    user_message = session.get(AgentMessage, user_message_id)
    if user_message is None:
        raise HarnessError("agent_message_not_found", "用户消息不存在")
    if user_message.role != "user" or (user_message.metadata_json or {}).get("delivery_status") != "streaming":
        raise HarnessError("turn_completion_rejected", "对话已结算，不能覆盖终态")
    effective_task_kind = payload.task_kind or (user_message.metadata_json or {}).get("task_kind")
    user_message.metadata_json = {
        **(user_message.metadata_json or {}),
        "delivery_status": "completed",
        "task_kind": effective_task_kind,
    }
    run = _require_run(session, user_message.run_id) if user_message.run_id else None
    research_result = None
    assistant_content = payload.content.strip()
    if effective_task_kind == "interview_research":
        latest_brief = session.scalar(
            select(InterviewBrief)
            .where(
                InterviewBrief.job_id == user_message.job_id,
                InterviewBrief.updated_at >= user_message.created_at,
            )
            .order_by(InterviewBrief.updated_at.desc())
        )
        saved_sources = list(session.scalars(
            select(InterviewSource).where(
                InterviewSource.job_id == user_message.job_id,
                InterviewSource.updated_at >= user_message.created_at,
            )
        ).all())
        primary_source_count = sum(1 for item in saved_sources if item.platform == "xiaohongshu")
        supplemental_source_count = len(saved_sources) - primary_source_count
        evidence_status = (latest_brief.metadata_json or {}).get("evidence_status") if latest_brief else None
        research_result = {
            "status": (
                "brief_ready" if latest_brief and evidence_status == "sufficient"
                else "brief_limited" if latest_brief
                else "sources_saved" if saved_sources
                else "completed_without_brief"
            ),
            "brief_id": latest_brief.id if latest_brief else None,
            "source_count": len(saved_sources),
            "primary_platform": "xiaohongshu",
            "primary_source_count": primary_source_count,
            "supplemental_source_count": supplemental_source_count,
            "evidence_status": evidence_status or ("limited" if saved_sources else "insufficient"),
        }
        if latest_brief is None:
            assistant_content = (
                "本轮没有形成可核查的面经简报。当前尚未完成公开来源的正文读取与逐字引文校验，"
                "FetchCV 不会把搜索结果摘要或失效链接伪装成面经证据。"
                "你可以稍后重新调研，或粘贴仍可公开访问的小红书、牛客等原帖链接让我直接读取。"
            )
    assistant = AgentMessage(
        candidate_id=user_message.candidate_id,
        job_id=user_message.job_id,
        run_id=user_message.run_id,
        role="assistant",
        content=assistant_content,
        metadata_json={
            "runtime": {**payload.usage, "runtime": "pi"},
            "thinking_level": (user_message.metadata_json or {}).get("thinking_level", "balanced"),
            "task_kind": effective_task_kind,
            "research_result": research_result,
            "model_draft": payload.content.strip() if assistant_content != payload.content.strip() else None,
            "delivery_status": "completed",
            "processing_trace": payload.processing_trace,
            "tool_receipts": payload.tool_receipts,
            "processing_duration_ms": payload.processing_duration_ms,
            "agent_runtime": "pi",
        },
    )
    session.add(assistant)
    session.flush()
    if run:
        TraceService(session).record(
            run=run,
            stage=run.current_stage or "conversation",
            agent_name="pi_agent_runtime",
            event_type="conversation",
            usage={**payload.usage, "runtime": "pi"},
            output_refs=[f"message:{assistant.id}"],
        )
    return {"assistant": _message_row(assistant)}


@router.post("/turns/{user_message_id}/fail")
def fail_turn(user_message_id: str, payload: PiTurnFailure, session: Session = Depends(get_session)):
    user_message = session.get(AgentMessage, user_message_id)
    if user_message is None:
        raise HarnessError("agent_message_not_found", "用户消息不存在")
    if user_message.role != "user" or (user_message.metadata_json or {}).get("delivery_status") != "streaming":
        raise HarnessError("turn_completion_rejected", "对话已结算，不能覆盖终态")
    user_message.metadata_json = {
        **(user_message.metadata_json or {}),
        "delivery_status": payload.delivery_status,
        "failure_message": payload.message or None,
        "agent_runtime": "pi",
    }
    return {"user": _message_row(user_message)}
