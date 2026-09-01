"""Public Agent runtime event protocol.

The protocol transports observable actions and evidence summaries. It must
never be used to persist or reveal a provider's hidden chain of thought.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from time import time
from typing import Any, Callable


PROTOCOL_VERSION = 1
VALID_STATUSES = {"pending", "active", "completed", "failed", "paused", "cancelled"}
VALID_KINDS = {"model", "tool", "control", "approval", "artifact", "system"}


def _compact(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text if len(text) <= limit else f"{text[: max(0, limit - 1)]}…"


@dataclass
class AgentEventStream:
    callback: Callable[[dict[str, Any]], None]
    thread_id: str
    run_id: str
    turn_id: str
    _sequence: int = 0
    _events: dict[str, dict[str, Any]] = field(default_factory=dict)

    def emit(self, item: dict[str, Any]) -> dict[str, Any]:
        event_id = str(item.get("id") or f"event-{self._sequence + 1}")
        current = self._events.get(event_id)
        now = int(time() * 1000)
        if current is None:
            self._sequence += 1

        raw_kind = item.get("kind") or item.get("type")
        kind = raw_kind if raw_kind in VALID_KINDS else "system"
        label = item.get("label") or (current or {}).get("label") or "正在处理"
        detail = item.get("detail") if "detail" in item else (current or {}).get("detail", "")
        event = {
            "protocol_version": PROTOCOL_VERSION,
            "id": event_id,
            "thread_id": self.thread_id,
            "run_id": self.run_id,
            "turn_id": self.turn_id,
            "sequence": current["sequence"] if current else self._sequence,
            "revision": int(current.get("revision", 1)) + 1 if current else 1,
            "kind": kind,
            # Compatibility alias for Python consumers that predate protocol v1.
            "type": kind,
            "status": item.get("status") if item.get("status") in VALID_STATUSES else "active",
            "label": _compact(label, 120),
            "detail": _compact(detail, 1200),
            "evidence_refs": [
                _compact(value, 240)
                for value in (item.get("evidence_refs") or (current or {}).get("evidence_refs") or [])
            ][:24],
            "started_at": current["started_at"] if current else now,
            "updated_at": now,
        }
        self._events[event_id] = event
        self.callback(event)
        return event
