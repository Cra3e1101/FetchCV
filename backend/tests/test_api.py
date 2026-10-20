import json

from fastapi.testclient import TestClient

from applyos_api.main import create_app
from applyos_domain.models import ResumeVersion


def test_health_and_fact_verification_flow(database):
    with TestClient(create_app(database)) as client:
        assert client.get("/health").json()["status"] == "ok"

        candidate_response = client.post("/api/candidates", json={"name": "测试候选人", "title": "数据产品经理"})
        assert candidate_response.status_code == 201
        candidate_id = candidate_response.json()["id"]

        fact_response = client.post(
            f"/api/candidates/{candidate_id}/facts",
            json={"category": "experience", "content": "负责需求分析", "source_type": "user_input"},
        )
        assert fact_response.status_code == 201
        assert fact_response.json()["verified"] is False
        fact_id = fact_response.json()["id"]

        verified = client.patch(
            f"/api/facts/{fact_id}/verification",
            json={"verified": True, "allowed_outputs": ["resume", "portfolio"]},
        )
        assert verified.status_code == 200
        assert verified.json()["verified"] is True
        assert verified.json()["version"] == 2


def test_job_requires_existing_candidate(database):
    with TestClient(create_app(database)) as client:
        response = client.post("/api/jobs", json={"candidate_id": "missing", "company": "A", "role": "B"})
        assert response.status_code == 404
        assert response.json()["detail"] == "candidate_not_found"


def test_job_can_be_renamed_and_deleted_without_deleting_candidate(database):
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "Job owner"}).json()
        job = client.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "Old", "role": "Analyst", "jd_raw": "Analyze data"}).json()
        updated = client.patch(f"/api/jobs/{job['id']}", json={"company": "New", "role": "Senior Analyst", "jd_raw": "Analyze data with SQL", "source_url": "https://jobs.example.com/123", "source_type": "web"})
        assert updated.status_code == 200
        assert updated.json()["company"] == "New"
        assert updated.json()["source_url"] == "https://jobs.example.com/123"
        assert client.delete(f"/api/jobs/{job['id']}").status_code == 204
        assert client.get(f"/api/candidates/{candidate['id']}").status_code == 200
        assert client.get(f"/api/jobs/{job['id']}/workspace").status_code == 404


def test_job_workspace_exposes_base_resume_before_tailored_version_exists(database):
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "测试候选人"}).json()
        job = client.post(
            "/api/jobs",
            json={"candidate_id": candidate["id"], "company": "示例公司", "role": "策略运营"},
        ).json()
        with database.session() as session:
            base_resume = ResumeVersion(
                candidate_id=candidate["id"],
                name="基础简历",
                content_json={"editor_snapshot": {"profile": {"name": "测试候选人"}, "sections": []}},
            )
            session.add(base_resume)
            session.flush()
            base_resume_id = base_resume.id

        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert workspace["resumes"] == []
        assert workspace["base_resumes"][0]["id"] == base_resume_id
        assert workspace["base_resumes"][0]["name"] == "基础简历"


def test_desktop_session_token_protects_local_data(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_CONTROL_TOKEN", "desktop-test-token")
    with TestClient(create_app(database)) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/api/workspace").status_code == 403
        authorized = client.get("/api/workspace", headers={"X-FetchCV-Control-Token": "desktop-test-token"})
        assert authorized.status_code == 200


def test_mock_runtime_is_reported_as_not_configured(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_AGENT_RUNTIME", "mock")
    monkeypatch.delenv("FETCHCV_PROVIDER_API_KEY", raising=False)
    with TestClient(create_app(database)) as client:
        runtime = client.get("/api/runtime/status").json()
        assert runtime["runtime"] == "mock"
        assert runtime["configured"] is False


def test_permission_settings_persist_and_gate_web_reads(database):
    with TestClient(create_app(database)) as client:
        initial = client.get("/api/settings/permissions")
        assert initial.status_code == 200
        assert initial.json()["web_access"] == "allow"
        updated = client.patch("/api/settings/permissions", json={"web_access": "deny", "workspace_write": "deny"})
        assert updated.status_code == 200
        assert updated.json()["web_access"] == "deny"
        assert updated.json()["workspace_write"] == "deny"
        assert client.get("/api/settings/permissions").json()["workspace_write"] == "deny"
        blocked = client.post("/api/web/read", json={"url": "https://example.com"})
        assert blocked.status_code == 403
        assert blocked.json()["detail"] == "web_access_disabled"


def test_permission_settings_are_written_to_json(database, tmp_path, monkeypatch):
    settings_path = tmp_path / "settings" / "settings.json"
    monkeypatch.setenv("FETCHCV_SETTINGS_FILE", str(settings_path))
    with TestClient(create_app(database)) as client:
        response = client.patch(
            "/api/settings/permissions",
            json={"web_access": "ask", "browser_bridge": "ask", "workspace_write": "deny"},
        )
        assert response.status_code == 200
        assert response.json()["web_access"] == "ask"
        stored = json.loads(settings_path.read_text(encoding="utf-8"))
        assert stored["permissions"] == response.json()


def test_general_appearance_settings_persist(database, tmp_path, monkeypatch):
    settings_path = tmp_path / "settings" / "appearance.json"
    monkeypatch.setenv("FETCHCV_SETTINGS_FILE", str(settings_path))
    with TestClient(create_app(database)) as client:
        initial = client.get("/api/settings/general")
        assert initial.status_code == 200
        assert initial.json()["theme"] == "system"
        response = client.patch(
            "/api/settings/general",
            json={"theme": "dark", "accent": "sage", "density": "compact"},
        )
        assert response.status_code == 200
        assert response.json() == {"theme": "dark", "accent": "sage", "density": "compact"}
        assert json.loads(settings_path.read_text(encoding="utf-8"))["general"] == response.json()


def test_streamable_http_mcp_configuration_is_selectable(database):
    with TestClient(create_app(database)) as client:
        response = client.post(
            "/api/mcp/servers",
            json={"name": "remote_tools", "transport": "streamable_http", "command": "https://mcp.example.com/mcp"},
        )
        assert response.status_code == 201
        assert response.json()["transport"] == "streamable_http"






def test_auto_start_cannot_reenter_python_loop(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_AGENT_RUNTIME", "mock")
    monkeypatch.setenv("FETCHCV_ALLOW_MOCK_RUNTIME", "0")
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "No mock user"}).json()
        job = client.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "A", "role": "B", "jd_raw": "分析数据"}).json()
        response = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "no-mock-run"},
            json={"candidate_id": candidate["id"], "job_id": job["id"], "auto_start": True},
        )
        assert response.status_code == 409
        assert response.json()["detail"] == "desktop_agent_required"
