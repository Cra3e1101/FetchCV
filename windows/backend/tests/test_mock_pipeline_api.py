from fastapi.testclient import TestClient

from applyos_api.main import create_app


def _seed(client):
    candidate = client.post("/api/candidates", json={"name": "Mock 候选人"}).json()
    facts = []
    for content in ["参与甲公司数据分析项目，复核3000条结果", "使用 Python 完成数据清洗", "制作内部使用的分析原型"]:
        response = client.post(
            f"/api/candidates/{candidate['id']}/facts",
            json={"category": "experience", "content": content, "verified": True, "allowed_outputs": ["resume", "portfolio"]},
        )
        facts.append(response.json())
    job = client.post(
        "/api/jobs",
        json={"candidate_id": candidate["id"], "company": "目标公司", "role": "数据分析师", "jd_raw": "负责数据分析\n使用 Python\n持续优化业务指标"},
    ).json()
    return candidate, facts, job


def test_mock_pipeline_reaches_editable_draft_without_publish_approval(database):
    with TestClient(create_app(database)) as client:
        candidate, facts, job = _seed(client)
        created = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "pipeline-e2e"},
            json={"candidate_id": candidate["id"], "job_id": job["id"]},
        )
        assert created.status_code == 201
        run = created.json()
        assert run["current_stage"] == "awaiting_fact_review"
        run_id = run["id"]

        duplicate = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "pipeline-e2e"},
            json={"candidate_id": candidate["id"], "job_id": job["id"]},
        ).json()
        assert duplicate["id"] == run_id

        approvals = client.get(f"/api/agent-runs/{run_id}/approvals").json()
        fact_approval = next(item for item in approvals if item["action_type"] == "confirm_relevant_facts")
        confirmed = client.post(
            f"/api/agent-runs/{run_id}/facts/review",
            json={"approval_id": fact_approval["id"], "approved_by": "tester", "fact_ids": [item["id"] for item in facts]},
        )
        assert confirmed.status_code == 200
        run = client.post(f"/api/agent-runs/{run_id}/resume").json()
        assert run["current_stage"] == "awaiting_user_review"

        proposals = client.get(f"/api/agent-runs/{run_id}/proposals").json()
        approvals = client.get(f"/api/agent-runs/{run_id}/approvals").json()
        assert len(proposals) == 3
        assert {item["risk_level"] for item in proposals} == {"low"}
        review_approval = next(item for item in approvals if item["action_type"] == "apply_resume_changes")

        draft_decisions = {proposals[0]["id"]: {"decision": "accepted", "edited_after": None}}
        draft = client.patch(
            f"/api/agent-runs/{run_id}/approvals/{review_approval['id']}/draft",
            json={"base_revision": 0, "decisions": draft_decisions, "edited_by": "tester"},
        )
        assert draft.status_code == 200
        assert draft.json()["decision_payload"]["draft"]["revision"] == 1
        assert draft.json()["decision_payload"]["draft"]["decisions"] == draft_decisions
        conflict = client.patch(
            f"/api/agent-runs/{run_id}/approvals/{review_approval['id']}/draft",
            json={"base_revision": 0, "decisions": draft_decisions, "edited_by": "second-window"},
        )
        assert conflict.status_code == 409
        assert conflict.json()["code"] == "approval_revision_conflict"

        incomplete = client.post(
            f"/api/agent-runs/{run_id}/proposals/review",
            json={"approval_id": review_approval["id"], "decisions": [{"proposal_id": proposals[0]["id"], "decision": "accepted"}]},
        )
        assert incomplete.status_code == 422
        assert incomplete.json()["code"] == "proposal_decision_incomplete"

        decisions = [
            {"proposal_id": item["id"], "decision": "rejected" if item["risk_level"] == "high" else "accepted"}
            for item in proposals
        ]
        reviewed = client.post(
            f"/api/agent-runs/{run_id}/proposals/review",
            json={"approval_id": review_approval["id"], "approved_by": "tester", "decisions": decisions},
        )
        assert reviewed.status_code == 200
        assert reviewed.json()["decision_payload"]["previous_draft_revision"] == 1

        ready = client.post(f"/api/agent-runs/{run_id}/resume").json()
        assert ready["current_stage"] == "ready_to_publish"
        assert ready["status"] == "paused"
        approvals = client.get(f"/api/agent-runs/{run_id}/approvals").json()
        assert not any(item["action_type"] == "publish_assets" for item in approvals)

        report = client.get(f"/api/agent-runs/{run_id}/report").json()
        assert report["trace_events"] > 10
        assert "fact_validating" in report["completed_stages"]
        assert client.get(f"/api/jobs/{job['id']}/workspace").json()["portfolios"] == []
        events = client.get(f"/api/agent-runs/{run_id}/events")
        assert events.status_code == 200
        assert "event: trace" in events.text


def test_failed_pipeline_can_retry_without_duplicate_run(database):
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "失败恢复"}).json()
        fact = client.post(
            f"/api/candidates/{candidate['id']}/facts",
            json={"category": "experience", "content": "真实经历", "verified": True, "allowed_outputs": ["resume"]},
        ).json()
        job = client.post("/api/jobs", json={"candidate_id": candidate["id"], "company": "甲", "role": "分析师"}).json()
        failed = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "retry-e2e"},
            json={"candidate_id": candidate["id"], "job_id": job["id"]},
        ).json()
        assert failed["current_stage"] == "failed"
        assert failed["resume_stage"] == "input_validating"

        with database.session() as session:
            stored_job = session.get(__import__("applyos_domain.models", fromlist=["Job"]).Job, job["id"])
            stored_job.jd_raw = "负责数据分析"

        retried = client.post(f"/api/agent-runs/{failed['id']}/retry").json()
        assert retried["id"] == failed["id"]
        assert retried["current_stage"] == "awaiting_fact_review"
        approval = next(item for item in client.get(f"/api/agent-runs/{failed['id']}/approvals").json() if item["action_type"] == "confirm_relevant_facts")
        client.post(
            f"/api/agent-runs/{failed['id']}/facts/review",
            json={"approval_id": approval["id"], "fact_ids": [fact["id"]], "approved_by": "tester"},
        )
        resumed = client.post(f"/api/agent-runs/{failed['id']}/resume").json()
        assert resumed["current_stage"] == "awaiting_user_review"


def test_pipeline_accepts_jd_before_any_fact_is_verified(database):
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "自然流程"}).json()
        fact = client.post(
            f"/api/candidates/{candidate['id']}/facts",
            json={"category": "experience", "content": "参与真实项目并完成交付", "verified": False},
        ).json()
        job = client.post(
            "/api/jobs",
            json={"candidate_id": candidate["id"], "company": "目标公司", "role": "产品经理", "jd_raw": "负责产品交付与项目推进"},
        ).json()
        run = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "jd-first-flow"},
            json={"candidate_id": candidate["id"], "job_id": job["id"]},
        ).json()
        assert run["current_stage"] == "awaiting_fact_review"
        approval = next(item for item in client.get(f"/api/agent-runs/{run['id']}/approvals").json() if item["action_type"] == "confirm_relevant_facts")
        response = client.post(
            f"/api/agent-runs/{run['id']}/facts/review",
            json={"approval_id": approval["id"], "fact_ids": [fact["id"]]},
        )
        assert response.status_code == 200
        assert client.get(f"/api/candidates/{candidate['id']}/facts").json()[0]["verified"] is True


def test_chat_requires_a_real_model_instead_of_local_rule_reply(database, monkeypatch):
    monkeypatch.setenv("FETCHCV_AGENT_RUNTIME", "mock")
    with TestClient(create_app(database)) as client:
        candidate = client.post("/api/candidates", json={"name": "对话测试"}).json()
        job = client.post(
            "/api/jobs",
            json={"candidate_id": candidate["id"], "company": "目标公司", "role": "分析师", "jd_raw": "负责业务分析"},
        ).json()
        response = client.post(f"/api/jobs/{job['id']}/messages", json={"content": "帮我分析岗位"})
        assert response.status_code == 422
        assert response.json()["code"] == "model_required"
        workspace = client.get(f"/api/jobs/{job['id']}/workspace").json()
        assert workspace["messages"] == []


def test_run_can_be_cancelled_after_model_disconnect(database, monkeypatch):
    with TestClient(create_app(database)) as client:
        candidate, _, job = _seed(client)
        run = client.post(
            "/api/agent-runs",
            headers={"Idempotency-Key": "cancel-without-model"},
            json={"candidate_id": candidate["id"], "job_id": job["id"], "auto_start": False},
        ).json()
        monkeypatch.setenv("FETCHCV_ALLOW_MOCK_RUNTIME", "0")
        cancelled = client.post(f"/api/agent-runs/{run['id']}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
        assert cancelled.json()["current_stage"] == "cancelled"
