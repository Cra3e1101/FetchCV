from fastapi.testclient import TestClient
from applyos_api.main import create_app
from applyos_api.conversations import recover_conversations
from applyos_agent.config import AgentSettings


def start(client, chat, text="你好", **kwargs):
    return client.post(f"/api/pi/conversations/{chat}/turns", json={"content": text, "provider": {"model": "synthetic", "protocol": "anthropic"}, **kwargs})


def finish(client, turn, content="你好，有什么可以帮你？"):
    return client.post(f"/api/pi/chat-turns/{turn}/complete", json={"content": content})


def test_standalone_roundtrip_no_candidate_or_job(database):
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        first = start(c, chat).json()
        assert first["standalone"] and first["history"] == []
        assert finish(c, first["user"]["id"]).status_code == 200
        assert c.get("/api/workspace").json() == {"candidates": [], "jobs": []}
        assert c.get("/api/conversations").json()[0]["title"] == "你好"
    with TestClient(create_app(database)) as c:
        saved = c.get(f"/api/conversations/{chat}").json()
        assert [m["role"] for m in saved["messages"]] == ["user", "assistant"]
        second = start(c, chat, "继续").json()
        assert len(second["history"]) == 2
        other = c.post("/api/conversations").json()["id"]
        assert start(c, other).json()["history"] == []


def test_standalone_active_turn_and_restart(database):
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        turn = start(c, chat).json()["user"]["id"]
        assert start(c, chat).status_code >= 400
        assert c.patch(f"/api/conversations/{chat}", json={"job_id": None}).status_code >= 400
        with database.session_factory() as session:
            recover_conversations(session)
            session.commit()
        assert finish(c, turn).status_code >= 400
        saved = c.get(f"/api/conversations/{chat}").json()
        assert saved["messages"][0]["metadata_json"]["delivery_status"] == "cancelled"
        next_turn = start(c, chat).json()["user"]["id"]
        assert finish(c, next_turn).status_code == 200
        assert finish(c, next_turn).status_code >= 400


def test_context_calibration_survives_reload_and_stays_in_its_conversation(database):
    snapshot = {"version": 1, "model": "synthetic", "source": "reported", "used_tokens": 1200,
                "calibration": {"prompt_tokens": 1200, "estimated_tokens": 300, "envelope_hash": "a" * 64}}
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        first = start(c, chat).json()
        assert first["previous_context_usage"] is None
        done = c.post(f"/api/pi/chat-turns/{first['user']['id']}/complete",
                      json={"content": "已完成", "usage": {"context_usage": snapshot, "total_tokens": 9999}})
        assert done.status_code == 200
    with TestClient(create_app(database)) as c:
        second = start(c, chat).json()
        assert second["previous_context_usage"] == snapshot
        assert "calibration" not in str(second["history"])  # Numeric telemetry is not model conversation data.
        other = c.post("/api/conversations").json()["id"]
        assert start(c, other).json()["previous_context_usage"] is None
        finish(c, second["user"]["id"])
        assert start(c, chat).json()["previous_context_usage"] is None  # Do not resurrect an older sample.


def test_standalone_quote_and_link_scope(database):
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        other = c.post("/api/conversations").json()["id"]
        turn = start(c, chat).json()["user"]["id"]
        assistant = finish(c, turn).json()["assistant"]
        assert start(c, other, quoted_text="你好", quoted_message_id=assistant["id"]).status_code >= 400
        assert c.patch(f"/api/conversations/{chat}", json={"job_id": "missing"}).status_code == 404
        candidate = c.post("/api/candidates", json={"name": "合成用户"}).json()
        job = c.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "合成公司", "role": "合成岗位", "jd_raw": "合成JD"}).json()
        assert c.patch(f"/api/conversations/{chat}", json={"job_id": job["id"]}).status_code == 200
        body = start(c, chat, quoted_text="你好", quoted_message_id=assistant["id"]).json()
        assert "合成JD" not in body["system_prompt"]
        assert "合成JD" in body["prompt"]
        assert finish(c, body["user"]["id"]).status_code == 200
        assert c.patch(f"/api/conversations/{chat}", json={"job_id": None}).json()["job_id"] is None
        unlinked = start(c, chat).json()
        assert "合成JD" not in unlinked["system_prompt"] + unlinked["prompt"]


def test_standalone_attachment_permission_and_request_audit(database):
    root = AgentSettings.from_env().workspace_root
    root.mkdir(parents=True, exist_ok=True)
    (root / "synthetic-chat.txt").write_text("synthetic attachment", encoding="utf-8")
    (root / "other-chat.txt").write_text("unselected", encoding="utf-8")
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        assert start(c, chat, attachment_paths=["../outside.txt"]).status_code >= 400
        turn = start(c, chat, attachment_paths=["synthetic-chat.txt"]).json()["user"]["id"]
        def tool(p):
            return c.post(f"/api/pi/chat-tools/{turn}/read_workspace_file", json={"arguments": {"path": p}, "idempotency_key": "synthetic-read"})
        assert tool("synthetic-chat.txt").json()["result"]["text"] == "synthetic attachment"
        assert tool("other-chat.txt").status_code >= 400
        path = f"/api/pi/chat-records/{turn}/requests"
        assert c.post(path, json={"sequence": 2, "record": {}}).status_code >= 400
        assert c.post(path, json={"sequence": 1, "record": {"synthetic": True}}).status_code == 200
        c.patch("/api/settings/permissions", json={"workspace_read": "deny"})
        assert tool("synthetic-chat.txt").status_code >= 400
        assert c.post(f"/api/pi/chat-turns/{turn}/fail", json={"delivery_status": "failed", "message": "synthetic failure"}).status_code == 200
        assert c.post(path, json={"sequence": 2, "record": {}}).status_code >= 400


def test_standalone_knowledge_without_profile(database):
    with TestClient(create_app(database)) as c:
        assert c.get("/api/interview-knowledge").json() == {"sources": [], "briefs": []}


def test_standalone_web_tools_without_job_and_permission_revocation(database, monkeypatch):
    from types import SimpleNamespace
    from integrations.web import WebClient
    calls = []

    def search(self, query, *, max_results):
        calls.append(("search", query, max_results))
        return [SimpleNamespace(title="Synthetic public source", url="https://example.com/current")]

    def read(self, url, *, max_chars):
        calls.append(("read", url, max_chars))
        return SimpleNamespace(final_url=url, title="Synthetic public source", description="",
                               text="Synthetic current information", headings=[], content_type="text/html",
                               content_sha256="synthetic", truncated=False)

    monkeypatch.setattr(WebClient, "search", search)
    monkeypatch.setattr(WebClient, "read_page", read)
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        boot = start(c, chat, "查询实时公开信息").json()
        assert {"search_web", "read_web_page"} <= {t["name"] for t in boot["tools"]}
        assert c.get("/api/workspace").json() == {"candidates": [], "jobs": []}
        turn = boot["user"]["id"]

        def tool(name, arguments):
            return c.post(f"/api/pi/chat-tools/{turn}/{name}",
                          json={"arguments": arguments, "idempotency_key": "synthetic-web-check-" + name})

        found = tool("search_web", {"query": "current information", "max_results": 2})
        assert found.status_code == 200
        assert found.json()["result"]["results"][0]["url"] == "https://example.com/current"
        page = tool("read_web_page", {"url": "https://example.com/current", "max_chars": 2000})
        assert page.json()["result"]["text"] == "Synthetic current information"
        assert len(calls) == 2
        assert c.patch("/api/settings/permissions", json={"web_access": "deny"}).status_code == 200
        assert tool("search_web", {"query": "denied query"}).status_code >= 400
        assert tool("read_web_page", {"url": "https://example.com/current"}).status_code >= 400
        assert len(calls) == 2  # Revocation is checked at execution, not only bootstrap.
        finish(c, turn)
        boot2 = start(c, chat).json()
        assert not {"search_web", "read_web_page"} & {t["name"] for t in boot2["tools"]}
        finish(c, boot2["user"]["id"])
        assert tool("search_web", {"query": "finished turn"}).status_code >= 400
        assert len(calls) == 2


def test_standalone_web_read_retains_private_address_guard(database):
    with TestClient(create_app(database)) as c:
        chat = c.post("/api/conversations").json()["id"]
        turn = start(c, chat).json()["user"]["id"]
        response = c.post(f"/api/pi/chat-tools/{turn}/read_web_page", json={
            "arguments": {"url": "https://127.0.0.1/private"},
            "idempotency_key": "synthetic-ssrf-check",
        })
        assert response.status_code >= 400
        assert "web_private_address_denied" in response.text


def test_standalone_web_ask_requires_host_confirmation_and_rechecks_deny(database, monkeypatch):
    from integrations.web import WebClient
    calls = []
    monkeypatch.setattr(WebClient, "search", lambda self, query, **kw: calls.append(query) or [])
    with TestClient(create_app(database)) as c:
        c.patch("/api/settings/permissions", json={"web_access": "ask"})
        chat = c.post("/api/conversations").json()["id"]
        boot = start(c, chat).json()
        assert "search_web" in {t["name"] for t in boot["tools"]}
        endpoint = f"/api/pi/chat-tools/{boot['user']['id']}/search_web"
        body = {"arguments": {"query": "synthetic search", "approval_confirmed": True}, "idempotency_key": "synthetic-confirm"}
        assert c.post(endpoint, json=body).json()["code"] == "web_approval_required"
        assert calls == []  # A model argument cannot approve the host envelope.
        body["arguments"].pop("approval_confirmed")
        body["approval_confirmed"] = True
        assert c.post(endpoint, json=body).json()["code"] == "web_approval_required"
        import base64, hashlib, hmac, json, time
        monkeypatch.setenv("FETCHCV_APPROVAL_KEY", "synthetic-approval-key")
        def token(arguments, expires=None):
            claim = {"message_id": boot["user"]["id"], "tool": "search_web", "call_id": body["idempotency_key"],
                     "arguments": arguments, "expires_at": expires or time.time()+300}
            encoded=base64.urlsafe_b64encode(json.dumps(claim).encode()).decode().rstrip("=")
            signature=hmac.new(b"synthetic-approval-key", ("fetchcv-web-approval-v1:"+encoded).encode(), hashlib.sha256).hexdigest()
            return encoded+"."+signature
        body["approval_token"] = token({"query": "different"})
        assert c.post(endpoint, json=body).json()["code"] == "web_approval_required"
        body["approval_token"] = token(body["arguments"], time.time()-1)
        assert c.post(endpoint, json=body).json()["code"] == "web_approval_required"
        body["approval_token"] = token(body["arguments"])
        assert c.post(endpoint, json=body).status_code == 200
        assert c.post(endpoint, json=body).status_code == 200  # receipt replay; no second network call
        changed={**body, "arguments": {"query": "changed"}}
        assert c.post(endpoint, json=changed).json()["code"] == "idempotency_conflict"
        assert calls == ["synthetic search"]
        saved = c.get(f"/api/conversations/{chat}").json()
        assert saved["messages"][0]["metadata_json"]["web_approvals"][0]["tool"] == "search_web"
        c.patch("/api/settings/permissions", json={"web_access": "deny"})
        assert c.post(endpoint, json=body).json()["code"] == "tool_permission_denied"
        assert calls == ["synthetic search"]
