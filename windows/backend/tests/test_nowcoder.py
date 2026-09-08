import json

import httpx
import pytest

from integrations.web import WebClient
from integrations.web.nowcoder import canonical_nowcoder_url, extract_nowcoder
from applyos_agent.interview_tools import register_interview_tools
from applyos_domain.models import Candidate, Job, AgentRun, InterviewSource
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_harness.errors import HarnessError


def html(state):
    return '<html><meta charset="utf-8"><body><aside>推荐：无关面试题</aside><script>window.__INITIAL_STATE__=' + json.dumps(state, ensure_ascii=False) + ';</script></body></html>'


def post_state(post_id="123"):
    return {"prefetchData": {"2": {"contentId": post_id, "ssrCommonData": {
        "contentData": {"title": "远山科技产品经理面经", "content": "<p>一面：请说明需求分析的方法。</p>" + "<p>追问：如何评估需求优先级，并向团队解释产品决策？</p>" * 8, "createTime": 1631352859000},
        "commentListFirst": [{"content": "评论里的无关问题不能入库"}],
        "similarRecommend": [{"content": "推荐的其他公司面试问题"}],
    }}}}


def search_state(page=1, total=40):
    return {"app": {"180": {"current": page, "size": 20, "total": total, "records": [
        {"data": {"contentData": {"id": str(100 + page), "title": "远山科技产品经理面经", "desc": "产品面试经验"}}},
        {"data": {"momentData": {"uuid": "a" * 32, "title": "远山科技产品面试复盘"}}},
    ]}}}


@pytest.mark.parametrize("url", ["http://m.nowcoder.com/discuss/123/?sourceSSR=search#comments", "https://www.nowcoder.com/discuss/123"])
def test_canonical_mobile_and_tracking_links(url):
    assert canonical_nowcoder_url(url) == "https://www.nowcoder.com/discuss/123"


@pytest.mark.parametrize("url", ["https://www.nowcoder.com/discuss/tag/123", "https://www.nowcoder.com/discuss/experience", "https://nowcoder.com.evil.test/discuss/123", "https://user:secret@nowcoder.com/discuss/123", "https://nowcoder.com:bad/discuss/123"])
def test_non_post_links_are_rejected(url):
    assert canonical_nowcoder_url(url) == ""


def test_extracts_only_current_post_and_publication_time():
    value = extract_nowcoder(html(post_state()), "https://www.nowcoder.com/discuss/123")
    assert "需求优先级" in value["text"]
    assert "无关问题" not in value["text"]
    assert "其他公司" not in value["text"]
    assert value["published_at"] == "2021-09-11T17:34:19+08:00"
    assert extract_nowcoder(html(post_state()), "https://www.nowcoder.com/discuss/999")["text"] == ""


def test_search_extracts_posts_and_moments_with_real_pagination():
    value = extract_nowcoder(html(search_state()), "https://www.nowcoder.com/search/all?query=test&type=all")
    assert len(value["links"]) == 2
    assert value["links"][1]["url"].endswith("/feed/main/detail/" + "a" * 32)
    assert value["next_url"].endswith("type=all&page=2")
    last = extract_nowcoder(html(search_state(2)), "https://www.nowcoder.com/search/all?query=test&type=all&page=2")
    assert last["next_url"] == ""


def test_malformed_state_and_empty_shell_do_not_become_post_evidence():
    for value in ["<html>登录</html>", html({"prefetchData": [1, 2]}), '<script>window.__INITIAL_STATE__=runCode()</script>']:
        assert extract_nowcoder(value, "https://www.nowcoder.com/discuss/123")["text"] == ""


class Browser:
    configured = True
    def open(self, _url):
        raise AssertionError("Nowcoder-only discovery must not open Xiaohongshu")


def test_nowcoder_only_pagination_and_capture_pipeline(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WEB_SEARCH_ENDPOINT", "https://www.bing.com/search")
    requests = []
    def handler(request):
        requests.append(str(request.url))
        if request.url.path == "/discuss/999":
            return httpx.Response(429, request=request)
        if request.url.path == "/search/all":
            body = "<html>empty shell</html>" if request.url.params.get("query") == "shell" else html(search_state(int(request.url.params.get("page", 1))))
        elif request.url.path.startswith("/discuss/"):
            body = html(post_state(request.url.path.rsplit("/", 1)[-1]))
        else:
            body = "<html></html>"
        return httpx.Response(200, headers={"content-type": "text/html"}, text=body, request=request)
    web = WebClient(transport=httpx.MockTransport(handler), resolver=lambda _host, port, **_: [(2, 1, 6, "", ("93.184.216.34", port))])
    with database.session() as session:
        candidate = Candidate(name="Test")
        session.add(candidate); session.flush()
        job = Job(candidate_id=candidate.id, company="远山科技", role="产品经理")
        session.add(job); session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=Browser())
        permission = {ToolPermission.NETWORK_READ, ToolPermission.DRAFT_WRITE, ToolPermission.READ}
        result = gateway.execute(tool_name="discover_interview_sources", run=run, arguments={"company": job.company, "role": job.role, "platforms": ["nowcoder"], "nowcoder_query": "远山 产品经理 面经", "nowcoder_page_limit": 1}, granted_permissions=permission, idempotency_key="discovery")
        assert result["data"]["primary_source_count"] == 0
        assert result["data"]["nowcoder_site_source_count"] == 2
        assert result["data"]["discovery_exhausted"] is False
        assert result["data"]["nowcoder_continuations"] == [{"query": "远山 产品经理 面经", "page": 2}]
        assert not any("xiaohongshu" in url for url in requests)
        continuation = gateway.execute(tool_name="discover_interview_sources", run=run, arguments={"company": job.company, "role": job.role, "platforms": ["nowcoder"], "nowcoder_query": "远山 产品经理 面经", "nowcoder_start_page": 2}, granted_permissions=permission, idempotency_key="continue")
        assert continuation["data"]["nowcoder_pages"][0]["page"] == 2
        assert continuation["data"]["nowcoder_continuations"] == []
        shell = gateway.execute(tool_name="discover_interview_sources", run=run, arguments={"company": job.company, "role": job.role, "platforms": ["nowcoder"], "nowcoder_query": "shell"}, granted_permissions=permission, idempotency_key="shell")
        assert shell["data"]["discovery_exhausted"] is False
        assert shell["data"]["nowcoder_pages"][0]["status"] == "unrecognized_page"
        capture = gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": "https://m.nowcoder.com/discuss/101?sourceSSR=search"}, granted_permissions=permission, idempotency_key="capture")
        source = capture["data"]["source"]
        assert source["platform"] == "nowcoder"
        assert source["published_at"].startswith("2021-09-11")
        assert "无关问题" not in source["raw_text"]
        duplicate = gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": "https://www.nowcoder.com/discuss/101"}, granted_permissions=permission, idempotency_key="duplicate")
        assert duplicate["data"]["duplicate"] is True
        assert duplicate["data"]["source"]["id"] == source["id"]
        assert session.query(InterviewSource).count() == 1
        analyzed = gateway.execute(tool_name="analyze_interview_source", run=run, arguments={"source_id": source["id"], "summary": "需求分析面经", "questions": [{"question": "如何分析需求？", "evidence_quote": "请说明需求分析的方法。"}, {"question": "虚构问题", "evidence_quote": "不存在的引文"}]}, granted_permissions=permission, idempotency_key="analyze")
        assert analyzed["data"]["rejected_count"] == 1
        with pytest.raises(HarnessError, match="牛客要求登录或限制访问"):
            gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": "https://www.nowcoder.com/discuss/999"}, granted_permissions=permission, idempotency_key="rate-limit")
        assert sum("/discuss/999" in url for url in requests) == 1
        assert session.query(InterviewSource).count() == 1


def test_read_page_keeps_unrecognized_post_empty():
    web = WebClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, headers={"content-type": "text/html"}, text="<html><title>面经</title><p>推荐面试问题</p>" * 50, request=request)), resolver=lambda _host, port, **_: [(2, 1, 6, "", ("93.184.216.34", port))])
    assert web.read_page("https://www.nowcoder.com/discuss/123").text == ""


def test_image_ocr_is_saved_for_review_but_cannot_be_analyzed(database, tmp_path):
    class Browser:
        configured = True
        def open(self, url):
            return {"url": url, "title": "滴滴策略运营面经", "text": "面试问题见图片", "image_count": 2,
                    "ocr_job_id": "a" * 64, "ocr_status": "queued", "ocr_images_saved": 2,
                    "ocr_images_processed": 0, "login_required": False}
        def command(self, command, **kwargs):
            assert command == "ocr_result" and kwargs["job_id"] == "a" * 64
            return {"status": "completed", "completed": 2, "pages": [{"index": 1, "text": "请介绍如何搭建业务指标体系。" * 12}]}
    web = WebClient(resolver=lambda _host, port, **_: [(2, 1, 6, "", ("93.184.216.34", port))])
    with database.session() as session:
        candidate = Candidate(name="OCR test")
        session.add(candidate); session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴", role="策略运营", jd_raw="指标分析")
        session.add(job); session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway, web_client=web, browser_client=Browser())
        permissions = {ToolPermission.NETWORK_READ, ToolPermission.DRAFT_WRITE, ToolPermission.READ}
        result = gateway.execute(tool_name="capture_interview_source", run=run, arguments={"url": "https://www.xiaohongshu.com/explore/69a58b24000000001a035e5d"}, granted_permissions=permissions, idempotency_key="ocr-capture")
        source = result["data"]["source"]
        assert source["status"] == "ocr_pending"
        assert "指标体系" not in source["raw_text"]
        collected = gateway.execute(tool_name="collect_interview_ocr", run=run, arguments={"source_id": source["id"]}, granted_permissions=permissions, idempotency_key="collect-ocr")
        assert collected["data"]["ocr_status"] == "completed"
        assert "指标体系" in collected["data"]["source"]["metadata_json"]["ocr_text"]
        assert collected["data"]["source"]["status"] == "ocr_pending"
        with pytest.raises(HarnessError, match="尚未核对"):
            gateway.execute(tool_name="analyze_interview_source", run=run, arguments={"source_id": source["id"], "summary": "待核对", "questions": []}, granted_permissions=permissions, idempotency_key="ocr-analyze")
