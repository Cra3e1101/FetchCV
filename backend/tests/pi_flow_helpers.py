"""Scripted semantic arguments through the real Pi HTTP tool boundary.

No LLM or replacement conversation loop lives here. Each helper advances one
explicit approval segment, then completes the Pi task just as the host does.
"""
PROVIDER = {"provider_name": "Test", "protocol": "openai", "base_url": "https://example.invalid/v1", "model": "fixture"}


def advance_pi(client, run_id, *, kind="resume"):
    run = client.get(f"/api/agent-runs/{run_id}").json()
    started = client.post(f"/api/pi/runs/{run_id}/tasks", json={"kind": kind, "host_id": "fixture-host", "provider": PROVIDER})
    assert started.status_code == 200, started.text
    task = started.json()
    workspace = client.get(f"/api/jobs/{run['job_id']}/workspace").json()
    job = workspace["job"]
    facts = client.get(f"/api/candidates/{run['candidate_id']}/facts").json()
    if run["current_stage"] in {"created", "input_validating", "failed"}:
        tool = "prepare_job_review"
        arguments = {"analysis": {"responsibilities": [{"text": job["jd_raw"], "source_quote": job["jd_raw"]}], "summary": "依据原始 JD 完成岗位分析"},
                     "fact_ranking": [{"fact_id": f["id"], "recommended": True, "relevance": "high", "rationale": "与 JD 所述分析工作相关"} for f in facts]}
    elif run["current_stage"] == "awaiting_fact_review":
        # Synthetic source resume is explicit; model-supplied before cannot
        # bootstrap its own source or rely on shadow claims metadata.
        if not workspace["resumes"] and not workspace.get("base_resumes"):
            from applyos_domain.models import ResumeVersion
            with client.app.state.database.session() as session:
                session.add(ResumeVersion(candidate_id=run["candidate_id"], name="Synthetic source", content_json={"editor_snapshot": {
                    "profile": {"name": workspace["candidate"]["name"]},
                    "sections": [{"title": "经历", "items": [{"body": f["content"]} for f in facts]}],
                }}))
        tool = "prepare_resume_review"
        arguments = {
            "strategy": {"positioning": "基于已确认事实呈现分析经历", "selected_fact_ids": [f["id"] for f in facts]},
            "patches": [{"section": "experience", "before": f["content"], "after": f["content"] + "。", "reason": "规范表述",
                         "jd_evidence": [job["jd_raw"]], "fact_ids": [f["id"]], "risk_level": "low",
                         "evidence": [{"evidence_type": "candidate_fact", "candidate_id": run["candidate_id"], "fact_id": f["id"], "fact_version": f["version"], "source_quote": f["content"]}],
                         "action": f["content"], "object": f["content"], "metrics": sorted(__import__("applyos_harness.validation", fromlist=["extract_numbers"]).extract_numbers(f["content"]))} for f in facts],
            "summary": "已形成可逐条审核的补丁",
        }
    else:
        assert run["current_stage"] == "awaiting_user_review", run
        tool, arguments = "apply_and_verify_resume", {}
    response = client.post(f"/api/pi/runs/{run_id}/task-tools/{tool}", json={"task_id": task["task_id"], "arguments": arguments, "idempotency_key": f"fixture:{task['task_id']}:{tool}"})
    assert response.status_code == 200, response.text
    done = client.post(f"/api/pi/tasks/{task['task_id']}/complete", json={"content": response.json()["result"]["summary"]})
    assert done.status_code == 200, done.text
    return client.get(f"/api/agent-runs/{run_id}").json()
