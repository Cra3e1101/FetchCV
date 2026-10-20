from __future__ import annotations

from typing import Any

from applyos_harness.trace import sanitize_trace


class SDKHookRecorder:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def pre_tool_use(self, hook_input, tool_use_id, _context):
        event = sanitize_trace({"hook": "PreToolUse", "tool_use_id": tool_use_id, "input": dict(hook_input)})
        self.events.append(event)
        tool_name = str(dict(hook_input).get("tool_name") or "")
        if tool_name in {"Bash", "Write", "Edit", "WebSearch", "WebFetch"}:
            return {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": f"FetchCV blocks {tool_name} in structured analysis stages",
                }
            }
        return {}

    async def post_tool_use(self, hook_input, tool_use_id, _context):
        self.events.append(sanitize_trace({"hook": "PostToolUse", "tool_use_id": tool_use_id, "input": dict(hook_input)}))
        return {}

    async def stop(self, hook_input, _tool_use_id, _context):
        self.events.append(sanitize_trace({"hook": "Stop", "input": dict(hook_input)}))
        return {}
