"""Independent T3 acceptance: production API + real tool handlers, fake IO only."""
from copy import deepcopy
from hashlib import sha256
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import json
import sqlite3

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import func, select

from applyos_api.main import create_app
import applyos_api.main as api
from applyos_domain.database import Database
from applyos_domain.models import AgentRun, Candidate, InterviewBrief, Job, JobProfile, MaterialAsset, ResumeVersion, RewriteProposal
from applyos_domain.job_context import normalize_context, current_analysis_marker
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission
from applyos_agent.web_tools import register_web_tools, ImportJobPostingInput
from applyos_agent.interview_tools import register_interview_tools, SearchInterviewKnowledgeInput
from applyos_agent.service import AgentService
from applyos_agent.schemas import JDAnalysis
from integrations.web.job_posting import ParsedJobPosting

spec = importlib.util.spec_from_file_location("t3_independent_fixtures", Path(__file__).resolve().parents[2] / "tests/fixtures/t3-workflow/common.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)

def seed(database):
    with database.session() as session:
        candidate = Candidate(id="t3-candidate", name="T3 合成验收")
        session.add(candidate)
        session.flush()
        job = Job(id="t3-job", candidate_id=candidate.id, company="合成科技", role="数据分析", source_url=fixture.URL)
        session.add(job)
        session.flush()
        session.add(AgentRun(id="t3-run", candidate_id=candidate.id, job_id=job.id, run_type="job_resume", current_stage="created"))

def context(session):
    return ToolContext(session=session, run=session.get(AgentRun, "t3-run"), granted_permissions=set(ToolPermission), workspace_root=Path.cwd() / "artifacts/t3-independent/tool")

@pytest.mark.parametrize("case,expected", [("static", "ok"), ("spa", "insufficient_content"), ("firecrawl-browser", "ok"), ("timeout", "timeout"), ("login", "requires_user_action"), ("insufficient", "insufficient_content")])
def test_real_preview_and_agent_share_typed_body_and_status(database, monkeypatch, case, expected):
    seed(database)
    monkeypatch.setattr(api, "_job_posting_importer", lambda session: fixture.importer(session, case)[0])
    client = TestClient(create_app(database))
    before = None
    with database.session() as session:
        before = {"jobs": session.scalar(select(func.count()).select_from(Job)), "materials": session.scalar(select(func.count()).select_from(MaterialAsset)), "job": (session.get(Job, "t3-job").jd_raw, session.get(Job, "t3-job").input_revision)}
    response = client.post("/api/web/job-posting/preview", json={"url": fixture.URL})
    assert response.status_code == 200, response.text
    preview = response.json()
    assert preview["status"] == expected
    assert preview["body"] == preview["description"]
    assert preview["body_hash"] == sha256(preview["body"].encode()).hexdigest()
    assert all(key in preview for key in ("source_url", "adapter", "adapter_version", "fetched_at", "warnings"))
    with database.session() as session:
        after = {"jobs": session.scalar(select(func.count()).select_from(Job)), "materials": session.scalar(select(func.count()).select_from(MaterialAsset)), "job": (session.get(Job, "t3-job").jd_raw, session.get(Job, "t3-job").input_revision)}
        assert before == after, "Production preview must not mutate jobs or MaterialAsset"
        gateway = ToolGateway(session, workspace_root=context(session).workspace_root)
        web, firecrawl, browser, calls = fixture.clients(case)
        register_web_tools(gateway, web_client=web, firecrawl_client=firecrawl, browser_client=browser)
        result = gateway.registry["import_job_posting"].handler(context(session), ImportJobPostingInput())
        imported = result.data["posting"]
        for key in ("body", "source_url", "status", "body_hash", "adapter", "warnings"):
            assert imported[key] == preview[key], (key, case)
        assert result.data["imported"] is (expected == "ok")
        assert session.scalar(select(func.count()).select_from(MaterialAsset)) == (1 if expected == "ok" else 0)
        if case == "firecrawl-browser":
            assert calls == ["static", "firecrawl", "browser"]
            assert imported["body"] == fixture.LONG and imported["adapter"] == "controlled-browser"
        if case == "login":
            assert result.requires_user_action

def test_hash_is_final_truncated_body_not_html():
    posting = ParsedJobPosting(fixture.URL, "", "", "", "  " + fixture.BODY * 120 + "  ", False, content_sha256="html-hash")
    assert len(posting.body) == 40000
    assert posting.body_hash == sha256(posting.body.encode()).hexdigest()

def confirmed(kind="social"):
    return {"schema_version": 1, "fields": {key: {"value": value, "basis": "user_confirmed", "source_quote": "", "source_span": None} for key, value in {"function": "风险分析", "sub_direction": "合成反欺诈", "recruitment_type": kind, "business_unit": "合成风控事业部", "published_at": "2026-10-25"}.items()}}

@pytest.mark.parametrize("kind", ["campus", "internship", "social", None])
def test_context_save_reopen_and_real_query_rank_arguments(database, monkeypatch, kind):
    seed(database)
    client = TestClient(create_app(database))
    payload = confirmed(kind)
    assert client.patch("/api/jobs/t3-job", json={"jd_raw": fixture.BODY, "context_json": payload}).status_code == 200
    reopened = client.get("/api/jobs/t3-job/workspace").json()["job"]
    assert reopened["context_json"]["fields"]["recruitment_type"]["value"] == kind
    import applyos_agent.interview_tools as tools
    captured = {}
    def retrieve(session, **kwargs):
        captured["query"] = kwargs["query"]
        return []
    def rank(hits, **kwargs):
        captured["rank"] = kwargs
        return []
    monkeypatch.setattr(tools, "retrieve_knowledge", retrieve)
    monkeypatch.setattr(tools, "rank_interviews", rank)
    with database.session() as session:
        gateway = ToolGateway(session, workspace_root=context(session).workspace_root)
        register_interview_tools(gateway)
        result = gateway.registry["search_interview_knowledge"].handler(context(session), SearchInterviewKnowledgeInput(company="合成科技", role="数据分析"))
        assert "合成风控事业部" in captured["query"] and "合成反欺诈" in captured["query"]
        assert captured["rank"]["business_unit"] == "合成风控事业部"
        assert captured["rank"]["recruitment_type_target"] == (kind or "unknown")
        assert captured["rank"]["target_context"]["fields"]["function"]["value"] == "风险分析"
        label = {"campus":"校招", "internship":"实习", "social":"社招"}.get(kind)
        if label:
            assert label in captured["query"]
        else:
            assert "校招" not in captured["query"], "Unknown context must not be guessed from JD prose"
        gateway.registry["search_interview_knowledge"].handler(context(session), SearchInterviewKnowledgeInput(company="合成科技", role="数据分析", jd_text="明确不同的 JD SQL"))
        assert captured["rank"]["recruitment_type_target"] == "unknown"
        assert captured["rank"]["business_unit"] == ""
        assert "合成反欺诈" not in captured["query"]

@pytest.mark.parametrize("field,value,quote", [("recruitment_type","social","招聘类型：正式校招"),("function","算法工程","职能：数据分析"),("business_unit","增长事业部","部门：风险策略部")])
def test_source_basis_cannot_launder_mismatching_value(field, value, quote):
    normalized = normalize_context({"fields": {field:{"value": value, "basis":"source", "source_quote":quote}}}, fixture.BODY)
    assert normalized["fields"][field]["basis"] == "unknown"
    assert normalized["fields"][field]["value"] is None

def test_source_quotes_invalidation_and_inferred_boundary():
    for basis in ("source", "inferred"):
        value = {"fields":{"function":{"value":"数据分析", "basis":basis,"source_quote":"职能：数据分析"}}}
        original = normalize_context(value, fixture.BODY)
        assert original["fields"]["function"]["basis"] == basis
        assert original["fields"]["function"]["source_span"] == [0,7]
        invalidated = normalize_context(value, "修改后的 JD")
        assert invalidated["fields"]["function"]["value"] is None
    assert normalize_context(None)["fields"]["recruitment_type"]["basis"] == "unknown"

def test_body_context_change_stale_survives_refresh_and_noop(database):
    seed(database)
    client = TestClient(create_app(database))
    client.patch("/api/jobs/t3-job",json={"jd_raw":fixture.BODY,"context_json":confirmed()})
    with database.session() as session:
        job = session.get(Job,"t3-job")
        marker = current_analysis_marker(job)
        old_revision = job.input_revision
        session.add(JobProfile(job_id=job.id,responsibilities=["旧分析"],business_context=marker))
        session.add(InterviewBrief(id="t3-brief",candidate_id=job.candidate_id,job_id=job.id,company=job.company,role=job.role,summary="旧简报",metadata_json=marker))
    for change in ({"jd_raw":fixture.BODY+"\n新增职责：核对合成报表。"}, {"context_json":confirmed("internship")}):
        changed = client.patch("/api/jobs/t3-job",json=change)
        assert changed.status_code == 200, changed.text
        assert changed.json()["input_revision"] == old_revision + 1
        old_revision += 1
        for _ in range(2):
            snapshot = client.get("/api/jobs/t3-job/workspace").json()
            assert snapshot["profile"]["business_context"]["analysis_status"] == "stale"
            with database.session() as session:
                assert session.get(InterviewBrief,"t3-brief").metadata_json["analysis_status"] == "stale"
        unchanged = client.patch("/api/jobs/t3-job",json=change)
        assert unchanged.json()["input_revision"] == old_revision

def test_inflight_analysis_is_stamped_old_revision(database):
    seed(database)
    with database.session() as session:
        job=session.get(Job,"t3-job")
        job.jd_raw="旧 JD"
        session.flush()
        original_revision=job.input_revision
        class Suite:
            def analyze_jd(self, _job, **_):
                job.jd_raw="分析期间修订的新 JD"
                job.input_revision=original_revision+1
                session.flush()
                return JDAnalysis(keywords=["旧结果"]), SimpleNamespace(usage={},session_id=None,hook_events=[])
        profile=AgentService(session,suite=Suite()).analyze_job(job)
        assert profile.business_context["input_revision"] == original_revision
        assert profile.business_context["analysis_status"] == "stale"
        assert profile.business_context["current_input_revision"] == original_revision+1

def test_synthetic_legacy_upgrade_twice_retains_rows_and_unknown(tmp_path):
    filename=tmp_path/"old.db"
    connection=sqlite3.connect(filename)
    connection.executescript("""CREATE TABLE candidates(id VARCHAR(40) PRIMARY KEY, legacy_id VARCHAR(160), name VARCHAR(120) NOT NULL, email VARCHAR(240), phone VARCHAR(80), location VARCHAR(240), metadata_json JSON NOT NULL DEFAULT '{}', created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL);
    CREATE TABLE jobs(id VARCHAR(40) PRIMARY KEY, legacy_id VARCHAR(160), candidate_id VARCHAR(40) NOT NULL, company VARCHAR(240) NOT NULL, role VARCHAR(240) NOT NULL, location VARCHAR(240), jd_raw TEXT, source_type VARCHAR(80) NOT NULL, source_url TEXT, status VARCHAR(80) NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL);
    INSERT INTO candidates(id,name) VALUES('legacy-candidate','合成旧同学');
    INSERT INTO jobs(id,candidate_id,company,role,jd_raw,source_type,status) VALUES('legacy-job','legacy-candidate','合成旧公司','校招数据分析','合成旧正文不得改写','manual','draft');""")
    connection.commit()
    before=connection.execute("SELECT id,candidate_id,company,role,jd_raw,source_type,status,created_at,updated_at FROM jobs").fetchall()
    connection.close()
    database=Database("sqlite:///"+filename.as_posix())
    for _ in range(2):
        database.create_schema()
        with database.session() as session:
            job=session.get(Job,"legacy-job")
            assert job.context_json == {} and job.jd_provenance == {} and job.input_revision == 1
            assert normalize_context(job.context_json,job.jd_raw)["fields"]["recruitment_type"]["value"] is None
        check=sqlite3.connect(filename)
        assert check.execute("SELECT id,candidate_id,company,role,jd_raw,source_type,status,created_at,updated_at FROM jobs").fetchall()==before
        check.close()
    database.engine.dispose()

def test_confirmed_context_changes_existing_specialty_eligibility_and_type_score():
    from applyos_domain.interview_ranking import score_interview, WEIGHTS
    source=SimpleNamespace(id="synthetic-algorithm",title="合成科技算法工程师校招面经",company="合成科技",role="算法工程师",business_unit="风控部",published_at=None,metadata_json={},status="captured",extracted_questions=[],content_hash="one",source_url=fixture.URL)
    original=score_interview(source,company="合成科技",role="工程师")
    assert original["eligible"]
    target={"schema_version":1,"fields":{"sub_direction":{"value":"测试","basis":"user_confirmed"}}}
    scoped=score_interview(source,company="合成科技",role="工程师",target_context=target)
    assert scoped["eligible"] is False and scoped["exclusion_reason"]=="role_not_supported_by_source"
    assert scoped["weights"]==original["weights"]==WEIGHTS
    target["fields"]["sub_direction"]={"value":None,"basis":"unknown"}
    assert score_interview(source,company="合成科技",role="工程师",target_context=target)["eligible"]
    campus=score_interview(source,company="合成科技",role="工程师",recruitment_type_target="campus")
    social=score_interview(source,company="合成科技",role="工程师",recruitment_type_target="social")
    assert campus["score"] > social["score"] and campus["eligible"] and social["eligible"]
    assert original["recruitment_type"]["target"]=="unknown"

def test_old_artifact_relevance_stays_stale_after_new_profile_without_mutating_t1(database):
    seed(database)
    content={"verification_status":"verified","claims":[],"synthetic_marker":"do not rewrite"}
    contract={"needs_evidence":True,"claims":[],"synthetic_marker":"do not rewrite"}
    with database.session() as session:
        job=session.get(Job,"t3-job")
        session.add(JobProfile(job_id=job.id,business_context=current_analysis_marker(job)))
        session.add(ResumeVersion(id="t3-old-resume",candidate_id=job.candidate_id,job_id=job.id,name="旧合成稿",content_json=deepcopy(content),content_hash="preserve-this-hash"))
        session.flush()
        session.add(RewriteProposal(id="t3-old-proposal",resume_version_id="t3-old-resume",run_id="t3-run",section="experience",before="原句",after="原句",reason="合成",claim_contract=deepcopy(contract)))
    client=TestClient(create_app(database))
    assert client.patch("/api/jobs/t3-job",json={"jd_raw":fixture.BODY}).status_code==200
    for regenerate in (False,True):
        if regenerate:
            with database.session() as session:
                class Suite:
                    def analyze_jd(self,job,**_):
                        return JDAnalysis(keywords=["新分析"]),SimpleNamespace(usage={},session_id=None,hook_events=[])
                profile=AgentService(session,suite=Suite()).analyze_job(session.get(Job,"t3-job"))
                assert profile.business_context["analysis_status"]=="current"
        snapshot=client.get("/api/jobs/t3-job/workspace").json()
        assert snapshot["resumes"][0]["job_relevance"]["analysis_status"]=="stale"
        assert snapshot["proposals"][0]["job_relevance"]["analysis_status"]=="stale"
        assert snapshot["resumes"][0]["content_json"]==content
        assert snapshot["resumes"][0]["content_hash"]=="preserve-this-hash"
        assert snapshot["proposals"][0]["claim_contract"]==contract
