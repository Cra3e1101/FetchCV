from datetime import date

from fastapi.testclient import TestClient

from applyos_agent.config import AgentSettings
from applyos_agent.prompt_contract import CORE, INTERVIEW, TASK, WEB, build_system_prompt
from applyos_api.main import create_app
from applyos_domain.models import AgentMessage


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
        assert WEB not in denied["system_prompt"]
        assert not any(t["name"] == "search_web" for t in denied["tools"])
        c.post(f"/api/pi/chat-turns/{denied['user']['id']}/complete",
               json={"content": "旧回答：没有联网能力"})
        c.patch("/api/settings/permissions", json={"web_access": "ask"})
        allowed = c.post(f"/api/pi/conversations/{chat}/turns",
                         json={"content": "查天气", "provider": provider}).json()
        assert WEB in allowed["system_prompt"]
        assert "不沿用历史能力声明" in allowed["system_prompt"]
        assert any(t["name"] == "search_web" for t in allowed["tools"])
        assert "旧回答" in allowed["history"][-1]["content"]


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
