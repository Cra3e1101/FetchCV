from __future__ import annotations

import json
import re
import asyncio
from collections.abc import AsyncIterator
from typing import Protocol, TypeVar
from urllib.parse import urlparse

import anyio
import httpx
from pydantic import BaseModel

from applyos_harness.errors import HarnessError

from .config import AgentSettings
from .cancellation import ProviderRequestCancelled, cancellable_handle, raise_if_cancelled
from .hooks import SDKHookRecorder
from .model_protocol import contains_dsml, parse_dsml_tool_calls, strip_model_protocol
from .schemas import AgentTurnDecision, RuntimeResult, RuntimeToolCall, RuntimeToolDefinition, RuntimeTurnResult

OutputT = TypeVar("OutputT", bound=BaseModel)


def _cancelled_error(exc: ProviderRequestCancelled) -> HarnessError:
    return HarnessError(
        "provider_request_cancelled",
        "模型请求已按用户操作中断",
        retryable=True,
        details={"signal": exc.signal},
    )


def _close_client(client) -> None:
    close = getattr(client, "close", None)
    if callable(close):
        close()


class AgentRuntime(Protocol):
    def generate(
        self,
        *,
        agent_name: str,
        prompt: str,
        system_prompt: str,
        output_model: type[OutputT],
        mock_data: dict,
        session_id: str | None = None,
    ) -> tuple[OutputT, RuntimeResult]: ...

    def stream_text(
        self,
        *,
        agent_name: str,
        prompt: str,
        system_prompt: str,
        session_id: str | None = None,
    ) -> AsyncIterator[dict]: ...

    def complete_turn(
        self,
        *,
        agent_name: str,
        system_prompt: str,
        messages: list[dict],
        tools: list[RuntimeToolDefinition],
        session_id: str | None = None,
    ) -> RuntimeTurnResult: ...


class MockAgentRuntime:
    def generate(self, *, agent_name: str, prompt: str, system_prompt: str, output_model: type[OutputT], mock_data: dict, session_id: str | None = None) -> tuple[OutputT, RuntimeResult]:
        output = output_model.model_validate(mock_data)
        result = RuntimeResult(
            data=output.model_dump(mode="json"),
            session_id=session_id or f"mock:{agent_name}",
            text=f"{agent_name} produced deterministic structured output",
            usage={"runtime": "mock", "input_tokens": 0, "output_tokens": 0},
            hook_events=[{"hook": "SessionStart"}, {"hook": "Stop"}, {"hook": "SessionEnd"}],
        )
        return output, result

    async def stream_text(self, **_) -> AsyncIterator[dict]:
        if False:
            yield {}
        raise HarnessError("model_required", "请先连接并启用一个模型；Agent 对话不会使用本地规则冒充模型回答。")

    def complete_turn(self, *, agent_name: str, system_prompt: str, messages: list[dict], tools: list[RuntimeToolDefinition], session_id: str | None = None) -> RuntimeTurnResult:
        actionable = next((item for item in tools if item.name != "inspect_job_context"), None)
        if actionable is None:
            return RuntimeTurnResult(
                text="当前任务已推进到需要用户确认的节点。",
                session_id=session_id or f"mock:{agent_name}",
                usage={"runtime": "mock_agent_loop", "input_tokens": 0, "output_tokens": 0},
            )
        return RuntimeTurnResult(
            tool_calls=[RuntimeToolCall(id=f"mock:{actionable.name}", name=actionable.name, arguments={})],
            finish_reason="tool_calls",
            session_id=session_id or f"mock:{agent_name}",
            usage={"runtime": "mock_agent_loop", "input_tokens": 0, "output_tokens": 0},
        )


class ClaudeAgentRuntime:
    def __init__(self, settings: AgentSettings):
        self.settings = settings

    def generate(self, *, agent_name: str, prompt: str, system_prompt: str, output_model: type[OutputT], mock_data: dict, session_id: str | None = None) -> tuple[OutputT, RuntimeResult]:
        try:
            return anyio.run(
                self._generate_async,
                agent_name,
                prompt,
                system_prompt,
                output_model,
                session_id,
            )
        except HarnessError:
            raise
        except ProviderRequestCancelled as exc:
            raise _cancelled_error(exc) from exc
        except Exception as exc:
            raise HarnessError("claude_sdk_error", f"Claude Agent SDK 调用失败：{exc}", retryable=True) from exc

    async def _generate_async(self, agent_name: str, prompt: str, system_prompt: str, output_model: type[OutputT], session_id: str | None):
        from claude_agent_sdk import (
            AssistantMessage,
            ClaudeSDKClient,
            ClaudeAgentOptions,
            HookMatcher,
            ResultMessage,
            TextBlock,
        )

        recorder = SDKHookRecorder()
        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            model=self.settings.model,
            max_turns=self.settings.max_turns,
            max_budget_usd=self.settings.max_budget_usd,
            cwd=self.settings.workspace_root,
            resume=session_id,
            tools=[],
            allowed_tools=[],
            disallowed_tools=["Bash", "Write", "Edit", "WebSearch", "WebFetch"],
            permission_mode="dontAsk",
            setting_sources=[],
            output_format={"type": "json_schema", "schema": output_model.model_json_schema()},
            hooks={
                "PreToolUse": [HookMatcher(hooks=[recorder.pre_tool_use])],
                "PostToolUse": [HookMatcher(hooks=[recorder.post_tool_use])],
                "Stop": [HookMatcher(hooks=[recorder.stop])],
            },
        )
        text_parts: list[str] = []
        structured = None
        final_session = session_id
        usage: dict = {}
        client = ClaudeSDKClient(options=options)
        await client.connect()
        loop = asyncio.get_running_loop()

        def interrupt() -> None:
            asyncio.run_coroutine_threadsafe(client.interrupt(), loop)

        try:
            with cancellable_handle(interrupt):
                await client.query(prompt, session_id=session_id or "default")
                async for message in client.receive_response():
                    raise_if_cancelled()
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, TextBlock):
                                text_parts.append(block.text)
                    if isinstance(message, ResultMessage):
                        final_session = message.session_id or final_session
                        structured = message.structured_output
                        usage = dict(message.usage or {})
                        usage.update({"total_cost_usd": message.total_cost_usd, "num_turns": message.num_turns, "runtime": "claude"})
                        if message.is_error:
                            raise HarnessError("claude_result_error", message.result or "Claude returned an error", retryable=True)
        finally:
            await client.disconnect()
        if structured is None:
            combined = "\n".join(text_parts).strip()
            try:
                structured = json.loads(combined)
            except json.JSONDecodeError as exc:
                raise HarnessError("structured_output_missing", "Claude 未返回符合 Schema 的结构化结果", retryable=True) from exc
        output = output_model.model_validate(structured)
        result = RuntimeResult(
            data=output.model_dump(mode="json"),
            session_id=final_session,
            text="\n".join(text_parts),
            usage=usage,
            hook_events=recorder.events,
        )
        return output, result

    async def stream_text(self, *, agent_name: str, prompt: str, system_prompt: str, session_id: str | None = None) -> AsyncIterator[dict]:
        from claude_agent_sdk import AssistantMessage, ClaudeSDKClient, ClaudeAgentOptions, ResultMessage, TextBlock

        options = ClaudeAgentOptions(
            system_prompt=system_prompt,
            model=self.settings.model,
            max_turns=self.settings.max_turns,
            max_budget_usd=self.settings.max_budget_usd,
            cwd=self.settings.workspace_root,
            resume=session_id,
            tools=[],
            allowed_tools=[],
            disallowed_tools=["Bash", "Write", "Edit", "WebSearch", "WebFetch"],
            permission_mode="dontAsk",
            setting_sources=[],
        )
        final_session = session_id
        usage: dict = {}
        client = ClaudeSDKClient(options=options)
        await client.connect()
        loop = asyncio.get_running_loop()

        def interrupt() -> None:
            asyncio.run_coroutine_threadsafe(client.interrupt(), loop)

        try:
            with cancellable_handle(interrupt):
                await client.query(prompt, session_id=session_id or "default")
                async for message in client.receive_response():
                    raise_if_cancelled()
                    if isinstance(message, AssistantMessage):
                        for block in message.content:
                            if isinstance(block, TextBlock) and block.text:
                                yield {"type": "delta", "text": block.text}
                    if isinstance(message, ResultMessage):
                        if message.is_error:
                            raise HarnessError("claude_result_error", message.result or "Claude returned an error", retryable=True)
                        final_session = message.session_id or final_session
                        usage = dict(message.usage or {})
                        usage.update({"total_cost_usd": message.total_cost_usd, "num_turns": message.num_turns})
        except ProviderRequestCancelled as exc:
            raise _cancelled_error(exc) from exc
        finally:
            await client.disconnect()
        yield {"type": "done", "session_id": final_session, "usage": {**usage, "runtime": "claude", "model": self.settings.model}}

    def complete_turn(self, *, agent_name: str, system_prompt: str, messages: list[dict], tools: list[RuntimeToolDefinition], session_id: str | None = None) -> RuntimeTurnResult:
        prompt = self._decision_prompt(messages, tools)
        decision, result = self.generate(
            agent_name=agent_name,
            prompt=prompt,
            system_prompt=system_prompt,
            output_model=AgentTurnDecision,
            mock_data={"message": "", "tool_calls": []},
            session_id=session_id,
        )
        calls = [item.model_copy(update={"id": item.id or f"claude:{index}"}) for index, item in enumerate(decision.tool_calls, start=1)]
        return RuntimeTurnResult(
            text=decision.message,
            tool_calls=calls,
            finish_reason="tool_calls" if calls else "stop",
            session_id=result.session_id,
            usage={**result.usage, "tool_mode": "structured_decision"},
        )

    @staticmethod
    def _decision_prompt(messages: list[dict], tools: list[RuntimeToolDefinition]) -> str:
        return (
            "根据会话和当前可用工具决定下一步。需要执行任务时返回 tool_calls；只有已经完成或必须等待用户时才返回 message。"
            "不要描述未执行的工具结果。\n\n会话：\n"
            + json.dumps(messages, ensure_ascii=False)
            + "\n\n工具：\n"
            + json.dumps([item.model_dump(mode="json") for item in tools], ensure_ascii=False)
        )


class CompatibleAgentRuntime:
    """Structured-output runtime for OpenAI- and Anthropic-compatible APIs."""

    def __init__(self, settings: AgentSettings):
        self.settings = settings

    @staticmethod
    def _json_text(value: str) -> str:
        text = value.strip()
        fenced = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", text, flags=re.DOTALL | re.IGNORECASE)
        if fenced:
            return fenced.group(1).strip()
        decoder = json.JSONDecoder()
        for index, char in enumerate(text):
            if char not in "[{":
                continue
            try:
                _, end = decoder.raw_decode(text[index:])
                return text[index:index + end]
            except json.JSONDecodeError:
                continue
        return text

    @staticmethod
    def _dsml_tool_calls(value: str) -> tuple[list[RuntimeToolCall], str]:
        return parse_dsml_tool_calls(value)

    @staticmethod
    def _endpoint(base_url: str, protocol: str) -> str:
        base = base_url.rstrip("/")
        suffix = "/v1/messages" if protocol == "anthropic" else "/chat/completions"
        if base.endswith(suffix):
            return base
        if base.endswith("/v1"):
            return f"{base}/messages" if protocol == "anthropic" else f"{base}/chat/completions"
        return f"{base}{suffix}"

    @staticmethod
    def _anthropic_messages(messages: list[dict]) -> list[dict]:
        converted: list[dict] = []
        for message in messages:
            role = message.get("role")
            if role == "system":
                continue
            if role == "assistant":
                content: list[dict] = []
                if message.get("content"):
                    content.append({"type": "text", "text": str(message["content"])})
                for call in message.get("tool_calls") or []:
                    content.append({"type": "tool_use", "id": call.get("id"), "name": call.get("name"), "input": call.get("arguments") or {}})
                converted.append({"role": "assistant", "content": content or [{"type": "text", "text": ""}]})
            elif role == "tool":
                result_block = {
                    "type": "tool_result",
                    "tool_use_id": message.get("tool_call_id"),
                    "content": str(message.get("content") or ""),
                    "is_error": bool(message.get("is_error")),
                }
                previous_content = converted[-1].get("content") if converted and converted[-1].get("role") == "user" else None
                if isinstance(previous_content, list) and previous_content and all(item.get("type") == "tool_result" for item in previous_content):
                    previous_content.append(result_block)
                else:
                    converted.append({"role": "user", "content": [result_block]})
            else:
                converted.append({"role": "user", "content": str(message.get("content") or "")})
        return converted

    @staticmethod
    def _openai_messages(system_prompt: str, messages: list[dict]) -> list[dict]:
        converted = [{"role": "system", "content": system_prompt}]
        for message in messages:
            role = message.get("role")
            if role == "assistant" and message.get("tool_calls"):
                converted.append({
                    "role": "assistant",
                    "content": message.get("content") or None,
                    "tool_calls": [
                        {
                            "id": call.get("id"),
                            "type": "function",
                            "function": {"name": call.get("name"), "arguments": json.dumps(call.get("arguments") or {}, ensure_ascii=False)},
                        }
                        for call in message["tool_calls"]
                    ],
                })
            elif role == "tool":
                converted.append({"role": "tool", "tool_call_id": message.get("tool_call_id"), "content": str(message.get("content") or "")})
            elif role in {"user", "assistant"}:
                converted.append({"role": role, "content": str(message.get("content") or "")})
        return converted

    def _structured_decision_turn(self, *, agent_name: str, system_prompt: str, messages: list[dict], tools: list[RuntimeToolDefinition], session_id: str | None) -> RuntimeTurnResult:
        decision, result = self.generate(
            agent_name=agent_name,
            prompt=ClaudeAgentRuntime._decision_prompt(messages, tools),
            system_prompt=system_prompt,
            output_model=AgentTurnDecision,
            mock_data={"message": "", "tool_calls": []},
            session_id=session_id,
        )
        calls = [item.model_copy(update={"id": item.id or f"fallback:{index}"}) for index, item in enumerate(decision.tool_calls, start=1)]
        return RuntimeTurnResult(
            text=decision.message,
            tool_calls=calls,
            finish_reason="tool_calls" if calls else "stop",
            session_id=result.session_id,
            usage={**result.usage, "tool_mode": "structured_fallback"},
        )

    def complete_turn(self, *, agent_name: str, system_prompt: str, messages: list[dict], tools: list[RuntimeToolDefinition], session_id: str | None = None) -> RuntimeTurnResult:
        if not self.settings.provider_base_url or not self.settings.provider_api_key or not self.settings.model:
            raise HarnessError("provider_not_configured", "模型连接缺少 Base URL、API Key 或模型名", retryable=True)
        provider_host = (urlparse(self.settings.provider_base_url).hostname or "").lower()
        trust_environment = provider_host not in {"127.0.0.1", "localhost", "::1"}
        protocol = self.settings.provider_protocol
        try:
            client = httpx.Client(timeout=httpx.Timeout(90.0, connect=15.0), follow_redirects=False, trust_env=trust_environment)
            try:
                with cancellable_handle(lambda: _close_client(client)):
                    raise_if_cancelled()
                    if protocol == "anthropic":
                        response = client.post(
                            self._endpoint(self.settings.provider_base_url, "anthropic"),
                            headers={"x-api-key": self.settings.provider_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
                            json={
                                "model": self.settings.model,
                                "max_tokens": 4096,
                                "system": system_prompt,
                                "messages": self._anthropic_messages(messages),
                                "tools": [{"name": item.name, "description": item.description, "input_schema": item.input_schema} for item in tools],
                            },
                        )
                    else:
                        response = client.post(
                            self._endpoint(self.settings.provider_base_url, "openai"),
                            headers={"Authorization": f"Bearer {self.settings.provider_api_key}", "content-type": "application/json"},
                            json={
                                "model": self.settings.model,
                                "messages": self._openai_messages(system_prompt, messages),
                                "tools": [{"type": "function", "function": {"name": item.name, "description": item.description, "parameters": item.input_schema}} for item in tools],
                                "tool_choice": "auto",
                                "stream": False,
                            },
                        )
                    if response.status_code in {400, 404, 422}:
                        return self._structured_decision_turn(agent_name=agent_name, system_prompt=system_prompt, messages=messages, tools=tools, session_id=session_id)
                    response.raise_for_status()
                    payload = response.json()
            finally:
                _close_client(client)
        except ProviderRequestCancelled as exc:
            raise _cancelled_error(exc) from exc
        except httpx.HTTPStatusError as exc:
            detail = ""
            try:
                error_payload = exc.response.json()
                detail = str((error_payload.get("error") or {}).get("message") or error_payload.get("message") or "")
            except (ValueError, TypeError, AttributeError):
                pass
            detail = detail.replace(self.settings.provider_api_key, "[已隐藏]")[:280]
            raise HarnessError("provider_http_error", f"模型 API 返回 {exc.response.status_code}{f'：{detail}' if detail else ''}", retryable=exc.response.status_code >= 500) from exc
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            message = str(exc).replace(self.settings.provider_api_key, "[已隐藏]")[:280]
            raise HarnessError("provider_connection_error", f"模型工具调用失败：{message}", retryable=True) from exc

        calls: list[RuntimeToolCall] = []
        tool_mode = "native"
        if protocol == "anthropic":
            content = payload.get("content") or []
            text = "\n".join(str(item.get("text") or "") for item in content if item.get("type") == "text").strip()
            for index, item in enumerate(content, start=1):
                if item.get("type") == "tool_use":
                    calls.append(RuntimeToolCall(id=str(item.get("id") or f"anthropic:{index}"), name=str(item.get("name") or ""), arguments=item.get("input") or {}))
            finish_reason = str(payload.get("stop_reason") or ("tool_use" if calls else "stop"))
        else:
            choice = (payload.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            text = str(message.get("content") or "").strip()
            for index, item in enumerate(message.get("tool_calls") or [], start=1):
                function = item.get("function") or {}
                raw_arguments = function.get("arguments") or "{}"
                arguments = json.loads(raw_arguments) if isinstance(raw_arguments, str) else raw_arguments
                calls.append(RuntimeToolCall(id=str(item.get("id") or f"openai:{index}"), name=str(function.get("name") or ""), arguments=arguments or {}))
            finish_reason = str(choice.get("finish_reason") or ("tool_calls" if calls else "stop"))
        # Some compatible providers emit DSML inside a normal text block even
        # on their Anthropic endpoint. Normalize protocol text after both
        # provider branches so the Agent Loop sees one consistent tool-call
        # representation.
        raw_text = text
        if not calls and text:
            dsml_calls, cleaned_text = self._dsml_tool_calls(text)
            if dsml_calls:
                calls = dsml_calls
                text = cleaned_text
                tool_mode = "dsml"
            else:
                text = cleaned_text
                try:
                    decision = AgentTurnDecision.model_validate(json.loads(self._json_text(text)))
                    calls = [item.model_copy(update={"id": item.id or f"json:{index}"}) for index, item in enumerate(decision.tool_calls, start=1)]
                    text = decision.message or text
                    if calls:
                        tool_mode = "structured_content"
                except (json.JSONDecodeError, ValueError):
                    pass
        if contains_dsml(text):
            text = strip_model_protocol(text)
        if not calls and not text and contains_dsml(raw_text):
            raise HarnessError("provider_protocol_error", "模型返回了无法解析的工具调用格式，请重试本轮请求", retryable=True)
        return RuntimeTurnResult(
            text=text,
            tool_calls=calls,
            finish_reason="tool_calls" if calls else finish_reason,
            session_id=session_id,
            usage={**(payload.get("usage") or {}), "runtime": "compatible_agent", "provider": self.settings.provider_name or "custom", "model": self.settings.model, "protocol": protocol, "tool_mode": tool_mode},
        )

    def generate(self, *, agent_name: str, prompt: str, system_prompt: str, output_model: type[OutputT], mock_data: dict, session_id: str | None = None) -> tuple[OutputT, RuntimeResult]:
        if not self.settings.provider_base_url or not self.settings.provider_api_key or not self.settings.model:
            raise HarnessError("provider_not_configured", "模型连接缺少 Base URL、API Key 或模型名", retryable=True)
        schema = output_model.model_json_schema()
        json_instruction = (
            "\n\n只返回一个 JSON 对象，不要使用 Markdown。JSON 必须严格符合以下 Schema：\n"
            + json.dumps(schema, ensure_ascii=False)
        )
        provider_host = (urlparse(self.settings.provider_base_url).hostname or "").lower()
        trust_environment = provider_host not in {"127.0.0.1", "localhost", "::1"}
        try:
            client = httpx.Client(timeout=httpx.Timeout(60.0, connect=15.0), follow_redirects=False, trust_env=trust_environment)
            try:
                with cancellable_handle(lambda: _close_client(client)):
                    raise_if_cancelled()
                    if self.settings.provider_protocol == "anthropic":
                        response = client.post(
                            self._endpoint(self.settings.provider_base_url, "anthropic"),
                            headers={
                                "x-api-key": self.settings.provider_api_key,
                                "anthropic-version": "2023-06-01",
                                "content-type": "application/json",
                            },
                            json={
                                "model": self.settings.model,
                                "max_tokens": 4096,
                                "system": system_prompt + json_instruction,
                                "messages": [{"role": "user", "content": prompt}],
                            },
                        )
                        response.raise_for_status()
                        payload = response.json()
                        text = "\n".join(item.get("text", "") for item in payload.get("content", []) if item.get("type") == "text")
                        usage = payload.get("usage", {})
                    else:
                        endpoint = self._endpoint(self.settings.provider_base_url, "openai")
                        request_body = {
                            "model": self.settings.model,
                            "messages": [
                                {"role": "system", "content": system_prompt + json_instruction},
                                {"role": "user", "content": prompt},
                            ],
                            "response_format": {"type": "json_object"},
                            "stream": False,
                        }
                        response = client.post(
                            endpoint,
                            headers={"Authorization": f"Bearer {self.settings.provider_api_key}", "content-type": "application/json"},
                            json=request_body,
                        )
                        if response.status_code in {400, 422}:
                            request_body.pop("response_format", None)
                            response = client.post(
                                endpoint,
                                headers={"Authorization": f"Bearer {self.settings.provider_api_key}", "content-type": "application/json"},
                                json=request_body,
                            )
                        response.raise_for_status()
                        payload = response.json()
                        text = payload["choices"][0]["message"]["content"]
                        usage = payload.get("usage", {})
            finally:
                _close_client(client)
        except ProviderRequestCancelled as exc:
            raise _cancelled_error(exc) from exc
        except httpx.HTTPStatusError as exc:
            request_id = exc.response.headers.get("x-request-id", "")
            suffix = f"（request id: {request_id}）" if request_id else ""
            detail = ""
            try:
                payload = exc.response.json()
                if isinstance(payload, dict):
                    error_payload = payload.get("error")
                    if isinstance(error_payload, dict):
                        detail = error_payload.get("message", "") or error_payload.get("type", "")
                    detail = detail or payload.get("message", "") or payload.get("detail", "")
            except (ValueError, TypeError):
                pass
            detail = str(detail).replace(self.settings.provider_api_key, "[已隐藏]").strip()[:280]
            message = f"模型 API 返回 {exc.response.status_code}{suffix}"
            if detail:
                message += f"：{detail}"
            raise HarnessError("provider_http_error", message, retryable=exc.response.status_code >= 500) from exc
        except (httpx.HTTPError, KeyError, TypeError, ValueError) as exc:
            raise HarnessError("provider_connection_error", f"模型 API 调用失败：{exc}", retryable=True) from exc
        fallback_reason = ""
        try:
            structured = json.loads(self._json_text(text))
            output = output_model.model_validate(structured)
        except (json.JSONDecodeError, ValueError) as exc:
            # Chat providers sometimes ignore structured-output instructions
            # but still return a useful prose answer. Preserve that actual API
            # answer for conversation models; deterministic fallback remains
            # limited to strictly structured pipeline stages.
            if "message" in output_model.model_fields and text.strip():
                output = output_model.model_validate({"message": text.strip(), "intent": "discuss", "suggested_actions": []})
                fallback_reason = "unstructured_conversation"
            else:
                raise HarnessError(
                    "provider_structured_output_invalid",
                    "模型返回的结构不符合当前任务要求，未使用本地规则替代模型结果。请重试或切换模型。",
                    retryable=True,
                    details={"validation_error": type(exc).__name__},
                ) from exc
        result = RuntimeResult(
            data=output.model_dump(mode="json"),
            session_id=session_id,
            text=text,
            usage={**usage, "runtime": "compatible_unstructured" if fallback_reason == "unstructured_conversation" else "compatible_fallback" if fallback_reason else "compatible", "provider": self.settings.provider_name or "custom", "model": self.settings.model, "protocol": self.settings.provider_protocol, "base_url": self.settings.provider_base_url, "fallback_reason": fallback_reason},
            hook_events=[],
        )
        return output, result

    async def stream_text(self, *, agent_name: str, prompt: str, system_prompt: str, session_id: str | None = None) -> AsyncIterator[dict]:
        if not self.settings.provider_base_url or not self.settings.provider_api_key or not self.settings.model:
            raise HarnessError("provider_not_configured", "模型连接缺少 Base URL、API Key 或模型名", retryable=True)
        provider_host = (urlparse(self.settings.provider_base_url).hostname or "").lower()
        trust_environment = provider_host not in {"127.0.0.1", "localhost", "::1"}
        protocol = self.settings.provider_protocol
        if protocol == "anthropic":
            endpoint = self._endpoint(self.settings.provider_base_url, "anthropic")
            headers = {
                "x-api-key": self.settings.provider_api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }
            body = {
                "model": self.settings.model,
                "max_tokens": 4096,
                "system": system_prompt,
                "messages": [{"role": "user", "content": prompt}],
                "stream": True,
            }
        else:
            endpoint = self._endpoint(self.settings.provider_base_url, "openai")
            headers = {"Authorization": f"Bearer {self.settings.provider_api_key}", "content-type": "application/json"}
            body = {
                "model": self.settings.model,
                "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}],
                "stream": True,
            }
        usage: dict = {}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0), follow_redirects=False, trust_env=trust_environment) as client:
                async with client.stream("POST", endpoint, headers=headers, json=body) as response:
                    if not response.is_success:
                        raw = (await response.aread()).decode(errors="replace")
                        detail = raw.replace(self.settings.provider_api_key, "[已隐藏]").strip()[:280]
                        request_id = response.headers.get("x-request-id", "")
                        suffix = f"（request id: {request_id}）" if request_id else ""
                        raise HarnessError("provider_http_error", f"模型 API 返回 {response.status_code}{suffix}{f'：{detail}' if detail else ''}", retryable=response.status_code >= 500)
                    content_type = response.headers.get("content-type", "").lower()
                    if "text/event-stream" not in content_type:
                        payload = json.loads((await response.aread()).decode())
                        if protocol == "anthropic":
                            text = "\n".join(item.get("text", "") for item in payload.get("content", []) if item.get("type") == "text")
                        else:
                            text = payload["choices"][0]["message"]["content"]
                            try:
                                structured_text = json.loads(text)
                                if isinstance(structured_text, dict) and structured_text.get("message"):
                                    text = str(structured_text["message"])
                            except (json.JSONDecodeError, TypeError):
                                pass
                        usage = payload.get("usage", {})
                        if text:
                            yield {"type": "delta", "text": text}
                    else:
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            payload = json.loads(data)
                            usage = payload.get("usage") or usage
                            if protocol == "anthropic":
                                delta = payload.get("delta", {})
                                text = delta.get("text", "") if payload.get("type") == "content_block_delta" else ""
                            else:
                                choices = payload.get("choices") or []
                                text = choices[0].get("delta", {}).get("content", "") if choices else ""
                            if text:
                                yield {"type": "delta", "text": text}
        except HarnessError:
            raise
        except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
            message = str(exc).replace(self.settings.provider_api_key, "[已隐藏]")[:280]
            raise HarnessError("provider_connection_error", f"模型 API 调用失败：{message}", retryable=True) from exc
        yield {
            "type": "done",
            "session_id": session_id,
            "usage": {
                **usage,
                "runtime": "compatible_stream",
                "provider": self.settings.provider_name or "custom",
                "model": self.settings.model,
                "protocol": protocol,
                "base_url": self.settings.provider_base_url,
            },
        }


def build_runtime(settings: AgentSettings) -> AgentRuntime:
    if settings.runtime.value == "claude":
        raise HarnessError(
            "legacy_claude_runtime_removed",
            "Claude Agent SDK 运行时已由 Electron Pi Agent Runtime 替代，请在桌面设置中连接模型。",
        )
    if settings.runtime.value == "compatible":
        return CompatibleAgentRuntime(settings)
    return MockAgentRuntime()
