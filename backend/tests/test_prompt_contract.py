from datetime import date

from fastapi.testclient import TestClient

from applyos_agent.agents import AgentSuite
from applyos_agent.config import AgentSettings
from applyos_agent.conversation_prompt import build_conversation_request
from applyos_agent.prompt_contract import (
    CORE, INTERVIEW, OUTPUT_LANGUAGE, PRESENTATION, SKILL_GUIDANCE, TASK, WEB, WORKSPACE,
    build_prompt_sections, build_system_prompt,
)
from applyos_agent.runtime import MockAgentRuntime
from applyos_api.main import create_app
from applyos_domain.models import AgentMessage, Fact, Job


def settings(tmp_path):
    return AgentSettings(workspace_root=tmp_path, provider_name="Example", model="custom-model",
                         provider_protocol="anthropic",
                         provider_base_url="https://name:secret@example.com/anthropic?key=secret#secret",
                         provider_api_key="never-export-this")


def test_policy_sections_are_loaded_by_capability_and_task(tmp_path):
    config = settings(tmp_path)
    plain = build_system_prompt(config, tools=[])
    assert plain.count(CORE) == 1
    assert WEB not in plain and INTERVIEW not in plain and TASK not in plain
    assert date.today().isoformat() in plain
    assert "custom-model" in plain and "anthropic" in plain
    assert "secret" not in plain and "never-export-this" not in plain
    assert "https://example.com/anthropic" in plain
    web = build_system_prompt(config, tools=[{"name": "search_web"}, {"name": "read_web_page"}])
    assert web.count(WEB) == 1
    research = build_system_prompt(config, tools=[], workspace=True, interview=True)
    assert research.count(INTERVIEW) == 1 and WEB not in research
    task = build_system_prompt(config, tools=[], task=True)
    assert TASK in task and "approval_required" in task
    assert INTERVIEW not in task


def test_standalone_uses_current_model_and_permissions_not_old_history(database):
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        provider = {"model": "user-selected-model", "provider_name": "User provider",
                    "protocol": "anthropic", "base_url": "https://example.com/anthropic"}
        c.patch("/api/settings/permissions", json={"web_access": "deny"})
        r = c.post(f"/api/pi/conversations/{chat}/turns",
                   json={"content": "你是什么模型", "provider": provider})
        assert r.status_code == 200
        denied = r.json()
        assert "user-selected-model" in denied["system_prompt"]
        assert PRESENTATION in denied["system_prompt"]
        assert WEB not in denied["system_prompt"]
        assert not any(t["name"] == "search_web" for t in denied["tools"])
        c.post(f"/api/pi/chat-turns/{denied['user']['id']}/complete",
               json={"content": "旧回答：没有联网能力"})
        c.patch("/api/settings/permissions", json={"web_access": "ask"})
        allowed = c.post(f"/api/pi/conversations/{chat}/turns",
                         json={"content": "查天气", "provider": provider}).json()
        assert WEB in allowed["system_prompt"]
        assert "Do not reuse historical capability claims" in allowed["system_prompt"]
        assert any(t["name"] == "search_web" for t in allowed["tools"])
        assert "旧回答" in allowed["history"][-1]["content"]


def test_presentation_contract_is_shared_by_workspace_and_dynamic_runtime_sections(tmp_path):
    config = settings(tmp_path)
    for options in ({}, {"workspace": True}, {"task": True}, {"interview": True}, {"thinking_level": "fast"}):
        assert build_system_prompt(config, tools=[], **options).count(PRESENTATION) == 1
        assert build_system_prompt(config, tools=[], **options).count(OUTPUT_LANGUAGE) == 1
    for task in (False, True):
        sections = build_prompt_sections(config, task=task)
        unconditional = "\n".join(section["text"] for section in sections if not section.get("requires_all"))
        assert unconditional.count(PRESENTATION) == 1
        assert unconditional.count(OUTPUT_LANGUAGE) == 1


def test_language_contract_preserves_chinese_output_and_original_evidence():
    assert "Simplified Chinese for all user-facing replies and generated business content" in OUTPUT_LANGUAGE
    assert "unless the user explicitly requests another language" in OUTPUT_LANGUAGE
    assert "verbatim evidence in their original language" in OUTPUT_LANGUAGE
    assert "never translate or paraphrase source_quote, evidence_quote or before" in OUTPUT_LANGUAGE
    assert "schema keys, enum values, tool names, identifiers and URLs unchanged" in OUTPUT_LANGUAGE


def test_dynamic_workflow_sections_keep_capability_gates(tmp_path):
    sections = build_prompt_sections(settings(tmp_path), skills="available-skill-marker")
    by_text = {section["text"]: section for section in sections}
    assert by_text[WEB]["requires_all"] == ["search_web", "read_web_page"]
    assert by_text[WORKSPACE]["requires_all"] == ["read_job_workspace_context"]
    assert by_text[INTERVIEW]["requires_all"] == ["build_interview_brief"]
    assert by_text[INTERVIEW]["excludes"] == ["activate_interview_research"]
    assert by_text[SKILL_GUIDANCE + "available-skill-marker"]["requires_all"] == ["read_skill"]
    for only_tool in ("search_web", "read_web_page"):
        assert WEB not in build_system_prompt(settings(tmp_path), tools=[{"name": only_tool}])


def test_conversation_keeps_user_material_verbatim_under_english_instructions(tmp_path):
    job = Job(id="job-原始ID", company="中文公司", role="数据分析师", jd_raw="未请求读取的 JD")
    message = "请用英文回复，但保留原文引文：‘参与数据整理，未负责项目’。"
    context = "用户：过去使用 SQL；assistant: original English text."
    prompt, system_prompt = build_conversation_request(settings(tmp_path), job, message, context, "balanced")
    assert message in prompt and context in prompt
    assert job.id in prompt and job.company in prompt and job.role in prompt
    assert job.jd_raw not in prompt
    assert "This identifies the active desktop workspace only" in prompt
    assert OUTPUT_LANGUAGE in system_prompt


def test_structured_agents_share_language_policy_without_translating_inputs(tmp_path):
    class CapturingRuntime(MockAgentRuntime):
        def __init__(self):
            self.calls = []

        def generate(self, **kwargs):
            self.calls.append(kwargs)
            return super().generate(**kwargs)

    runtime = CapturingRuntime()
    suite = AgentSuite(settings(tmp_path), runtime=runtime)
    job = Job(id="job-original", company="原始公司", role="数据分析师", jd_raw="负责数据分析；熟悉 SQL。")
    fact = Fact(id="fact-original", category="experience", content="参与 SQL 报表整理，未负责上线。", verified=True)
    suite.analyze_jd(job)
    page_text = "原始公司\n负责数据分析；熟悉 SQL。\n工作地点：上海"
    suite.extract_job_posting(page_text, page_title="原文职位标题")
    suite.create_strategy(job, [fact])
    suite.rank_facts(job, [fact])
    assets, _ = suite.generate_assets(job, [fact], resume_context={"原始模块": fact.content})
    suite.audit(assets.proposals)
    suite.respond(job, "继续修改简历", "历史原文")

    calls = {call["agent_name"]: call for call in runtime.calls}
    assert len(calls) == 7
    for call in calls.values():
        assert call["system_prompt"].count(OUTPUT_LANGUAGE) == 1
    assert job.jd_raw in calls["jd_analyst"]["prompt"]
    assert page_text in calls["job_posting_extractor"]["prompt"]
    assert "原文职位标题" in calls["job_posting_extractor"]["prompt"]
    for agent_name in ("resume_strategy", "fact_matcher", "asset_generation"):
        assert fact.content in calls[agent_name]["prompt"]
        assert fact.id in calls[agent_name]["prompt"]
        assert job.jd_raw in calls[agent_name]["prompt"]
    assert calls["jd_analyst"]["mock_data"]["responsibilities"][0]["source_quote"] == job.jd_raw
    assert assets.proposals[0].before == fact.content
    assert assets.proposals[0].after == fact.content
    assert calls["job_workspace_conversation"]["mock_data"]["suggested_actions"] == ["查看简历预览", "重新生成修订版"]


def test_job_bootstrap_still_compacts_older_history(database):
    with TestClient(create_app(database)) as c:
        candidate = c.post("/api/candidates", json={"name": "Synthetic"}).json()
        job = c.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "Example",
                                      "role": "Analyst", "jd_raw": "Synthetic JD"}).json()
        with database.session_factory() as session:
            for i in range(12):
                session.add(AgentMessage(candidate_id=candidate["id"], job_id=job["id"],
                                         role="user", content=f"history-marker-{i:02d}"))
                session.flush()
            session.commit()
        r = c.post(f"/api/pi/jobs/{job['id']}/turns",
                   json={"content": "继续", "provider": {"model": "synthetic"}})
        assert r.status_code == 200
        body = r.json()
        assert "history-marker-00" in body["compacted_summary"]
        assert "history-marker-01" in body["compacted_summary"]
        assert len(body["history"]) == 10
        assert "history-marker-11" in body["history"][-1]["content"]
