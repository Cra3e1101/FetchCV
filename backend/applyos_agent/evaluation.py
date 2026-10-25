"""Evidence-based evaluation of a FetchCV run.

This is intentionally not an opaque AI score. Each item is derived from
persisted domain state and links to the concrete record a user or test can
inspect.
"""

from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import ApprovalStatus, QualityStatus
from applyos_domain.models import (
    AgentContextSnapshot,
    AgentMessage,
    AgentRun,
    AgentRunStep,
    AgentTask,
    Approval,
    Job,
    JobProfile,
    QualityReport,
    ResumeVersion,
)

from .context import ContextManager, PinnedContextInputs


@dataclass(frozen=True)
class RunEvaluationInputs:
    """Rows already read for a workspace; empty/None values are authoritative."""

    steps: Sequence[AgentRunStep]
    tasks: Sequence[AgentTask]
    approvals: Sequence[Approval]
    reports: Sequence[QualityReport]
    profile: JobProfile | None
    resume: ResumeVersion | None
    messages: Sequence[AgentMessage]
    pinned_inputs: PinnedContextInputs | None = None


class AgentRunEvaluator:
    def __init__(self, session: Session):
        self.session = session

    def evaluate(self, *, job: Job, run: AgentRun | None, inputs: RunEvaluationInputs | None = None) -> dict[str, Any]:
        if run is None:
            return {
                "status": "not_started",
                "summary": "Agent 尚未开始运行",
                "checks": [],
                "passed": 0,
                "total": 0,
            }

        if inputs is None:
            inputs = RunEvaluationInputs(
                steps=self.session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id)).all(),
                tasks=self.session.scalars(select(AgentTask).where(AgentTask.run_id == run.id)).all(),
                approvals=self.session.scalars(select(Approval).where(Approval.run_id == run.id)).all(),
                reports=self.session.scalars(select(QualityReport).where(QualityReport.run_id == run.id)).all(),
                profile=self.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id).limit(1)),
                resume=self.session.scalar(
                    select(ResumeVersion).where(ResumeVersion.job_id == job.id)
                    .order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc()).limit(1)
                ),
                messages=self.session.scalars(
                    select(AgentMessage).where(AgentMessage.job_id == job.id, AgentMessage.role == "user")
                ).all(),
            )
        steps = inputs.steps
        # The workspace sorts tasks by creation time and reports newest first.
        # Define evidence order here so both read paths produce the same result.
        tasks = sorted(inputs.tasks, key=lambda item: (item.updated_at, item.id), reverse=True)
        approvals = sorted(inputs.approvals, key=lambda item: (item.created_at, item.id))
        reports = sorted(inputs.reports, key=lambda item: (item.created_at, item.id))
        profile, resume = inputs.profile, inputs.resume
        failed_messages = sorted((
            item for item in inputs.messages
            if item.role == "user" and (item.metadata_json or {}).get("delivery_status") == "failed"
        ), key=lambda item: (item.created_at, item.id))

        latest_snapshot = self.session.execute(
            select(AgentContextSnapshot.id, AgentContextSnapshot.pinned_context["source_fingerprint"].as_string().label("source_fingerprint"))
            .where(AgentContextSnapshot.job_id == job.id, AgentContextSnapshot.run_id == run.id)
            .order_by(AgentContextSnapshot.version.desc()).limit(1)
        ).first()
        context_options = {"inputs": inputs.pinned_inputs} if inputs.pinned_inputs is not None else {}
        context_current = latest_snapshot is None or (
            latest_snapshot.source_fingerprint == ContextManager(self.session).pinned(job, **context_options)["source_fingerprint"]
        )

        runtime_events = [
            event
            for task in tasks
            for event in (
                (task.result_json or {}).get("processing_trace")
                or ((task.result_json or {}).get("checkpoint") or {}).get("processing_trace")
                or []
            )
            if isinstance(event, dict)
        ]
        has_model_trace = any(step.event_type == "model_turn" for step in steps) or any(
            event.get("kind") == "model" for event in runtime_events
        )
        has_tool_trace = any(step.event_type == "tool" for step in steps)
        event_protocol_current = not runtime_events or all(
            int(event.get("protocol_version") or 0) == 1
            and bool(event.get("id"))
            and bool(event.get("status"))
            for event in runtime_events
        )
        has_durable_checkpoint = any(bool((task.result_json or {}).get("checkpoint")) for task in tasks)
        profile_evidence = list((profile.business_context or {}).get("evidence") or []) if profile else []
        pending_approvals = [item for item in approvals if item.status == ApprovalStatus.PENDING]
        blocked_reports = [item for item in reports if item.status == QualityStatus.BLOCKED]
        passed_reports = [item for item in reports if item.status == QualityStatus.PASSED]

        checks = [
            self._check("model_trace", "模型决策有记录", has_model_trace, "pending" if not steps else "warning", [f"run:{run.id}"]),
            self._check("tool_trace", "工具调用经过网关", has_tool_trace, "pending" if not steps else "warning", [f"run:{run.id}"]),
            self._check(
                "event_protocol",
                "运行事件可恢复且顺序稳定",
                event_protocol_current,
                "warning",
                [f"task:{task.id}" for task in tasks[:4]],
            ),
            self._check(
                "durable_checkpoint",
                "长任务保留可恢复检查点",
                has_durable_checkpoint or not any(task.status in {"running", "paused", "failed"} for task in tasks),
                "pending" if not tasks else "warning",
                [f"task:{task.id}" for task in tasks[:4]],
            ),
            self._check("context_current", "上下文与当前材料一致", context_current, "warning", [f"context:{latest_snapshot.id}"] if latest_snapshot else []),
            self._check("job_evidence", "岗位理解保留 JD 证据", bool(profile_evidence), "pending" if profile is None else "warning", [f"job_profile:{profile.id}"] if profile else []),
            self._check("resume_lineage", "岗位简历保留版本来源", resume is not None and bool(resume.parent_version_id), "pending" if resume is None else "warning", [f"resume:{resume.id}"] if resume else []),
            self._check("quality_gate", "确定性质量门禁通过", bool(passed_reports) and not blocked_reports, "pending" if not reports else "warning", [f"quality:{item.id}" for item in reports[:4]]),
            self._check("message_delivery", "对话消息未静默丢失", not failed_messages, "warning", [f"message:{item.id}" for item in failed_messages[:4]]),
            {
                "code": "human_control",
                "label": "关键操作由用户控制",
                "status": "pending" if pending_approvals else "passed",
                "evidence": [f"approval:{item.id}" for item in approvals[:6]],
                "detail": f"仍有 {len(pending_approvals)} 项等待确认" if pending_approvals else "当前没有悬而未决的关键操作",
            },
        ]
        passed = sum(1 for item in checks if item["status"] == "passed")
        warnings = sum(1 for item in checks if item["status"] == "warning")
        status = "attention" if warnings or blocked_reports else "verified" if passed == len(checks) else "in_progress"
        return {
            "status": status,
            "summary": "存在需要处理的运行证据" if status == "attention" else "运行证据持续记录中" if status == "in_progress" else "本轮运行证据完整",
            "checks": checks,
            "passed": passed,
            "total": len(checks),
        }

    @staticmethod
    def _check(code: str, label: str, passed: bool, missing_status: str, evidence: list[str]) -> dict[str, Any]:
        return {
            "code": code,
            "label": label,
            "status": "passed" if passed else missing_status,
            "evidence": evidence,
        }
