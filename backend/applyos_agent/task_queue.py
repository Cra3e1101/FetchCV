"""Controls for persisted tasks. Scheduling belongs exclusively to Electron Pi.

Legacy queued records remain readable/cancellable; nothing here claims them.
"""
from sqlalchemy.orm import Session

from applyos_domain.base import utc_now
from applyos_domain.models import AgentTask
from applyos_harness.errors import HarnessError


class TaskQueue:
    def __init__(self, session: Session):
        self.session = session

    def request_pause(self, task: AgentTask) -> AgentTask:
        if task.status == "queued":
            task.status = "paused"
        elif task.status == "running":
            task.pause_requested = True
        elif task.status != "paused":
            raise HarnessError("task_not_pausable", "当前任务不能暂停", details={"task_id": task.id, "status": task.status})
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
        return task
