from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from applyos_domain.enums import StepStatus
from applyos_domain.models import AgentRun, AgentRunStep


def _redact_text(value: str) -> str:
    value = re.sub(r"(?<!\w)[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}(?!\w)", "[REDACTED_EMAIL]", value)
    value = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[REDACTED_PHONE]", value)
    return re.sub(r"(?i)(?:sk|key|token)[-_][A-Za-z0-9._-]{12,}", "[REDACTED_SECRET]", value)


def redact_text(value: str) -> str:
    return _redact_text(value)


def sanitize_trace(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_text(value)
    if isinstance(value, list):
        return [sanitize_trace(item) for item in value]
    if isinstance(value, dict):
        return {str(key): sanitize_trace(item) for key, item in value.items() if str(key).lower() not in {"api_key", "authorization", "token"}}
    return value


class TraceService:
    def __init__(self, session: Session):
        self.session = session

    def next_sequence(self, run_id: str) -> int:
        maximum = self.session.scalar(select(func.max(AgentRunStep.sequence)).where(AgentRunStep.run_id == run_id))
        return int(maximum or 0) + 1

    def record(
        self,
        *,
        run: AgentRun,
        stage: str,
        agent_name: str,
        event_type: str,
        status: StepStatus = StepStatus.COMPLETED,
        actor: str | None = None,
        reason: str | None = None,
        input_refs: list[str] | None = None,
        output_refs: list[str] | None = None,
        tool_calls: list[dict[str, Any]] | None = None,
        usage: dict[str, Any] | None = None,
        duration_ms: int | None = None,
        error_code: str | None = None,
        error: str | None = None,
    ) -> AgentRunStep:
        step = AgentRunStep(
            run_id=run.id,
            stage=stage,
            agent_name=agent_name,
            event_type=event_type,
            actor=actor,
            reason=reason,
            status=status,
            sequence=self.next_sequence(run.id),
            input_refs=sanitize_trace(input_refs or []),
            output_refs=sanitize_trace(output_refs or []),
            tool_calls=sanitize_trace(tool_calls or []),
            usage=sanitize_trace(usage or {}),
            duration_ms=duration_ms,
            error_code=error_code,
            error=_redact_text(error) if error else None,
        )
        self.session.add(step)
        self.session.flush()
        return step

    def pipeline_report(self, run: AgentRun) -> dict[str, Any]:
        steps = self.session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence)).all()
        completed = [step.stage for step in steps if step.event_type == "stage" and step.status == StepStatus.COMPLETED]
        failures = [
            {"stage": step.stage, "code": step.error_code, "message": step.error}
            for step in steps
            if step.status == StepStatus.FAILED
        ]
        return {
            "run_id": run.id,
            "session_id": run.session_id,
            "status": run.status.value,
            "current_stage": run.current_stage,
            "completed_stages": list(dict.fromkeys(completed)),
            "failures": failures,
            "trace_events": len(steps),
            "generated_at": datetime.now().astimezone().isoformat(),
        }
