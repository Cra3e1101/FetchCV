from __future__ import annotations

from copy import deepcopy

from sqlalchemy import select

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.schemas import RuntimeToolCall, RuntimeTurnResult
from applyos_agent.tools import register_pipeline_tools
from applyos_domain.models import Approval, Fact, Job, ResumeVersion, RewriteProposal
from applyos_harness.approval import ApprovalService
from applyos_harness.permissions import ToolGateway
from applyos_harness.pipeline import MockPipeline
from applyos_harness.versioning import VersionService
from integrations.resume_pdf.importer import PdfResumeImporter






def _approval(session, run_id, action):
    return session.scalar(select(Approval).where(Approval.run_id == run_id, Approval.action_type == action))


def _bodies(snapshot):
    return [str(item.get("body") or "") for section in snapshot.get("sections", []) for item in section.get("items", [])]


def test_real_pdf_and_jd_domain_flow_preserves_original_resume(database, tmp_path, monkeypatch, legacy_resume_pdf, legacy_job_descriptions):
    monkeypatch.setenv("FETCHCV_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    imported = PdfResumeImporter(database).import_file(legacy_resume_pdf)
    first_jd = legacy_job_descriptions.read_text(encoding="utf-8").split("\n\n字节跳动", 1)[0].strip()
    assert "策略运营实习生-TikTok Shop" in first_jd

    with database.session() as session:
        base_resume = session.get(ResumeVersion, imported["resume_id"])
        original_content = deepcopy(base_resume.content_json)
        original_snapshot = deepcopy(original_content["editor_snapshot"])
        education_item = original_snapshot["sections"][0]["items"][0]
        internship_item = original_snapshot["sections"][1]["items"][0]
        project_section = next(item for item in original_snapshot["sections"] if item["id"] == "project")
        assert [item["id"] for item in original_snapshot["sections"]] == ["education", "internship", "skills", "project"]
        assert education_item["fields"]["timeRange"] == {"start": "2024-09", "end": "", "current": True}
        assert education_item["fields"]["major"] == "数量经济学（统计学方向）"
        assert education_item["fields"]["gpa"] == "3.56/4"
        assert not education_item["body"].startswith("2024-09")
        assert internship_item["fields"]["timeRange"] == {"start": "2026-03", "end": "2026-06", "current": False}
        assert internship_item["fields"]["company"] == "拓尔思信息技术股份有限公司"
        assert internship_item["fields"]["role"] == "金融产品中心-智能产品部-数据分析师"
        assert project_section["items"][0]["fields"]["timeRange"] == {"start": "2025-09", "end": "2025-10", "current": False}
        assert project_section["items"][0]["fields"]["role"] == "华为杯国二"
        job = Job(
            candidate_id=imported["candidate_id"],
            company="字节跳动",
            role="策略运营实习生-TikTok Shop",
            jd_raw=first_jd,
            source_type="test_fixture",
        )
        session.add(job)
        session.flush()

        pipeline = MockPipeline(session)
        gateway = ToolGateway(session, workspace_root=PROJECT_ROOT)
        register_pipeline_tools(gateway, pipeline)
        settings = AgentSettings(runtime=RuntimeMode.MOCK, model="scripted", workspace_root=PROJECT_ROOT, max_turns=4, allow_mock_runtime=True)
        run = pipeline.create_run(candidate_id=imported["candidate_id"], job_id=job.id, idempotency_key="real-material-agent-flow")

        post_review = pipeline.drive(run)
        assert post_review.current_stage == "awaiting_fact_review", run.error
        imported_facts = list(session.scalars(select(Fact).where(Fact.candidate_id == imported["candidate_id"])).all())
        assert imported_facts
        for fact in imported_facts:
            fact.verified = True
            fact.allowed_outputs = ["resume", "portfolio"]
        ApprovalService(session).approve_action(
            approval_id=_approval(session, run.id, "confirm_relevant_facts").id,
            approved_by="acceptance-test",
            payload={"fact_ids": [fact.id for fact in imported_facts]},
        )
        VersionService(session).snapshot(
            target_type="job_resume_strategy",
            target_id=job.id,
            payload={
                "positioning": "以跨境业务分析与策略判断为主线，突出数据证据和协同落地",
                "section_order": ["summary", "internship", "projects", "skills", "education"],
                "warnings": ["不扩写原简历没有的跨境业务结果"],
            },
            run_id=run.id,
            reason="real material model strategy fixture",
        )

        assert pipeline.drive(run).current_stage == "awaiting_user_review"
        job_resume = session.scalar(select(ResumeVersion).where(ResumeVersion.job_id == job.id))
        assert job_resume is not None
        assert job_resume.parent_version_id == base_resume.id
        draft_snapshot = job_resume.content_json["editor_snapshot"]
        assert draft_snapshot["template"] == original_snapshot["template"]
        assert draft_snapshot["settings"] == original_snapshot["settings"]
        assert [item["id"] for item in draft_snapshot["sections"]] == [item["id"] for item in original_snapshot["sections"]]
        assert _bodies(draft_snapshot) == _bodies(original_snapshot)
        assert job_resume.content_json["strategy"]["positioning"] == "以跨境业务分析与策略判断为主线，突出数据证据和协同落地"
        assert job_resume.content_json["strategy"]["strategy_source"] == "model"

        proposals = list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id).order_by(RewriteProposal.created_at)).all())
        assert proposals
        rewrite_suffix = "针对目标岗位补充：通过数据整理与业务分析支持策略判断。"
        edited_text = proposals[0].before + "\n" + rewrite_suffix
        decisions = [
            {"proposal_id": proposal.id, "decision": "edited_accepted", "edited_after": edited_text}
            if proposal.id == proposals[0].id
            else {"proposal_id": proposal.id, "decision": "rejected"}
            for proposal in proposals
        ]
        review_approval = _approval(session, run.id, "apply_resume_changes")
        ApprovalService(session).review_proposals(
            approval_id=review_approval.id,
            approved_by="acceptance-test",
            expected_revision=int((review_approval.decision_payload.get("draft") or {}).get("revision") or 0),
            expected_target_content_hash=review_approval.decision_payload["target_content_hash"],
            decisions=decisions,
        )

        post_review = pipeline.drive(run)
        assert post_review.current_stage == "ready_to_publish", run.error
        assert session.scalar(select(Approval).where(Approval.run_id == run.id, Approval.action_type == "publish_assets")) is None

        session.refresh(base_resume)
        session.refresh(job_resume)
        final_snapshot = job_resume.content_json["editor_snapshot"]
        assert base_resume.content_json == original_content
        assert final_snapshot["template"] == original_snapshot["template"]
        assert final_snapshot["settings"] == original_snapshot["settings"]
        assert any(rewrite_suffix in body for body in _bodies(final_snapshot))
        assert sum(before != after for before, after in zip(_bodies(original_snapshot), _bodies(final_snapshot), strict=True)) == 1
