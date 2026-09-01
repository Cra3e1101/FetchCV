from __future__ import annotations

from enum import StrEnum

from sqlalchemy.orm import Session

from applyos_domain.base import utc_now
from applyos_domain.enums import RunStatus
from applyos_domain.models import AgentRun

from .errors import HarnessError
from .trace import TraceService


class PipelineStage(StrEnum):
    CREATED = "created"
    INPUT_VALIDATING = "input_validating"
    JD_ANALYZING = "jd_analyzing"
    FACTS_MATCHING = "facts_matching"
    AWAITING_FACT_REVIEW = "awaiting_fact_review"
    STRATEGY_GENERATING = "strategy_generating"
    DRAFT_GENERATING = "draft_generating"
    AWAITING_USER_REVIEW = "awaiting_user_review"
    APPROVED_CHANGES_APPLYING = "approved_changes_applying"
    FACT_VALIDATING = "fact_validating"
    PORTFOLIO_BUILDING = "portfolio_building"
    CONSISTENCY_CHECKING = "consistency_checking"
    AWAITING_PUBLISH_APPROVAL = "awaiting_publish_approval"
    READY_TO_PUBLISH = "ready_to_publish"
    PUBLISHED = "published"
    FROZEN = "frozen"
    FAILED = "failed"
    CANCELLED = "cancelled"
    BLOCKED = "blocked"


NORMAL_TRANSITIONS: dict[PipelineStage, set[PipelineStage]] = {
    PipelineStage.CREATED: {PipelineStage.INPUT_VALIDATING},
    PipelineStage.INPUT_VALIDATING: {PipelineStage.JD_ANALYZING},
    PipelineStage.JD_ANALYZING: {PipelineStage.FACTS_MATCHING},
    PipelineStage.FACTS_MATCHING: {PipelineStage.AWAITING_FACT_REVIEW},
    PipelineStage.AWAITING_FACT_REVIEW: {PipelineStage.STRATEGY_GENERATING},
    PipelineStage.STRATEGY_GENERATING: {PipelineStage.DRAFT_GENERATING},
    PipelineStage.DRAFT_GENERATING: {PipelineStage.AWAITING_USER_REVIEW},
    PipelineStage.AWAITING_USER_REVIEW: {PipelineStage.APPROVED_CHANGES_APPLYING},
    PipelineStage.APPROVED_CHANGES_APPLYING: {PipelineStage.FACT_VALIDATING},
    PipelineStage.FACT_VALIDATING: {PipelineStage.PORTFOLIO_BUILDING},
    PipelineStage.PORTFOLIO_BUILDING: {PipelineStage.CONSISTENCY_CHECKING},
    PipelineStage.CONSISTENCY_CHECKING: {PipelineStage.AWAITING_PUBLISH_APPROVAL},
    PipelineStage.AWAITING_PUBLISH_APPROVAL: {PipelineStage.READY_TO_PUBLISH},
    PipelineStage.READY_TO_PUBLISH: {PipelineStage.PUBLISHED},
    PipelineStage.PUBLISHED: {PipelineStage.FROZEN},
}

INTERRUPTIBLE = set(NORMAL_TRANSITIONS) | {PipelineStage.READY_TO_PUBLISH}
TERMINAL = {PipelineStage.FROZEN, PipelineStage.CANCELLED}


class RunStateMachine:
    def __init__(self, session: Session):
        self.session = session
        self.trace = TraceService(session)

    def transition(
        self,
        run: AgentRun,
        target: PipelineStage,
        *,
        actor: str = "harness",
        reason: str = "pipeline progression",
        review_approved: bool = False,
        publish_approved: bool = False,
    ) -> AgentRun:
        current = PipelineStage(run.current_stage or PipelineStage.CREATED)
        if current in TERMINAL:
            raise HarnessError("terminal_state", f"{current.value} 状态不可继续流转", run_id=run.id, stage=current.value)
        if target in {PipelineStage.FAILED, PipelineStage.CANCELLED, PipelineStage.BLOCKED}:
            if current not in INTERRUPTIBLE:
                raise self._illegal(run, current, target)
        elif target not in NORMAL_TRANSITIONS.get(current, set()):
            raise self._illegal(run, current, target)
        if current == PipelineStage.AWAITING_USER_REVIEW and target == PipelineStage.APPROVED_CHANGES_APPLYING and not review_approved:
            raise HarnessError("approval_required", "修改建议尚未完成审批", run_id=run.id, stage=current.value)
        if current == PipelineStage.AWAITING_PUBLISH_APPROVAL and target == PipelineStage.READY_TO_PUBLISH and not publish_approved:
            raise HarnessError("publish_approval_required", "发布尚未获得用户批准", run_id=run.id, stage=current.value)

        if target in {PipelineStage.FAILED, PipelineStage.BLOCKED}:
            run.resume_stage = current.value
        run.current_stage = target.value
        run.updated_at = utc_now()
        run.status = self._lifecycle(target)
        if target == PipelineStage.INPUT_VALIDATING and run.started_at is None:
            run.started_at = utc_now()
        if target in {PipelineStage.FROZEN, PipelineStage.CANCELLED}:
            run.completed_at = utc_now()
        self.trace.record(
            run=run,
            stage=target.value,
            agent_name="fetchcv_state_machine",
            event_type="transition",
            actor=actor,
            reason=reason,
            input_refs=[f"stage:{current.value}"],
            output_refs=[f"stage:{target.value}"],
        )
        self.session.flush()
        return run

    def recover(self, run: AgentRun, *, actor: str = "user", reason: str = "retry failed stage") -> AgentRun:
        current = PipelineStage(run.current_stage or PipelineStage.CREATED)
        if current not in {PipelineStage.FAILED, PipelineStage.BLOCKED} or not run.resume_stage:
            raise HarnessError("run_not_recoverable", "当前运行没有可恢复的失败阶段", run_id=run.id, stage=current.value)
        target = PipelineStage(run.resume_stage)
        run.current_stage = target.value
        run.resume_stage = None
        run.status = RunStatus.RUNNING
        run.error = None
        self.trace.record(
            run=run,
            stage=target.value,
            agent_name="fetchcv_state_machine",
            event_type="recovery",
            actor=actor,
            reason=reason,
            output_refs=[f"stage:{target.value}"],
        )
        self.session.flush()
        return run

    @staticmethod
    def _lifecycle(stage: PipelineStage) -> RunStatus:
        if stage in {
            PipelineStage.AWAITING_FACT_REVIEW,
            PipelineStage.AWAITING_USER_REVIEW,
            PipelineStage.AWAITING_PUBLISH_APPROVAL,
            PipelineStage.READY_TO_PUBLISH,
        }:
            return RunStatus.PAUSED
        if stage == PipelineStage.FAILED:
            return RunStatus.FAILED
        if stage == PipelineStage.CANCELLED:
            return RunStatus.CANCELLED
        if stage == PipelineStage.BLOCKED:
            return RunStatus.BLOCKED
        if stage in {PipelineStage.PUBLISHED, PipelineStage.FROZEN}:
            return RunStatus.COMPLETED
        return RunStatus.RUNNING

    @staticmethod
    def _illegal(run: AgentRun, current: PipelineStage, target: PipelineStage) -> HarnessError:
        return HarnessError(
            "illegal_state_transition",
            f"不允许从 {current.value} 跳转到 {target.value}",
            run_id=run.id,
            stage=current.value,
            details={"from": current.value, "to": target.value},
        )
