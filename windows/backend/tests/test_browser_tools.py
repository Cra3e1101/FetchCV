from __future__ import annotations

import httpx

from applyos_agent.browser_tools import BrowserBridgeClient, register_browser_tools
from applyos_domain.models import AgentRun, Candidate, Job
from applyos_harness.permissions import ToolGateway, ToolPermission
from integrations.web import WebClient


PUBLIC_IP = "93.184.216.34"


def resolver(_host, port, **_):
    return [(2, 1, 6, "", (PUBLIC_IP, port))]


def test_visible_browser_pauses_for_user_login(database, tmp_path):
    calls = []

    def handler(request):
        assert request.headers["authorization"] == "Bearer bridge-secret"
        payload = __import__("json").loads(request.content)
        calls.append(payload)
        return httpx.Response(200, json={"ok": True, "result": {
            "open": True,
            "loading": False,
            "url": payload.get("url", "https://jobs.example.com/login"),
            "title": "招聘网站登录",
            "text": "请登录后继续",
            "login_required": True,
            "user_action": "login",
        }})

    bridge = BrowserBridgeClient(
        base_url="http://127.0.0.1:32123",
        token="bridge-secret",
        transport=httpx.MockTransport(handler),
        web_client=WebClient(resolver=resolver),
    )
    with database.session() as session:
        candidate = Candidate(name="Browser candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume_tailoring", current_stage="created")
        session.add(run)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_browser_tools(gateway, bridge=bridge)

        result = gateway.execute(
            tool_name="open_browser_page",
            run=run,
            arguments={"url": "https://jobs.example.com/login#/session"},
            granted_permissions={ToolPermission.NETWORK_READ},
            idempotency_key="browser-open-1",
        )

        assert result["requires_user_action"] is True
        assert result["approval_action"] == "complete_browser_login"
        assert result["data"]["user_action"] == "login"
        assert calls == [{"command": "open", "url": "https://jobs.example.com/login#/session"}]


def test_browser_tools_are_absent_without_desktop_bridge(database, tmp_path):
    with database.session() as session:
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_browser_tools(gateway, bridge=BrowserBridgeClient(base_url="", token=""))
        assert "open_browser_page" not in gateway.registry
