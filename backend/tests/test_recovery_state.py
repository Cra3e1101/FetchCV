"""Synthetic contract checks. No personal fixtures or external services."""
from copy import deepcopy

import pytest

from applyos_agent.recovery_state import (
    ReadRecoveryContextInput, build_recovery_state, initialize_task_baselines,
    read_recovery_context, register_recovery_tools,
)
from applyos_domain.models import (
    AgentRun, AgentTask, Approval, Candidate, Fact, InterviewSource, Job,
    ResumeVersion, RewriteProposal, ToolInvocation,
)
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway
from applyos_harness.versioning import VersionService, canonical_hash
from applyos_agent.result_archive import archive_result, read_result


def _scope(session, label="one"):
    candidate = Candidate(name="Synthetic " + label)
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="Synthetic", role="Analyst", jd_raw="Analyze data")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_native_job_asset_pipeline", current_stage="created")
    session.add(run)
    session.flush()
    return candidate, job, run


def _task(session, run):
    task = AgentTask(run_id=run.id, kind="start", status="running")
    session.add(task)
    session.flush()
    return task


def test_first_attempt_baseline_is_idempotent_and_inherited_without_overwrite(database):
    with database.session() as session:
        candidate, _, run = _scope(session)
        resume = ResumeVersion(candidate_id=candidate.id, name="Base", content_json={"text": "Before"})
        session.add(resume)
        session.flush()
        first = _task(session, run)
        initialize_task_baselines(session, run, first)
        original = deepcopy(first.payload_json["recovery_baselines"])
        assert original["cycle"]["status"] == "known"
        assert original["attempt"]["source_resume"]["content_hash"] == canonical_hash(resume.content_json)
        resume.content_json = {"text": "After"}
        session.flush()
        initialize_task_baselines(session, run, first)
        assert first.payload_json["recovery_baselines"] == original
        second = _task(session, run)
        initialize_task_baselines(session, run, second, previous=first)
        saved = second.payload_json["recovery_baselines"]
        assert saved["cycle"] == original["cycle"]
        assert saved["previous_attempt"] == original["attempt"]
        state = build_recovery_state(session, run, second)
        assert state["baselines"]["comparisons"]["cycle"]["source_resume"] == "content_changed"
        assert state["baselines"]["comparisons"]["attempt"]["source_resume"] == "unchanged"


@pytest.mark.parametrize("historical_task", [True, False])
def test_legacy_run_cycle_stays_unknown(database, historical_task):
    with database.session() as session:
        _, _, run = _scope(session)
        previous = _task(session, run) if historical_task else None
        if not historical_task:
            run.current_stage = "awaiting_fact_review"
        task = _task(session, run)
        initialize_task_baselines(session, run, task, previous=previous)
        assert task.payload_json["recovery_baselines"]["cycle"]["status"] == "unknown"
        assert task.payload_json["recovery_baselines"]["attempt"]["status"] == "known"


def test_state_distinguishes_selected_verified_and_source_readiness(database):
    with database.session() as session:
        candidate, job, run = _scope(session)
        chosen = Fact(candidate_id=candidate.id, category="work", content="Chosen", verified=True)
        other = Fact(candidate_id=candidate.id, category="work", content="Other", verified=True)
        session.add_all([chosen, other])
        session.flush()
        session.add(Approval(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id,
            status="approved", decision_payload={"fact_ids": [chosen.id]}))
        for index, questions in enumerate(([], [{"question": "Why?", "evidence_valid": True}])):
            session.add(InterviewSource(candidate_id=candidate.id, job_id=job.id, company="Synthetic", role="Analyst",
                source_url=f"https://example.org/{index}", url_hash=str(index), status="analyzed", extracted_questions=questions))
        session.flush()
        state = build_recovery_state(session, run)
        assert state["current"]["facts"]["candidate_verified"] == 2
        assert state["current"]["facts"]["run_selected_total"] == 1
        sources = state["current"]["job_linked_interview_sources"]
        assert sources["analyzed_with_questions"] == 1
        assert sources["analyzed_without_questions"] == 1


def test_revision_changes_without_count_changes_and_has_no_clock_noise(database):
    with database.session() as session:
        candidate, _, run = _scope(session)
        fact = Fact(candidate_id=candidate.id, category="work", content="Before", verified=True)
        session.add(fact)
        session.flush()
        initial = build_recovery_state(session, run)
        assert build_recovery_state(session, run)["state_revision"] == initial["state_revision"]
        fact.content = "After"
        fact.version += 1
        session.flush()
        assert build_recovery_state(session, run)["state_revision"] != initial["state_revision"]


def test_proposal_text_edit_changes_revision_after_normal_flush(database):
    with database.session() as session:
        candidate, job, run = _scope(session)
        resume = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="Synthetic", content_json={})
        session.add(resume)
        session.flush()
        proposal = RewriteProposal(resume_version_id=resume.id, run_id=run.id, section="work",
                                  before="Before", after="First", reason="Synthetic")
        session.add(proposal)
        session.flush()
        initial = build_recovery_state(session, run)
        proposal.after = "Second"
        session.flush()
        assert build_recovery_state(session, run)["state_revision"] != initial["state_revision"]


def test_fact_selection_revision_and_multiple_approvals_are_explicit(database):
    with database.session() as session:
        candidate, job, run = _scope(session)
        facts = [Fact(candidate_id=candidate.id, category="work", content=f"Fact {index}", verified=True)
                 for index in range(2)]
        session.add_all(facts)
        session.flush()
        approval = Approval(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id,
                            status="approved", decision_payload={"fact_ids": [facts[0].id]})
        session.add(approval)
        session.flush()
        initial = read_recovery_context(session, run, ReadRecoveryContextInput(section="facts"))
        approval.decision_payload = {"fact_ids": [facts[1].id], "fact_snapshots": [{
            "fact_id": facts[1].id, "fact_version": facts[1].version, "content_hash": canonical_hash(facts[1].content)}]}
        session.flush()
        changed = read_recovery_context(session, run, ReadRecoveryContextInput(section="facts"))
        assert changed["page_revision"] != initial["page_revision"]
        assert next(item for item in changed["items"] if item["id"] == facts[1].id)["run_selected"]
        session.add(Approval(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id,
                    status="approved", decision_payload={"fact_ids": [facts[0].id]}))
        session.flush()
        summary = build_recovery_state(session, run)["current"]["facts"]
        assert summary["run_selection_status"] == "ambiguous"
        assert summary["run_selection_approval_count"] == 2
        assert summary["pipeline_effective_verified"] is None
        assert all(item["selection_ambiguous"] for item in
                   read_recovery_context(session, run, ReadRecoveryContextInput(section="facts"))["items"])


def test_created_legacy_run_with_tool_history_has_unknown_cycle(database):
    with database.session() as session:
        _, _, run = _scope(session)
        session.add(ToolInvocation(run_id=run.id, operation_id="synthetic_completed", tool_name="synthetic_write",
                    stage="created", arguments_hash="0" * 64, status="completed"))
        session.flush()
        task = _task(session, run)
        initialize_task_baselines(session, run, task)
        assert task.payload_json["recovery_baselines"]["cycle"]["status"] == "unknown"


def test_detail_pages_are_complete_and_cross_scope_ids_are_rejected_by_projection(database):
    with database.session() as session:
        candidate, job, run = _scope(session)
        other_candidate, _, other_run = _scope(session, "two")
        fact = Fact(candidate_id=candidate.id, category="work", content="Complete " * 2000, verified=True,
                    normalized_value={"experience_id": "synthetic"})
        foreign = Fact(candidate_id=other_candidate.id, category="work", content="Hidden", verified=True)
        session.add_all([fact, foreign])
        session.flush()
        page = read_recovery_context(session, run, ReadRecoveryContextInput(section="facts", ids=[fact.id, foreign.id]))
        assert page["total"] == 1
        assert page["items"][0]["content"] == fact.content
        assert page["items"][0]["candidate_id"] == candidate.id
        assert page["items"][0]["evidence_type"] == "candidate_fact"
        own_approval = Approval(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id,
                                decision_payload={"fact_ids": [f"fact_{index}" for index in range(90)]})
        session.add_all([own_approval, Approval(run_id=other_run.id, action_type="confirm_relevant_facts",
            target_type="job", target_id=job.id)])
        session.flush()
        detail = read_recovery_context(session, run, ReadRecoveryContextInput(section="approvals"))
        assert detail["total"] == 1
        assert len(detail["items"][0]["decision"]["fact_ids"]) == 90


def test_pagination_detects_drift_and_explicit_job_history(database):
    with database.session() as session:
        candidate, job, run = _scope(session)
        previous_run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="synthetic", current_stage="created")
        session.add(previous_run)
        session.flush()
        for owner in (run, previous_run):
            session.add(Approval(run_id=owner.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id))
        for index in range(3):
            session.add(Fact(candidate_id=candidate.id, category="work", content=f"Fact {index}"))
        session.flush()
        assert read_recovery_context(session, run, ReadRecoveryContextInput(section="approvals"))["total"] == 1
        history = read_recovery_context(session, run, ReadRecoveryContextInput(section="approvals", include_history=True))
        assert history["total"] == 2 and history["scope"]["history"] == "job_history"
        first = read_recovery_context(session, run, ReadRecoveryContextInput(section="facts", limit=1))
        assert first["total"] == 3 and first["has_more"] and first["next_offset"] == 1
        second = read_recovery_context(session, run, ReadRecoveryContextInput(section="facts", limit=1, offset=1,
                                      expected_revision=first["page_revision"]))
        assert second["items"][0]["id"] != first["items"][0]["id"]
        session.add(Fact(candidate_id=candidate.id, category="work", content="New"))
        session.flush()
        with pytest.raises(HarnessError, match="恢复索引已变化"):
            read_recovery_context(session, run, ReadRecoveryContextInput(section="facts", offset=1,
                                  expected_revision=first["page_revision"]))


def test_archive_index_is_run_scoped_and_does_not_require_receipts(database):
    with database.session() as session:
        _, _, run = _scope(session)
        _, _, foreign_run = _scope(session, "foreign")
        own = archive_result(session, "run:" + run.id, {"synthetic": "complete"})
        archive_result(session, "run:" + foreign_run.id, {"synthetic": "hidden"})
        page = read_recovery_context(session, run, ReadRecoveryContextInput(section="tool_results"))
        assert page["total"] == 1
        item = page["items"][0]
        assert item["id"] == own["arguments"]["result_id"]
        assert item["sha256"] == own["sha256"] and item["total_chars"] == own["total_chars"]
        assert "complete" in read_result(session, "run:" + run.id, item["read_ref"]["arguments"])["text"]


def test_snapshot_content_hash_is_not_snapshot_payload_hash_and_content_is_opt_in(database):
    with database.session() as session:
        candidate, _, run = _scope(session)
        resume = ResumeVersion(candidate_id=candidate.id, name="Base", content_json={"text": "Synthetic content"})
        session.add(resume)
        session.flush()
        snapshot = VersionService(session).snapshot_entity(resume, run_id=run.id, reason="synthetic")
        page = read_recovery_context(session, run, ReadRecoveryContextInput(section="resumes", ids=[snapshot.id]))
        assert "payload" not in page["items"][0]
        item = page["items"][0]
        assert item["snapshot_payload_hash"] == snapshot.content_hash
        assert item["resume_content_hash"] == canonical_hash(resume.content_json)
        assert item["resume_content_hash"] != item["snapshot_payload_hash"]
        detailed = read_recovery_context(session, run, ReadRecoveryContextInput(section="resumes", ids=[snapshot.id], include_content=True))
        assert detailed["items"][0]["payload"]["content_json"] == resume.content_json


def test_candidate_unknown_operations_remain_visible_without_replay(database, tmp_path):
    with database.session() as session:
        candidate, job, run = _scope(session)
        earlier = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="synthetic", current_stage="created")
        session.add(earlier)
        session.flush()
        session.add(ToolInvocation(run_id=earlier.id, operation_id="synthetic_unknown", tool_name="synthetic_write",
                    stage="created", arguments_hash="0" * 64, status="outcome_unknown"))
        session.flush()
        state = build_recovery_state(session, run)
        assert state["current"]["candidate_unresolved_operation_total"] == 1
        assert state["pending"]["preview"][0]["kind"] == "operation_resolution"
        gateway = register_recovery_tools(ToolGateway(session, workspace_root=tmp_path))
        spec = gateway.registry["read_recovery_context"]
        assert spec.read_only and not spec.side_effect
        with pytest.raises(Exception):
            ReadRecoveryContextInput(section="facts", candidate_id="caller_supplied_scope")
