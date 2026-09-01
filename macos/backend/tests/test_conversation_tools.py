from __future__ import annotations

import json

import httpx

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.conversation_tools import ConversationToolAgent, build_conversation_gateway
from applyos_agent.schemas import RuntimeToolCall, RuntimeTurnResult
from applyos_agent.web_tools import register_web_tools
from applyos_domain.models import AgentRun, Candidate, Job
from applyos_harness.permissions import ToolGateway
from applyos_harness.state_machine import PipelineStage
from integrations.web import WebClient


PUBLIC_IP = "93.184.216.34"


def resolver(_host, port, **_):
    return [(2, 1, 6, "", (PUBLIC_IP, port))]


class SearchThenReadRuntime:
    def __init__(self):
        self.turn = 0
        self.seen_tools = []
        self.messages = []

    def complete_turn(self, *, tools, messages, session_id=None, **_):
        self.turn += 1
        self.seen_tools.append([item.name for item in tools])
        self.messages = messages
        if self.turn == 1:
            return RuntimeTurnResult(
                tool_calls=[RuntimeToolCall(id="search-1", name="search_web", arguments={"query": "北京 今天天气", "max_results": 3})],
                finish_reason="tool_calls",
                session_id=session_id,
                usage={"runtime": "scripted"},
            )
        if self.turn == 2:
            return RuntimeTurnResult(
                tool_calls=[RuntimeToolCall(id="read-1", name="read_web_page", arguments={"url": "https://weather.example.com/beijing"})],
                finish_reason="tool_calls",
                session_id=session_id,
                usage={"runtime": "scripted"},
            )
        return RuntimeTurnResult(
            text="北京今天晴，最高 31°C。来源：https://weather.example.com/beijing",
            finish_reason="stop",
            session_id="conversation-session",
            usage={"runtime": "scripted"},
        )


class RepeatingSearchRuntime:
    def __init__(self):
        self.calls = 0

    def complete_turn(self, *, tools, session_id=None, **_):
        self.calls += 1
        if tools:
            return RuntimeTurnResult(
                tool_calls=[RuntimeToolCall(id=f"search-{self.calls}", name="search_web", arguments={"query": "北京天气", "max_results": 3})],
                finish_reason="tool_calls",
                session_id=session_id,
                usage={"runtime": "repeating"},
            )
        return RuntimeTurnResult(
            text="根据现有搜索来源，北京天气信息可查看中国天气网。",
            finish_reason="stop",
            session_id=session_id,
            usage={"runtime": "repeating"},
        )


class DirectAnswerRuntime:
    def __init__(self):
        self.tool_names = []

    def complete_turn(self, *, tools, session_id=None, **_):
        self.tool_names = [item.name for item in tools]
        return RuntimeTurnResult(text="RAG 是一种结合检索与生成的架构。", finish_reason="stop", session_id=session_id, usage={"runtime": "direct"})


class SemanticContextRuntime:
    def __init__(self):
        self.turn = 0

    def complete_turn(self, *, tools, messages, session_id=None, **_):
        self.turn += 1
        if self.turn == 1:
            assert "read_job_workspace_context" in [item.name for item in tools]
            return RuntimeTurnResult(
                tool_calls=[RuntimeToolCall(id="context-1", name="read_job_workspace_context", arguments={"sections": ["job", "facts"]})],
                finish_reason="tool_calls",
                session_id=session_id,
                usage={"runtime": "semantic_context"},
            )
        tool_message = next(item for item in messages if item.get("role") == "tool")
        assert "Analyze product metrics" in tool_message["content"]
        return RuntimeTurnResult(text="我会沿用当前方向，优先突出指标分析。", finish_reason="stop", session_id=session_id, usage={"runtime": "semantic_context"})


def test_general_question_still_reaches_semantic_agent_with_tools(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="General user")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst", jd_raw="Analyze product metrics")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage=PipelineStage.CREATED.value)
        session.add(run)
        session.flush()
        runtime = DirectAnswerRuntime()
        outcome = ConversationToolAgent(
            session,
            settings=AgentSettings(runtime=RuntimeMode.COMPATIBLE, model="test", workspace_root=tmp_path, api_key_configured=True, provider_base_url="https://api.example.com", provider_api_key="secret"),
            runtime=runtime,
            gateway=build_conversation_gateway(session, AgentSettings(workspace_root=tmp_path)),
        ).run(job=job, run=run, message="解释一下什么是 RAG", context="{}", thinking_level="balanced", request_id="direct-request")

        assert outcome.text.startswith("RAG")
        assert outcome.tool_results == []
        assert "search_web" in runtime.tool_names
        assert "read_job_workspace_context" in runtime.tool_names


def test_model_can_request_context_from_implicit_semantics(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="Context user")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst", jd_raw="Analyze product metrics")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage=PipelineStage.CREATED.value)
        session.add(run)
        session.flush()
        settings = AgentSettings(runtime=RuntimeMode.COMPATIBLE, model="test", workspace_root=tmp_path, api_key_configured=True, provider_base_url="https://api.example.com", provider_api_key="secret")
        outcome = ConversationToolAgent(session, settings=settings, runtime=SemanticContextRuntime()).run(
            job=job,
            run=run,
            message="照这个方向继续调整一下",
            context='{"recent_messages": []}',
            thinking_level="balanced",
            request_id="implicit-context-request",
        )

        assert outcome.text.startswith("我会沿用")
        assert [item["tool_name"] for item in outcome.tool_results] == ["read_job_workspace_context"]


def test_conversation_agent_searches_reads_and_returns_sources(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://search.example.com/")

    def handler(request):
        if request.url.host == "search.example.com":
            return httpx.Response(200, headers={"content-type": "text/html"}, text='<a class="result__a" href="https://weather.example.com/beijing">北京天气</a>', request=request)
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<html><title>北京天气</title><body>北京今天晴，最高 31°C。</body></html>", request=request)

    with database.session() as session:
        candidate = Candidate(name="Weather user")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst", jd_raw="Analyze data")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage=PipelineStage.CREATED.value)
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_web_tools(gateway, web_client=WebClient(transport=httpx.MockTransport(handler), resolver=resolver))
        gateway.registry.pop("import_job_posting")
        for spec in gateway.registry.values():
            spec.allowed_stages = set(PipelineStage)
        runtime = SearchThenReadRuntime()
        settings = AgentSettings(runtime=RuntimeMode.COMPATIBLE, model="test", workspace_root=tmp_path, api_key_configured=True, provider_base_url="https://api.example.com", provider_api_key="secret")
        events = []

        outcome = ConversationToolAgent(session, settings=settings, runtime=runtime, gateway=gateway).run(
            job=job,
            run=run,
            message="北京今天的天气",
            context=json.dumps({"recent_messages": []}),
            thinking_level="balanced",
            request_id="weather-request",
            on_event=events.append,
        )

        assert [item["tool_name"] for item in outcome.tool_results] == ["search_web", "read_web_page"]
        assert "31°C" in outcome.text
        assert "https://weather.example.com/beijing" in outcome.text
        assert "search_web" in runtime.seen_tools[0]
        assert "open_browser_page" not in runtime.seen_tools[0]
        assert any(item["type"] == "tool" and item["label"] == "搜索网页" for item in events)
        tool_messages = [item for item in runtime.messages if item.get("role") == "tool"]
        assert "北京今天晴" in tool_messages[-1]["content"]


def test_repeated_tool_call_is_synthesized_instead_of_failing(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://search.example.com/")

    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, text='<a class="result__a" href="https://weather.example.com/beijing">北京天气</a>', request=request)

    with database.session() as session:
        candidate = Candidate(name="Loop user")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage=PipelineStage.CREATED.value)
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_web_tools(gateway, web_client=WebClient(transport=httpx.MockTransport(handler), resolver=resolver))
        gateway.registry.pop("import_job_posting")
        for spec in gateway.registry.values():
            spec.allowed_stages = set(PipelineStage)
        runtime = RepeatingSearchRuntime()
        settings = AgentSettings(runtime=RuntimeMode.COMPATIBLE, model="test", workspace_root=tmp_path, api_key_configured=True, provider_base_url="https://api.example.com", provider_api_key="secret")

        outcome = ConversationToolAgent(session, settings=settings, runtime=runtime, gateway=gateway).run(
            job=job,
            run=run,
            message="北京天气",
            context="{}",
            thinking_level="balanced",
            request_id="repeating-request",
        )

        assert runtime.calls == 3
        assert len(outcome.tool_results) == 1
        assert "中国天气网" in outcome.text
