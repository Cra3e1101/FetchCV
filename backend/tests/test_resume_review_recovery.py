"""Recovery contracts for pending resume reviews. These tests make no model calls."""
from copy import deepcopy

import pytest
from sqlalchemy import select, update

from applyos_agent.pi_domain_tools import PiDomainPipeline, register_pi_domain_tools
from applyos_domain.enums import ApprovalStatus, ProposalStatus
from applyos_domain.models import AgentRun, Approval, Candidate, Fact, Job, ResumeVersion, RewriteProposal, VersionSnapshot
from applyos_harness.approval import ApprovalService
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission
from applyos_harness.versioning import canonical_hash
from integrations.resume.editor_schema import apply_resume_patches


def _execute(gateway, run, name, arguments):
    return gateway.execute(tool_name=name, run=run, arguments=arguments,
        granted_permissions=set(ToolPermission), idempotency_key="recovery-test:" + name)


def _review(session, tmp_path):
    candidate = Candidate(name="合成恢复候选人")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="合成公司", role="数据岗位", jd_raw="整理订单数据。保留项目原型。")
    fact = Fact(candidate_id=candidate.id, category="experience", content="整理订单数据。保留项目原型。",
        verified=True, allowed_outputs=["resume"], version=2)
    session.add_all([job, fact])
    session.flush()
    original = {"page_count": 2, "editor_snapshot": {"template": "existing-job-template", "settings": {"fontSize": 13},
        "profile": {"name": candidate.name}, "sections": [{"id": "experience", "title": "经历", "visible": True,
            "items": [{"body": fact.content, "fields": {}, "customLayout": "keep"}]}]}}
    base = ResumeVersion(candidate_id=candidate.id, name="旧基础版", content_json={"editor_snapshot": {
        "template": "wrong-base-template", "sections": [{"items": [{"body": "旧基础正文"}]}]}})
    source = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="当前岗位版", content_json=deepcopy(original))
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_native", current_stage="awaiting_fact_review")
    session.add_all([base, source, run])
    session.flush()
    service = ApprovalService(session)
    fact_review = service.request(run_id=run.id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id)
    service.approve_action(approval_id=fact_review.id, approved_by="user", payload={"fact_ids": [fact.id],
        "fact_snapshots": [{"fact_id": fact.id, "fact_version": fact.version, "content_hash": canonical_hash(fact.content)}]})
    pipeline = PiDomainPipeline(session)
    gateway = ToolGateway(session, workspace_root=tmp_path)
    register_pi_domain_tools(gateway, pipeline)
    patches = [{"section": "experience", "before": text, "after": text + "。", "reason": "规范句末标点",
        "jd_evidence": [text], "fact_ids": [fact.id], "evidence": [{"candidate_id": candidate.id,
            "fact_id": fact.id, "fact_version": fact.version, "source_quote": text}],
        "action": text, "object": text, "risk_level": "low"} for text in ("整理订单数据。", "保留项目原型。")]
    _execute(gateway, run, "prepare_resume_review", {"strategy": {"positioning": "保留已确认经历", "selected_fact_ids": [fact.id]},
        "patches": patches, "summary": "两个条目共用同一事实证据。"})
    approval = session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "apply_resume_changes"))
    proposals = list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id).order_by(RewriteProposal.created_at)).all())
    return service, pipeline, gateway, run, source, original, approval, proposals, patches


def _revision(approval):
    return {"expected_revision": int((approval.decision_payload.get("draft") or {}).get("revision") or 0),
        "expected_target_content_hash": approval.decision_payload["target_content_hash"]}


def test_same_fact_patches_keep_current_job_baseline_and_layout(database, tmp_path):
    with database.session() as session:
        service, pipeline, _, run, source, original, approval, proposals, _ = _review(session, tmp_path)
        draft = pipeline._require_resume(run)
        assert draft.parent_version_id == source.id
        service.review_proposals(approval_id=approval.id, decisions=[{"proposal_id": item.id, "decision": "accepted"} for item in proposals],
            approved_by="user", **_revision(approval))
        pipeline._apply_approved_changes(run)
        actual = draft.content_json["editor_snapshot"]
        assert actual["template"] == original["editor_snapshot"]["template"]
        assert actual["settings"] == original["editor_snapshot"]["settings"]
        assert actual["sections"][0]["items"][0] == {**original["editor_snapshot"]["sections"][0]["items"][0],
            "body": "整理订单数据。。保留项目原型。。"}
        assert draft.content_json["page_count"] == 2
        assert source.content_json == original


def test_stale_final_revision_leaves_all_proposals_pending(database, tmp_path):
    with database.session() as session:
        service, _, _, _, _, _, approval, proposals, _ = _review(session, tmp_path)
        stale = _revision(approval)
        service.save_review_draft(approval_id=approval.id, base_revision=0,
            decisions={proposals[0].id: {"decision": "rejected"}}, edited_by="another-window")
        with pytest.raises(HarnessError, match="审批内容已更新"):
            service.review_proposals(approval_id=approval.id, decisions=[{"proposal_id": item.id, "decision": "rejected"} for item in proposals],
                approved_by="stale-window", **stale)
        assert approval.status == ApprovalStatus.PENDING
        assert all(item.approval_status == ProposalStatus.PENDING for item in proposals)


def test_pending_rewrite_preserves_other_decisions_and_rejects_wrong_scope(database, tmp_path):
    with database.session() as session:
        service, _, gateway, run, _, _, approval, proposals, patches = _review(session, tmp_path)
        decisions = {item.id: {"decision": "rejected"} for item in proposals}
        service.save_review_draft(approval_id=approval.id, base_revision=0, decisions=decisions, edited_by="user")
        selected = proposals[0]
        service.request_rewrite(approval_id=approval.id, proposal_ids=[selected.id], instruction="只重写指定条目", requested_by="user", **_revision(approval))
        request = deepcopy(approval.decision_payload["rework_request"])
        assert approval.decision_payload["draft"]["decisions"] == {proposals[1].id: decisions[proposals[1].id]}
        before_other = deepcopy(proposals[1].claim_contract)
        with pytest.raises(HarnessError) as caught:
            _execute(gateway, run, "revise_resume_review", {"request_id": request["request_id"], "expected_revision": request["revision"],
                "patches": [{**patches[1], "proposal_id": proposals[1].id}], "summary": "越界尝试"})
        assert caught.value.code == "proposal_scope_mismatch"
        assert proposals[1].claim_contract == before_other
        with pytest.raises(HarnessError) as caught:
            service.review_proposals(approval_id=approval.id, decisions=[{"proposal_id": item.id, "decision": "rejected"} for item in proposals],
                approved_by="user", **_revision(approval))
        assert caught.value.code == "proposal_rewrite_pending"
        changed_patch = {**patches[0], "after": patches[0]["before"] + "。。", "proposal_id": selected.id}
        _execute(gateway, run, "revise_resume_review", {"request_id": request["request_id"], "expected_revision": request["revision"],
            "patches": [changed_patch], "summary": "已只修改指定条目。"})
        assert run.current_stage == "awaiting_user_review"
        assert approval.decision_payload["rework_request"]["status"] == "completed"
        assert approval.decision_payload["draft"]["decisions"] == {proposals[1].id: decisions[proposals[1].id]}
        assert proposals[1].claim_contract == before_other
        assert session.scalar(select(VersionSnapshot.id).where(VersionSnapshot.target_type == "proposal_review_batch",
            VersionSnapshot.reason == "after:revise selected proposals")) is not None


def test_cancel_rewrite_restores_decision_and_rejects_late_result(database, tmp_path):
    with database.session() as session:
        service, _, gateway, run, _, _, approval, proposals, patches = _review(session, tmp_path)
        decisions = {proposals[0].id: {"decision": "rejected"}}
        service.save_review_draft(approval_id=approval.id, base_revision=0, decisions=decisions, edited_by="user")
        service.request_rewrite(approval_id=approval.id, proposal_ids=[proposals[0].id], instruction="仅修改这一条", requested_by="user", **_revision(approval))
        request = deepcopy(approval.decision_payload["rework_request"])
        original_after = proposals[0].after
        service.cancel_rewrite(approval_id=approval.id, request_id=request["request_id"], **_revision(approval))
        with pytest.raises(HarnessError) as caught:
            _execute(gateway, run, "revise_resume_review", {"request_id": request["request_id"], "expected_revision": request["revision"],
                "patches": [{**patches[0], "proposal_id": proposals[0].id}], "summary": "迟到结果"})
        assert caught.value.code in {"approval_revision_conflict", "proposal_rewrite_request_changed"}
        assert proposals[0].after == original_after
        assert approval.decision_payload["draft"]["decisions"] == decisions


def test_final_cas_conflict_never_mutates_proposal_rows(database, tmp_path, monkeypatch):
    with database.session() as session:
        service, _, _, _, _, _, approval, proposals, _ = _review(session, tmp_path)
        original_cas = service._cas_review
        def raced_cas(row, old, new, **values):
            session.execute(update(Approval).where(Approval.id == row.id).values(
                decision_payload={**old, "draft": {"revision": 1, "decisions": {}}}).execution_options(synchronize_session=False))
            original_cas(row, old, new, **values)
        monkeypatch.setattr(service, "_cas_review", raced_cas)
        with pytest.raises(HarnessError) as caught:
            service.review_proposals(approval_id=approval.id,
                decisions=[{"proposal_id": item.id, "decision": "rejected"} for item in proposals], approved_by="user", **_revision(approval))
        assert caught.value.code == "approval_revision_conflict"
        assert all(item.approval_status == ProposalStatus.PENDING for item in proposals)


@pytest.mark.parametrize("body,before", [("重复句。重复句。", "重复句。"),
    ('<p title="仅属性">可见正文</p>', "仅属性"), ("<p>跨<b>标签</b>正文</p>", "跨标签正文"), ("A &amp; B", "amp")])
def test_ambiguous_or_nonvisible_anchors_fail_closed(body, before):
    content = {"editor_snapshot": {"sections": [{"items": [{"body": body}]}]}}
    original = deepcopy(content)
    with pytest.raises(HarnessError):
        apply_resume_patches(content, [{"before": before, "after": "替换"}])
    assert content == original
