"""Offline T3 implementation regressions; no model or external platform calls."""
from hashlib import sha256
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import applyos_api.main as api
from applyos_agent.context import ContextManager
from applyos_agent.service import AgentService
from applyos_agent.interview_evidence import refresh_briefs
from applyos_domain.job_context import normalize_context, source_context, current_analysis_marker, mark_job_analyses_stale
from applyos_domain.models import Candidate, Job, JobProfile, InterviewBrief, ResumeVersion, RewriteProposal
from applyos_domain.interview_ranking import score_interview, WEIGHTS
from applyos_domain.interview_queries import jd_query_plan
from integrations.web import WebClient, JobPostingImporter


JD = "职能：研发\n子方向：后端开发\n招聘类型：校招正式\n部门：合成部门\n发布日期：2026-10-01\n岗位职责：" + "负责使用Python开发服务并维护接口。" * 35
DISABLED = SimpleNamespace(configured=False)


def web(handler):
    return WebClient(transport=httpx.MockTransport(handler), resolver=lambda h, p, **kw: [(2, 1, 6, '', ('93.184.216.34', p))])


def seed(database):
    with database.session() as session:
        session.add(Candidate(id="t3-person", name="Synthetic")); session.flush()
        session.add(Job(id="t3-job", candidate_id="t3-person", company="合成公司", role="后端开发", jd_raw=JD,
                        context_json=source_context(JD), source_url="https://jobs.example.com/42")); session.flush()


def test_short_firecrawl_then_long_browser_keeps_one_type_and_actual_body_hash(database):
    static = web(lambda request: httpx.Response(200, text="<html><title>岗位</title><body>加载中</body></html>"))
    fire = SimpleNamespace(configured=True, scrape=lambda url: SimpleNamespace(text="岗位职责：" + "开发服务和维护接口。" * 24,
        source_url=url, title="Firecrawl岗位"))
    browser = SimpleNamespace(configured=True, open=lambda url: {"url":url, "title":"浏览器岗位", "text":JD * 2})
    posting = JobPostingImporter(None, web_client=static, firecrawl_client=fire, browser_client=browser).preview("https://jobs.example.com/42")
    assert posting.status == "ok" and posting.adapter == "controlled-browser"
    assert posting.body == JD * 2 and posting.description == posting.body
    assert posting.body_hash == sha256(posting.body.encode()).hexdigest()
    assert posting.as_dict()["jd_provenance"]["body_hash"] == posting.body_hash


@pytest.mark.parametrize("http_status,expected", [(401,"requires_user_action"), (403,"requires_user_action"), (500,"error")])
def test_access_and_read_error_are_not_body_insufficiency(http_status, expected):
    reader = web(lambda request: httpx.Response(http_status, text="Unavailable"))
    result = JobPostingImporter(None, web_client=reader, firecrawl_client=DISABLED, browser_client=DISABLED).preview("https://jobs.example.com/42")
    assert result.status == expected and result.body == ""


def test_real_mocktransport_timeout_is_explicit():
    def timeout(request):
        raise httpx.ReadTimeout("synthetic timeout", request=request)
    result = JobPostingImporter(None, web_client=web(timeout), firecrawl_client=DISABLED, browser_client=DISABLED).preview("https://jobs.example.com/42")
    assert result.status == "timeout" and result.body == ""


def test_source_value_needs_quote_support_and_dates_never_use_fetch_time():
    context = source_context(JD)
    assert context["fields"]["recruitment_type"]["value"] == "campus"
    context["fields"]["recruitment_type"]["value"] = "social"
    assert normalize_context(context, JD)["fields"]["recruitment_type"]["basis"] == "unknown"
    context = source_context(JD)
    changed = JD.replace("招聘类型：校招正式", "招聘类型未定")
    assert normalize_context(context, changed)["fields"]["recruitment_type"]["value"] is None
    assert source_context("岗位职责：" + "开发服务。" * 40)["fields"]["published_at"]["value"] is None


def test_save_reopen_revalidates_source_and_stales_existing_outputs(database):
    seed(database)
    with database.session() as session:
        session.add(JobProfile(job_id="t3-job", business_context={"analysis_status":"current"}))
        session.add(InterviewBrief(id="t3-brief", candidate_id="t3-person", job_id="t3-job", company="合成公司", role="后端开发"))
    client = TestClient(api.create_app(database))
    response = client.patch("/api/jobs/t3-job", json={"jd_raw":JD.replace("招聘类型：校招正式", "招聘类型未定"),
        "jd_provenance":{"body_hash":"0"*64,"adapter":"controlled-browser","fetched_at":"2026-10-01T00:00:00Z"}})
    assert response.status_code == 200, response.text
    saved = response.json()
    assert saved["context_json"]["fields"]["recruitment_type"]["value"] is None
    assert saved["jd_provenance"]["body_hash"] == sha256(saved["jd_raw"].encode()).hexdigest()
    assert "body_edited_since_fetch" in saved["jd_provenance"]["warnings"]
    reopened = client.get("/api/jobs/t3-job/workspace").json()
    assert reopened["job"]["input_revision"] == 2
    assert reopened["profile"]["business_context"]["analysis_status"] == "stale"
    with database.session() as session:
        refresh_briefs(session, "t3-person")
        assert session.get(InterviewBrief,"t3-brief").metadata_json["analysis_status"] == "stale"
        pinned = ContextManager(session).pinned(session.get(Job,"t3-job"), sections=["job"])
        assert pinned["job"]["input_revision"] == 2
        assert pinned["job"]["context_json"]["fields"]["recruitment_type"]["value"] is None


def test_reanalysis_does_not_clear_old_artifact_relevance_or_change_t1_content(database):
    seed(database)
    with database.session() as session:
        job = session.get(Job,"t3-job")
        profile = JobProfile(job_id=job.id, business_context={"analysis_status":"current"})
        resume = ResumeVersion(id="t3-resume",candidate_id=job.candidate_id,job_id=job.id,name="Synthetic",content_json={"body":"原内容"})
        session.add_all([profile,resume]); session.flush()
        proposal = RewriteProposal(id="t3-proposal",resume_version_id=resume.id,section="正文",before="原内容",after="原内容",reason="Synthetic",claim_contract={"needs_evidence":True})
        session.add(proposal); session.flush()
        original_resume, original_contract = dict(resume.content_json), dict(proposal.claim_contract)
        mark_job_analyses_stale(session, job, reason="test")
        profile.business_context = current_analysis_marker(job, profile.business_context)
        assert profile.business_context["analysis_status"] == "current"
        assert profile.business_context["stale_related_artifacts"] == {"resume_ids":[resume.id],"proposal_ids":[proposal.id]}
        assert resume.content_json == original_resume and proposal.claim_contract == original_contract
    data = TestClient(api.create_app(database)).get("/api/jobs/t3-job/workspace").json()
    assert data["resumes"][0]["job_relevance"]["analysis_status"] == "stale"


def test_in_flight_analysis_keeps_captured_revision(database):
    seed(database)
    with database.session() as session:
        job = session.get(Job,"t3-job")
        def analyze(job, **kw):
            job.jd_raw = "新岗位正文"; job.input_revision = 2; session.flush()
            analysis = SimpleNamespace(responsibilities=[SimpleNamespace(text="旧职责", source_quote="旧原句")], hard_requirements=[],
                preferred_requirements=[], keywords=[], competencies=[], uncertain_items=[])
            return analysis, SimpleNamespace(usage={"runtime":"mock"})
        result = AgentService(session, suite=SimpleNamespace(analyze_jd=analyze)).analyze_job(job)
        assert result.business_context["analysis_status"] == "stale"
        assert result.business_context["input_revision"] == 1
        assert result.business_context["current_input_revision"] == 2


def test_confirmed_direction_consumes_existing_specialty_check_without_weight_change():
    source = SimpleNamespace(title="合成公司算法面经", company="合成公司", role="算法工程师", business_unit=None,
        metadata_json={}, published_at=None, status="captured", extracted_questions=[])
    baseline = score_interview(source, company="合成公司", role="工程师")
    context = {"fields":{"sub_direction":{"value":"测试","basis":"user_confirmed"}}}
    directed = score_interview(source, company="合成公司", role="工程师", target_context=context)
    unknown = score_interview(source, company="合成公司", role="工程师", target_context={"fields":{}})
    assert baseline["eligible"] and not directed["eligible"]
    assert directed["exclusion_reason"] == "role_not_supported_by_source"
    assert unknown["score"] == baseline["score"] and unknown["eligible"]
    assert directed["weights"] == baseline["weights"] == WEIGHTS


def test_context_after_lexical_budget_is_preserved_with_full_body_evidence():
    body = "岗位职责：" + "研发能力。" * 6500 + "\n招聘类型：社招\n子方向：后端开发"
    assert 30000 < len(body) < 40000
    plan = jd_query_plan(body, "工程师", context_json=source_context(body))
    assert plan["job_context"]["fields"]["recruitment_type"]["value"] == "social"
    assert plan["job_context"]["fields"]["sub_direction"]["value"] == "后端开发"
    assert "社招" in plan["terms"]
