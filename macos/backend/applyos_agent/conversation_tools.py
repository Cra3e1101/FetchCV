from __future__ import annotations

import json
from dataclasses import dataclass, field
from time import monotonic
from typing import Any, Callable

from sqlalchemy.orm import Session

from applyos_domain.enums import StepStatus
from applyos_domain.models import AgentRun, Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_harness.state_machine import PipelineStage
from applyos_harness.trace import TraceService
from applyos_harness.policy import apply_gateway_policy, granted_permissions, permission_settings

from .agents import AgentSuite
from .cancellation import bind_request_scope, provider_requests, reset_request_scope
from .config import AgentSettings
from .context_tools import register_context_tools
from .mcp_tools import McpManager, register_mcp_tools
from .loop_utils import ToolCallLedger, append_tool_message
from .runtime import AgentRuntime, build_runtime
from .schemas import ConversationReply, RuntimeToolDefinition
from .skills import SkillLoader, register_skill_tools
from .web_tools import register_web_tools
from .workspace_tools import register_workspace_tools


@dataclass
class ConversationToolOutcome:
    text: str
    session_id: str | None
    usage: dict[str, Any] = field(default_factory=dict)
    tool_results: list[dict[str, Any]] = field(default_factory=list)


def build_conversation_gateway(session: Session, settings: AgentSettings) -> ToolGateway:
    gateway = ToolGateway(session, workspace_root=settings.workspace_root)
    register_web_tools(gateway)
    register_workspace_tools(gateway)
    register_context_tools(gateway)
    loader = SkillLoader(session, project_root=settings.workspace_root)
    loader.sync()
    register_skill_tools(gateway, loader)
    register_mcp_tools(gateway, McpManager(session), include_writes=False)
    workspace_mutations = {"write_workspace_file", "move_workspace_file", "delete_workspace_file"}
    # Conversation can always use read-only capabilities. Only the explicitly
    # bounded workspace mutations survive this filter; pipeline writes remain hidden.
    for name, spec in list(gateway.registry.items()):
        if not spec.read_only and name not in workspace_mutations:
            gateway.registry.pop(name)
            continue
        spec.allowed_stages = set(PipelineStage)
    apply_gateway_policy(gateway, permission_settings(session))
    return gateway


class ConversationToolAgent:
    def __init__(
        self,
        session: Session,
        *,
        settings: AgentSettings | None = None,
        runtime: AgentRuntime | None = None,
        gateway: ToolGateway | None = None,
    ):
        self.session = session
        self.settings = settings or AgentSettings.from_env()
        self.runtime = runtime or build_runtime(self.settings)
        self.gateway = gateway or build_conversation_gateway(session, self.settings)
        self.trace = TraceService(session)
        self.permissions = granted_permissions(permission_settings(session))

    def run(
        self,
        *,
        job: Job,
        run: AgentRun,
        message: str,
        context: str,
        thinking_level: str,
        request_id: str,
        on_event: Callable[[dict[str, Any]], None] | None = None,
        max_iterations: int = 5,
    ) -> ConversationToolOutcome:
        emit = on_event or (lambda _event: None)
        suite = AgentSuite(settings=self.settings, runtime=self.runtime)
        prompt, system_prompt = suite._conversation_request(job, message, context, thinking_level)
        definitions = [
            RuntimeToolDefinition(name=item["name"], description=item["description"], input_schema=item["input_schema"])
            for item in self.gateway.definitions(run)
        ]
        if not definitions:
            raise HarnessError("conversation_tools_unavailable", "当前对话没有可用的只读工具", retryable=True)
        messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
        results: list[dict[str, Any]] = []
        ledger = ToolCallLedger()
        final_session = run.session_id
        final_usage: dict[str, Any] = {}
        tool_attempts = 0
        token = bind_request_scope(request_id)
        try:
            for iteration in range(1, max_iterations + 1):
                emit({"type": "model", "status": "active", "label": "判断是否需要工具", "detail": "模型正在选择搜索、网页读取或其他只读能力。"})
                started = monotonic()
                turn = self.runtime.complete_turn(
                    agent_name="conversation_tool_agent",
                    system_prompt=system_prompt,
                    messages=messages,
                    tools=definitions,
                    session_id=final_session,
                )
                final_session = turn.session_id or final_session
                final_usage = turn.usage or final_usage
                self.trace.record(
                    run=run,
                    stage=run.current_stage or "conversation",
                    agent_name="conversation_tool_agent",
                    event_type="model_turn",
                    status=StepStatus.COMPLETED,
                    reason=turn.text[:500] or "model requested a conversation tool",
                    tool_calls=[item.model_dump(mode="json") for item in turn.tool_calls],
                    usage=turn.usage,
                    duration_ms=max(1, int((monotonic() - started) * 1000)),
                )
                if not turn.tool_calls:
                    text = turn.text.strip()
                    if not text:
                        raise HarnessError("agent_empty_turn", "模型没有返回回答或工具调用", retryable=True)
                    emit({"type": "model", "status": "completed", "label": "组织回答", "detail": "已根据工具结果生成回答。"})
                    run.session_id = final_session or run.session_id
                    self.session.flush()
                    return ConversationToolOutcome(text=text, session_id=final_session, usage=final_usage, tool_results=results)

                messages.append({"role": "assistant", "content": turn.text, "tool_calls": [item.model_dump(mode="json") for item in turn.tool_calls]})
                ledger.begin_turn()
                should_finalize = False
                for call_index, call in enumerate(turn.tool_calls[:3], start=1):
                    tool_attempts += 1
                    if ledger.duplicate(call):
                        error = {"code": "duplicate_tool_call", "message": "相同工具调用已经执行。"}
                        append_tool_message(messages, call, {"ok": False, "error": error}, is_error=True)
                        should_finalize = True
                        continue
                    spec = self.gateway.registry.get(call.name)
                    if spec is not None and not ledger.side_effect_allowed(spec.side_effect):
                        error = {"code": "tool_call_deferred", "message": "每个模型回合只执行一个有副作用的工具。"}
                        append_tool_message(messages, call, {"ok": False, "error": error}, is_error=True)
                        should_finalize = True
                        continue
                    display = {
                        "search_web": "搜索网页",
                        "read_web_page": "读取网页",
                        "list_workspace_files": "查看工作区",
                        "read_workspace_file": "读取工作区文件",
                        "search_workspace_text": "搜索工作区",
                        "read_job_workspace_context": "读取岗位工作区上下文",
                        "write_workspace_file": "准备写入文件",
                        "move_workspace_file": "准备移动文件",
                        "delete_workspace_file": "准备删除文件",
                    }.get(call.name, "调用工作区工具")
                    emit({"type": "tool", "status": "active", "id": f"tool-{iteration}-{call_index}", "label": display, "detail": call.name})
                    try:
                        result = self.gateway.execute(
                            tool_name=call.name,
                            run=run,
                            arguments=call.arguments,
                            granted_permissions=self.permissions,
                            idempotency_key=f"conversation:{request_id}:{iteration}:{call.id or call_index}",
                        )
                        results.append({"tool_name": call.name, "result": result})
                        append_tool_message(messages, call, {"ok": True, "result": result})
                        emit({"type": "tool", "status": "completed", "id": f"tool-{iteration}-{call_index}", "label": display, "detail": str(result.get("summary") or "工具调用完成。")})
                        if call.name in {"read_web_page", "read_workspace_file", "search_workspace_text", "read_job_workspace_context"}:
                            should_finalize = True
                        if result.get("requires_user_action"):
                            text = str(result.get("summary") or "请在受控浏览器完成操作后重试。")
                            return ConversationToolOutcome(text=text, session_id=final_session, usage=final_usage, tool_results=results)
                    except HarnessError as exc:
                        append_tool_message(messages, call, {"ok": False, "error": exc.as_dict()}, is_error=True)
                        emit({"type": "tool", "status": "failed", "id": f"tool-{iteration}-{call_index}", "label": display, "detail": exc.message})
                        if exc.code == "approval_required":
                            should_finalize = True
                        if tool_attempts >= 2:
                            should_finalize = True
                if should_finalize or tool_attempts >= 3 or iteration == max_iterations:
                    return self._finalize(
                        job=job,
                        run=run,
                        message=message,
                        messages=messages,
                        system_prompt=system_prompt,
                        final_session=final_session,
                        final_usage=final_usage,
                        results=results,
                        emit=emit,
                    )
            return self._finalize(
                job=job,
                run=run,
                message=message,
                messages=messages,
                system_prompt=system_prompt,
                final_session=final_session,
                final_usage=final_usage,
                results=results,
                emit=emit,
            )
        finally:
            provider_requests.clear(request_id)
            reset_request_scope(token)

    def _finalize(
        self,
        *,
        job: Job,
        run: AgentRun,
        message: str,
        messages: list[dict[str, Any]],
        system_prompt: str,
        final_session: str | None,
        final_usage: dict[str, Any],
        results: list[dict[str, Any]],
        emit: Callable[[dict[str, Any]], None],
    ) -> ConversationToolOutcome:
        emit({"type": "model", "status": "active", "label": "组织回答", "detail": "工具阶段已结束，正在基于已获得的来源归纳回答。"})
        synthesis_prompt = (
            system_prompt
            + "\n工具调用阶段已经结束。现在不能再请求任何工具。请直接依据上面的工具结果回答用户；"
              "有可靠来源时附上 URL，来源不足时明确说明不足，不要重复建议用户自行搜索。"
        )
        started = monotonic()
        turn = self.runtime.complete_turn(
            agent_name="conversation_tool_synthesis",
            system_prompt=synthesis_prompt,
            messages=messages,
            tools=[],
            session_id=final_session,
        )
        final_session = turn.session_id or final_session
        final_usage = turn.usage or final_usage
        text = turn.text.strip()
        if not text:
            reply, runtime_result = self.runtime.generate(
                agent_name="conversation_tool_synthesis",
                prompt=(
                    "用户问题：\n" + message + "\n\n已执行工具及结果：\n"
                    + json.dumps(results, ensure_ascii=False)[:60000]
                    + "\n\n直接给出最终回答并附可靠来源 URL。不要请求或描述新的工具调用。"
                ),
                system_prompt=synthesis_prompt,
                output_model=ConversationReply,
                mock_data={"message": "现有来源不足以形成可靠回答。", "intent": "discuss", "suggested_actions": []},
                session_id=final_session,
            )
            text = reply.message.strip()
            final_session = runtime_result.session_id or final_session
            final_usage = runtime_result.usage or final_usage
        self.trace.record(
            run=run,
            stage=run.current_stage or "conversation",
            agent_name="conversation_tool_synthesis",
            event_type="model_turn",
            status=StepStatus.COMPLETED,
            reason=text[:500],
            usage=final_usage,
            duration_ms=max(1, int((monotonic() - started) * 1000)),
        )
        if not text:
            raise HarnessError("empty_model_response", "模型没有生成联网结果摘要", retryable=True)
        emit({"type": "model", "status": "completed", "label": "组织回答", "detail": "已根据现有来源完成回答。"})
        run.session_id = final_session or run.session_id
        self.session.flush()
        return ConversationToolOutcome(text=text, session_id=final_session, usage=final_usage, tool_results=results)
