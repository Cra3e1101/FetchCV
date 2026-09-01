from __future__ import annotations

import json

import httpx
import pytest
from sqlalchemy import select

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.engine import AgentEngine
from applyos_agent.schemas import RuntimeToolCall, RuntimeTurnResult
from applyos_agent.tools import register_pipeline_tools
from applyos_agent.web_tools import register_web_tools
from applyos_domain.enums import StepStatus
from applyos_domain.models import AgentRunStep, Approval, Candidate, Fact, Job, MaterialAsset
from applyos_harness.approval import ApprovalService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway
from applyos_harness.pipeline import MockPipeline
from integrations.web import JobPostingImporter, WebClient


PUBLIC_IP = "93.184.216.34"


def _resolver(host, port, **_):
    return [(2, 1, 6, "", (PUBLIC_IP, port))]


def _job_html(*, title="数据分析实习生", company="示例科技", description=None):
    description = description or "负责业务指标分析、数据清洗和专题研究；使用 SQL 与 Python 完成分析，并与产品和运营团队协作推动策略落地。"
    payload = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": title,
        "hiringOrganization": {"@type": "Organization", "name": company},
        "jobLocation": {"@type": "Place", "address": {"addressLocality": "北京", "addressCountry": "中国"}},
        "description": f"<p>{description}</p>",
        "datePosted": "2026-07-18",
    }
    return f"""<!doctype html><html><head><title>{title} | {company}</title><meta name="description" content="招聘岗位"><script type="application/ld+json">{json.dumps(payload, ensure_ascii=False)}</script><script>ignore()</script></head><body><nav>导航</nav><h1>{title}</h1><main><p>{description}</p></main></body></html>"""


def _client(handler):
    return WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)


def test_web_client_blocks_ssrf_credentials_insecure_urls_and_ports():
    client = WebClient(resolver=_resolver)
    denied = [
        "http://example.com/job",
        "https://user:secret@example.com/job",
        "https://localhost/job",
        "https://127.0.0.1/job",
        "https://10.0.0.8/job",
        "https://example.com:8443/job",
    ]
    for url in denied:
        with pytest.raises(HarnessError):
            client.validate_url(url)
    assert client.validate_url("https://example.com/job?x=1") == "https://example.com/job?x=1"
    assert client.validate_url("https://example.com/app#/job/abc-123", preserve_fragment=True) == "https://example.com/app#/job/abc-123"
    assert client.validate_url("https://example.com/app#token=should-not-survive", preserve_fragment=True) == "https://example.com/app"


def test_web_client_revalidates_redirects_and_limits_response_size():
    def private_redirect(request):
        return httpx.Response(302, headers={"location": "https://127.0.0.1/private"}, request=request)

    with pytest.raises(HarnessError) as redirect_error:
        _client(private_redirect).read_page("https://example.com/start")
    assert redirect_error.value.code == "web_private_address_denied"

    def oversized(request):
        return httpx.Response(200, headers={"content-type": "text/html", "content-length": str(3 * 1024 * 1024)}, content=b"x", request=request)

    with pytest.raises(HarnessError) as size_error:
        _client(oversized).read_page("https://example.com/large")
    assert size_error.value.code == "web_response_too_large"


def test_web_client_removes_sensitive_query_values_before_persisting_results():
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, text="<html><title>Job</title><body>" + ("岗位正文 " * 30) + "</body></html>", request=request)

    page = _client(handler).read_page("https://jobs.example.com/123?job=42&token=never-store&signature=also-secret")
    assert page.final_url == "https://jobs.example.com/123?job=42"
    assert "never-store" not in json.dumps(page.__dict__)
    assert "also-secret" not in json.dumps(page.__dict__)


def test_web_page_read_and_search_return_public_sources(monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://search.example.com/html/")

    def handler(request):
        if request.url.host == "search.example.com":
            html = """<html><body><a href="/about">About</a><a class="result__a" href="/l/?uddg=https%3A%2F%2Fjobs.example.com%2F123">数据分析实习生</a><a href="https://10.0.0.2/private">private</a></body></html>"""
            return httpx.Response(200, headers={"content-type": "text/html"}, text=html, request=request)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=_job_html(), request=request)

    client = _client(handler)
    page = client.read_page("https://jobs.example.com/123")
    assert page.title == "数据分析实习生 | 示例科技"
    assert page.headings == ["数据分析实习生"]
    assert "ignore()" not in page.text
    assert page.content_sha256
    results = client.search("示例科技 数据分析", max_results=5)
    assert [(item.title, item.url) for item in results] == [("数据分析实习生", "https://jobs.example.com/123")]


def test_job_posting_import_uses_json_ld_and_never_silently_overwrites(database):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html; charset=utf-8"}, text=_job_html(), request=request)

    with database.session() as session:
        candidate = Candidate(name="网页导入候选人")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="待导入", role="待识别", source_url="https://jobs.example.com/123")
        session.add(job)
        session.flush()
        importer = JobPostingImporter(session, web_client=_client(handler))

        imported = importer.import_into_job(job)
        assert imported["imported"] is True
        assert job.company == "示例科技"
        assert job.role == "数据分析实习生"
        assert job.location == "北京 中国"
        assert "SQL" in job.jd_raw
        assert job.source_type == "web_import"
        material = session.get(MaterialAsset, imported["material_id"])
        assert material.metadata_json["structured_data"] is True

        def changed_handler(request):
            changed = "负责产品需求分析、用户研究、原型设计和跨团队项目推进，持续跟踪上线后的用户反馈并推动产品迭代。"
            return httpx.Response(200, headers={"content-type": "text/html"}, text=_job_html(title="产品经理", description=changed), request=request)

        conflict = JobPostingImporter(session, web_client=_client(changed_handler)).import_into_job(job)
        assert conflict["conflict"] is True
        assert job.role == "数据分析实习生"
        assert len(list(session.scalars(select(MaterialAsset).where(MaterialAsset.candidate_id == candidate.id)).all())) == 1


class ImportFirstRuntime:
    def __init__(self):
        self.turn = 0

    def complete_turn(self, *, tools, session_id=None, **_):
        self.turn += 1
        available = [item.name for item in tools]
        if self.turn == 1:
            selected = "validate_run_input"
        elif self.turn == 2 and "import_job_posting" in available:
            selected = "import_job_posting"
        else:
            selected = next(name for name in available if name not in {"inspect_job_context", "search_web", "read_web_page", "import_job_posting"})
        return RuntimeTurnResult(
            tool_calls=[RuntimeToolCall(id=f"web-{self.turn}", name=selected, arguments={})],
            finish_reason="tool_calls",
            session_id=session_id,
            usage={"runtime": "scripted_web"},
        )


class ImportConflictRuntime(ImportFirstRuntime):
    def complete_turn(self, *, tools, session_id=None, **_):
        self.turn += 1
        available = [item.name for item in tools]
        selected = "import_job_posting" if self.turn <= 2 else next(
            name for name in available if name not in {"inspect_job_context", "search_web", "read_web_page", "import_job_posting"}
        )
        return RuntimeTurnResult(
            tool_calls=[RuntimeToolCall(id=f"conflict-{self.turn}", name=selected, arguments={})],
            finish_reason="tool_calls",
            session_id=session_id,
            usage={"runtime": "scripted_web_conflict"},
        )


def test_agent_recovers_from_empty_jd_imports_page_and_continues(database, tmp_path):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, text=_job_html(), request=request)

    with database.session() as session:
        candidate = Candidate(name="Agent 网页候选人")
        session.add(candidate)
        session.flush()
        fact = Fact(candidate_id=candidate.id, category="experience", content="使用 SQL 完成业务数据分析", verified=True, allowed_outputs=["resume", "portfolio"])
        job = Job(candidate_id=candidate.id, company="待导入", role="待识别", jd_raw="", source_url="https://jobs.example.com/123")
        session.add_all([fact, job])
        session.flush()
        pipeline = MockPipeline(session)
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_pipeline_tools(gateway, pipeline)
        register_web_tools(gateway, web_client=_client(handler))
        settings = AgentSettings(runtime=RuntimeMode.MOCK, model="scripted", workspace_root=tmp_path, max_turns=4, allow_mock_runtime=True)
        engine = AgentEngine(session, runtime=ImportFirstRuntime(), pipeline=pipeline, gateway=gateway, settings=settings)
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="web-import-agent")

        outcome = engine.run(run)
        assert outcome.stop_reason == "approval_required", (run.current_stage, run.error, outcome.tool_results)
        assert run.current_stage == "awaiting_fact_review"
        assert job.company == "示例科技"
        assert job.role == "数据分析实习生"
        steps = list(session.scalars(select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence)).all())
        assert any(step.error_code == "job_page_import_required" for step in steps)
        imported_step = next(step for step in steps if step.event_type == "tool" and step.status == StepStatus.COMPLETED and step.tool_calls[0]["tool_name"] == "import_job_posting")
        assert imported_step.tool_calls[0]["result"]["data"]["posting"]["source_url"] == "https://jobs.example.com/123"


def test_agent_requires_real_approval_before_replacing_existing_jd(database, tmp_path):
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, text=_job_html(), request=request)

    with database.session() as session:
        candidate = Candidate(name="JD 冲突候选人")
        session.add(candidate)
        session.flush()
        fact = Fact(candidate_id=candidate.id, category="experience", content="使用 SQL 完成业务数据分析", verified=True, allowed_outputs=["resume", "portfolio"])
        old_jd = "这是用户已经手动填写的岗位描述，包含原始职责、岗位要求和其他需要保留核对的信息，不允许 Agent 在没有确认时自动覆盖。"
        job = Job(candidate_id=candidate.id, company="已有公司", role="已有岗位", jd_raw=old_jd, source_url="https://jobs.example.com/123")
        session.add_all([fact, job])
        session.flush()
        pipeline = MockPipeline(session)
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_pipeline_tools(gateway, pipeline)
        register_web_tools(gateway, web_client=_client(handler))
        settings = AgentSettings(runtime=RuntimeMode.MOCK, model="scripted", workspace_root=tmp_path, max_turns=4, allow_mock_runtime=True)
        engine = AgentEngine(session, runtime=ImportConflictRuntime(), pipeline=pipeline, gateway=gateway, settings=settings)
        run = engine.create_run(candidate_id=candidate.id, job_id=job.id, idempotency_key="web-conflict-agent")

        paused = engine.run(run)
        assert paused.stop_reason == "user_action_required"
        assert job.jd_raw == old_jd
        approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "replace_job_description"))
        assert approval is not None
        ApprovalService(session).approve_action(approval_id=approval.id, approved_by="tester")

        resumed = engine.run(run)
        assert resumed.stop_reason == "approval_required"
        assert "SQL" in job.jd_raw
        assert job.jd_raw != old_jd
