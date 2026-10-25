from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

from fastapi.testclient import TestClient
from sqlalchemy import select

from applyos_api.main import create_app
from applyos_api.startup_trace import mark_startup
from applyos_domain.models import Candidate, Experience, Fact, Job


TOKEN = "synthetic-startup-token"
NONCE = "synthetic-startup-instance"
HEADERS = {"X-FetchCV-Control-Token": TOKEN}


def enable_gate(monkeypatch):
    monkeypatch.setenv("FETCHCV_DESKTOP_STARTUP_GATE", "1")
    monkeypatch.setenv("FETCHCV_CONTROL_TOKEN", TOKEN)
    monkeypatch.setenv("FETCHCV_INSTANCE_NONCE", NONCE)


def test_startup_gate_preserves_reads_and_blocks_business_writes(database, monkeypatch):
    enable_gate(monkeypatch)
    with TestClient(create_app(database), headers=HEADERS) as client:
        assert client.get("/health").json()["instance_nonce"] == NONCE
        assert client.get("/api/workspace").status_code == 200
        assert client.get("/api/conversations").status_code == 200
        for method, path in [
            ("POST", "/api/candidates"),
            ("POST", "/api/conversations"),
            ("POST", "/api/pi/jobs/missing/turns"),
            ("PATCH", "/api/settings/general"),
            ("DELETE", "/api/conversations/missing"),
            ("PUT", "/api/resumes/missing/pdf"),
            ("GET", "/api/resumes/missing/docx"),
        ]:
            response = client.request(method, path, content=b"{}")
            assert response.status_code == 503, path
            assert response.json()["detail"] == "agent_startup_pending"
        assert client.get("/api/candidates").json() == []


def test_only_authenticated_current_instance_can_release_gate(database, monkeypatch):
    enable_gate(monkeypatch)
    with TestClient(create_app(database)) as client:
        assert client.get("/api/workspace").status_code == 403
        assert client.post("/api/runtime/startup-ready", json={"instance_nonce": NONCE}).status_code == 403
        assert client.post("/api/runtime/startup-ready", headers=HEADERS, json={"instance_nonce": "other-instance"}).status_code == 403
        assert client.post("/api/runtime/startup-ready", headers=HEADERS, json={"instance_nonce": "另一个实例"}).status_code == 403
        assert client.post("/api/candidates", headers=HEADERS, json={"name": "Blocked"}).status_code == 503
        ready = client.post("/api/runtime/startup-ready", headers=HEADERS, json={"instance_nonce": NONCE})
        assert ready.json() == {"agent_ready": True}
        assert client.post("/api/candidates", headers=HEADERS, json={"name": "Ready"}).status_code == 201


def test_internal_startup_requests_remain_available(database, monkeypatch):
    enable_gate(monkeypatch)
    # configure_runtime updates environment; have monkeypatch restore all keys.
    for key in ("AGENT_RUNTIME", "PROVIDER_NAME", "PROVIDER_PROTOCOL", "PROVIDER_BASE_URL", "PROVIDER_API_KEY", "PROVIDER_MODEL"):
        monkeypatch.setenv("FETCHCV_" + key, os.getenv("FETCHCV_" + key, ""))
    with TestClient(create_app(database), headers=HEADERS) as client:
        assert client.post("/api/runtime/configure", json={
            "provider_name": "Synthetic", "protocol": "openai", "base_url": "https://example.com",
            "api_key": "synthetic-not-a-secret", "model": "test-model",
        }).status_code == 200
        assert client.post("/api/pi/hosts/reconcile", json={"host_id": "synthetic-host"}).status_code == 200
        assert client.post("/api/conversations").status_code == 503


def test_standalone_api_keeps_existing_write_behavior(database, monkeypatch):
    monkeypatch.delenv("FETCHCV_DESKTOP_STARTUP_GATE", raising=False)
    monkeypatch.delenv("FETCHCV_CONTROL_TOKEN", raising=False)
    with TestClient(create_app(database)) as client:
        assert client.post("/api/candidates", json={"name": "Standalone"}).status_code == 201


def test_read_only_browsing_does_not_run_legacy_backfill_or_skill_sync(database, monkeypatch):
    with database.session() as session:
        session.add(Candidate(id="candidate", name="Synthetic"))
        session.flush()
        session.add(Job(id="job", candidate_id="candidate", company="Synthetic", role="Engineer"))
        session.add(Fact(candidate_id="candidate", category="experience", content="Synthetic experience"))
    enable_gate(monkeypatch)
    with TestClient(create_app(database), headers=HEADERS) as client:
        assert client.get("/api/skills").json() == []
        assert client.get("/api/candidates/candidate/library").status_code == 200
        assert client.get("/api/jobs/job/workspace").status_code == 200
        with database.session() as session:
            assert session.scalar(select(Experience.id)) is None
        client.post("/api/runtime/startup-ready", json={"instance_nonce": NONCE})
        assert client.get("/api/candidates/candidate/library").status_code == 200
        with database.session() as session:
            assert session.scalar(select(Experience.id)) is not None


def test_startup_trace_is_opt_in_and_pipe_failure_is_nonfatal(monkeypatch, capsys):
    monkeypatch.delenv("FETCHCV_STARTUP_TRACE_ID", raising=False)
    mark_startup("python.schema_ready", 1.25)
    assert capsys.readouterr().err == ""
    monkeypatch.setenv("FETCHCV_STARTUP_TRACE_ID", "synthetic-trace")
    mark_startup("python.schema_ready", 1.25)
    line = capsys.readouterr().err
    event = json.loads(line.removeprefix("FETCHCV_STARTUP "))
    assert set(event) == {"traceId", "stage", "elapsedMs", "timestampMs", "durationMs"}
    assert event["durationMs"] == 1.25

    class ClosedPipe:
        def write(self, _value):
            raise BrokenPipeError()

    monkeypatch.setattr(sys, "stderr", ClosedPipe())
    mark_startup("python.lifespan_ready")


def test_fresh_import_and_lifespan_are_traced_without_optional_heavy_modules(tmp_path):
    env = {**os.environ, "FETCHCV_STARTUP_TRACE_ID": "synthetic-import-trace",
           "FETCHCV_DATABASE_URL": f"sqlite:///{(tmp_path / 'startup.db').as_posix()}",
           "FETCHCV_ARTIFACT_ROOT": str(tmp_path / "artifacts"),
           "FETCHCV_WORKSPACE_ROOT": str(tmp_path / "workspace"),
           "FETCHCV_SETTINGS_FILE": str(tmp_path / "settings.json")}
    script = """
import asyncio, json, sys
from applyos_api.main import app
async def check():
    async with app.router.lifespan_context(app):
        print(json.dumps([name for name in ('mcp', 'pypdf', 'jsonschema', 'reportlab') if name in sys.modules]))
asyncio.run(check())
"""
    result = subprocess.run([sys.executable, "-c", script], cwd=Path(__file__).resolve().parents[1],
                            env=env, text=True, capture_output=True, timeout=30, check=True)
    assert json.loads(result.stdout) == []
    events = [json.loads(line.removeprefix("FETCHCV_STARTUP ")) for line in result.stderr.splitlines()
              if line.startswith("FETCHCV_STARTUP ")]
    assert [event["stage"] for event in events] == [
        "python.entry", "python.imports_complete", "python.schema_ready", "python.index_ready", "python.lifespan_ready",
    ]
    assert all(event["traceId"] == "synthetic-import-trace" for event in events)
    assert all(a["elapsedMs"] <= b["elapsedMs"] for a, b in zip(events, events[1:]))
