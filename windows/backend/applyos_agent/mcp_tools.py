from __future__ import annotations

import asyncio
import json
import os
import re
from datetime import timedelta
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.base import utc_now
from applyos_domain.models import McpServerConfig, VersionSnapshot
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from applyos_harness.trace import sanitize_trace


MAX_MCP_OUTPUT_CHARS = 24000
ENV_KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]{0,127}$")


class McpArguments(BaseModel):
    model_config = ConfigDict(extra="allow")


class McpToolResult(BaseModel):
    summary: str
    data: dict[str, Any] = Field(default_factory=dict)


class McpRollbackInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    snapshot_id: str = Field(min_length=1, max_length=80)


class McpManager:
    def __init__(self, session: Session):
        self.session = session

    @staticmethod
    def validate(config: McpServerConfig) -> None:
        if config.transport == "streamable_http":
            from urllib.parse import parse_qs, urlsplit
            parsed = urlsplit(config.command.strip())
            local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
            if parsed.scheme != "https" and not local_http:
                raise HarnessError("mcp_url_invalid", "流式 HTTP MCP 地址必须使用 HTTPS，或仅使用本机回环 HTTP")
            if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
                raise HarnessError("mcp_url_invalid", "流式 HTTP MCP 地址无效")
            if any(re.search(r"password|passwd|secret|token|api[_-]?key|apikey|authorization|cookie", key, re.IGNORECASE) for key in parse_qs(parsed.query)):
                raise HarnessError("mcp_url_secret_denied", "MCP URL 不能在查询参数中携带密钥；请使用受控环境变量或安全认证配置")
            return
        if config.transport != "stdio":
            raise HarnessError("mcp_transport_invalid", "MCP Server 类型不受支持")
        command = Path(config.command).expanduser()
        if not command.is_absolute() or not command.is_file() or not os.access(command, os.X_OK):
            raise HarnessError("mcp_command_invalid", "MCP command 必须是存在且可执行的绝对路径")
        if config.cwd:
            cwd = Path(config.cwd).expanduser()
            if not cwd.is_absolute() or not cwd.is_dir():
                raise HarnessError("mcp_cwd_invalid", "MCP cwd 必须是存在的绝对目录")
        if any(not ENV_KEY_PATTERN.fullmatch(key) for key in (config.env_keys or [])):
            raise HarnessError("mcp_env_key_invalid", "MCP 环境变量名无效")

    def probe(self, config: McpServerConfig) -> list[dict[str, Any]]:
        if not config.approved:
            raise HarnessError("mcp_approval_required", "必须先明确批准 MCP Server 才能启动")
        self.validate(config)
        try:
            previous = config.discovered_tools or []
            discovered = asyncio.run(self._list_tools(config))
            if previous and json.dumps(previous, ensure_ascii=False, sort_keys=True) != json.dumps(discovered, ensure_ascii=False, sort_keys=True):
                # Trust is bound to the exact discovered capability surface.
                # A server update may turn a previously harmless tool into a
                # different operation while retaining the same name.
                config.allowed_tools = []
                config.tool_policies = {}
                config.enabled = False
            config.discovered_tools = discovered
            config.status = "ready"
            config.last_error = None
            config.last_checked_at = utc_now()
            self.session.flush()
            return discovered
        except HarnessError:
            raise
        except Exception as exc:
            config.status = "error"
            config.last_error = f"{type(exc).__name__}: {str(exc)[:400]}"
            config.last_checked_at = utc_now()
            self.session.flush()
            raise HarnessError("mcp_probe_failed", "MCP Server 连接或工具发现失败", retryable=True, details={"error_type": type(exc).__name__}) from exc

    async def _list_tools(self, config: McpServerConfig) -> list[dict[str, Any]]:
        from mcp.client.session import ClientSession
        from mcp.client.stdio import stdio_client
        from mcp.client.streamable_http import streamablehttp_client

        client_transport = stdio_client(self._parameters(config)) if config.transport == "stdio" else streamablehttp_client(config.command)
        async with client_transport as transport:
            reader, writer = transport[0], transport[1]
            async with ClientSession(reader, writer) as client:
                await client.initialize()
                response = await client.list_tools()
                return [self._tool_dict(tool) for tool in response.tools]

    def call(self, config: McpServerConfig, tool_name: str, arguments: dict[str, Any], *, allow_write: bool = False) -> dict[str, Any]:
        self.validate(config)
        if not config.approved or not config.enabled:
            raise HarnessError("mcp_tool_denied", "MCP 工具未获批准或未在白名单中")
        discovered = next((item for item in (config.discovered_tools or []) if item.get("name") == tool_name), None)
        if not discovered:
            raise HarnessError("mcp_tool_not_found", "MCP 工具未在最近一次发现结果中")
        if discovered.get("read_only"):
            if tool_name not in (config.allowed_tools or []):
                raise HarnessError("mcp_tool_denied", "MCP 只读工具未在白名单中")
        else:
            policy = (config.tool_policies or {}).get(tool_name) or {}
            if not allow_write or policy.get("mode") != "write" or policy.get("approved") is not True:
                raise HarnessError("mcp_write_tool_denied", "MCP 写工具未获得逐工具写入批准")
            annotations = discovered.get("annotations") or {}
            if annotations.get("destructiveHint") is not False or annotations.get("openWorldHint") is not False:
                raise HarnessError("mcp_write_scope_unverifiable", "只允许声明为非破坏性且封闭作用域的 MCP 写工具")
        result = asyncio.run(self._call_tool(config, tool_name, arguments))
        if result.get("is_error"):
            raise HarnessError("mcp_tool_reported_error", "MCP 工具返回错误", retryable=True, details={"tool": tool_name})
        return result

    async def _call_tool(self, config: McpServerConfig, tool_name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        from mcp.client.session import ClientSession
        from mcp.client.stdio import stdio_client
        from mcp.client.streamable_http import streamablehttp_client

        client_transport = stdio_client(self._parameters(config)) if config.transport == "stdio" else streamablehttp_client(config.command)
        async with client_transport as transport:
            reader, writer = transport[0], transport[1]
            async with ClientSession(reader, writer) as client:
                await client.initialize()
                response = await client.call_tool(tool_name, arguments, read_timeout_seconds=timedelta(seconds=30))
                payload = response.model_dump(mode="json")
                safe = sanitize_trace(payload)
                encoded = json.dumps(safe, ensure_ascii=False)
                return {"content": encoded[:MAX_MCP_OUTPUT_CHARS], "truncated": len(encoded) > MAX_MCP_OUTPUT_CHARS, "is_error": bool(response.isError)}

    @staticmethod
    def _parameters(config: McpServerConfig):
        from mcp.client.stdio import StdioServerParameters

        # Never inherit the sidecar environment implicitly: it contains model
        # credentials and browser/control tokens. Users must name each value a
        # server is allowed to receive.
        env = {"PATH": os.defpath, "LANG": os.environ.get("LANG", "C.UTF-8")}
        if os.name == "nt" and os.environ.get("SYSTEMROOT"):
            env["SYSTEMROOT"] = os.environ["SYSTEMROOT"]
        env.update({key: os.environ[key] for key in (config.env_keys or []) if key in os.environ})
        return StdioServerParameters(command=config.command, args=list(config.args_json or []), env=env, cwd=config.cwd or None)

    @staticmethod
    def _tool_dict(tool) -> dict[str, Any]:
        annotations = tool.annotations.model_dump(mode="json") if tool.annotations else {}
        return {
            "name": tool.name,
            "description": tool.description or "",
            "input_schema": tool.inputSchema or {"type": "object", "properties": {}},
            "read_only": annotations.get("readOnlyHint") is True,
            "annotations": annotations,
        }


def register_mcp_tools(gateway: ToolGateway, manager: McpManager, *, include_writes: bool = True) -> ToolGateway:
    stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED, PipelineStage.FAILED, PipelineStage.BLOCKED}
    servers = gateway.session.scalars(select(McpServerConfig).where(McpServerConfig.enabled.is_(True), McpServerConfig.approved.is_(True))).all()
    for server in servers:
        for tool in server.discovered_tools or []:
            original_name = str(tool.get("name") or "")
            if not original_name:
                continue
            is_read_only = bool(tool.get("read_only"))
            if not include_writes and not is_read_only:
                continue
            policy = (server.tool_policies or {}).get(original_name) or {}
            if is_read_only and original_name not in (server.allowed_tools or []):
                continue
            if not is_read_only and not (policy.get("mode") == "write" and policy.get("approved") is True):
                continue
            annotations = tool.get("annotations") or {}
            if not is_read_only and (annotations.get("destructiveHint") is not False or annotations.get("openWorldHint") is not False):
                continue
            safe_server = re.sub(r"[^A-Za-z0-9_-]", "_", server.name)
            registered_name = f"mcp__{safe_server}__{original_name}"

            def handler(_: ToolContext, payload: McpArguments, *, config=server, name=original_name, write=not is_read_only) -> McpToolResult:
                result = manager.call(config, name, payload.model_dump(exclude_none=True), allow_write=write)
                return McpToolResult(summary=f"MCP 工具 {config.name}/{name} 已完成。", data=result)

            gateway.register(ToolSpec(
                name=registered_name,
                description=f"{'只读' if is_read_only else '需逐次审批的写入'} MCP 工具（{server.name}）：{tool.get('description') or original_name}",
                input_model=McpArguments,
                output_model=McpToolResult,
                input_schema_override=tool.get("input_schema") or {"type": "object", "properties": {}},
                permission=ToolPermission.READ if is_read_only else ToolPermission.CONFIRMED_WRITE,
                allowed_stages=stages,
                handler=handler,
                read_only=is_read_only,
                side_effect=not is_read_only,
                approval_action=None if is_read_only else f"mcp_write:{server.id}:{original_name}",
                auto_request_approval=not is_read_only,
                target_type=None if is_read_only else str(policy.get("target_type") or ""),
                target_id_field=None if is_read_only else str(policy.get("target_id_argument") or ""),
            ))

    if not include_writes:
        return gateway

    def rollback(context: ToolContext, payload: McpRollbackInput) -> McpToolResult:
        snapshot = context.session.get(VersionSnapshot, payload.snapshot_id)
        if snapshot is None:
            raise HarnessError("snapshot_not_found", "回滚快照不存在")
        target = gateway.versions.restore_snapshot(snapshot, run_id=context.run.id)
        return McpToolResult(summary="已从审批前快照恢复版本。", data={"snapshot_id": snapshot.id, "target_type": snapshot.target_type, "target_id": target.id})

    gateway.register(ToolSpec(
        name="rollback_version_snapshot",
        description="将简历或作品集恢复到指定工具调用前快照。该操作本身也需要用户确认并产生新快照。",
        input_model=McpRollbackInput,
        output_model=McpToolResult,
        permission=ToolPermission.CONFIRMED_WRITE,
        allowed_stages=stages,
        handler=rollback,
        read_only=False,
        side_effect=True,
        approval_action="rollback_version_snapshot",
        auto_request_approval=True,
        target_id_field="snapshot_id",
    ))
    return gateway
