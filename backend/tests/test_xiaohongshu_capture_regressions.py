"""Discovery and capture checks against browser responses, without live requests."""

import httpx
import pytest

from applyos_agent.interview_tools import register_interview_tools
from applyos_domain.models import AgentRun, Candidate, InterviewSource, Job
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission
from integrations.web import WebClient, WebSearchResult


NOTE_ID = "69a58b24000000001a035e5d"
NOTE_URL = f"https://www.xiaohongshu.com/explore/{NOTE_ID}"


class BrowserResponse:
    configured = True

    def __init__(self, state):
        self.state = state
        self.opened = []

    def open(self, url):
        self.opened.append(url)
        return self.state


@pytest.fixture
def interview_pipeline(database, tmp_path, monkeypatch):
    web = WebClient(
        resolver=lambda _host, port, **_: [(2, 1, 6, "", ("93.184.216.34", port))],
        transport=httpx.MockTransport(lambda _: pytest.fail("Capture must use the guarded browser")),
    )
    monkeypatch.setattr(web, "search", lambda *args, **kwargs: [])
    with database.session() as session:
        candidate = Candidate(name="XHS regression fixture")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="滴滴出行", role="策略运营")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
        session.add(run)
        session.flush()

        def execute(browser, tool, arguments):
            gateway = ToolGateway(session, workspace_root=tmp_path)
            register_interview_tools(gateway, web_client=web, browser_client=browser)
            return gateway.execute(
                tool_name=tool, run=run, arguments=arguments,
                granted_permissions={ToolPermission.NETWORK_READ},
                idempotency_key=f"{tool}-{len(browser.opened)}",
            )

        yield session, web, execute


def test_discovery_keeps_visible_snippet_and_deduplicates_note_routes(interview_pipeline, monkeypatch):
    _, web, execute = interview_pipeline
    alternate_url = f"https://www.xiaohongshu.com/discovery/item/{NOTE_ID}/?source=share"
    browser = BrowserResponse({
        "candidates": [
            None,
            "invalid browser candidate",
            {"url": NOTE_URL, "title": "一面记录", "snippet": "滴滴两轮车策略运营面经：指标拆解与实验设计"},
            {"url": alternate_url, "title": "滴滴两轮车策略运营面经"},
        ],
    })
    monkeypatch.setattr(web, "search", lambda *args, **kwargs: [
        WebSearchResult(title="滴滴两轮车策略运营面经", url=alternate_url),
    ])

    result = execute(browser, "discover_interview_sources", {
        "company": "滴滴出行", "role": "策略运营", "business_unit": "两轮车", "platforms": ["xiaohongshu"],
    })["data"]

    assert result["primary_source_count"] == 1
    assert result["supplemental_source_count"] == 0
    assert len(result["results"]) == 1
    assert result["results"][0]["url"] == NOTE_URL
    assert result["results"][0]["snippet"].startswith("滴滴两轮车")
    assert result["results"][0]["scope"] == "same_business_role"


def test_xhs_public_search_does_not_mislabel_other_platforms(interview_pipeline, monkeypatch):
    _, web, execute = interview_pipeline
    browser = BrowserResponse({"candidates": []})
    monkeypatch.setattr(web, "search", lambda *args, **kwargs: [
        WebSearchResult(title="滴滴策略运营面经", url="https://www.nowcoder.com/discuss/123456"),
        WebSearchResult(title="滴滴策略运营面经", url="https://www.zhihu.com/question/123/answer/456"),
        WebSearchResult(title="滴滴策略运营面经", url=NOTE_URL),
    ])

    result = execute(browser, "discover_interview_sources", {
        "company": "滴滴出行", "role": "策略运营", "platforms": ["xiaohongshu"],
    })["data"]

    assert result["primary_source_count"] == 1
    assert [item["url"] for item in result["results"]] == [NOTE_URL]


@pytest.mark.parametrize("override", [
    {"url": "https://www.xiaohongshu.com/404"},
    {"url": "https://www.xiaohongshu.com/search_result/?keyword=面经"},
    {"url": "https://www.nowcoder.com/discuss/123456"},
    {"login_required": True},
    {"cooldown_until": 9999999999},
    {"text": "当前笔记暂时无法浏览"},
    {"text": "安全验证，请完成验证"},
    {"text": "扫码登录后查看笔记内容"},
    {"page_kind": "search"},
])
def test_ocr_metadata_does_not_admit_blocked_or_wrong_pages(interview_pipeline, override):
    session, _, execute = interview_pipeline
    browser = BrowserResponse({
        "url": NOTE_URL, "title": "滴滴策略运营面经", "text": "问题见图片",
        "page_kind": "note", "login_required": False, "note_ready": True,
        "ocr_status": "queued", "ocr_images_saved": 2,
        "ocr_text": "请介绍如何搭建业务指标体系。" * 12,
        **override,
    })

    with pytest.raises(HarnessError) as error:
        execute(browser, "capture_interview_source", {"url": NOTE_URL})

    assert error.value.code in {"interview_source_unreadable", "interview_source_public_access_stopped"}
    if override.get("login_required") or override.get("cooldown_until"):
        assert error.value.code == "interview_source_public_access_stopped"
        assert error.value.retryable is False
    assert session.query(InterviewSource).count() == 0
    assert len(browser.opened) == 1


def test_image_only_note_remains_available_for_ocr_review(interview_pipeline):
    session, _, execute = interview_pipeline
    browser = BrowserResponse({
        "url": NOTE_URL, "title": "滴滴策略运营面经", "text": "问题见图片",
        "page_kind": "note", "login_required": False, "image_count": 2,
        "ocr_status": "queued", "ocr_images_saved": 2,
    })

    result = execute(browser, "capture_interview_source", {"url": NOTE_URL})

    assert result["data"]["source"]["status"] == "ocr_pending"
    assert result["data"]["source"]["raw_text"] == "问题见图片"
    assert session.query(InterviewSource).count() == 1


@pytest.mark.parametrize("note_ready", [False, True])
def test_capture_accepts_interview_discussing_login_and_verification(interview_pipeline, note_ready):
    session, _, execute = interview_pipeline
    body = (
        "滴滴策略运营产品面试复盘。面试官让我分析扫码登录的产品设计，"
        "解释安全验证会如何影响用户转化率，以及如何通过实验衡量体验与安全。"
        "随后追问指标定义、漏斗拆解、异常归因与反问环节，我结合项目案例说明了取舍。"
    ) * 3
    browser = BrowserResponse({
        "url": NOTE_URL, "title": "扫码登录和安全验证产品面试复盘", "text": body,
        "page_kind": "note", "note_ready": note_ready, "login_required": False, "user_action": "",
    })

    result = execute(browser, "capture_interview_source", {"url": NOTE_URL})

    assert result["data"]["source"]["status"] == "captured"
    assert result["data"]["source"]["raw_text"] == body
    assert session.query(InterviewSource).count() == 1


@pytest.mark.parametrize("restriction", [
    {"login_required": True},
    {"cooldown_until": 9999999999},
    {"user_action": "login"},
    {"user_action": "captcha"},
    {"user_action": "rate_limited"},
])
def test_explicit_access_gate_overrides_ready_note_and_ocr(interview_pipeline, restriction):
    session, _, execute = interview_pipeline
    browser = BrowserResponse({
        "url": NOTE_URL, "title": "滴滴策略运营面试复盘",
        "text": "面试官追问如何拆解业务指标，验证策略运营的实验结果与转化效果。" * 10,
        "page_kind": "note", "note_ready": True, "login_required": False,
        "ocr_images_saved": 2, "ocr_text": "请解释实验与业务指标。" * 12,
        **restriction,
    })

    with pytest.raises(HarnessError) as error:
        execute(browser, "capture_interview_source", {"url": NOTE_URL})

    assert error.value.code == "interview_source_public_access_stopped"
    assert error.value.retryable is False
    assert session.query(InterviewSource).count() == 0
