from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from enum import StrEnum
from pathlib import Path
from typing import Any, Callable

from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from applyos_domain.enums import StepStatus
from applyos_domain.models import AgentRun, AgentRunStep, PortfolioVersion, ResumeVersion, ToolInvocation

from .approval import ApprovalService
from .errors import HarnessError
from .state_machine import PipelineStage
from .trace import TraceService
from .versioning import VersionService


class ToolPermission(StrEnum):
    READ = "read"
    NETWORK_READ = "network_read"
    DRAFT_WRITE = "draft_write"
    CONFIRMED_WRITE = "confirmed_write"
    EXPORT = "export"
    PUBLISH = "publish"
    DELETE = "delete"


@dataclass
class ToolContext:
    session: Session
    run: AgentRun
    granted_permissions: set[ToolPermission]
    workspace_root: Path
    candidate_id: str | None = None
    job_id: str | None = None
    version_id: str | None = None

    def require(self, permission: ToolPermission) -> None:
        if permission not in self.granted_permissions:
            raise HarnessError("tool_permission_denied", f"缺少工具权限：{permission.value}", run_id=self.run.id, stage=self.run.current_stage)


ToolHandler = Callable[[ToolContext, BaseModel], BaseModel | dict[str, Any]]
ApprovalTargetBuilder = Callable[[BaseModel], str]


@dataclass
class ToolSpec:
    name: str
    input_model: type[BaseModel]
    output_model: type[BaseModel]
    permission: ToolPermission
    allowed_stages: set[PipelineStage]
    handler: ToolHandler
    description: str = ""
    read_only: bool = True
    side_effect: bool = False
    approval_action: str | None = None
    auto_request_approval: bool = False
    approval_target_builder: ApprovalTargetBuilder | None = None
    path_fields: tuple[str, ...] = ()
    target_type: str | None = None
    target_id_field: str | None = None
    input_schema_override: dict[str, Any] | None = None


class ToolGateway:
    def __init__(self, session: Session, *, workspace_root: str | Path):
        self.session = session
        self.workspace_root = Path(workspace_root).resolve()
        self.registry: dict[str, ToolSpec] = {}
        self.trace = TraceService(session)
        self.approvals = ApprovalService(session)
        self.versions = VersionService(session)

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self.registry:
            raise ValueError(f"duplicate tool: {spec.name}")
        self.registry[spec.name] = spec

    def available(self, run: AgentRun) -> list[ToolSpec]:
        stage = PipelineStage(run.current_stage or PipelineStage.CREATED)
        return [spec for spec in self.registry.values() if stage in spec.allowed_stages]

    def definitions(self, run: AgentRun) -> list[dict[str, Any]]:
        return [
            {
                "name": spec.name,
                "description": spec.description or spec.name.replace("_", " "),
                "input_schema": spec.input_schema_override or spec.input_model.model_json_schema(),
                "permission": spec.permission.value,
                "read_only": spec.read_only,
                "side_effect": spec.side_effect,
            }
            for spec in self.available(run)
        ]

    def execute(
        self,
        *,
        tool_name: str,
        run: AgentRun,
        arguments: dict[str, Any],
        granted_permissions: set[ToolPermission],
        idempotency_key: str,
    ) -> dict[str, Any]:
        try:
            spec = self.registry.get(tool_name)
            if spec is None:
                raise HarnessError("tool_not_registered", f"工具未注册：{tool_name}", run_id=run.id, stage=run.current_stage)
            stage = PipelineStage(run.current_stage or PipelineStage.CREATED)
            if stage not in spec.allowed_stages:
                raise HarnessError("tool_stage_denied", f"{stage.value} 阶段不可调用 {tool_name}", run_id=run.id, stage=stage.value)
            if spec.side_effect and not idempotency_key.strip():
                raise HarnessError("idempotency_key_required", "有副作用的工具必须提供幂等键", run_id=run.id, stage=stage.value)
            payload = spec.input_model.model_validate(arguments)
            normalized_arguments = payload.model_dump(mode="json", exclude_none=True)
            operation_id, arguments_hash = self._operation_identity(
                run=run,
                stage=stage,
                tool_name=tool_name,
                arguments=normalized_arguments,
            )
            context = ToolContext(
                session=self.session,
                run=run,
                granted_permissions=granted_permissions,
                workspace_root=self.workspace_root,
                candidate_id=getattr(payload, "candidate_id", None),
                job_id=getattr(payload, "job_id", None),
                version_id=getattr(payload, "version_id", None),
            )
            context.require(spec.permission)
            self._validate_scope(context)
            self._validate_paths(spec, payload, run)
            target = self._target(spec, payload)
            if spec.approval_action:
                approval_target_id = (
                    spec.approval_target_builder(payload)
                    if spec.approval_target_builder
                    else getattr(target, "id", None) or (getattr(payload, spec.target_id_field, None) if spec.target_id_field else None)
                )
                # Pipeline approvals intentionally match by action type only.
                # Policy-generated approvals need a stable target even when a
                # read-only tool has no domain entity behind it.
                if spec.auto_request_approval:
                    # Bind a policy-generated approval to the exact normalized
                    # operation, not merely to a mutable entity or MCP target.
                    approval_target_id = operation_id
                if spec.auto_request_approval and not self.approvals.is_approved(run_id=run.id, action_type=spec.approval_action, target_id=approval_target_id):
                    self.approvals.request(
                        run_id=run.id,
                        action_type=spec.approval_action,
                        target_type=spec.target_type or "tool_action",
                        target_id=str(approval_target_id or tool_name),
                        items=[{
                            "operation_id": operation_id,
                            "tool_name": tool_name,
                            "permission": spec.permission.value,
                            "source": "mcp" if tool_name.startswith("mcp__") else "native",
                            "target": getattr(target, "id", None) or spec.target_type or "external_action",
                            "arguments": normalized_arguments,
                            "risk": "write" if spec.side_effect else "read",
                            "recoverable": target is not None,
                        }],
                    )
                self.approvals.require(run_id=run.id, action_type=spec.approval_action, target_id=approval_target_id)
            replay = self._find_replay(run.id, tool_name, operation_id) if spec.side_effect else (
                self._find_replay(run.id, tool_name, idempotency_key) if idempotency_key else None
            )
            if replay is not None:
                return replay
            invocation = None
            if spec.side_effect:
                invocation = self._prepare_invocation(
                    run=run,
                    stage=stage,
                    tool_name=tool_name,
                    operation_id=operation_id,
                    arguments_hash=arguments_hash,
                    arguments=normalized_arguments,
                    provider_call_id=idempotency_key,
                )
                if invocation.status in {"completed", "completed_verified"}:
                    return dict(invocation.result_json)
                if invocation.status in {"running", "outcome_unknown"}:
                    invocation.status = "outcome_unknown"
                    self.session.commit()
                    raise HarnessError(
                        "tool_outcome_unknown",
                        "上次执行在保存回执前中断；为避免重复写入，已停止自动重试，请先核对目标系统。",
                        run_id=run.id,
                        stage=stage.value,
                        retryable=False,
                        details={"operation_id": operation_id, "tool_name": tool_name},
                    )
                invocation.status = "running"
                self.session.commit()
            before_snapshot = None
            if target is not None and spec.side_effect:
                self.versions.assert_mutable(target)
                before_snapshot = self.versions.snapshot_entity(target, run_id=run.id, reason=f"before_tool:{tool_name}")
            result = spec.output_model.model_validate(spec.handler(context, payload)).model_dump(mode="json")
            if target is not None and spec.side_effect:
                after_snapshot = self.versions.snapshot_entity(target, run_id=run.id, reason=f"after_tool:{tool_name}")
                result["versioning"] = {
                    "target_type": target.__tablename__,
                    "target_id": target.id,
                    "before_snapshot_id": before_snapshot.id,
                    "after_snapshot_id": after_snapshot.id,
                    "rollback_available": True,
                }
            if invocation is not None:
                invocation = self.session.get(ToolInvocation, invocation.id)
                invocation.status = "awaiting_user_action" if result.get("requires_user_action") else "completed"
                invocation.result_json = result
            self.trace.record(
                run=run,
                stage=stage.value,
                agent_name="tool_gateway",
                event_type="tool",
                status=StepStatus.COMPLETED,
                input_refs=[f"tool:{tool_name}"],
                output_refs=[f"tool_result:{tool_name}"],
                tool_calls=[{
                    "tool_name": tool_name,
                    "idempotency_key": operation_id if spec.side_effect else idempotency_key,
                    "provider_call_id": idempotency_key,
                    "operation_id": operation_id if spec.side_effect else None,
                    "result": result,
                }],
            )
            return result
        except HarnessError as exc:
            self._record_failure(run, tool_name, idempotency_key, exc)
            raise
        except ValidationError as exc:
            error = HarnessError(
                "tool_input_invalid",
                f"工具 {tool_name} 的参数不符合 Schema",
                run_id=run.id,
                stage=run.current_stage,
                details={"errors": exc.errors(include_input=False, include_url=False)},
            )
            self._record_failure(run, tool_name, idempotency_key, error)
            raise error from exc
        except Exception as exc:
            error = HarnessError(
                "tool_execution_failed",
                f"工具 {tool_name} 执行失败",
                run_id=run.id,
                stage=run.current_stage,
                retryable=True,
                details={"error_type": type(exc).__name__},
            )
            self._record_failure(run, tool_name, idempotency_key, error)
            raise error from exc

    @staticmethod
    def _operation_identity(
        *,
        run: AgentRun,
        stage: PipelineStage,
        tool_name: str,
        arguments: dict[str, Any],
    ) -> tuple[str, str]:
        encoded = json.dumps(arguments, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        arguments_hash = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
        seed = f"{run.id}\n{stage.value}\n{tool_name}\n{arguments_hash}"
        return f"op_{hashlib.sha256(seed.encode('utf-8')).hexdigest()[:40]}", arguments_hash

    def _prepare_invocation(
        self,
        *,
        run: AgentRun,
        stage: PipelineStage,
        tool_name: str,
        operation_id: str,
        arguments_hash: str,
        arguments: dict[str, Any],
        provider_call_id: str,
    ) -> ToolInvocation:
        existing = self.session.scalar(select(ToolInvocation).where(ToolInvocation.operation_id == operation_id))
        if existing is not None:
            return existing
        invocation = ToolInvocation(
            operation_id=operation_id,
            run_id=run.id,
            tool_name=tool_name,
            stage=stage.value,
            arguments_hash=arguments_hash,
            arguments_summary=arguments,
            provider_call_id=provider_call_id,
            status="prepared",
        )
        self.session.add(invocation)
        try:
            self.session.commit()
        except IntegrityError:
            self.session.rollback()
            existing = self.session.scalar(select(ToolInvocation).where(ToolInvocation.operation_id == operation_id))
            if existing is None:
                raise
            return existing
        return invocation

    def _record_failure(self, run: AgentRun, tool_name: str, idempotency_key: str, error: HarnessError) -> None:
        self.trace.record(
            run=run,
            stage=run.current_stage or "unknown",
            agent_name="tool_gateway",
            event_type="tool",
            status=StepStatus.FAILED,
            tool_calls=[{"tool_name": tool_name, "idempotency_key": idempotency_key}],
            error_code=error.code,
            error=error.message,
        )

    def _validate_scope(self, context: ToolContext) -> None:
        mismatches: dict[str, dict[str, str | None]] = {}
        if context.candidate_id and context.candidate_id != context.run.candidate_id:
            mismatches["candidate_id"] = {"expected": context.run.candidate_id, "actual": context.candidate_id}
        if context.job_id and context.run.job_id and context.job_id != context.run.job_id:
            mismatches["job_id"] = {"expected": context.run.job_id, "actual": context.job_id}
        if mismatches:
            raise HarnessError("tool_scope_mismatch", "工具参数与当前运行上下文不匹配", run_id=context.run.id, stage=context.run.current_stage, details=mismatches)

    def _validate_paths(self, spec: ToolSpec, payload: BaseModel, run: AgentRun) -> None:
        for field_name in spec.path_fields:
            raw = getattr(payload, field_name, None)
            if raw is None:
                continue
            candidate = Path(raw).expanduser()
            resolved = (candidate if candidate.is_absolute() else self.workspace_root / candidate).resolve()
            if not resolved.is_relative_to(self.workspace_root):
                raise HarnessError("path_outside_workspace", "工具路径超出允许工作区", run_id=run.id, stage=run.current_stage, details={"path": str(resolved)})

    def _target(self, spec: ToolSpec, payload: BaseModel) -> ResumeVersion | PortfolioVersion | None:
        if not spec.target_type or not spec.target_id_field:
            return None
        target_id = getattr(payload, spec.target_id_field, None)
        if spec.target_type not in {"resume", "portfolio"}:
            raise HarnessError("tool_target_type_invalid", "工具目标类型无效", details={"target_type": spec.target_type})
        model = ResumeVersion if spec.target_type == "resume" else PortfolioVersion
        target = self.session.get(model, target_id)
        if target is None:
            raise HarnessError("tool_target_not_found", "工具目标版本不存在", details={"target_id": target_id})
        return target

    def _find_replay(self, run_id: str, tool_name: str, idempotency_key: str) -> dict[str, Any] | None:
        steps = self.session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run_id, AgentRunStep.event_type == "tool")).all()
        for step in steps:
            for call in step.tool_calls:
                if call.get("tool_name") == tool_name and call.get("idempotency_key") == idempotency_key and "result" in call:
                    result = dict(call["result"])
                    if result.get("requires_user_action"):
                        continue
                    return result
        return None
