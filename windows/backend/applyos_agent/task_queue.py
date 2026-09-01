from __future__ import annotations

import json
import os
import socket
import threading
import time
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from applyos_domain.base import utc_now
from applyos_domain.database import Database
from applyos_domain.enums import StepStatus
from applyos_domain.models import AgentMessage, AgentRun, AgentTask, Job, QueuedAgentMessage
from applyos_harness.errors import HarnessError
from applyos_harness.trace import TraceService
from applyos_harness.trace import redact_text

from .cancellation import provider_requests


ACTIVE_TASK_STATUSES = {"queued", "running"}
RESUMABLE_TASK_STATUSES = {"paused", "failed"}

class AgentService:
    """Lazy compatibility facade for queued-message processing.

    The concrete service imports the full provider runtime. Keeping this tiny
    facade lets tests/embedders patch ``AgentService.converse`` as before while
    avoiding that import until a queued message is actually processed.
    """

    def __init__(self, session: Session):
        from .service import AgentService as ConcreteAgentService

        self._service = ConcreteAgentService(session)

    def converse(self, *args, **kwargs):
        return self._service.converse(*args, **kwargs)


class TaskQueue:
    def __init__(self, session: Session):
        self.session = session

    def enqueue(self, run: AgentRun, *, kind: str = "resume", priority: int = 100, payload: dict | None = None) -> AgentTask:
        if kind not in {"start", "resume", "retry"}:
            raise HarnessError("task_kind_invalid", "任务类型无效", run_id=run.id, details={"kind": kind})
        existing = self.session.scalar(
            select(AgentTask).where(AgentTask.run_id == run.id, AgentTask.status.in_(ACTIVE_TASK_STATUSES)).order_by(AgentTask.created_at.desc())
        )
        if existing:
            return existing
        task = AgentTask(run_id=run.id, kind=kind, status="queued", priority=priority, payload_json=payload or {})
        self.session.add(task)
        self.session.flush()
        TraceService(self.session).record(run=run, stage=run.current_stage or "created", agent_name="task_queue", event_type="task_queued", actor="user", output_refs=[f"task:{task.id}"], reason=f"queued {kind}")
        return task

    def request_pause(self, task: AgentTask) -> AgentTask:
        if task.status == "queued":
            task.status = "paused"
        elif task.status == "running":
            task.pause_requested = True
        elif task.status != "paused":
            raise HarnessError("task_not_pausable", "当前任务不能暂停", details={"task_id": task.id, "status": task.status})
        self.session.flush()
        provider_requests.cancel(task.run_id, signal="pause")
        return task

    def resume(self, task: AgentTask, *, retry: bool = False) -> AgentTask:
        if task.status not in RESUMABLE_TASK_STATUSES:
            raise HarnessError("task_not_resumable", "当前任务不能恢复", details={"task_id": task.id, "status": task.status})
        if task.status == "failed" or retry:
            task.kind = "retry"
            if task.attempt >= task.max_attempts:
                raise HarnessError("task_retry_limit", "任务已达到最大重试次数", details={"task_id": task.id})
        else:
            task.kind = "resume"
        task.status = "queued"
        task.pause_requested = False
        task.cancel_requested = False
        task.error = None
        task.completed_at = None
        task.locked_by = None
        self.session.flush()
        return task

    def request_cancel(self, task: AgentTask) -> AgentTask:
        if task.status == "running":
            task.cancel_requested = True
        elif task.status in {"queued", "paused", "failed"}:
            task.status = "cancelled"
            task.cancel_requested = True
            task.completed_at = utc_now()
        elif task.status != "cancelled":
            raise HarnessError("task_not_cancellable", "当前任务不能取消", details={"task_id": task.id, "status": task.status})
        self.session.flush()
        provider_requests.cancel(task.run_id, signal="cancel")
        return task

    def enqueue_message(self, *, job: Job, run: AgentRun | None, content: str, thinking_level: str) -> QueuedAgentMessage:
        maximum = self.session.scalar(select(func.max(QueuedAgentMessage.sequence)).where(QueuedAgentMessage.job_id == job.id))
        message = QueuedAgentMessage(
            candidate_id=job.candidate_id,
            job_id=job.id,
            run_id=run.id if run else None,
            content=content.strip(),
            thinking_level=thinking_level,
            status="queued",
            sequence=int(maximum or 0) + 1,
        )
        self.session.add(message)
        self.session.flush()
        if run:
            TraceService(self.session).record(run=run, stage=run.current_stage or "conversation", agent_name="task_queue", event_type="message_queued", actor="user", output_refs=[f"queued_message:{message.id}"])
        return message


@dataclass
class WorkerResult:
    kind: str
    item_id: str
    status: str


class AgentTaskWorker:
    def __init__(self, database: Database, *, poll_interval: float = 0.25, worker_id: str | None = None):
        self.database = database
        self.poll_interval = poll_interval
        self.worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}"
        self.stop_event = threading.Event()

    def recover_orphans(self) -> None:
        with self.database.session() as session:
            for task in session.scalars(select(AgentTask).where(AgentTask.status == "running")).all():
                task.status = "queued"
                task.locked_by = None
                task.error = "worker restarted before task completed"

    def run_forever(self) -> None:
        self.recover_orphans()
        while not self.stop_event.is_set():
            result = self.process_once()
            if result is None:
                self.stop_event.wait(self.poll_interval)

    def stop(self) -> None:
        self.stop_event.set()

    def process_once(self) -> WorkerResult | None:
        task_id = self._claim_task()
        if task_id:
            return self._process_task(task_id)
        message_id = self._claim_message()
        if message_id:
            return self._process_message(message_id)
        return None

    def _claim_task(self) -> str | None:
        with self.database.session() as session:
            task = session.scalar(select(AgentTask).where(AgentTask.status == "queued").order_by(AgentTask.priority, AgentTask.created_at))
            if not task:
                return None
            task.status = "running"
            task.attempt += 1
            task.locked_by = self.worker_id
            task.started_at = utc_now()
            return task.id

    def _process_task(self, task_id: str) -> WorkerResult:
        with self.database.session() as session:
            task = session.get(AgentTask, task_id)
            run = session.get(AgentRun, task.run_id) if task else None
            if not task or not run:
                return WorkerResult("task", task_id, "missing")
            trace = TraceService(session)
            trace.record(run=run, stage=run.current_stage or "created", agent_name="task_worker", event_type="task_started", output_refs=[f"task:{task.id}"], reason=f"attempt {task.attempt}")

            def control() -> str | None:
                with self.database.session() as control_session:
                    current = control_session.get(AgentTask, task_id)
                    if not current:
                        return "cancel"
                    if current.cancel_requested:
                        return "cancel"
                    if current.pause_requested:
                        return "pause"
                    return None

            try:
                from .engine import build_agent_engine

                engine = build_agent_engine(session)
                outcome = engine.retry(run, control=control) if task.kind == "retry" else engine.run(run, control=control)
                task.result_json = {"stop_reason": outcome.stop_reason, "iterations": outcome.iterations, "stage": run.current_stage, "status": run.status.value}
                if outcome.stop_reason == "task_cancelled":
                    task.status = "cancelled"
                elif outcome.stop_reason in {"approval_required", "user_action_required", "task_paused", "iteration_limit", "model_final"}:
                    task.status = "paused"
                elif outcome.stop_reason in {"tool_error", "model_error", "empty_turn"}:
                    task.status = "failed"
                else:
                    task.status = "completed"
                task.error = run.error if task.status == "failed" else None
            except Exception as exc:
                task.status = "failed"
                task.error = json.dumps({"code": "task_worker_error", "message": redact_text(str(exc))[:500], "error_type": type(exc).__name__}, ensure_ascii=False)
            task.pause_requested = False
            task.cancel_requested = task.status == "cancelled"
            task.locked_by = None
            task.completed_at = utc_now() if task.status in {"completed", "failed", "cancelled"} else None
            trace.record(run=run, stage=run.current_stage or "unknown", agent_name="task_worker", event_type=f"task_{task.status}", status=StepStatus.FAILED if task.status == "failed" else StepStatus.COMPLETED, output_refs=[f"task:{task.id}"], error=task.error if task.status == "failed" else None)
            return WorkerResult("task", task.id, task.status)

    def _claim_message(self) -> str | None:
        with self.database.session() as session:
            candidates = session.scalars(select(QueuedAgentMessage).where(QueuedAgentMessage.status == "queued").order_by(QueuedAgentMessage.created_at)).all()
            for message in candidates:
                active = session.scalar(select(AgentTask.id).where(AgentTask.run_id == message.run_id, AgentTask.status == "running")) if message.run_id else None
                if active:
                    continue
                message.status = "processing"
                return message.id
            return None

    def _process_message(self, message_id: str) -> WorkerResult:
        with self.database.session() as session:
            queued = session.get(QueuedAgentMessage, message_id)
            if not queued:
                return WorkerResult("message", message_id, "missing")
            job = session.get(Job, queued.job_id)
            run = session.get(AgentRun, queued.run_id) if queued.run_id else None
            if not job:
                queued.status = "failed"
                queued.error = "job_not_found"
                return WorkerResult("message", queued.id, queued.status)
            try:
                from .context import ContextManager

                context = ContextManager(session).conversation_context(job=job, run=run, include_job_context=False)
                processing_trace: list[dict] = []

                def capture_event(item: dict) -> None:
                    event_id = str(item.get("id") or item.get("type") or "agent")
                    for index, existing in enumerate(processing_trace):
                        if existing.get("id") == event_id:
                            processing_trace[index] = {**existing, **item}
                            return
                    processing_trace.append(dict(item))

                user = AgentMessage(candidate_id=job.candidate_id, job_id=job.id, run_id=run.id if run else None, role="user", content=queued.content, metadata_json={"thinking_level": queued.thinking_level, "delivery_status": "queued_completed"})
                session.add(user)
                session.flush()
                result = AgentService(session).converse(
                    job,
                    queued.content,
                    run=run,
                    context=context,
                    thinking_level=queued.thinking_level,
                    on_event=capture_event,
                )
                assistant = AgentMessage(
                    candidate_id=job.candidate_id,
                    job_id=job.id,
                    run_id=run.id if run else None,
                    role="assistant",
                    content=result["message"],
                    metadata_json={
                        "intent": result["intent"],
                        "suggested_actions": result["suggested_actions"],
                        "runtime": result["runtime"],
                        "thinking_level": queued.thinking_level,
                        "queued_message_id": queued.id,
                        "processing_trace": processing_trace,
                    },
                )
                session.add(assistant)
                session.flush()
                queued.result_message_id = assistant.id
                queued.status = "completed"
                if run:
                    TraceService(session).record(run=run, stage=run.current_stage or "conversation", agent_name="task_worker", event_type="message_completed", output_refs=[f"queued_message:{queued.id}", f"message:{assistant.id}"])
            except Exception as exc:
                queued.status = "failed"
                queued.error = json.dumps({"code": "queued_message_failed", "message": redact_text(str(exc))[:500]}, ensure_ascii=False)
            return WorkerResult("message", queued.id, queued.status)
