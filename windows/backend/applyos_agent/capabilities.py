from __future__ import annotations

from enum import StrEnum

from sqlalchemy.orm import Session

from applyos_harness.permissions import ToolGateway
from applyos_harness.policy import apply_gateway_policy, permission_settings
from applyos_harness.state_machine import PipelineStage

from .browser_tools import register_browser_tools
from .application_tools import register_application_tools
from .config import AgentSettings
from .context_tools import register_context_tools
from .interview_tools import register_interview_tools
from .skills import SkillLoader, register_skill_tools
from .tools import register_pipeline_tools
from .web_tools import register_web_tools
from .workspace_tools import register_workspace_tools


class CapabilityMode(StrEnum):
    """Selects the domain tools exposed by the same Agent capability gateway."""

    CONVERSATION = "conversation"
    TASK = "task"


def build_capability_gateway(
    session: Session,
    *,
    settings: AgentSettings,
    mode: CapabilityMode,
    pipeline=None,
) -> ToolGateway:
    """Build the single capability surface used by every Agent Loop.

    Native tools, Skills and MCP tools all enter through ToolGateway, which
    keeps permission, approval, scope, idempotency and trace enforcement out
    of model prompts and UI code. Conversation mode omits only the automatic
    resume pipeline tools; safe workspace/JD mutations and approved MCP writes
    remain discoverable and are still guarded by the gateway.
    """

    gateway = ToolGateway(session, workspace_root=settings.workspace_root)
    if mode == CapabilityMode.TASK:
        if pipeline is None:
            raise ValueError("task capability mode requires a pipeline")
        register_pipeline_tools(gateway, pipeline)

    register_web_tools(gateway)
    register_interview_tools(gateway)
    register_browser_tools(gateway)
    register_workspace_tools(gateway)
    register_context_tools(gateway)
    register_application_tools(gateway)

    loader = SkillLoader(session, project_root=settings.workspace_root)
    loader.sync()
    register_skill_tools(gateway, loader)

    # Enabled MCP tools are normal Agent capabilities. Read-only tools execute
    # immediately; write tools are exposed only after server/tool approval and
    # still require ToolGateway approval at execution time.
    # MCP's transport SDK is comparatively expensive to import. It belongs to
    # Agent gateway construction, not API process startup.
    from .mcp_tools import McpManager, register_mcp_tools

    register_mcp_tools(gateway, McpManager(session), include_writes=True)

    if mode == CapabilityMode.CONVERSATION:
        # Conversation is not a reduced chat sandbox. It may use any registered
        # capability at any non-terminal stage; the permission/approval policy,
        # not page-specific routing, decides whether execution is allowed.
        for spec in gateway.registry.values():
            spec.allowed_stages = set(PipelineStage)

    apply_gateway_policy(gateway, permission_settings(session))
    return gateway
