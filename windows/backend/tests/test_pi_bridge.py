from fastapi.testclient import TestClient

from applyos_api.main import create_app


def _workspace(client: TestClient):
    candidate = client.post("/api/candidates", json={"name": "Pi user"}).json()
    job = client.post(
        "/api/jobs",
        json={"candidate_id": candidate["id"], "company": "Example", "role": "Data Analyst", "jd_raw": "Use SQL to analyze data"},
    ).json()
    return candidate, job


def _turn_payload(content="请读取当前岗位", task_kind=None):
    payload = {
        "content": content,
        "thinking_level": "balanced",
        "provider": {
            "provider_name": "Test provider",
            "protocol": "openai",
            "base_url": "https://api.example.com",
            "model": "test-model",
        },
    }
    if task_kind:
        payload["task_kind"] = task_kind
    return payload


def test_pi_turn_bootstrap_exposes_gateway_and_persists_messages(database):
    with TestClient(create_app(database)) as client:
        _, job = _workspace(client)
        started = client.post(f"/api/pi/jobs/{job['id']}/turns", json=_turn_payload())
        assert started.status_code == 200
        body = started.json()
        assert body["user"]["metadata_json"]["agent_runtime"] == "pi"
        assert body["prompt"] == "请读取当前岗位"
        assert body["history"] == []
        assert "Test provider" in body["system_prompt"]
        assert any(tool["name"] == "read_job_workspace_context" for tool in body["tools"])

        executed = client.post(
            f"/api/pi/runs/{body['run_id']}/tools/read_job_workspace_context",
            json={"arguments": {"sections": ["job"]}, "idempotency_key": "pi-test-context-read"},
        )
        assert executed.status_code == 200
        assert executed.json()["result"]["data"]["job"]["role"] == "Data Analyst"

        completed = client.post(
            f"/api/pi/turns/{body['user']['id']}/complete",
            json={
                "content": "已读取岗位。",
                "usage": {"runtime": "pi", "total_tokens": 42},
                "processing_trace": [{"id": "tool-1", "label": "读取岗位", "detail": "已完成", "status": "completed"}],
                "processing_duration_ms": 120,
            },
        )
        assert completed.status_code == 200
        assert completed.json()["assistant"]["metadata_json"]["agent_runtime"] == "pi"
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert [message["role"] for message in workspace["messages"]] == ["user", "assistant"]
        assert workspace["messages"][0]["metadata_json"]["delivery_status"] == "completed"
        assert workspace["messages"][1]["content"] == "已读取岗位。"


def test_pi_interview_research_exposes_dedicated_multi_source_evidence_tools(database):
    with TestClient(create_app(database)) as client:
        _, job = _workspace(client)
        started = client.post(
            f"/api/pi/jobs/{job['id']}/turns",
            json=_turn_payload("帮我调研这个岗位的小红书面经", task_kind="interview_research"),
        )
        assert started.status_code == 200
        body = started.json()
        names = {tool["name"] for tool in body["tools"]}
        assert {
            "read_job_workspace_context",
            "search_interview_knowledge",
            "discover_interview_sources",
            "capture_interview_source",
            "analyze_interview_source",
            "build_interview_brief",
        }.issubset(names)
        assert {"search_web", "read_web_page", "open_browser_page", "read_browser_page"}.isdisjoint(names)
        assert "牛客" in body["system_prompt"]
        assert "以小红书公开面经为主" in body["system_prompt"]
        assert "牛客等专业社区为补充" in body["system_prompt"]

        bypass = client.post(
            f"/api/pi/runs/{body['run_id']}/tools/search_web",
            json={
                "arguments": {"query": "site:nowcoder.com 面经"},
                "idempotency_key": "pi-interview-generic-search",
                "task_kind": "interview_research",
            },
        )
        assert bypass.status_code == 422
        assert bypass.json()["code"] == "interview_research_tool_not_allowed"

        completed = client.post(
            f"/api/pi/turns/{body['user']['id']}/complete",
            json={
                "content": "我找到了 5 篇牛客面经并完成总结。",
                "task_kind": "interview_research",
                "processing_duration_ms": 20,
            },
        )
        assert completed.status_code == 200
        assistant = completed.json()["assistant"]
        assert "没有形成可核查的面经简报" in assistant["content"]
        assert "5 篇牛客" not in assistant["content"]
        assert assistant["metadata_json"]["research_result"]["status"] == "completed_without_brief"


def test_pi_model_can_semantically_switch_a_plain_conversation_to_interview_research(database):
    with TestClient(create_app(database)) as client:
        _, job = _workspace(client)
        started = client.post(
            f"/api/pi/jobs/{job['id']}/turns",
            json=_turn_payload("重新帮我找这个岗位的面试经验帖子，并总结可能会问的问题"),
        )
        assert started.status_code == 200
        body = started.json()
        assert any(tool["name"] == "activate_interview_research" for tool in body["tools"])
        assert "第一步必须调用 activate_interview_research" in body["system_prompt"]

        activated = client.post(
            f"/api/pi/runs/{body['run_id']}/tools/activate_interview_research",
            json={
                "arguments": {"reason": "用户要求查找面试经验帖并归纳面试问题"},
                "idempotency_key": "pi-activate-interview-research",
            },
        )
        assert activated.status_code == 200
        switched = activated.json()
        assert switched["task_kind"] == "interview_research"
        switched_names = {tool["name"] for tool in switched["tools"]}
        assert "discover_interview_sources" in switched_names
        assert "search_web" not in switched_names

        blocked_generic_search = client.post(
            f"/api/pi/runs/{body['run_id']}/tools/search_web",
            json={
                "arguments": {"query": "滴滴策略运营 牛客面经"},
                "idempotency_key": "pi-generic-search-after-activation",
            },
        )
        assert blocked_generic_search.status_code == 422
        assert blocked_generic_search.json()["code"] == "interview_research_tool_not_allowed"

        completed = client.post(
            f"/api/pi/turns/{body['user']['id']}/complete",
            json={
                "content": "未核验完成。",
                "processing_duration_ms": 20,
            },
        )
        assert completed.status_code == 200
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert workspace["messages"][0]["metadata_json"]["task_kind"] == "interview_research"
        assert "没有形成可核查的面经简报" in workspace["messages"][1]["content"]


def test_pi_tool_bridge_preserves_workspace_approval(database, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_WORKSPACE_ROOT", str(tmp_path))
    with TestClient(create_app(database)) as client:
        _, job = _workspace(client)
        body = client.post(f"/api/pi/jobs/{job['id']}/turns", json=_turn_payload("写入测试文件")).json()
        blocked = client.post(
            f"/api/pi/runs/{body['run_id']}/tools/write_workspace_file",
            json={
                "arguments": {"path": "notes/test.md", "content": "draft", "overwrite": False},
                "idempotency_key": "pi-test-write-approval",
            },
        )
        assert blocked.status_code == 403
        assert blocked.json()["code"] == "approval_required"
        assert not (tmp_path / "notes" / "test.md").exists()
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert any(item["action_type"] == "workspace_write" and item["status"] == "pending" for item in workspace["approvals"])


def test_pi_task_bootstrap_replaces_python_agent_worker_loop(database):
    with TestClient(create_app(database)) as client:
        candidate, job = _workspace(client)
        run = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "pi-task-run"},
            json={"candidate_id": candidate["id"], "job_id": job["id"], "auto_start": False},
        ).json()
        started = client.post(
            f"/api/pi/runs/{run['id']}/tasks",
            json={"kind": "start", "provider": _turn_payload()["provider"]},
        )
        assert started.status_code == 200
        body = started.json()
        assert body["task"]["status"] == "running"
        assert body["task"]["payload_json"]["agent_runtime"] == "pi"
        tool_names = {tool["name"] for tool in body["tools"]}
        assert {"inspect_application_workspace", "prepare_job_review"}.issubset(tool_names)
        assert "validate_run_input" not in tool_names
        assert "analyze_job" not in tool_names

        executed = client.post(
            f"/api/pi/runs/{run['id']}/task-tools/prepare_job_review",
            json={
                "arguments": {
                    "analysis": {
                        "responsibilities": [{"text": "使用 SQL 分析数据", "source_quote": "Use SQL to analyze data"}],
                        "hard_requirements": [],
                        "preferred_requirements": [],
                        "keywords": ["SQL"],
                        "competencies": ["数据分析"],
                        "uncertain_items": [],
                        "summary": "岗位需要使用 SQL 完成数据分析。",
                    },
                    "fact_ranking": [],
                },
                "idempotency_key": "pi-task-prepare-job-review",
            },
        )
        assert executed.status_code == 200
        assert executed.json()["stage"] == "awaiting_fact_review"
        assert executed.json()["result"]["requires_user_action"] is True
        refreshed = client.get(f"/api/pi/runs/{run['id']}/task-tools")
        assert refreshed.status_code == 200
        refreshed_names = {tool["name"] for tool in refreshed.json()["tools"]}
        assert "prepare_resume_review" in refreshed_names
        assert "generate_resume_strategy" not in refreshed_names

        completed = client.post(
            f"/api/pi/tasks/{body['task_id']}/complete",
            json={"content": "已完成输入校验，准备分析岗位。", "usage": {"total_tokens": 20}, "processing_duration_ms": 80},
        )
        assert completed.status_code == 200
        assert completed.json()["task"]["status"] == "paused"
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert workspace["messages"][-1]["metadata_json"]["agent_runtime"] == "pi"


def test_pi_task_checkpoint_survives_electron_host_restart(database):
    with TestClient(create_app(database)) as client:
        candidate, job = _workspace(client)
        run = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "pi-checkpoint-run"},
            json={"candidate_id": candidate["id"], "job_id": job["id"], "auto_start": False},
        ).json()
        first = client.post(
            f"/api/pi/runs/{run['id']}/tasks",
            json={"kind": "start", "host_id": "electron-host-a", "provider": _turn_payload()["provider"]},
        ).json()
        assert len(first["capability_fingerprint"]) == 64
        assert first["prior_checkpoint_compatible"] is True
        saved = client.post(
            f"/api/pi/tasks/{first['task_id']}/checkpoint",
            json={
                "sequence": 3,
                "turn_number": 2,
                "phase": "working",
                "partial_text": "已读取岗位，准备核对经历。",
                "processing_trace": [{"id": "tool-1", "label": "读取工作区", "status": "completed"}],
            },
        )
        assert saved.status_code == 200
        assert saved.json()["checkpoint"]["sequence"] == 3
        assert saved.json()["checkpoint"]["capability_fingerprint"] == first["capability_fingerprint"]

        changed = client.patch("/api/settings/permissions", json={"web_access": "deny"})
        assert changed.status_code == 200

        resumed = client.post(
            f"/api/pi/runs/{run['id']}/tasks",
            json={"kind": "resume", "host_id": "electron-host-b", "provider": _turn_payload()["provider"]},
        )
        assert resumed.status_code == 200
        body = resumed.json()
        assert body["prior_checkpoint_compatible"] is False
        assert body["capability_fingerprint"] != first["capability_fingerprint"]
        assert "permission policy changed" in body["prompt"]
        assert body["prior_checkpoint"]["partial_text"] == "已读取岗位，准备核对经历。"
        assert body["task"]["payload_json"]["host_id"] == "electron-host-b"
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        old_task = next(item for item in workspace["tasks"] if item["id"] == first["task_id"])
        assert old_task["status"] == "paused"
        assert old_task["result_json"]["stop_reason"] == "host_restarted"


def test_pi_host_reconciliation_releases_orphaned_running_tasks(database):
    with TestClient(create_app(database)) as client:
        candidate, job = _workspace(client)
        run = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "pi-orphan-run"},
            json={"candidate_id": candidate["id"], "job_id": job["id"], "auto_start": False},
        ).json()
        first = client.post(
            f"/api/pi/runs/{run['id']}/tasks",
            json={"kind": "start", "host_id": "electron-old-host", "provider": _turn_payload()["provider"]},
        ).json()

        reconciled = client.post("/api/pi/hosts/reconcile", json={"host_id": "electron-new-host"})

        assert reconciled.status_code == 200
        assert reconciled.json() == {"recovered": 1, "outcome_unknown": 0}
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        task = next(item for item in workspace["tasks"] if item["id"] == first["task_id"])
        assert task["status"] == "paused"
        assert task["result_json"]["stop_reason"] == "host_restarted"
        assert workspace["run"]["status"] == "paused"


def test_pi_conversation_hydrates_native_history_instead_of_embedding_transcript(database):
    with TestClient(create_app(database)) as client:
        _, job = _workspace(client)
        first = client.post(f"/api/pi/jobs/{job['id']}/turns", json=_turn_payload("第一问")).json()
        client.post(
            f"/api/pi/turns/{first['user']['id']}/complete",
            json={"content": "第一答", "processing_duration_ms": 10},
        )
        second = client.post(f"/api/pi/jobs/{job['id']}/turns", json=_turn_payload("第二问")).json()
        assert second["prompt"] == "第二问"
        assert [(item["role"], item["content"]) for item in second["history"]] == [("user", "第一问"), ("assistant", "第一答")]
        assert "第一问" not in second["prompt"]
