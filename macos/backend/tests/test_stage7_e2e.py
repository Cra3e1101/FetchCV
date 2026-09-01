from pathlib import Path

from fastapi.testclient import TestClient

from applyos_agent.agents import AgentSuite
from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_api.main import create_app
from applyos_domain.models import Job


def _seed_ready_run(client: TestClient):
    candidate = client.post("/api/candidates", json={"name": "Stage 7 Candidate", "title": "AI Product"}).json()
    for content in [
        "Built a fact-grounded review workflow for 3000 records.",
        "Used Python and SQL to analyze model quality.",
        "Created an internal automation prototype.",
    ]:
        client.post(
            f"/api/candidates/{candidate['id']}/facts",
            json={"category": "experience", "content": content, "verified": True, "allowed_outputs": ["resume", "portfolio"]},
        )
    job = client.post(
        "/api/jobs",
        json={"candidate_id": candidate["id"], "company": "Example", "role": "AI Product Manager", "jd_raw": "Own AI product analysis\nUse Python and SQL\nBuild trustworthy workflows"},
    ).json()
    run = client.post(
        "/api/agent-runs",
        headers={"Idempotency-Key": "stage7-complete"},
        json={"candidate_id": candidate["id"], "job_id": job["id"]},
    ).json()
    approvals = client.get(f"/api/agent-runs/{run['id']}/approvals").json()
    fact_review = next(item for item in approvals if item["action_type"] == "confirm_relevant_facts")
    fact_ids = [item["fact_id"] for item in fact_review["decision_payload"]["items"]]
    client.post(
        f"/api/agent-runs/{run['id']}/facts/review",
        json={"approval_id": fact_review["id"], "fact_ids": fact_ids, "approved_by": "stage7"},
    )
    run = client.post(f"/api/agent-runs/{run['id']}/resume").json()
    proposals = client.get(f"/api/agent-runs/{run['id']}/proposals").json()
    approvals = client.get(f"/api/agent-runs/{run['id']}/approvals").json()
    review = next(item for item in approvals if item["action_type"] == "apply_resume_changes")
    client.post(
        f"/api/agent-runs/{run['id']}/proposals/review",
        json={
            "approval_id": review["id"],
            "decisions": [{"proposal_id": item["id"], "decision": "rejected" if item["risk_level"] == "high" else "accepted"} for item in proposals],
        },
    )
    client.post(f"/api/agent-runs/{run['id']}/resume")
    publish = next(item for item in client.get(f"/api/agent-runs/{run['id']}/approvals").json() if item["action_type"] == "publish_assets")
    client.post(f"/api/agent-runs/{run['id']}/publish-approval", json={"approval_id": publish["id"]})
    run = client.post(f"/api/agent-runs/{run['id']}/resume").json()
    workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
    return candidate, job, run, workspace


def test_runtime_uses_structured_mock_without_external_credentials():
    settings = AgentSettings(runtime=RuntimeMode.MOCK, workspace_root=Path.cwd())
    suite = AgentSuite(settings=settings)
    job = Job(candidate_id="candidate", company="Example", role="Analyst", jd_raw="Analyze product data\nUse SQL")
    analysis, runtime = suite.analyze_jd(job)
    assert analysis.responsibilities
    assert runtime.usage["runtime"] == "mock"
    assert runtime.session_id.startswith("mock:")


def test_stage7_asset_flow_builds_pdf_portfolio_and_submitted_snapshot(database, tmp_path, monkeypatch):
    import applyos_harness.assets as assets_module
    import integrations.resume.renderer as renderer_module

    monkeypatch.setattr(renderer_module, "ARTIFACT_ROOT", tmp_path / "resumes")
    monkeypatch.setattr(assets_module, "PORTFOLIO_ROOT", tmp_path / "portfolios")
    with TestClient(create_app(database)) as client:
        _, job, run, workspace = _seed_ready_run(client)
        assert workspace["run"]["current_stage"] == "ready_to_publish"
        resume = workspace["resumes"][0]

        rendered = client.post(f"/api/resumes/{resume['id']}/render", json={"run_id": run["id"]})
        assert rendered.status_code == 200
        pdf_path = Path(rendered.json()["resume"]["pdf_path"])
        assert pdf_path.read_bytes().startswith(b"%PDF")
        assert Path(rendered.json()["bridge_payload_path"]).is_file()

        canonical_pdf = b"%PDF-1.4\n% FetchCV editor renderer\n%%EOF\n"
        uploaded = client.put(
            f"/api/resumes/{resume['id']}/pdf",
            content=canonical_pdf,
            headers={"content-type": "application/pdf", "x-fetchcv-page-count": "2"},
        )
        assert uploaded.status_code == 200
        assert uploaded.json()["page_count"] == 2
        assert Path(uploaded.json()["resume"]["pdf_path"]).read_bytes() == canonical_pdf
        assert uploaded.json()["resume"]["content_json"]["pdf_renderer"] == "resume-editor-prototype"
        assert uploaded.json()["resume"]["content_json"]["pdf_renderer_version"] == 2

        preview = client.get(f"/api/resumes/{resume['id']}/pdf")
        assert preview.status_code == 200
        assert preview.headers["content-type"].startswith("application/pdf")
        assert preview.headers["content-disposition"].startswith("inline;")
        assert preview.content == canonical_pdf

        portfolio = client.post(
            f"/api/jobs/{job['id']}/portfolios",
            json={"run_id": run["id"], "resume_version_id": resume["id"], "mode": "mock"},
        ).json()
        built = client.post(f"/api/portfolios/{portfolio['id']}/build", json={"run_id": run["id"], "mode": "mock"})
        assert built.status_code == 200
        assert Path(built.json()["build"]["preview_path"]).is_file()
        published = client.post(f"/api/portfolios/{portfolio['id']}/publish", json={"run_id": run["id"]})
        assert published.status_code == 200
        assert published.json()["status"] == "published"

        application = client.post(
            "/api/applications",
            json={"run_id": run["id"], "resume_version_id": resume["id"], "portfolio_version_id": portfolio["id"], "status": "submitted"},
        )
        assert application.status_code == 201
        final_workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert final_workspace["run"]["current_stage"] == "published"
        assert final_workspace["applications"][0]["status"] == "submitted"
        assert final_workspace["resumes"][0]["status"] == "draft"
        assert final_workspace["portfolios"][0]["status"] == "published"
        assert final_workspace["applications"][0]["submitted_at"] is not None
        assert final_workspace["applications"][0]["frozen_at"] is None
