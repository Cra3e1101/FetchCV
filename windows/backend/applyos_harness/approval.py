from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.enums import ApprovalStatus, ProposalStatus, RiskLevel
from applyos_domain.models import Approval, RewriteProposal

from .errors import HarnessError


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
        approval = Approval(
            run_id=run_id,
            action_type=action_type,
            target_type=target_type,
            target_id=target_id,
            decision_payload={"items": items or []},
        )
        self.session.add(approval)
        self.session.flush()
        return approval

    def review_proposals(self, *, approval_id: str, decisions: list[dict[str, Any]], approved_by: str) -> Approval:
        approval = self.session.get(Approval, approval_id)
        if approval is None:
            raise HarnessError("approval_not_found", "审批记录不存在")
        if approval.action_type != "apply_resume_changes":
            raise HarnessError("approval_scope_mismatch", "审批类型与修改建议不匹配", run_id=approval.run_id)
        if approval.status != ApprovalStatus.PENDING:
            raise HarnessError("approval_already_decided", "审批已经完成", run_id=approval.run_id)
        proposals = self.session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == approval.run_id)).all()
        decision_map = {str(item.get("proposal_id")): item for item in decisions}
        missing = [proposal.id for proposal in proposals if proposal.id not in decision_map]
        if missing:
            raise HarnessError(
                "proposal_decision_incomplete",
                "每条修改建议都必须明确接受、拒绝或编辑后接受",
                run_id=approval.run_id,
                details={"missing_proposal_ids": missing},
            )
        high_risk = [proposal.id for proposal in proposals if proposal.risk_level == RiskLevel.HIGH]
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
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by = approved_by
        approval.approved_at = datetime.now(timezone.utc)
        draft_revision = int(((approval.decision_payload or {}).get("draft") or {}).get("revision") or 0)
        approval.decision_payload = {
            "items": decisions,
            "revision": draft_revision + 1,
            "previous_draft_revision": draft_revision,
            "event_type": "proposal_review_approved",
            "high_risk_individually_confirmed": high_risk,
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
        approval.decision_payload = payload or {"approved": True}
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
