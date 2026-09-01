from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_domain.models import AgentMessage, AgentRun, Fact, Job, JobProfile, ResumeVersion, VersionSnapshot
from applyos_harness.errors import HarnessError
from applyos_harness.state_machine import PipelineStage
from applyos_harness.trace import TraceService
from applyos_harness.versioning import VersionService

from .agents import AgentSuite
from .config import RuntimeMode
from .conversation_tools import ConversationToolAgent
from .schemas import GeneratedProposal, RankedFact


class AgentService:
    def __init__(self, session: Session, suite: AgentSuite | None = None):
        self.session = session
        self.suite = suite or AgentSuite()
        self.trace = TraceService(session)
        self.versions = VersionService(session)

    def analyze_job(self, job: Job, *, run: AgentRun | None = None) -> JobProfile:
        analysis, runtime = self.suite.analyze_jd(job, session_id=run.session_id if run else None)
        profile = self.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
        if profile is None:
            profile = JobProfile(job_id=job.id)
            self.session.add(profile)
        profile.responsibilities = [item.text for item in analysis.responsibilities]
        profile.hard_requirements = [item.text for item in analysis.hard_requirements]
        profile.preferred_requirements = [item.text for item in analysis.preferred_requirements]
        profile.keywords = analysis.keywords
        profile.competencies = analysis.competencies
        profile.uncertain_items = analysis.uncertain_items
        profile.business_context = {
            "evidence": [item.source_quote for item in analysis.responsibilities + analysis.hard_requirements + analysis.preferred_requirements],
            "runtime": runtime.usage.get("runtime", "mock"),
        }
        if run:
            profile.source_run_id = run.id
            run.session_id = runtime.session_id or run.session_id
            self.trace.record(
                run=run,
                stage=run.current_stage or "jd_analyzing",
                agent_name="jd_analyst",
                event_type="agent",
                output_refs=[f"job_profile:{profile.id}"],
                tool_calls=runtime.hook_events,
                usage=runtime.usage,
            )
            existing_message = self.session.scalar(
                select(AgentMessage).where(
                    AgentMessage.run_id == run.id,
                    AgentMessage.role == "assistant",
                )
            )
            if existing_message is None:
                responsibilities = "、".join(profile.responsibilities[:3]) or "岗位的核心交付"
                requirements = "、".join(profile.hard_requirements[:3]) or "JD 中明确的能力要求"
                competencies = "、".join(profile.competencies[:4]) or "相关业务与执行能力"
                fallback_note = "\n\n模型结构化结果不完整，本轮已使用本地解析兜底；你可以在对话中继续校正。" if runtime.usage.get("runtime") == "compatible_fallback" else ""
                self.session.add(AgentMessage(
                    candidate_id=job.candidate_id,
                    job_id=job.id,
                    run_id=run.id,
                    role="assistant",
                    content=f"我先说一下对这个岗位的理解。\n\n核心工作是：{responsibilities}。\n硬性要求主要是：{requirements}。\n因此简历会优先证明：{competencies}。教育背景和基础身份信息会原样保留，只对实习、项目与技能表达做岗位化组织。{fallback_note}",
                    metadata_json={"type": "job_understanding", "runtime": runtime.usage, "profile_id": profile.id},
                ))
        self.session.flush()
        return profile

    def resume_strategy(self, job: Job, *, run: AgentRun | None = None, fact_ids: list[str] | None = None) -> dict:
        statement = select(Fact).where(Fact.candidate_id == job.candidate_id, Fact.verified.is_(True))
        if fact_ids is not None:
            statement = statement.where(Fact.id.in_(fact_ids))
        facts = list(self.session.scalars(statement).all())
        strategy, runtime = self.suite.create_strategy(job, facts, session_id=run.session_id if run else None)
        snapshot = self.versions.snapshot(
            target_type="job_resume_strategy",
            target_id=job.id,
            payload=strategy.model_dump(mode="json"),
            run_id=run.id if run else None,
            reason="structured resume strategy",
        )
        if run:
            run.session_id = runtime.session_id or run.session_id
            self.trace.record(
                run=run,
                stage=run.current_stage or "strategy_generating",
                agent_name="resume_strategy",
                event_type="agent",
                output_refs=[f"snapshot:{snapshot.id}"],
                tool_calls=runtime.hook_events,
                usage=runtime.usage,
            )
        return {"strategy": strategy.model_dump(mode="json"), "snapshot_id": snapshot.id, "runtime": runtime.usage.get("runtime", "mock")}

    def rank_facts(self, job: Job, facts: list[Fact], *, run: AgentRun | None = None) -> dict:
        ranking, runtime = self.suite.rank_facts(job, facts, session_id=run.session_id if run else None)
        allowed_ids = {fact.id for fact in facts}
        ranked_by_id = {item.fact_id: item for item in ranking.items if item.fact_id in allowed_ids}
        normalized_items = []
        for fact in facts:
            item = ranked_by_id.get(fact.id)
            if item is None:
                item = RankedFact(
                    fact_id=fact.id,
                    recommended=False,
                    relevance="low",
                    rationale="模型未返回该条经历，保留给用户手动决定",
                )
            normalized_items.append(item)
        if run:
            run.session_id = runtime.session_id or run.session_id
            self.trace.record(
                run=run,
                stage=run.current_stage or "facts_matching",
                agent_name="fact_matcher",
                event_type="agent",
                output_refs=[f"ranked_fact:{item.fact_id}" for item in normalized_items],
                tool_calls=runtime.hook_events,
                usage=runtime.usage,
            )
        return {"items": [item.model_dump(mode="json") for item in normalized_items], "summary": ranking.summary, "runtime": runtime.usage}

    def generate_assets(self, job: Job, facts: list[Fact], *, run: AgentRun | None = None) -> dict:
        base_resume = self.session.scalar(
            select(ResumeVersion)
            .where(ResumeVersion.candidate_id == job.candidate_id, ResumeVersion.job_id.is_(None))
            .order_by(ResumeVersion.updated_at.desc())
        )
        resume_context = (base_resume.content_json or {}).get("editor_snapshot", {}) if base_resume else {}
        generation, runtime = self.suite.generate_assets(job, facts, resume_context=resume_context, session_id=run.session_id if run else None)
        allowed_ids = {fact.id for fact in facts}
        fact_experience_ids = {
            fact.id: str((fact.normalized_value or {}).get("experience_id") or fact.subject_id or "")
            for fact in facts
        }
        valid_proposals = []
        for proposal in generation.proposals:
            fact_ids = list(dict.fromkeys(item for item in proposal.fact_ids if item in allowed_ids))
            before = proposal.before.strip()
            after = proposal.after.strip()
            # Unchanged or malformed model output is not a rewrite proposal.
            # Keeping it out of the approval list prevents the UI from implying
            # that a no-op is a meaningful edit.
            if not fact_ids or not before or not after or before == after:
                continue
            experience_ids = {fact_experience_ids.get(fact_id, "") for fact_id in fact_ids} - {""}
            valid_proposals.append(
                proposal.model_copy(
                    update={
                        "before": before,
                        "after": after,
                        "fact_ids": fact_ids,
                        "experience_id": next(iter(experience_ids), None),
                    }
                )
            )
        if not valid_proposals:
            fallback_fact = next(iter(facts), None)
            if fallback_fact is not None:
                valid_proposals = [GeneratedProposal(
                    section="no_change",
                    before=fallback_fact.content,
                    after=fallback_fact.content,
                    reason="模型判断当前原文无需岗位化改写；原简历保持不变。",
                    jd_evidence=[(job.jd_raw or "")[:240]],
                    fact_ids=[fallback_fact.id],
                    experience_id=fact_experience_ids.get(fallback_fact.id) or None,
                    risk_level="low",
                )]
        if run:
            run.session_id = runtime.session_id or run.session_id
            self.trace.record(
                run=run,
                stage=run.current_stage or "draft_generating",
                agent_name="asset_generation",
                event_type="agent",
                output_refs=[f"generated_proposal:{index}" for index, _ in enumerate(valid_proposals)],
                tool_calls=runtime.hook_events,
                usage=runtime.usage,
            )
        return {"proposals": [item.model_dump(mode="json") for item in valid_proposals], "summary": generation.summary, "runtime": runtime.usage}

    def converse(self, job: Job, message: str, *, run: AgentRun | None = None, context: str = "", thinking_level: str = "balanced") -> dict:
        if self.suite.settings.runtime == RuntimeMode.MOCK:
            raise HarnessError("model_required", "请先连接并启用一个模型；Agent 对话不会使用本地规则冒充模型回答。")
        if run is None:
            run = AgentRun(candidate_id=job.candidate_id, job_id=job.id, run_type="conversation_tools", current_stage=PipelineStage.CREATED.value)
            self.session.add(run)
            self.session.flush()
        outcome = ConversationToolAgent(
            self.session,
            settings=self.suite.settings,
            runtime=self.suite.runtime,
        ).run(
            job=job,
            run=run,
            message=message,
            context=context,
            thinking_level=thinking_level,
            request_id=f"conversation:{run.id}:{uuid4().hex}",
        )
        return {
            "message": outcome.text,
            "intent": "discuss",
            "suggested_actions": [],
            "runtime": {**outcome.usage, "tool_calls": [item["tool_name"] for item in outcome.tool_results]},
        }

    @staticmethod
    def require_job(session: Session, job_id: str) -> Job:
        job = session.get(Job, job_id)
        if job is None:
            raise HarnessError("job_not_found", "岗位不存在")
        return job
