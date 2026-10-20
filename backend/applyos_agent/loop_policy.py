"""Provider-neutral execution policy shared by FetchCV Agent loops.

The model decides what to do. This module keeps bounded execution, retries,
and user-visible evidence deterministic so every provider and delivery path
has the same safety and recovery semantics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AgentRunBudget:
    iteration_limit: int
    tool_limit: int
    calls_per_turn: int = 3
    read_retry_limit: int = 1

    @classmethod
    def conversation(cls, effort: str, *, iteration_override: int | None = None) -> "AgentRunBudget":
        presets = {
            "fast": cls(iteration_limit=5, tool_limit=6, calls_per_turn=2),
            "balanced": cls(iteration_limit=8, tool_limit=12, calls_per_turn=3),
            "deep": cls(iteration_limit=12, tool_limit=20, calls_per_turn=3),
        }
        selected = presets.get(effort, presets["balanced"])
        if iteration_override is None:
            return selected
        return cls(
            iteration_limit=max(1, iteration_override),
            tool_limit=selected.tool_limit,
            calls_per_turn=selected.calls_per_turn,
            read_retry_limit=selected.read_retry_limit,
        )

    @classmethod
    def pipeline(cls, max_turns: int, *, iteration_override: int | None = None) -> "AgentRunBudget":
        limit = iteration_override or max(8, min(20, max_turns * 3))
        return cls(iteration_limit=limit, tool_limit=limit * 3, calls_per_turn=3)


def evidence_manifest(results: list[dict[str, Any]]) -> dict[str, Any]:
    """Create a compact, non-sensitive proof summary from real tool results."""

    tools: list[str] = []
    sources: list[str] = []
    artifacts: list[str] = []
    for item in results:
        name = str(item.get("tool_name") or "")
        if name and name not in tools:
            tools.append(name)
        result = item.get("result") if isinstance(item, dict) else None
        data = result.get("data") if isinstance(result, dict) else None
        if not isinstance(data, dict):
            data = {}
        candidates = data.get("results")
        if isinstance(candidates, list):
            for candidate in candidates:
                if not isinstance(candidate, dict):
                    continue
                url = str(candidate.get("url") or "")
                if url.startswith(("https://", "http://")) and url not in sources:
                    sources.append(url)
        for key in ("source_url", "url"):
            url = str(data.get(key) or "")
            if url.startswith(("https://", "http://")) and url not in sources:
                sources.append(url)
        versioning = result.get("versioning") if isinstance(result, dict) else None
        if isinstance(versioning, dict):
            target_type = str(versioning.get("target_type") or "artifact")
            target_id = str(versioning.get("target_id") or "")
            reference = f"{target_type}:{target_id}" if target_id else target_type
            if reference not in artifacts:
                artifacts.append(reference)
    return {
        "tool_count": len(results),
        "tools": tools,
        "sources": sources[:12],
        "artifacts": artifacts[:12],
    }
