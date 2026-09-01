from __future__ import annotations

from sqlalchemy import select

from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_agent.pi_domain_tools import build_pi_task_gateway
from applyos_domain.models import AgentRun, Approval, Candidate, Fact, Job, RewriteProposal
from applyos_harness.approval import ApprovalService
from applyos_harness.permissions import ToolPermission


def _execute(gateway, run, name, arguments, sequence):
    return gateway.execute(
        tool_name=name,
        run=run,
        arguments=arguments,
        granted_permissions=set(ToolPermission),
        idempotency_key=f"pi-native-{sequence}-{name}",
    )


def _approval(session, run_id, action):
    return session.scalar(select(Approval).where(Approval.run_id == run_id, Approval.action_type == action))


def test_pi_native_domain_flow_uses_four_business_tools_without_nested_agent(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="Pi candidate")
        session.add(candidate)
        session.flush()
        fact = Fact(
            candidate_id=candidate.id,
            category="experience",
            content="在产品实习中使用 SQL 分析转化漏斗",
            verified=True,
            allowed_outputs=["resume", "portfolio"],
        )
        job = Job(
            candidate_id=candidate.id,
            company="Example",
            role="数据分析师",
            jd_raw="负责使用 SQL 分析业务数据，并搭建转化漏斗指标体系。",
        )
        session.add_all([fact, job])
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent", current_stage="created")
        session.add(run)
        session.flush()

        gateway = build_pi_task_gateway(
            session,
            settings=AgentSettings(runtime=RuntimeMode.MOCK, workspace_root=tmp_path, allow_mock_runtime=True),
        )
        names = set(gateway.registry)
        assert {"prepare_job_review", "prepare_resume_review", "apply_and_verify_resume"}.issubset(names)
        assert "finalize_resume_version" not in names
        assert not {
            "validate_run_input",
            "analyze_job",
            "match_candidate_experiences",
            "generate_resume_strategy",
            "propose_resume_rewrites",
        }.intersection(names)

        job_result = _execute(
            gateway,
            run,
            "prepare_job_review",
            {
                "analysis": {
                    "responsibilities": [{"text": "使用 SQL 分析业务数据", "source_quote": "使用 SQL 分析业务数据"}],
                    "hard_requirements": [{"text": "能够搭建指标体系", "source_quote": "搭建转化漏斗指标体系"}],
                    "preferred_requirements": [],
                    "keywords": ["SQL", "转化漏斗"],
                    "competencies": ["数据分析", "指标体系"],
                    "uncertain_items": [],
                    "summary": "该岗位需要用 SQL 分析业务数据并建设转化漏斗指标。",
                },
                "fact_ranking": [{
                    "fact_id": fact.id,
                    "recommended": True,
                    "relevance": "high",
                    "rationale": "经历同时包含 SQL 和转化漏斗分析。",
                    "matched_jd_requirements": ["使用 SQL 分析业务数据", "搭建转化漏斗指标体系"],
                }],
            },
            1,
        )
        assert job_result["stage"] == "awaiting_fact_review"
        ApprovalService(session).approve_action(
            approval_id=_approval(session, run.id, "confirm_relevant_facts").id,
            approved_by="tester",
            payload={"fact_ids": [fact.id]},
        )

        review_result = _execute(
            gateway,
            run,
            "prepare_resume_review",
            {
                "strategy": {
                    "positioning": "突出 SQL 与转化漏斗分析能力",
                    "selected_fact_ids": [fact.id],
                    "matches": [{
                        "fact_id": fact.id,
                        "jd_requirement": "使用 SQL 分析业务数据",
                        "relevance": "high",
                        "rationale": "直接对应岗位职责",
                    }],
                    "section_order": ["experience", "skills"],
                    "warnings": [],
                },
                "patches": [{
                    "section": "experience",
                    "before": fact.content,
                    "after": "在产品实习中使用 SQL 分析转化漏斗，形成业务指标结论",
                    "reason": "将原有数据分析工作前置，保持事实范围不变",
                    "jd_evidence": ["使用 SQL 分析业务数据", "搭建转化漏斗指标体系"],
                    "fact_ids": [fact.id],
                    "risk_level": "low",
                }],
                "summary": "已基于原简历形成一条可审阅的岗位化改写。",
            },
            2,
        )
        assert review_result["stage"] == "awaiting_user_review"
        proposals = list(session.scalars(select(RewriteProposal).where(RewriteProposal.run_id == run.id)).all())
        ApprovalService(session).review_proposals(
            approval_id=_approval(session, run.id, "apply_resume_changes").id,
            approved_by="tester",
            decisions=[{"proposal_id": item.id, "decision": "accepted"} for item in proposals],
        )

        verified = _execute(gateway, run, "apply_and_verify_resume", {}, 3)
        assert verified["stage"] == "ready_to_publish"
        assert verified["data"]["ready_to_edit"] is True
        assert _approval(session, run.id, "publish_assets") is None


def test_pi_job_review_rejects_evidence_not_present_in_jd(database, tmp_path):
    with database.session() as session:
        candidate = Candidate(name="Pi candidate")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Example", role="Analyst", jd_raw="负责 SQL 分析。")
        session.add(job)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent", current_stage="created")
        session.add(run)
        session.flush()
        gateway = build_pi_task_gateway(
            session,
            settings=AgentSettings(runtime=RuntimeMode.MOCK, workspace_root=tmp_path, allow_mock_runtime=True),
        )
        try:
            _execute(
                gateway,
                run,
                "prepare_job_review",
                {
                    "analysis": {
                        "responsibilities": [{"text": "管理百人团队", "source_quote": "管理百人团队"}],
                        "summary": "岗位要求管理大型团队。",
                    },
                    "fact_ranking": [],
                },
                1,
            )
        except Exception as exc:
            assert getattr(exc, "code", "") == "jd_evidence_not_found"
        else:
            raise AssertionError("Pi domain evidence gate should reject hallucinated JD evidence")
