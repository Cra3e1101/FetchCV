from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlsplit

import httpx
from pydantic import BaseModel, ConfigDict, Field

from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from integrations.web import WebClient

from .tools import PipelineToolResult


class BrowserToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BrowserOpenInput(BrowserToolInput):
    url: str = Field(min_length=8, max_length=4096)


class BrowserBridgeClient:
    def __init__(self, *, base_url: str | None = None, token: str | None = None, transport: httpx.BaseTransport | None = None, web_client: WebClient | None = None):
        self.base_url = (base_url if base_url is not None else os.getenv("FETCHCV_BROWSER_BRIDGE_URL", "")).strip().rstrip("/")
        self.token = token if token is not None else os.getenv("FETCHCV_BROWSER_BRIDGE_TOKEN", "")
        self.transport = transport
        self.web_client = web_client or WebClient()
        if self.base_url:
            parsed = urlsplit(self.base_url)
            if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "::1"} or parsed.username or parsed.password:
                raise HarnessError("browser_bridge_invalid", "浏览器桥必须绑定到本机回环地址")

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.token)

    def command(self, command: str, **payload: Any) -> dict[str, Any]:
        if not self.configured:
            raise HarnessError("browser_bridge_unavailable", "桌面受控浏览器未启动", retryable=True)
        request_payload = {"command": command, **payload}
        if "url" in request_payload:
            # SPA recruitment sites put the job id in the hash route. Static
            # HTTP ignores it, but the hidden browser needs it to render the
            # actual posting.
            request_payload["url"] = self.web_client.validate_url(str(request_payload["url"]), preserve_fragment=True)
        try:
            # Dynamic recruitment pages may spend most of the time loading
            # public assets before their job body appears. This is an
            # internal localhost bridge timeout, not permission to wait
            # indefinitely on an external request.
            with httpx.Client(timeout=httpx.Timeout(90.0, connect=2.0), trust_env=False, transport=self.transport) as client:
                response = client.post(
                    f"{self.base_url}/command",
                    headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
                    json=request_payload,
                )
                raw = response.text
                if response.is_error:
                    try:
                        error_body = response.json()
                        detail = error_body.get("error")
                    except (ValueError, TypeError):
                        detail = ""
                        error_body = {}
                    code = error_body.get("code")
                    if code not in {"xiaohongshu_public_access_cooldown", "xiaohongshu_public_access_limit", "browser_busy"}:
                        code = "browser_bridge_failed"
                    raise HarnessError(
                        code,
                        f"桌面受控浏览器命令失败{f'：{str(detail)[:180]}' if detail else ''}",
                        retryable=False if code != "browser_bridge_failed" else True,
                        details={"status": response.status_code, **{key: value for key, value in (error_body.get("details") or {}).items() if key in {"cooldown_until", "retry_after_ms", "remaining_requests"}}},
                    )
                body = json.loads(raw)
        except HarnessError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise HarnessError("browser_bridge_failed", "桌面受控浏览器命令失败", retryable=True, details={"error_type": type(exc).__name__}) from exc
        if not body.get("ok") or not isinstance(body.get("result"), dict):
            raise HarnessError("browser_bridge_failed", "桌面受控浏览器返回无效结果", retryable=True)
        return body["result"]

    def open(self, url: str) -> dict[str, Any]:
        return self.command("open", url=url)

    def read(self) -> dict[str, Any]:
        return self.command("read")

    def status(self) -> dict[str, Any]:
        return self.command("status")

    def close(self) -> dict[str, Any]:
        return self.command("close")


def register_browser_tools(gateway: ToolGateway, *, bridge: BrowserBridgeClient | None = None) -> ToolGateway:
    browser = bridge or BrowserBridgeClient()
    if not browser.configured:
        return gateway
    stages = set(PipelineStage) - {PipelineStage.FROZEN, PipelineStage.CANCELLED, PipelineStage.FAILED, PipelineStage.BLOCKED}

    def result(context: ToolContext, state: dict[str, Any], summary: str) -> PipelineToolResult:
        login_required = bool(state.get("login_required"))
        safe_state = {
            "open": bool(state.get("open")),
            "loading": bool(state.get("loading")),
            "url": WebClient.redact_url(str(state.get("url") or "")),
            "title": str(state.get("title") or "")[:500],
            "text": str(state.get("text") or "")[:50000],
            "links": [
                {
                    "url": WebClient.redact_url(str(item.get("url") or "")),
                    "title": str(item.get("title") or "")[:300],
                }
                for item in (state.get("links") or [])[:120]
                if isinstance(item, dict) and str(item.get("url") or "").startswith("https://")
            ],
            "candidates": [
                {
                    "url": WebClient.redact_url(str(item.get("url") or "")),
                    "title": str(item.get("title") or "")[:300],
                }
                for item in (state.get("candidates") or [])[:40]
                if isinstance(item, dict) and str(item.get("url") or "").startswith("https://")
            ],
            "platform": str(state.get("platform") or "")[:80],
            "page_kind": str(state.get("page_kind") or "")[:80],
            "note_ready": bool(state.get("note_ready")),
            "image_count": max(0, int(state.get("image_count") or 0)),
            "description": str(state.get("description") or "")[:1000],
            "truncated": bool(state.get("truncated")),
            "login_required": login_required,
            "user_action": str(state.get("user_action") or "") if login_required else "",
        }
        return PipelineToolResult(
            stage=context.run.current_stage or PipelineStage.CREATED.value,
            status=context.run.status.value,
            summary=summary,
            artifacts=[f"url:{safe_state['url']}"] if safe_state["url"] else [],
            requires_user_action=login_required,
            approval_action="complete_browser_login" if login_required else None,
            data=safe_state,
        )

    def open_page(context: ToolContext, payload: BrowserOpenInput) -> PipelineToolResult:
        state = browser.open(payload.url)
        message = "浏览器等待你完成登录或验证码，完成后请恢复任务。" if state.get("login_required") else f"已在受控浏览器中打开：{state.get('title') or state.get('url') or payload.url}"
        return result(context, state, message)

    def read_page(context: ToolContext, _: BrowserToolInput) -> PipelineToolResult:
        state = browser.read()
        message = "浏览器仍在等待你完成登录或验证码。" if state.get("login_required") else f"已读取受控浏览器当前页面：{state.get('title') or state.get('url') or '未命名页面'}"
        return result(context, state, message)

    gateway.register(ToolSpec(
        name="open_browser_page",
        description="在隔离的可见桌面浏览器中打开公开 HTTPS 页面。适合需要登录态或验证码的招聘网站；验证码只能由用户完成。",
        input_model=BrowserOpenInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.NETWORK_READ,
        allowed_stages=stages,
        handler=open_page,
        read_only=True,
    ))
    gateway.register(ToolSpec(
        name="read_browser_page",
        description="读取受控桌面浏览器当前页面的可见文本。若页面仍要求登录或验证码，会暂停并等待用户。",
        input_model=BrowserToolInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.NETWORK_READ,
        allowed_stages=stages,
        handler=read_page,
        read_only=True,
    ))
    return gateway
