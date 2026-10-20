from __future__ import annotations

import os
from enum import StrEnum
from pathlib import Path

from pydantic import BaseModel, Field


class RuntimeMode(StrEnum):
    MOCK = "mock"
    CLAUDE = "claude"
    COMPATIBLE = "compatible"


class AgentSettings(BaseModel):
    runtime: RuntimeMode = RuntimeMode.MOCK
    model: str = "claude-sonnet-4-5"
    max_turns: int = Field(default=4, ge=1, le=20)
    max_budget_usd: float = Field(default=0.50, gt=0, le=20)
    workspace_root: Path
    api_key_configured: bool = False
    provider_name: str = ""
    provider_protocol: str = "openai"
    provider_base_url: str = ""
    provider_api_key: str = ""
    allow_mock_runtime: bool = False

    @classmethod
    def from_env(cls) -> "AgentSettings":
        default_root = Path(__file__).resolve().parents[2]
        raw_runtime = os.getenv("FETCHCV_AGENT_RUNTIME", "mock").strip().lower()
        runtime = RuntimeMode.CLAUDE if raw_runtime == "claude" else RuntimeMode.COMPATIBLE if raw_runtime == "compatible" else RuntimeMode.MOCK
        provider_api_key = os.getenv("FETCHCV_PROVIDER_API_KEY", "").strip()
        return cls(
            runtime=runtime,
            model=os.getenv("FETCHCV_PROVIDER_MODEL", os.getenv("FETCHCV_CLAUDE_MODEL", "claude-sonnet-4-5")).strip(),
            max_turns=int(os.getenv("FETCHCV_CLAUDE_MAX_TURNS", "4")),
            max_budget_usd=float(os.getenv("FETCHCV_CLAUDE_MAX_BUDGET_USD", "0.50")),
            workspace_root=Path(os.getenv("FETCHCV_WORKSPACE_ROOT", str(default_root))).resolve(),
            api_key_configured=bool(provider_api_key or os.getenv("ANTHROPIC_API_KEY", "").strip()),
            provider_name=os.getenv("FETCHCV_PROVIDER_NAME", "").strip(),
            provider_protocol=os.getenv("FETCHCV_PROVIDER_PROTOCOL", "openai").strip().lower(),
            provider_base_url=os.getenv("FETCHCV_PROVIDER_BASE_URL", "").strip().rstrip("/"),
            provider_api_key=provider_api_key,
            allow_mock_runtime=os.getenv("FETCHCV_ALLOW_MOCK_RUNTIME", "").strip() == "1",
        )

    def public_status(self) -> dict[str, object]:
        return {
            "runtime": self.runtime.value,
            "model": self.model,
            "max_turns": self.max_turns,
            "api_key_configured": self.api_key_configured,
            "provider_name": self.provider_name,
            "provider_protocol": self.provider_protocol,
            "provider_base_url": self.provider_base_url,
        }
