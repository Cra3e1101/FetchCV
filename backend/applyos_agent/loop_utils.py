"""Small, provider-neutral helpers shared by the task and chat loops.

Business state transitions remain in their owning agents. This module only
keeps tool-call identity and provider message envelopes consistent.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

from .schemas import RuntimeToolCall


def tool_call_signature(call: RuntimeToolCall, *, stage: str | None = None) -> str:
    """Return a stable identity for duplicate detection within one run."""

    return json.dumps(
        {"stage": stage, "name": call.name, "arguments": call.arguments},
        ensure_ascii=False,
        sort_keys=True,
    )


def append_tool_message(
    messages: list[dict[str, Any]],
    call: RuntimeToolCall,
    payload: dict[str, Any],
    *,
    is_error: bool = False,
) -> None:
    """Append the canonical tool result shape expected by both protocols."""

    messages.append(
        {
            "role": "tool",
            "tool_call_id": call.id,
            "name": call.name,
            "content": json.dumps(payload, ensure_ascii=False),
            "is_error": is_error,
        }
    )


@dataclass
class ToolCallLedger:
    """Track duplicate calls and cap side effects per model turn."""

    seen: set[str] = field(default_factory=set)
    _side_effect_executed: bool = field(default=False, init=False)

    def begin_turn(self) -> None:
        self._side_effect_executed = False

    def duplicate(self, call: RuntimeToolCall, *, stage: str | None = None) -> bool:
        signature = tool_call_signature(call, stage=stage)
        if signature in self.seen:
            return True
        self.seen.add(signature)
        return False

    def side_effect_allowed(self, side_effect: bool) -> bool:
        if not side_effect:
            return True
        if self._side_effect_executed:
            return False
        self._side_effect_executed = True
        return True
