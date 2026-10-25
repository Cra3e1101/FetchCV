"""Read-only projections of durable state; baselines never authorize an action."""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import func, or_, select, union_all

from applyos_domain.base import utc_now
from applyos_domain.models import (
    AgentRun, AgentRunStep, AgentTask, Approval, Fact, InterviewSource, Job, ResumeVersion,
    RewriteProposal, ToolInvocation, ToolResultArchive, VersionSnapshot,
)
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from applyos_harness.versioning import canonical_hash

SCHEMA_VERSION = 1
HASH_KIND = "resume_content_json_sha256"
PREVIEW_LIMIT = 5
SECTIONS = ("state", "facts", "approvals", "proposals", "interview_sources", "operations", "tool_results", "resumes")
RecoverySection = Literal["state", "facts", "approvals", "proposals", "interview_sources", "operations", "tool_results", "resumes"]


def _value(value):
    return getattr(value, "value", value)


def _iso(value):
    return value.isoformat() if value else None


def _count(session, statement) -> int:
    return int(session.scalar(select(func.count()).select_from(statement.order_by(None).subquery())) or 0)


def _counts(session, model, column, *where) -> dict[str, int]:
    return {str(_value(key)): int(count) for key, count in session.execute(
        select(column, func.count()).select_from(model).where(*where).group_by(column)
    )}


def _scope(run, task=None):
    return {"candidate_id": run.candidate_id, "job_id": run.job_id, "run_id": run.id,
            "task_id": task.id if task else None}


def _resume_ref(resume):
    if resume is None:
        return None
    return {"id": resume.id, "job_id": resume.job_id, "parent_version_id": resume.parent_version_id,
            "content_hash": canonical_hash(resume.content_json or {}), "hash_kind": HASH_KIND,
            "status": str(_value(resume.status)), "updated_at": _iso(resume.updated_at)}


def _current_resumes(session, run):
    scoped = select(ResumeVersion).where(ResumeVersion.candidate_id == run.candidate_id)
    source = None
    if run.job_id:
        source = session.scalar(scoped.where(ResumeVersion.job_id == run.job_id).order_by(
            ResumeVersion.updated_at.desc(), ResumeVersion.id.desc()).limit(1))
    source = source or session.scalar(scoped.where(ResumeVersion.job_id.is_(None)).order_by(
        ResumeVersion.updated_at.desc(), ResumeVersion.id.desc()).limit(1))
    target = session.scalar(scoped.where(ResumeVersion.job_id == run.job_id,
        ResumeVersion.legacy_id == f"mock-run:{run.id}:draft").limit(1))
    return _resume_ref(source), _resume_ref(target)


def _capture_baseline(session, run, task):
    source, target = _current_resumes(session, run)
    job = session.get(Job, run.job_id) if run.job_id else None
    return {"status": "known", "run_id": run.id, "task_id": task.id,
            "captured_at": utc_now().isoformat(), "hash_kind": HASH_KIND,
            "definition": "pi_task_attempt_start",
            "source_resume": source, "target_resume": target,
            "job_input_revision": job.input_revision if job else None}


def initialize_task_baselines(session, run, task, previous=None) -> None:
    """Capture each attempt once; inherit a cycle only from the same run.

    A legacy task or already advanced run cannot acquire a fictitious historical
    baseline. No database commit, pipeline transition or asset write occurs here.
    """
    payload = dict(task.payload_json or {})
    if isinstance(payload.get("recovery_baselines"), dict):
        return
    first = session.scalar(select(AgentTask).where(AgentTask.run_id == run.id, AgentTask.id != task.id)
        .order_by(AgentTask.created_at.asc(), AgentTask.id.asc()).limit(1))
    if previous is None:
        previous = session.scalar(select(AgentTask).where(AgentTask.run_id == run.id, AgentTask.id != task.id)
            .order_by(AgentTask.created_at.desc(), AgentTask.id.desc()).limit(1))
    if previous is not None and previous.run_id != run.id:
        previous = None
    previous_data = (previous.payload_json or {}).get("recovery_baselines", {}) if previous else {}
    first_data = (first.payload_json or {}).get("recovery_baselines", {}) if first else {}
    inherited = previous_data.get("cycle") or first_data.get("cycle")
    attempt = _capture_baseline(session, run, task)
    business_exists = (
        (run.current_stage or "created") != PipelineStage.CREATED.value
        or session.scalar(select(Approval.id).where(Approval.run_id == run.id).limit(1)) is not None
        or session.scalar(select(RewriteProposal.id).where(RewriteProposal.run_id == run.id).limit(1)) is not None
        or session.scalar(select(ToolInvocation.id).where(ToolInvocation.run_id == run.id).limit(1)) is not None
        or session.scalar(select(AgentRunStep.id).where(AgentRunStep.run_id == run.id,
            AgentRunStep.event_type.notin_(["session_start", "task_started"])).limit(1)) is not None
        or attempt["target_resume"] is not None
    )
    if isinstance(inherited, dict) and inherited.get("run_id") == run.id:
        cycle = deepcopy(inherited)
    elif first is None and previous is None and not business_exists:
        cycle = deepcopy(attempt)
        cycle["definition"] = "first_pi_task_start_for_run"
    else:
        cycle = {"status": "unknown", "run_id": run.id, "hash_kind": HASH_KIND,
                 "reason": "historical_task_or_business_state_has_no_trusted_cycle_baseline"}
    prior_attempt = previous_data.get("attempt") if previous else None
    payload["recovery_baselines"] = {
        "schema_version": SCHEMA_VERSION, "cycle": cycle, "attempt": attempt,
        "previous_attempt": deepcopy(prior_attempt) if isinstance(prior_attempt, dict) and prior_attempt.get("run_id") == run.id else None,
    }
    task.payload_json = payload


def _selection(session, run):
    # Pull selection keys without loading the original ranked-fact bodies.
    approval = session.execute(select(Approval.id, Approval.updated_at, Approval.status,
        Approval.decision_payload["fact_ids"].label("fact_ids"),
        Approval.decision_payload["fact_snapshots"].label("fact_snapshots"),
        func.count().over().label("approved_count")).where(Approval.run_id == run.id,
        Approval.action_type == "confirm_relevant_facts", Approval.status == "approved")
        .order_by(Approval.approved_at.desc(), Approval.id.desc()).limit(1)).first()
    ids = list(dict.fromkeys(str(item) for item in (approval.fact_ids or []))) if approval else []
    evidence = {str(item.get("fact_id")): item for item in (approval.fact_snapshots or []) if isinstance(item, dict)} if approval else {}
    return approval, ids, evidence, int(approval.approved_count) if approval else 0


def _comparison(baseline, source, target, revision):
    if not isinstance(baseline, dict) or baseline.get("status") != "known":
        return {"status": "unknown"}
    def compare(name, current):
        old = baseline.get(name)
        if old is None and current is None:
            return "absent"
        if old is None:
            return "created"
        if current is None:
            return "missing"
        if old.get("id") != current.get("id"):
            return "different_version"
        return "unchanged" if old.get("content_hash") == current.get("content_hash") else "content_changed"
    return {"status": "compared", "source_resume": compare("source_resume", source),
            "target_resume": compare("target_resume", target),
            "job_input_revision_changed": baseline.get("job_input_revision") != revision}


def _operations_query(run):
    # The write guard blocks on unresolved operations across this candidate.
    return select(ToolInvocation).join(AgentRun, ToolInvocation.run_id == AgentRun.id).where(
        AgentRun.candidate_id == run.candidate_id,
        or_(ToolInvocation.run_id == run.id, ToolInvocation.status.in_(["running", "outcome_unknown"])))


def build_recovery_state(session, run, task=None) -> dict[str, Any]:
    """Return bounded metadata from authoritative rows, without persisting it."""
    if task is None:
        task = session.scalar(select(AgentTask).where(AgentTask.run_id == run.id)
            .order_by(AgentTask.created_at.desc(), AgentTask.id.desc()).limit(1))
    if task is not None and task.run_id != run.id:
        raise HarnessError("recovery_scope_mismatch", "恢复任务不属于当前运行", run_id=run.id)
    job = session.get(Job, run.job_id) if run.job_id else None
    source, target = _current_resumes(session, run)
    approval, selected, selected_snapshots, selection_count = _selection(session, run)
    facts = select(Fact).where(Fact.candidate_id == run.candidate_id)
    selected_verified = _count(session, facts.where(Fact.id.in_(selected), Fact.verified.is_(True))) if selected else 0
    approval_counts = _counts(session, Approval, Approval.status, Approval.run_id == run.id)
    proposal_counts = _counts(session, RewriteProposal, RewriteProposal.approval_status, RewriteProposal.run_id == run.id)
    linked = [InterviewSource.candidate_id == run.candidate_id, InterviewSource.job_id == run.job_id]
    source_counts = _counts(session, InterviewSource, InterviewSource.status, *linked) if run.job_id else {}
    with_questions = _count(session, select(InterviewSource.id).where(*linked, InterviewSource.status == "analyzed",
        func.json_array_length(InterviewSource.extracted_questions) > 0)) if run.job_id else 0
    pending_approvals = select(Approval).where(Approval.run_id == run.id, Approval.status == "pending")
    action_kinds = {"confirm_relevant_facts": "fact_confirmation", "apply_resume_changes": "resume_patch_review",
                    "publish_assets": "publish_confirmation"}
    preview = [{"kind": action_kinds.get(row.action_type, "action_approval"), "id": row.id, "action": row.action_type,
                "target_type": row.target_type, "target_id": row.target_id}
               for row in session.execute(pending_approvals.with_only_columns(Approval.id, Approval.action_type,
                   Approval.target_type, Approval.target_id).order_by(Approval.created_at, Approval.id).limit(PREVIEW_LIMIT))]
    blockers = _operations_query(run).where(ToolInvocation.status.in_(["running", "outcome_unknown"]))
    blocker_total = _count(session, blockers)
    preview += [{"kind": "operation_resolution", "id": row.operation_id, "source_run_id": row.run_id,
                 "tool_name": row.tool_name, "status": row.status}
                for row in session.execute(blockers.with_only_columns(ToolInvocation.operation_id, ToolInvocation.run_id,
                    ToolInvocation.tool_name, ToolInvocation.status).order_by(ToolInvocation.created_at, ToolInvocation.id).limit(PREVIEW_LIMIT))]
    pending_total = approval_counts.get("pending", 0) + blocker_total
    baselines = deepcopy((task.payload_json or {}).get("recovery_baselines") or {}) if task else {}
    baselines = baselines or {"schema_version": SCHEMA_VERSION, "cycle": {"status": "unknown", "reason": "not_recorded"},
                             "attempt": {"status": "unknown", "reason": "not_recorded"}, "previous_attempt": None}
    comparisons = {name: _comparison(baselines.get(name), source, target, job.input_revision if job else None)
                   for name in ("cycle", "attempt", "previous_attempt")}
    domain_revisions = {}
    for section in SECTIONS:
        if section in {"state", "resumes"}:
            continue
        statement, model = _section_query(run, section, False)
        domain_revisions[section] = _section_revision(session, statement, model, section, run=run)[1]
    domain_revisions["resumes"] = _resume_index(session, run)[1]
    state = {
        "schema_version": SCHEMA_VERSION, "scope": _scope(run, task),
        "current": {
            "stage": run.current_stage, "status": str(_value(run.status)),
            "job_input_revision": job.input_revision if job else None,
            "facts": {"candidate_total": _count(session, facts),
                      "candidate_verified": _count(session, facts.where(Fact.verified.is_(True))),
                      "run_selection_status": "ambiguous" if selection_count > 1 else "explicit" if approval else "not_confirmed",
                      "run_selection_approval_id": approval.id if approval else None,
                      "run_selection_approval_count": selection_count,
                      "selection_view": "latest_approved_for_reference_only" if selection_count > 1 else "single_approved_selection",
                      "run_selected_total": len(selected), "run_selected_currently_verified": selected_verified,
                      "pipeline_effective_verified": None if selection_count > 1 else selected_verified if selected else _count(session, facts.where(Fact.verified.is_(True))),
                      "selection_version_binding": "recorded" if selected_snapshots else "legacy_unknown"},
            "approvals_by_status": approval_counts, "proposals_by_status": proposal_counts,
            "source_resume": source, "target_resume": target,
            "resume_selection": {"source": "latest_job_else_latest_base", "target": "current_run_draft"},
            "job_linked_interview_sources": {"total": sum(source_counts.values()), "by_status": source_counts,
                "analyzed_with_questions": with_questions,
                "analyzed_without_questions": source_counts.get("analyzed", 0) - with_questions,
                "readiness_notice": "Analyzed with questions identifies reusable records, not relevance or sufficient independent evidence; search before synthesis."},
            "candidate_unresolved_operation_total": blocker_total,
            "archived_tool_result_total": _count(session, select(ToolResultArchive.id).where(ToolResultArchive.scope == "run:" + run.id)),
        },
        "pending": {"total": pending_total, "preview": preview[:PREVIEW_LIMIT],
                    "omitted": max(0, pending_total - PREVIEW_LIMIT)},
        "baselines": {**baselines, "comparisons": comparisons},
        "domain_revisions": domain_revisions,
        "read_refs": [{"tool": "read_recovery_context", "arguments": {"section": section, "offset": 0, "limit": 20}}
                      for section in SECTIONS if section != "state"],
        "authority_notice": "Readback and baselines are evidence only. Existing approval, version and side-effect guards remain authoritative.",
    }
    state["state_revision"] = canonical_hash(state)
    state["as_of"] = utc_now().isoformat()
    return state


class ReadRecoveryContextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    section: RecoverySection = "state"
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=50)
    ids: list[str] = Field(default_factory=list, max_length=50)
    include_history: bool = Field(default=False, description="For approvals/proposals only: explicitly include other runs for the current job.")
    include_content: bool = Field(default=False, description="For resumes only: include complete content_json or snapshot payload for the selected page; use IDs to read a specific version.")
    expected_revision: str | None = Field(default=None, pattern="^[a-f0-9]{64}$", description="Previous page_revision; a mismatch requires restarting pagination.")


class RecoveryToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    stage: str
    status: str
    summary: str
    data: dict[str, Any]


def _section_query(run, section, include_history):
    if section == "facts":
        return select(Fact).where(Fact.candidate_id == run.candidate_id), Fact
    if section in {"approvals", "proposals"}:
        model = Approval if section == "approvals" else RewriteProposal
        statement = select(model).where(model.run_id == run.id)
        if include_history and run.job_id:
            statement = select(model).join(AgentRun, model.run_id == AgentRun.id).where(
                AgentRun.candidate_id == run.candidate_id, AgentRun.job_id == run.job_id)
        return statement, model
    if section == "interview_sources":
        return select(InterviewSource).where(InterviewSource.candidate_id == run.candidate_id,
            InterviewSource.job_id == run.job_id if run.job_id else InterviewSource.id.is_(None)), InterviewSource
    if section == "operations":
        return _operations_query(run), ToolInvocation
    if section == "tool_results":
        return select(ToolResultArchive.id, ToolResultArchive.content_hash,
            func.length(ToolResultArchive.content).label("total_chars"), ToolResultArchive.created_at).where(
                ToolResultArchive.scope == "run:" + run.id), ToolResultArchive
    raise ValueError(section)


def _section_revision(session, statement, model, section, *, run=None):
    # ORM updates advance updated_at on flush. Revisions only scan metadata;
    # they must not deserialize every old patch, fact or operation result.
    if section == "facts":
        fields = (model.id, model.updated_at, model.version, model.verified)
    elif section == "approvals":
        fields = (model.id, model.updated_at, model.status, model.approved_at)
    elif section == "proposals":
        fields = (model.id, model.updated_at, model.approval_status, model.resume_version_id)
    elif section == "interview_sources":
        fields = (model.id, model.updated_at, model.content_hash, model.status)
    elif section == "operations":
        fields = (model.id, model.updated_at, model.status, model.arguments_hash)
    else:
        fields = (model.id, model.content_hash, model.created_at)
    rows = session.execute(statement.with_only_columns(*fields).order_by(model.id)).all()
    # No generation timestamp participates in this revision.
    signatures = [canonical_hash(list(row)) for row in rows]
    if section == "facts" and run is not None:
        choices = session.execute(select(Approval.id, Approval.updated_at, Approval.status).where(
            Approval.run_id == run.id, Approval.action_type == "confirm_relevant_facts").order_by(Approval.id)).all()
        signatures.append(canonical_hash([list(row) for row in choices]))
    return len(rows), canonical_hash(signatures)


def _item(row, section, run, selected, snapshots):
    if section == "facts":
        confirmed = snapshots.get(row.id)
        return {"id": row.id, "candidate_id": row.candidate_id, "evidence_type": "candidate_fact",
                "subject_id": row.subject_id, "normalized_value": row.normalized_value,
                "category": row.category, "content": row.content, "verified": row.verified,
                "version": row.version, "content_hash": canonical_hash(row.content), "allowed_outputs": row.allowed_outputs,
                "run_selected": row.id in selected, "confirmed_snapshot": confirmed,
                "confirmation_drift": None if not confirmed else (
                    confirmed.get("fact_version") != row.version or confirmed.get("content_hash") != canonical_hash(row.content))}
    if section == "approvals":
        return {"id": row.id, "run_id": row.run_id, "is_current_run": row.run_id == run.id,
                "action": row.action_type, "target_type": row.target_type, "target_id": row.target_id,
                "status": str(_value(row.status)), "decision": row.decision_payload,
                "approved_by": row.approved_by, "approved_at": _iso(row.approved_at), "updated_at": _iso(row.updated_at)}
    if section == "proposals":
        return {"id": row.id, "run_id": row.run_id, "is_current_run": row.run_id == run.id,
                "resume_version_id": row.resume_version_id, "section": row.section, "before": row.before,
                "after": row.after, "edited_after": row.edited_after, "reason": row.reason,
                "jd_evidence": row.jd_evidence, "fact_ids": row.fact_ids, "claim_contract": row.claim_contract,
                "risk_level": str(_value(row.risk_level)), "approval_status": str(_value(row.approval_status))}
    if section == "interview_sources":
        return {"id": row.id, "job_id": row.job_id, "title": row.title, "source_url": row.source_url,
                "platform": row.platform, "status": row.status, "summary": row.summary,
                "questions": row.extracted_questions, "question_count": len(row.extracted_questions or []),
                "analyzed_with_questions": row.status == "analyzed" and bool(row.extracted_questions),
                "content_hash": row.content_hash, "metadata": row.metadata_json,
                "read_ref": {"tool": "read_interview_source", "arguments": {"source_id": row.id, "offset": 0}}}
    if section == "operations":
        return {"id": row.id, "operation_id": row.operation_id, "source_run_id": row.run_id,
                "is_current_run": row.run_id == run.id, "tool_name": row.tool_name, "stage": row.stage,
                "status": row.status, "arguments_hash": row.arguments_hash, "arguments_summary": row.arguments_summary,
                "error": row.error_json, "requires_resolution": row.status in {"running", "outcome_unknown"},
                "result": row.result_json}
    return {"id": row.id, "sha256": row.content_hash, "total_chars": row.total_chars,
            "created_at": _iso(row.created_at),
            "read_ref": {"tool": "read_tool_result", "arguments": {"result_id": row.id, "offset": 0, "limit": 4000}}}


def _resume_index(session, run, ids=()):
    # Versions and snapshots share one index, so every older snapshot remains
    # discoverable with normal pagination rather than a latest-N nested list.
    scoped = select(ResumeVersion.id).where(ResumeVersion.candidate_id == run.candidate_id,
        or_(ResumeVersion.job_id.is_(None), ResumeVersion.job_id == run.job_id) if run.job_id else ResumeVersion.job_id.is_(None))
    from sqlalchemy import literal
    versions = select(literal("resume").label("kind"), ResumeVersion.id.label("id"),
        ResumeVersion.id.label("resume_id"), ResumeVersion.updated_at.label("sort_at"),
        ResumeVersion.content_hash.label("revision_hash")).where(ResumeVersion.id.in_(scoped))
    snapshots = select(literal("snapshot").label("kind"), VersionSnapshot.id.label("id"),
        VersionSnapshot.target_id.label("resume_id"), VersionSnapshot.created_at.label("sort_at"),
        VersionSnapshot.content_hash.label("revision_hash")).where(
            VersionSnapshot.target_type == "resume_versions", VersionSnapshot.target_id.in_(scoped))
    index = union_all(versions, snapshots).subquery()
    statement = select(index)
    if ids:
        statement = statement.where(index.c.id.in_(ids))
    revision_rows = list(session.execute(statement.order_by(index.c.sort_at.desc(), index.c.id.desc())))
    signatures = [[row.kind, row.id, _iso(row.sort_at), row.revision_hash] for row in revision_rows]
    return revision_rows, canonical_hash(signatures)


def _resume_page(session, run, payload):
    revision_rows, revision = _resume_index(session, run, payload.ids)
    items = []
    for row in revision_rows[payload.offset:payload.offset + payload.limit]:
        if row.kind == "resume":
            entity = session.get(ResumeVersion, row.id)
            items.append({"kind": "resume", **_resume_ref(entity), "name": entity.name,
                          "source_fact_ids": entity.source_fact_ids,
                          **({"content_json": entity.content_json} if payload.include_content else {})})
        else:
            entity = session.get(VersionSnapshot, row.id)
            content = (entity.payload or {}).get("content_json")
            items.append({"kind": "snapshot", "id": entity.id, "resume_id": entity.target_id,
                "source_run_id": entity.run_id, "sequence": entity.sequence, "reason": entity.reason,
                "created_at": _iso(entity.created_at), "snapshot_payload_hash": entity.content_hash,
                "resume_content_hash": canonical_hash(content) if content is not None else None, "hash_kind": HASH_KIND,
                "restore_requires_approval": True,
                **({"payload": entity.payload} if payload.include_content else {})})
    return len(revision_rows), revision, items


def read_recovery_context(session, run, payload: ReadRecoveryContextInput):
    if payload.section == "state":
        return build_recovery_state(session, run)
    if payload.section == "resumes":
        total, revision, items = _resume_page(session, run, payload)
    else:
        statement, model = _section_query(run, payload.section, payload.include_history)
        if payload.ids:
            statement = statement.where(model.id.in_(payload.ids))
        timestamp = getattr(model, "updated_at", model.created_at)
        ordered = statement.order_by(timestamp.desc(), model.id.desc())
        total, revision = _section_revision(session, statement, model, payload.section, run=run)
        rows = session.execute(ordered.offset(payload.offset).limit(payload.limit)).all()
        _, selected, snapshots, selection_count = _selection(session, run)
        items = [_item(row if payload.section == "tool_results" else row[0], payload.section, run, selected, snapshots) for row in rows]
        if payload.section == "facts":
            for item in items:
                item["selection_ambiguous"] = selection_count > 1
    if payload.expected_revision and payload.expected_revision != revision:
        raise HarnessError("recovery_revision_changed", "恢复索引已变化，请从 offset=0 重新读取", run_id=run.id,
                           details={"page_revision": revision})
    next_offset = payload.offset + len(items)
    return {"schema_version": SCHEMA_VERSION, "scope": {**_scope(run),
            "history": "job_history" if payload.include_history and run.job_id and payload.section in {"approvals", "proposals"} else "current_run"},
            "section": payload.section, "total": total, "offset": payload.offset, "limit": payload.limit,
            "next_offset": next_offset if next_offset < total else None, "has_more": next_offset < total,
            "omitted": max(0, total - next_offset), "page_revision": revision,
            "projection_notice": "Source bodies use read_interview_source. Resume content is opt-in with include_content. Complete detail pages are archived for read_tool_result if the transport preview is shortened.",
            "items": items}


def register_recovery_tools(gateway):
    def read(context, payload):
        return RecoveryToolResult(stage=context.run.current_stage or PipelineStage.CREATED.value,
            status=str(_value(context.run.status)), summary="已读取持久化恢复状态；审批与副作用保护继续生效。",
            data=read_recovery_context(context.session, context.run, payload))
    gateway.register(ToolSpec(name="read_recovery_context",
        description="Read durable recovery state for the bound run. Start with state; page one section or explicit IDs for facts, approvals, proposals, interview sources, operations, archived-result indexes or resume/snapshot indexes. Pass page_revision as expected_revision on continuation. Approvals/proposals default to this run; include_history explicitly reads other runs for this job. Readback does not grant approval or permit replay of unknown operations.",
        input_model=ReadRecoveryContextInput, output_model=RecoveryToolResult, permission=ToolPermission.READ,
        allowed_stages=set(PipelineStage), handler=read, read_only=True))
    return gateway
