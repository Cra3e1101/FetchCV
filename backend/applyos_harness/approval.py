from __future__ import annotations

from datetime import datetime, timezone
from copy import deepcopy
from typing import Any
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from applyos_domain.enums import ApprovalStatus, ProposalStatus, RiskLevel
from applyos_domain.models import Approval, RewriteProposal, ResumeVersion

from .errors import HarnessError
from .versioning import VersionService, canonical_hash, model_payload


class ApprovalService:
    def __init__(self, session: Session):
        self.session = session

    def request(self, *, run_id: str, action_type: str, target_type: str, target_id: str, items: list[dict[str, Any]] | None = None) -> Approval:
        existing = self.session.scalar(
            select(Approval).where(
                Approval.run_id == run_id,
                Approval.action_type == action_type,
                Approval.target_type == target_type,
                Approval.target_id == target_id,
                Approval.status == ApprovalStatus.PENDING,
            )
        )
        if existing is not None:
            return existing
        target = self.session.get(ResumeVersion, target_id) if target_type in {"resume", "resume_version"} else None
        approval = Approval(
            run_id=run_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            decision_payload={"items": items or [], **({"target_content_hash": canonical_hash(target.content_json)} if target is not None else {})},
        )
        self.session.add(approval)
        self.session.flush()
        return approval

    def _pending_review(self, approval_id: str, *, expected_revision: int | None = None, expected_target_content_hash: str | None = None) -> Approval:
        approval = self.session.get(Approval, approval_id)
        if approval is None:
            raise HarnessError("approval_not_found", "审批记录不存在")
        if approval.action_type != "apply_resume_changes":
            raise HarnessError("approval_scope_mismatch", "审批类型与修改建议不匹配", run_id=approval.run_id)
        if approval.status != ApprovalStatus.PENDING:
            raise HarnessError("approval_already_decided", "审批已经完成", run_id=approval.run_id)
        current = approval.decision_payload or {}
        revision = int((current.get("draft") or {}).get("revision") or 0)
        if expected_revision is not None and expected_revision != revision:
            raise HarnessError("approval_revision_conflict", "审批内容已更新，请重新打开审阅", run_id=approval.run_id, details={"current_revision": revision})
        if expected_target_content_hash is not None and expected_target_content_hash != current.get("target_content_hash"):
            raise HarnessError("approval_target_changed", "审阅的简历基线已变化，请重新打开审阅", run_id=approval.run_id)
        target = self.session.get(ResumeVersion, approval.target_id)
        if target is None or canonical_hash(target.content_json) != current.get("target_content_hash"):
            raise HarnessError("approval_target_changed", "简历内容已变化，请重新准备审阅", run_id=approval.run_id)
        # Acquire a write lock and recheck the exact baseline in the database.
        # Comparing a previously loaded hash alone leaves a check/write race.
        locked = self.session.execute(update(ResumeVersion).where(
            ResumeVersion.id == target.id, ResumeVersion.content_json == target.content_json,
        ).values(content_hash=canonical_hash(target.content_json)).execution_options(synchronize_session=False))
        if locked.rowcount != 1:
            raise HarnessError("approval_target_changed", "简历内容已变化，请重新准备审阅", run_id=approval.run_id)
        return approval

    def _cas_review(self, approval: Approval, old_payload: dict[str, Any], new_payload: dict[str, Any], **values) -> None:
        changed = self.session.execute(update(Approval).where(
            Approval.id == approval.id, Approval.status == ApprovalStatus.PENDING,
            Approval.decision_payload == old_payload,
        ).values(decision_payload=new_payload, **values).execution_options(synchronize_session=False))
        if changed.rowcount != 1:
            raise HarnessError("approval_revision_conflict", "审批已在其他窗口更新，请重新打开审阅", run_id=approval.run_id)
        self.session.refresh(approval)

    def _review_proposals(self, approval: Approval) -> list[RewriteProposal]:
        return list(self.session.scalars(select(RewriteProposal).where(
            RewriteProposal.run_id == approval.run_id, RewriteProposal.resume_version_id == approval.target_id,
        )).all())

    def snapshot_review(self, approval: Approval, *, reason: str) -> None:
        VersionService(self.session).snapshot(target_type="proposal_review_batch", target_id=approval.id,
            payload={"approval": model_payload(approval), "proposals": [model_payload(item) for item in self._review_proposals(approval)]},
            run_id=approval.run_id, reason=reason)

    def save_review_draft(self, *, approval_id: str, base_revision: int, decisions: dict[str, Any], edited_by: str) -> Approval:
        approval = self._pending_review(approval_id, expected_revision=base_revision)
        old = deepcopy(approval.decision_payload or {})
        if (old.get("rework_request") or {}).get("status") == "pending":
            raise HarnessError("proposal_rewrite_pending", "指定条目正在重新改写，请先完成或取消该请求", run_id=approval.run_id)
        ids = {item.id for item in self._review_proposals(approval)}
        if set(decisions) - ids:
            raise HarnessError("proposal_scope_mismatch", "审批草稿包含当前批次以外的条目", run_id=approval.run_id)
        payload = {**old, "draft": {"revision": base_revision + 1, "decisions": decisions,
            "edited_by": edited_by, "updated_at": datetime.now(timezone.utc).isoformat()}}
        self._cas_review(approval, old, payload)
        return approval

    def request_rewrite(self, *, approval_id: str, proposal_ids: list[str], instruction: str, requested_by: str,
                        expected_revision: int, expected_target_content_hash: str) -> Approval:
        approval = self._pending_review(approval_id, expected_revision=expected_revision, expected_target_content_hash=expected_target_content_hash)
        old = deepcopy(approval.decision_payload or {})
        if (old.get("rework_request") or {}).get("status") == "pending":
            raise HarnessError("proposal_rewrite_pending", "已有待处理的局部改写请求，请先完成或取消", run_id=approval.run_id)
        ids = list(dict.fromkeys(proposal_ids))
        proposals = self._review_proposals(approval)
        if not ids or set(ids) - {item.id for item in proposals} or any(item.approval_status != ProposalStatus.PENDING for item in proposals):
            raise HarnessError("proposal_scope_mismatch", "只能重新改写本批尚未完成审批的指定条目", run_id=approval.run_id)
        draft = deepcopy(old.get("draft") or {})
        decisions = dict(draft.get("decisions") or {})
        previous = {key: decisions.pop(key) for key in ids if key in decisions}
        revision = expected_revision + 1
        request = {"request_id": "rewrite_" + uuid4().hex, "proposal_ids": ids, "instruction": instruction,
            "status": "pending", "revision": revision, "requested_by": requested_by,
            "requested_at": datetime.now(timezone.utc).isoformat(), "previous_decisions": previous}
        payload = {**old, "draft": {**draft, "revision": revision, "decisions": decisions}, "rework_request": request}
        self.snapshot_review(approval, reason="before:request selected proposal rewrite")
        self._cas_review(approval, old, payload)
        self.snapshot_review(approval, reason="after:request selected proposal rewrite")
        return approval

    def cancel_rewrite(self, *, approval_id: str, request_id: str, expected_revision: int, expected_target_content_hash: str) -> Approval:
        approval = self._pending_review(approval_id, expected_revision=expected_revision, expected_target_content_hash=expected_target_content_hash)
        old = deepcopy(approval.decision_payload or {})
        request = old.get("rework_request") or {}
        if request.get("request_id") != request_id or request.get("status") != "pending":
            raise HarnessError("proposal_rewrite_request_changed", "局部改写请求已变化，请刷新后继续", run_id=approval.run_id)
        draft = deepcopy(old.get("draft") or {})
        payload = {**old, "draft": {**draft, "revision": expected_revision + 1,
            "decisions": {**(draft.get("decisions") or {}), **request.get("previous_decisions", {})}},
            "rework_request": {**request, "status": "cancelled"}}
        self.snapshot_review(approval, reason="before:cancel selected proposal rewrite")
        self._cas_review(approval, old, payload)
        self.snapshot_review(approval, reason="after:cancel selected proposal rewrite")
        return approval

    def review_proposals(self, *, approval_id: str, decisions: list[dict[str, Any]], approved_by: str,
                         expected_revision: int, expected_target_content_hash: str) -> Approval:
        approval = self._pending_review(approval_id, expected_revision=expected_revision, expected_target_content_hash=expected_target_content_hash)
        old_payload = deepcopy(approval.decision_payload or {})
        if (old_payload.get("rework_request") or {}).get("status") == "pending":
            raise HarnessError("proposal_rewrite_pending", "局部改写尚未完成，请先完成或取消再提交审批", run_id=approval.run_id)
        proposals = self._review_proposals(approval)
        decision_map = {str(item.get("proposal_id")): item for item in decisions}
        if len(decision_map) != len(decisions) or set(decision_map) - {item.id for item in proposals}:
            raise HarnessError("proposal_scope_mismatch", "审批条目必须与当前批次逐一对应", run_id=approval.run_id)
        missing = [proposal.id for proposal in proposals if proposal.id not in decision_map]
        if missing:
            raise HarnessError(
                "proposal_decision_incomplete",
                "每条修改建议都必须明确接受、拒绝或编辑后接受",
                run_id=approval.run_id,
                details={"missing_proposal_ids": missing},
            )
        high_risk = [proposal.id for proposal in proposals if proposal.risk_level == RiskLevel.HIGH]
        # Validate the entire decision set before mutating any approval state.
        # User edits are new text, not an exemption from factual validation.
        from .gates import proposal_claims
        for proposal in proposals:
            decision = decision_map[proposal.id]
            if decision.get("decision") not in {"accepted", "edited_accepted", "rejected"}:
                raise HarnessError("invalid_proposal_decision", "每条建议必须选择接受、编辑后接受或拒绝", run_id=approval.run_id)
            if decision.get("decision") in {"accepted", "edited_accepted"}:
                actual = str(decision.get("edited_after") or "") if decision.get("decision") == "edited_accepted" else proposal.after
                if not actual.strip():
                    raise HarnessError("invalid_proposal_decision", "编辑后接受必须包含非空正文")
                proposal_claims(self.session, proposal, text=actual)
        # Claim this exact pending revision before changing any proposal rows.
        draft_revision = int((old_payload.get("draft") or {}).get("revision") or 0)
        approved_payload = {**old_payload, "items": decisions, "revision": draft_revision + 1,
            "previous_draft_revision": draft_revision, "event_type": "proposal_review_approved",
            "high_risk_individually_confirmed": high_risk}
        self._cas_review(approval, old_payload, approved_payload, status=ApprovalStatus.APPROVED,
            approved_by=approved_by, approved_at=datetime.now(timezone.utc))
        for proposal in proposals:
            decision = decision_map[proposal.id]
            action = str(decision.get("decision") or "")
            if action == "accepted":
                proposal.approval_status = ProposalStatus.ACCEPTED
            elif action == "rejected":
                proposal.approval_status = ProposalStatus.REJECTED
            elif action == "edited_accepted" and str(decision.get("edited_after") or "").strip():
                proposal.approval_status = ProposalStatus.EDITED_ACCEPTED
                proposal.edited_after = str(decision["edited_after"])
            else:
                raise HarnessError(
                    "invalid_proposal_decision",
                    f"建议 {proposal.id} 的审批动作无效",
                    run_id=approval.run_id,
                    details={"proposal_id": proposal.id, "decision": action},
                )
        approval.decision_payload = {
            **approved_payload,
            "proposal_content_hashes": {proposal.id: canonical_hash({
                "before": proposal.before, "after": proposal.after, "edited_after": proposal.edited_after,
                "claim_contract": proposal.claim_contract, "fact_ids": proposal.fact_ids,
                "approval_status": proposal.approval_status.value,
            }) for proposal in proposals},
        }
        self.session.flush()
        return approval

    def approve_action(self, *, approval_id: str, approved_by: str, payload: dict[str, Any] | None = None) -> Approval:
        approval = self.session.get(Approval, approval_id)
        if approval is None:
            raise HarnessError("approval_not_found", "审批记录不存在")
        if approval.status != ApprovalStatus.PENDING:
            raise HarnessError("approval_already_decided", "审批已经完成", run_id=approval.run_id)
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by = approved_by
        approval.approved_at = datetime.now(timezone.utc)
        approval.decision_payload = {**(approval.decision_payload or {}), **(payload or {"approved": True})}
        self.session.flush()
        return approval

    def reject_action(self, *, approval_id: str, approved_by: str, payload: dict[str, Any] | None = None) -> Approval:
        approval = self.session.get(Approval, approval_id)
        if approval is None:
            raise HarnessError("approval_not_found", "审批记录不存在")
        if approval.status != ApprovalStatus.PENDING:
            raise HarnessError("approval_already_decided", "审批已经完成", run_id=approval.run_id)
        approval.status = ApprovalStatus.REJECTED
        approval.approved_by = approved_by
        approval.approved_at = datetime.now(timezone.utc)
        approval.decision_payload = {**(approval.decision_payload or {}), **(payload or {}), "approved": False}
        self.session.flush()
        return approval

    def is_approved(self, *, run_id: str, action_type: str, target_id: str | None = None) -> bool:
        statement = select(Approval).where(
            Approval.run_id == run_id,
            Approval.action_type == action_type,
            Approval.status == ApprovalStatus.APPROVED,
        )
        if target_id is not None:
            statement = statement.where(Approval.target_id == target_id)
        return self.session.scalar(statement) is not None

    def require(self, *, run_id: str, action_type: str, target_id: str | None = None) -> None:
        if not self.is_approved(run_id=run_id, action_type=action_type, target_id=target_id):
            raise HarnessError("approval_required", f"操作 {action_type} 需要用户审批", run_id=run_id)
