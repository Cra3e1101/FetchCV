from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient
from urllib.parse import parse_qs

from applyos_agent.interview_tools import (
    _candidate_relevance,
    _role_search_variants,
    _xiaohongshu_note_published_at,
    _xiaohongshu_note_timestamp,
    register_interview_tools,
)
from applyos_api.main import create_app
from applyos_domain.models import AgentRun, Candidate, InterviewBrief, InterviewSource, Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission
from integrations.web import WebClient


PUBLIC_IP = "93.184.216.34"


def _resolver(_host, port, **_):
    return [(2, 1, 6, "", (PUBLIC_IP, port))]


class PublicPageBrowser:
    """Fixture-only browser response from mock HTML, never a production fallback."""
    configured = True

    def __init__(self, web):
        self.web = web

    def open(self, url):
        page = self.web.read_page(url)
        return {"url": page.final_url, "title": page.title, "text": page.text,
                "page_kind": "note", "login_required": False,
                "image_count": 3 if page.images else 0}


def test_xiaohongshu_note_id_provides_publication_date_fallback():
    url = "https://www.xiaohongshu.com/explore/69a58b24000000001a035e5d"

    assert _xiaohongshu_note_timestamp(url) == 1772456740
    assert _xiaohongshu_note_published_at(url).startswith("2026-03-02T21:05:40")


def test_interview_research_tools_capture_verify_deduplicate_and_build_brief(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://www.bing.com/search")
    note_url = "https://www.xiaohongshu.com/explore/note-123?xsec_token=public-share-token"
    evidence = "面试官让我从留存率下降开始拆解指标，并追问如何验证假设"

    def handler(request):
        if request.url.host == "www.bing.com":
            return httpx.Response(200, headers={"content-type": "text/html"}, text=f'<html><body><h3><a href="{note_url}">字节数据分析实习面经</a></h3></body></html>', request=request)
        body = (f"字节跳动 TikTok 数据分析实习生面经。一面主要围绕业务指标。{evidence}。"
                "随后讨论 SQL 窗口函数、A/B 实验、异常波动定位和跨团队沟通。" * 12)
        return httpx.Response(200, headers={"content-type": "text/html"}, text=f"<html><title>TikTok 数据分析面经</title><body><main>{body}</main></body></html>", request=request)

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    permissions = {ToolPermission.READ, ToolPermission.NETWORK_READ, ToolPermission.DRAFT_WRITE}
    with database.session() as session:
        candidate = Candidate(name="Interview candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="数据分析师实习生", jd_raw="负责 TikTok 业务指标分析")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=PublicPageBrowser(web))
        for spec in gateway.registry.values():
            spec.allowed_stages.add(type(next(iter(spec.allowed_stages)))("ready_to_publish"))

        empty = gateway.execute(tool_name="search_interview_knowledge", run=run, arguments={"company": "字节跳动", "business_unit": "TikTok", "role": "数据分析师实习生"}, granted_permissions=permissions, idempotency_key="kb-empty")
        assert empty["data"]["sources"] == []

        discovered = gateway.execute(tool_name="discover_interview_sources", run=run, arguments={"company": "字节跳动", "business_unit": "TikTok", "role": "数据分析师实习生", "max_results": 5}, granted_permissions=permissions, idempotency_key="discover")
        discovered_url = discovered["data"]["results"][0]["url"]
        assert discovered_url == "https://www.xiaohongshu.com/explore/note-123"
        assert "xsec_token" not in discovered_url

        captured = gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": note_url, "company": "字节跳动", "business_unit": "TikTok", "role": "数据分析师实习生"}, granted_permissions=permissions, idempotency_key="capture")
        source_id = captured["data"]["source"]["id"]
        assert evidence in captured["data"]["source"]["raw_text"]

        duplicate = gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": note_url, "company": "字节跳动", "business_unit": "TikTok", "role": "数据分析师实习生"}, granted_permissions=permissions, idempotency_key="capture-again")
        assert duplicate["data"]["source"]["id"] == source_id
        assert session.query(InterviewSource).count() == 1

        analyzed = gateway.execute(tool_name="analyze_interview_source", run=run, arguments={
            "source_id": source_id,
            "summary": "重点考察指标拆解、实验与 SQL。",
            "questions": [
                {"question": "留存率下降如何拆解？", "category": "业务分析", "round": "一面", "evidence_quote": evidence},
                {"question": "编造的问题", "category": "其他", "round": "未注明", "evidence_quote": "原文中不存在的引文"},
            ],
            "tags": ["指标体系", "A/B 实验", "SQL"],
        }, granted_permissions=permissions, idempotency_key="analyze")
        assert len(analyzed["data"]["source"]["questions"]) == 1
        assert analyzed["data"]["rejected_count"] == 1

        brief = gateway.execute(tool_name="build_interview_brief", run=run, arguments={
            "company": "字节跳动", "business_unit": "TikTok", "role": "数据分析师实习生",
            "summary": "现有一篇可核查来源，指标拆解是明确出现的考点。",
            "source_ids": [source_id],
            "common_questions": [{"question": "留存率下降如何拆解？", "category": "业务分析", "source_ids": [source_id], "why_it_matters": "验证业务分析框架", "preparation": "准备指标树和假设验证案例"}],
            "recommendations": [{"title": "准备指标拆解", "action": "用北极星指标—驱动指标—诊断指标组织回答", "rationale": "来源中有明确追问"}],
            "query_terms": ["字节跳动", "TikTok", "数据分析实习", "面经"],
        }, granted_permissions=permissions, idempotency_key="brief")
        assert brief["data"]["common_questions"][0]["frequency"] == 1
        assert brief["data"]["common_questions"][0]["confidence"] == "single_source"
        assert brief["data"]["primary_platform"] == "xiaohongshu"
        assert brief["data"]["primary_source_count"] == 1
        assert brief["data"]["supplemental_source_count"] == 0
        assert brief["data"]["source_count"] == 1
        assert "source_goal" not in brief["data"]
        assert brief["data"]["evidence_status"] == "limited"
        assert brief["data"]["coverage_counts"] == {"same_business_role": 1, "company_role": 0}
        assert session.get(InterviewSource, source_id).metadata_json["coverage_scope"] == "same_business_role"
        assert session.query(InterviewBrief).count() == 1


def test_interview_brief_keeps_other_sites_as_limited_supplemental_sources(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="Primary source gate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        source = InterviewSource(
            candidate_id=candidate.id,
            job_id=job.id,
            platform="nowcoder",
            company=job.company,
            role=job.role,
            title="牛客策略运营面经",
            source_url="https://www.nowcoder.com/discuss/example",
            url_hash="n" * 64,
            raw_text="面试官问如何制定运营策略。",
            content_hash="c" * 64,
            summary="策略运营",
            extracted_questions=[{"question": "如何制定运营策略？", "evidence_quote": "面试官问如何制定运营策略。"}],
            status="analyzed",
        )
        session.add_all([run, source])
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway)

        result = gateway.execute(
            tool_name="build_interview_brief",
            run=run,
            arguments={
                "company": job.company,
                "role": job.role,
                "summary": "来自牛客的补充证据总结",
                "source_ids": [source.id],
                "common_questions": [{
                    "question": "如何制定运营策略？",
                    "source_ids": [source.id],
                    "why_it_matters": "验证策略拆解能力",
                    "preparation": "准备一个完整的策略落地案例",
                }],
            },
            granted_permissions={ToolPermission.DRAFT_WRITE},
            idempotency_key="supplemental-only-brief",
        )

        assert result["data"]["primary_source_count"] == 0
        assert result["data"]["supplemental_source_count"] == 1
        assert result["data"]["evidence_status"] == "limited"
        assert session.query(InterviewBrief).count() == 1


def test_interview_brief_has_no_fixed_source_goal(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="Source goal candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        sources = []
        for index in range(10):
            exact = index < 6
            source = InterviewSource(
                candidate_id=candidate.id,
                job_id=job.id,
                platform="xiaohongshu",
                company=job.company,
                business_unit="两轮车事业部",
                role="策略运营",
                title=f"{'两轮车事业部' if exact else '滴滴'}策略运营面经{index}",
                source_url=f"https://www.xiaohongshu.com/explore/goal-{index}",
                url_hash=f"{index + 1:064x}",
                raw_text=("两轮车事业部策略运营面试问题" if exact else "滴滴策略运营面试问题") * 10,
                content_hash=f"{index + 20:064x}",
                extracted_questions=[{"question": "如何拆解业务指标？", "evidence_quote": "策略运营面试问题"}],
                status="analyzed",
            )
            session.add(source)
            sources.append(source)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway)

        result = gateway.execute(
            tool_name="build_interview_brief",
            run=run,
            arguments={
                "company": job.company,
                "business_unit": "两轮车事业部",
                "role": "策略运营",
                "summary": "引用九篇已核验来源，不等待任意整数目标。",
                "source_ids": [item.id for item in sources[:9]],
                "common_questions": [{
                    "question": "如何拆解业务指标？",
                    "source_ids": [item.id for item in sources[:9]],
                    "why_it_matters": "验证业务分析能力",
                    "preparation": "准备一套指标树与异常归因框架",
                }],
            },
            granted_permissions={ToolPermission.DRAFT_WRITE},
            idempotency_key="brief-without-source-goal",
        )

        assert result["data"]["source_count"] == 9
        assert result["data"]["evidence_status"] == "sufficient"
        assert "source_goal" not in result["data"]
        assert session.query(InterviewBrief).count() == 1


def test_narrow_role_variants_prioritize_functional_title():
    variants = _role_search_variants("两轮车事业部-策略运营")

    assert variants[:3] == ["策略运营", "两轮车事业部-策略运营", "两轮车事业部"]
    assert "运营策略" in variants


def test_interview_candidate_relevance_has_no_count_cap_but_rejects_loose_company_cards():
    assert _candidate_relevance(
        "滴滴出行",
        "两轮车事业部",
        "策略运营",
        "滴滴-两轮车策略运营实习面经",
    )
    assert _candidate_relevance(
        "滴滴出行",
        "两轮车事业部",
        "策略运营",
        "滴滴策略运营凉经",
    )
    assert not _candidate_relevance(
        "滴滴出行",
        "两轮车事业部",
        "策略运营",
        "帮隔壁组招滴滴电单车 To G 实习生",
    )
    assert not _candidate_relevance(
        "滴滴出行",
        "两轮车事业部",
        "策略运营",
        "滴滴数据分析面经",
    )
    assert not _candidate_relevance(
        "滴滴出行",
        "两轮车事业部",
        "策略运营",
        "求问滴滴国际事业群策略运营有无面经",
    )


def test_interview_discovery_expands_narrow_product_role_and_keeps_share_links(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://www.bing.com/search")
    share_url = "https://xhslink.com/o/public-note"
    seen_queries = []

    def handler(request):
        query = parse_qs(request.url.query.decode()).get("q", [""])[0]
        seen_queries.append(query)
        result = f'<h3><a href="{share_url}">抖音 AI 产品经理面经</a></h3>' if "AI产品经理" in query else "<p>no exact result</p>"
        return httpx.Response(200, headers={"content-type": "text/html"}, text=f"<html><body>{result}</body></html>", request=request)

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Expanded search candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="AI产品实习生-抖音电商")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web)
        result = gateway.execute(
            tool_name="discover_interview_sources",
            run=run,
            arguments={"company": job.company, "role": job.role, "query_terms": ["AI产品经理"], "max_results": 5},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="expanded-discovery",
        )

    assert any("AI产品实习生-抖音电商" in query for query in seen_queries)
    assert any("AI产品经理" in query for query in seen_queries)
    assert "AI产品经理" in result["data"]["role_variants"]
    assert result["data"]["results"] == [{
        "title": "抖音 AI 产品经理面经",
        "url": share_url,
        "platform": "xiaohongshu",
        "scope": "company_role",
        "published_at": "",
    }]


def test_interview_discovery_prefers_xiaohongshu_site_candidates(database, tmp_path):
    urls = [
        "https://www.xiaohongshu.com/discovery/item/6a5e4c63000000001302d645",
        "https://www.xiaohongshu.com/discovery/item/6a5b612a000000000503ba9f",
    ]

    class BrowserStub:
        configured = True

        def __init__(self):
            self.opened = []

        def open(self, url):
            self.opened.append(url)
            return {
                "login_required": False,
                "candidates": [
                    {"url": urls[0], "title": "字节 AI 产品实习生面经"},
                    {"url": urls[1], "title": "抖音 AI 产品经理实习一面"},
                ],
            }

    browser = BrowserStub()
    web = WebClient(transport=httpx.MockTransport(lambda request: httpx.Response(500, request=request)), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="XHS discovery candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="AI产品实习生-抖音电商")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=browser)
        result = gateway.execute(
            tool_name="discover_interview_sources",
            run=run,
            arguments={"company": job.company, "role": job.role, "max_results": 2},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="xhs-site-discovery",
        )

    assert browser.opened
    first_keyword = parse_qs(httpx.URL(browser.opened[0]).query.decode())["keyword"][0]
    assert "AI产品实习生" in first_keyword
    assert "抖音电商" in first_keyword
    assert [item["url"] for item in result["data"]["results"]] == urls
    assert result["data"]["providers"] == ["xiaohongshu-anonymous-browser"]
    assert result["data"]["anonymous_public_mode"] is True
    assert result["data"]["account_session_used"] is False


def test_interview_discovery_ignores_legacy_total_cap_and_then_adds_nowcoder(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://www.bing.com/search")
    xhs_urls = [
        f"https://www.xiaohongshu.com/explore/{index + 1:024x}"
        for index in range(12)
    ]
    nowcoder_url = "https://www.nowcoder.com/discuss/123456789"

    class BrowserStub:
        configured = True

        def open(self, _url):
            return {
                "login_required": False,
                "candidates": [
                    {"url": url, "title": f"滴滴两轮车策略运营面经 {index + 1}"}
                    for index, url in enumerate(xhs_urls)
                ],
            }

    def handler(request):
        query = parse_qs(request.url.query.decode()).get("q", [""])[0]
        result = (
            f'<h3><a href="{nowcoder_url}">滴滴两轮车策略运营面经补充</a></h3>'
            if "nowcoder.com" in query
            else "<p>no result</p>"
        )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=f"<html><body>{result}</body></html>",
            request=request,
        )

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="No fixed discovery cap")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(
            candidate_id=candidate.id,
            job_id=job.id,
            run_type="conversation",
            current_stage="ready_to_publish",
        )
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=BrowserStub())
        result = gateway.execute(
            tool_name="discover_interview_sources",
            run=run,
            arguments={
                "company": job.company,
                "business_unit": "两轮车事业部",
                "role": "策略运营",
                "max_results": 10,
            },
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="discovery-legacy-limit-is-ignored",
        )

    assert result["data"]["primary_source_count"] == 12
    assert result["data"]["supplemental_source_count"] == 1
    assert len(result["data"]["results"]) == 13
    assert result["data"]["results"][-1]["url"] == nowcoder_url
    assert result["data"]["results"][-1]["platform"] == "nowcoder"
    assert result["data"]["result_limit"] is None
    assert result["data"]["legacy_requested_limit"] == 10


def test_interview_discovery_uses_nowcoder_site_search_as_supplement(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://www.bing.com/search")
    relevant_url = "https://www.nowcoder.com/discuss/796355474110054400?sourceSSR=search"

    class BrowserStub:
        configured = False

    def handler(request):
        if request.url.host == "www.nowcoder.com":
            return httpx.Response(
                200,
                headers={"content-type": "text/html"},
                text=(
                    "<html><body>"
                    f'<a href="{relevant_url}">滴滴两轮车策略运营面经</a>'
                    '<a href="https://www.nowcoder.com/discuss/111?sourceSSR=search">滴滴数据分析面经</a>'
                    "</body></html>"
                ),
                request=request,
            )
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<html><body>no public result</body></html>",
            request=request,
        )

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Nowcoder site search")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(
            candidate_id=candidate.id,
            job_id=job.id,
            run_type="conversation",
            current_stage="ready_to_publish",
        )
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=BrowserStub())
        result = gateway.execute(
            tool_name="discover_interview_sources",
            run=run,
            arguments={
                "company": job.company,
                "business_unit": "两轮车事业部",
                "role": "策略运营",
            },
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="nowcoder-site-search",
        )

    assert result["data"]["primary_source_count"] == 0
    assert result["data"]["supplemental_source_count"] == 1
    assert result["data"]["nowcoder_site_source_count"] == 1
    assert "nowcoder-site-search" in result["data"]["providers"]
    assert result["data"]["results"] == [{
        "title": "滴滴两轮车策略运营面经",
        "url": "https://www.nowcoder.com/discuss/796355474110054400",
        "platform": "nowcoder",
        "scope": "same_business_role",
        "published_at": "",
    }]


def test_interview_discovery_keeps_public_cards_rendered_before_login_overlay(database, tmp_path):
    note_url = "https://www.xiaohongshu.com/explore/public-card-before-login"

    class BrowserStub:
        configured = True

        def open(self, _url):
            return {
                "login_required": True,
                "user_action": "login",
                "candidates": [{"url": note_url, "title": "滴滴两轮车策略运营面经"}],
            }

    web = WebClient(transport=httpx.MockTransport(lambda request: httpx.Response(500, request=request)), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Public card candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=BrowserStub())
        result = gateway.execute(
            tool_name="discover_interview_sources",
            run=run,
            arguments={"company": job.company, "role": job.role, "max_results": 2},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="public-card-before-login",
        )

    assert result["data"]["results"] == [{
        "title": "滴滴两轮车策略运营面经",
        "url": note_url,
        "platform": "xiaohongshu",
        "scope": "same_business_role",
        "published_at": "",
    }]
    assert result["data"]["providers"] == ["xiaohongshu-anonymous-browser"]
    assert result["data"]["public_access_stopped"] is True
    assert result["data"]["public_access_reason"] == "login"


def test_capture_prefers_rendered_xiaohongshu_note_over_long_static_shell(database, tmp_path):
    note_url = "https://www.xiaohongshu.com/discovery/item/6a5b612a000000000503ba9f?xsec_token=temporary-share"
    evidence = "关于项目与架构深挖，面试官追问为什么使用 Agent，以及模型和中转站如何选择"

    class BrowserStub:
        configured = True

        def open(self, _url):
            return {
                "url": note_url,
                "title": "抖子AI产品经理实习一面（90分钟嘴巴起沫版）",
                "description": "字节跳动 AI 产品经理实习面试复盘",
                "text": (f"刚面完字节的AI产品经理实习一面。这次面试问得很细。{evidence}。"
                         "随后继续追问产品sense、广告投放素材优化、数据飞轮与压力问题。" * 8),
                "note_ready": True,
                "page_kind": "note",
                "image_count": 3,
                "login_required": False,
            }

    def handler(request):
        shell = "SQL刷题 课程目录 软件下载 社区公约 推荐内容 " * 200
        return httpx.Response(200, headers={"content-type": "text/html"}, text=f"<html><body>{shell}</body></html>", request=request)

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Rendered note candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="AI产品实习生-抖音电商")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=BrowserStub())
        result = gateway.execute(
            tool_name="capture_interview_source",
            run=run,
            arguments={"url": note_url, "company": job.company, "role": job.role},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="capture-rendered-xhs-note",
        )
        source = session.get(InterviewSource, result["data"]["source"]["id"])

    assert evidence in source.raw_text
    assert "SQL刷题" not in source.raw_text
    assert source.metadata_json["provider"] == "xiaohongshu-anonymous-browser"
    assert source.metadata_json["anonymous_public_mode"] is True
    assert source.metadata_json["account_session_used"] is False
    assert source.metadata_json["image_count"] == 3
    assert "xsec_token" not in source.source_url


def test_capture_never_persists_xiaohongshu_404_or_verification_pages(database, tmp_path):
    note_url = "https://www.xiaohongshu.com/explore/unavailable-note"

    class BrowserStub:
        configured = True

        def open(self, _url):
            return {
                "url": "https://www.xiaohongshu.com/404?error_msg=当前笔记暂时无法浏览",
                "title": "小红书 - 你访问的页面不见了",
                "text": ("当前笔记暂时无法浏览 redirectPath=/explore/unavailable-note 面试经验 " * 20),
                "note_ready": False,
                "page_kind": "",
                "login_required": False,
            }

    def handler(request):
        body = "当前笔记暂时无法浏览 redirectPath=/explore/unavailable-note 面试经验 " * 20
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=f"<html><head><title>小红书 - 你访问的页面不见了</title></head><body>{body}</body></html>",
            request=request,
        )

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Rejected 404 candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="两轮车事业部-策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=BrowserStub())

        with pytest.raises(HarnessError) as error:
            gateway.execute(
                tool_name="capture_interview_source",
                run=run,
                arguments={"url": note_url, "company": job.company, "role": job.role},
                granted_permissions={ToolPermission.NETWORK_READ},
                idempotency_key="reject-xhs-404",
            )

        assert error.value.code == "interview_source_unreadable"
        assert session.query(InterviewSource).count() == 0


def test_capture_upgrades_public_xhs_share_http_and_marks_image_evidence(database, tmp_path):
    share_url = "http://xhslink.com/o/public-note"
    note_url = "https://www.xiaohongshu.com/discovery/item/public-note"
    requested = []

    def handler(request):
        requested.append(str(request.url))
        if request.url.host == "xhslink.com":
            assert request.url.scheme == "https"
            return httpx.Response(302, headers={"location": note_url}, request=request)
        body = "1/3 抖音 AI产品实习生面经。深挖简历、AI 产品理解与案例分析，具体问题见图片。" * 12
        return httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text=f'<html><head><title>抖音 AI产品实习生 面经</title><meta property="og:image" content="https://sns-img.example.com/note-1.jpg"></head><body><main>{body}</main></body></html>',
            request=request,
        )

    web = WebClient(transport=httpx.MockTransport(handler), resolver=_resolver)
    with database.session() as session:
        candidate = Candidate(name="Share link candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="AI产品实习生-抖音电商")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=PublicPageBrowser(web))
        result = gateway.execute(
            tool_name="capture_interview_source",
            run=run,
            arguments={"url": share_url, "company": job.company, "role": job.role},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="capture-http-share",
        )
        source = session.get(InterviewSource, result["data"]["source"]["id"])
        assert source.source_url == note_url
        assert source.metadata_json["submitted_url"].startswith("https://xhslink.com/")
        assert source.metadata_json["image_count"] == 3
        assert source.metadata_json["image_evidence_pending"] is True
        assert "xsec_token" not in source.source_url

    assert requested[0].startswith("https://xhslink.com/")
    assert result["data"]["image_evidence_pending"] is True


def test_xiaohongshu_temporary_access_tokens_are_never_persisted():
    redacted = WebClient.redact_url(
        "https://www.xiaohongshu.com/discovery/item/public-note?xsec_token=private&source=share"
    )

    assert "xsec_token" not in redacted
    assert "private" not in redacted
    assert "source=share" in redacted


def test_interview_knowledge_is_returned_in_candidate_and_job_views(database):
    with database.session() as session:
        candidate = Candidate(name="Knowledge owner")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="数据分析师实习生")
        session.add(job)
        session.flush()
        source = InterviewSource(candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role, title="面经", source_url="https://www.xiaohongshu.com/explore/a", url_hash="a" * 64, raw_text="面试问题正文", content_hash="b" * 64, summary="指标分析", status="analyzed")
        brief = InterviewBrief(candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role, summary="岗位面试简报", source_ids=[])
        session.add_all([source, brief])
        candidate_id, job_id = candidate.id, job.id

    with TestClient(create_app(database)) as client:
        library = client.get(f"/api/candidates/{candidate_id}/library").json()
        assert library["interview_sources"][0]["title"] == "面经"
        assert "raw_text" not in library["interview_sources"][0]
        assert library["interview_sources"][0]["text_preview"] == "面试问题正文"
        assert library["interview_briefs"][0]["summary"] == "岗位面试简报"
        workspace = client.get(f"/api/jobs/{job_id}/workspace").json()
        assert workspace["interview_sources"][0]["source_url"].startswith("https://www.xiaohongshu.com")
        assert workspace["interview_briefs"][0]["company"] == "字节跳动"
        source_detail = client.get(f"/api/interview-sources/{source.id}").json()
        assert source_detail["raw_text"] == "面试问题正文"


def test_deleting_an_interview_source_recalculates_brief_evidence(database):
    with database.session() as session:
        candidate = Candidate(name="Evidence owner")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="字节跳动", role="数据分析师实习生")
        session.add(job)
        session.flush()
        first = InterviewSource(candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role, title="面经一", source_url="https://www.xiaohongshu.com/explore/one", url_hash="1" * 64, raw_text="问题一", content_hash="a" * 64, status="analyzed")
        second = InterviewSource(candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role, title="面经二", source_url="https://www.xiaohongshu.com/explore/two", url_hash="2" * 64, raw_text="问题一", content_hash="b" * 64, status="analyzed")
        session.add_all([first, second])
        session.flush()
        brief = InterviewBrief(
            candidate_id=candidate.id,
            job_id=job.id,
            company=job.company,
            role=job.role,
            summary="两篇来源",
            source_ids=[first.id, second.id],
            common_questions=[{"question": "如何拆解指标？", "source_ids": [first.id, second.id], "frequency": 2, "confidence": "recurring"}],
            metadata_json={"recurring_question_count": 1},
        )
        session.add(brief)
        session.flush()
        source_id, brief_id = first.id, brief.id

    with TestClient(create_app(database)) as client:
        response = client.delete(f"/api/interview-sources/{source_id}")
        assert response.status_code == 204

    with database.session() as session:
        updated = session.get(InterviewBrief, brief_id)
        assert len(updated.source_ids) == 1
        assert updated.common_questions[0]["frequency"] == 1
        assert updated.common_questions[0]["confidence"] == "single_source"
        assert updated.metadata_json["recurring_question_count"] == 0
