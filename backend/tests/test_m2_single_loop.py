import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from applyos_api.main import create_app
from applyos_domain.models import AgentMessage, AgentRun, AgentTask
from pi_flow_helpers import PROVIDER


def seed(client):
    candidate = client.post("/api/candidates", json={"name": "M2 synthetic"}).json()
    job = client.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "Test", "role": "Analyst", "jd_raw": "Use SQL to analyze data"}).json()
    payload = {"candidate_id": candidate["id"], "job_id": job["id"]}
    run = client.post("/api/agent-runs", json=payload, headers={"Idempotency-Key": "m2-test"}).json()
    return payload, job, run


@pytest.mark.parametrize("suffix", ["messages", "messages/stream", "messages/queue"])
def test_retired_conversation_routes_never_write_or_dispatch(database, suffix):
    with TestClient(create_app(database)) as client:
        _, job, run = seed(client)
        response = client.post(f"/api/jobs/{job['id']}/{suffix}", json={"content": "never dispatch"})
        assert response.status_code == 409
        assert response.json()["detail"] == "desktop_agent_required"
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert workspace["messages"] == [] and workspace["queued_messages"] == []
        assert workspace["run"]["id"] == run["id"]


def test_run_creation_is_idempotent_and_does_not_call_a_provider(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_ALLOW_MOCK_RUNTIME", "0")
    monkeypatch.delenv("FETCHCV_PROVIDER_API_KEY", raising=False)
    with TestClient(create_app(database)) as client:
        payload, _, run = seed(client)
        assert run["current_stage"] == "created" and run["status"] == "created"
        assert run["run_type"] == "pi_native_job_asset_pipeline"
        duplicate = client.post("/api/agent-runs", json=payload, headers={"Idempotency-Key": "m2-test"})
        assert duplicate.status_code == 201 and duplicate.json()["id"] == run["id"]
        changed = {**payload, "job_id": "different-job"}
        assert client.post("/api/agent-runs", json=changed, headers={"Idempotency-Key": "m2-test"}).status_code == 409
        assert client.get(f"/api/agent-runs/{run['id']}/tasks").json() == []


@pytest.mark.parametrize("action", ["pause", "cancel"])
def test_stop_cannot_be_overwritten_by_late_pi_completion(database, action):
    with TestClient(create_app(database)) as client:
        _, job, run = seed(client)
        started = client.post(f"/api/pi/runs/{run['id']}/tasks", json={"kind": "start", "host_id": "test-host", "provider": PROVIDER}).json()
        task_id = started["task_id"]
        assert client.post(f"/api/agent-tasks/{task_id}/{action}").status_code == 200
        assert client.get(f"/api/pi/tasks/{task_id}/control").json()["signal"] == action
        tool = client.post(f"/api/pi/runs/{run['id']}/task-tools/inspect_application_workspace", json={"arguments": {}, "idempotency_key": "after-stop"})
        assert tool.status_code == 422 and tool.json()["code"] == "task_not_running"
        rejected = client.post(f"/api/pi/tasks/{task_id}/complete", json={"content": "late success"})
        assert rejected.status_code == 422 and rejected.json()["code"] == "task_completion_rejected"
        assert client.get(f"/api/jobs/{job['id']}/workspace").json()["messages"] == []
        status = "paused" if action == "pause" else "cancelled"
        assert client.post(f"/api/pi/tasks/{task_id}/fail", json={"status": status, "message": "stopped"}).json()["task"]["status"] == status
        assert client.post(f"/api/pi/tasks/{task_id}/complete", json={"content": "even later"}).status_code == 422


def test_old_run_message_and_trace_remain_readable(database):
    with TestClient(create_app(database)) as client:
        _, job, run = seed(client)
        with database.session() as session:
            stored = session.get(AgentRun, run["id"])
            stored.run_type = "conversation_tools"
            session.add(AgentMessage(candidate_id=stored.candidate_id, job_id=job["id"], run_id=stored.id, role="assistant", content="历史回答", metadata_json={"runtime": "legacy"}))
        assert client.get(f"/api/jobs/{job['id']}/workspace").json()["messages"][0]["content"] == "历史回答"
        assert client.get(f"/api/agent-runs/{run['id']}").json()["run_type"] == "conversation_tools"
        assert "event: trace" in client.get(f"/api/agent-runs/{run['id']}/events").text
        for path in [f"/api/agent-runs/{run['id']}/resume", f"/api/agent-runs/{run['id']}/retry"]:
            assert client.post(path).status_code == 409
        with database.session() as session:
            assert list(session.scalars(select(AgentTask)).all()) == []


def test_task_tools_reject_out_of_stage_and_replay_without_duplicate_effect(database):
    with TestClient(create_app(database)) as client:
        _, _, run = seed(client)
        started = client.post(f"/api/pi/runs/{run['id']}/tasks", json={"kind": "start", "host_id": "test-host", "provider": PROVIDER}).json()
        assert {"search_web", "read_web_page", "read_workspace_file", "prepare_job_review"} <= {t["name"] for t in started["tools"]}
        blocked = client.post(f"/api/pi/runs/{run['id']}/task-tools/apply_and_verify_resume", json={"task_id": started["task_id"], "arguments": {}, "idempotency_key": "premature"})
        assert blocked.status_code in {403, 422}
        payload = {"task_id": started["task_id"], "arguments": {"analysis": {"responsibilities": [{"text": "Analyze data", "source_quote": "Use SQL to analyze data"}], "summary": "分析岗位"}}, "idempotency_key": "one-write"}
        path = f"/api/pi/runs/{run['id']}/task-tools/prepare_job_review"
        first = client.post(path, json=payload)
        assert first.status_code == 200, first.text
        replay = client.post(path, json=payload)
        # A repeated key must never create another approval, whether returned
        # from the ledger or rejected because the run already changed stage.
        assert replay.status_code in {200, 422}, replay.text
        approvals = client.get(f"/api/agent-runs/{run['id']}/approvals").json()
        assert len([a for a in approvals if a["action_type"] == "confirm_relevant_facts"]) == 1


def test_late_old_host_failure_does_not_overwrite_replacement_task(database):
    with TestClient(create_app(database)) as client:
        _, _, run = seed(client)
        path = f"/api/pi/runs/{run['id']}/tasks"
        old_response = client.post(path, json={"kind": "start", "host_id": "old-host", "provider": PROVIDER})
        new_response = client.post(path, json={"kind": "resume", "host_id": "new-host", "provider": PROVIDER})
        assert old_response.status_code == new_response.status_code == 200
        old, new = old_response.json(), new_response.json()
        late = client.post(f"/api/pi/tasks/{old['task_id']}/fail", json={"status": "failed", "message": "late error"})
        assert late.json()["task"]["status"] == "paused"
        assert client.get(f"/api/agent-runs/{run['id']}").json()["status"] == "running"
        assert client.get(f"/api/pi/tasks/{new['task_id']}/control").json()["signal"] is None
        stale_tool = client.post(f"/api/pi/runs/{run['id']}/task-tools/inspect_application_workspace", json={"task_id": old["task_id"], "arguments": {}, "idempotency_key": "late-old-host"})
        assert stale_tool.status_code == 422 and stale_tool.json()["code"] == "task_scope_mismatch"


def test_run_cancel_reaches_host_and_cannot_be_restarted_or_overwritten(database):
    with TestClient(create_app(database)) as client:
        _, _, run = seed(client)
        path = f"/api/pi/runs/{run['id']}/tasks"
        started = client.post(path, json={"kind": "start", "host_id": "test-host", "provider": PROVIDER}).json()
        assert client.post(f"/api/agent-runs/{run['id']}/cancel").status_code == 200
        assert client.get(f"/api/pi/tasks/{started['task_id']}/control").json()["signal"] == "cancel"
        late = client.post(f"/api/pi/tasks/{started['task_id']}/fail", json={"status": "failed", "message": "transport failure during stop"})
        assert late.json()["task"]["status"] == "cancelled"
        assert client.post(path, json={"kind": "retry", "host_id": "test-host", "provider": PROVIDER}).status_code == 409
