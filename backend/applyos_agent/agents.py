from __future__ import annotations

from collections import Counter
from collections.abc import AsyncIterator
import json
import re

from applyos_domain.models import Fact, Job
from applyos_harness.validation import role_strength_risk

from .config import AgentSettings
from .conversation_prompt import build_conversation_request
from .prompt_contract import OUTPUT_LANGUAGE
from .runtime import AgentRuntime, build_runtime
from .schemas import (
    AssetGeneration,
    AuditIssue,
    ConversationReply,
    EvidenceItem,
    FactMatch,
    FactRanking,
    RankedFact,
    GeneratedProposal,
    JobPostingExtraction,
    JDAnalysis,
    QualityAudit,
    ResumeStrategy,
    RuntimeResult,
)


class AgentSuite:
    def __init__(self, settings: AgentSettings | None = None, runtime: AgentRuntime | None = None):
        self.settings = settings or AgentSettings.from_env()
        self.runtime = runtime or build_runtime(self.settings)

    def analyze_jd(self, job: Job, *, session_id: str | None = None) -> tuple[JDAnalysis, RuntimeResult]:
        lines = [line.strip(" -•\t") for line in (job.jd_raw or "").splitlines() if line.strip()]
        evidence = [EvidenceItem(text=line, source_quote=line) for line in lines[:8]]
        keywords = [token for token, _ in Counter((job.jd_raw or "").replace("/", " ").split()).most_common(12)]
        mock = JDAnalysis(
            responsibilities=evidence[:5],
            hard_requirements=evidence[5:7],
            preferred_requirements=evidence[7:8],
            keywords=keywords,
            competencies=["事实分析", "结构化表达"],
            uncertain_items=[] if lines else ["JD 内容为空"],
        )
        return self.runtime.generate(
            agent_name="jd_analyst",
            prompt=f"Analyze the following job description using only the original text. Do not infer requirements from the company name:\n\n{job.jd_raw or ''}",
            system_prompt=(
                "You are the FetchCV JD Analyst. Preserve verbatim JD evidence for every item. "
                "Do not predict hiring probabilities or invent requirements. " + OUTPUT_LANGUAGE
            ),
            output_model=JDAnalysis,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def extract_job_posting(self, raw_text: str, *, page_title: str = "", session_id: str | None = None) -> tuple[JobPostingExtraction, RuntimeResult]:
        lines = [" ".join(line.split()) for line in raw_text.splitlines() if " ".join(line.split())]
        useful = [line for line in lines if len(line) > 2]
        responsibilities = [line for line in useful if any(token in line for token in ("负责", "工作内容", "职责", "参与", "完成"))][:12]
        requirements = [line for line in useful if any(token in line for token in ("要求", "任职", "学历", "熟悉", "掌握", "本科", "硕士"))][:12]
        body = "\n".join(useful[:80])[:30000]
        mock = JobPostingExtraction(
            title=page_title[:240],
            description=body,
            responsibilities=responsibilities,
            requirements=requirements,
            confidence=0.35 if len(useful) < 12 else 0.65,
            warnings=["页面未提供明确公司字段，请确认公司名称。"] if not any("百度" in line for line in useful[:8]) else [],
        )
        return self.runtime.generate(
            agent_name="job_posting_extractor",
            prompt=(
                "Extract a clean job description suitable for a job workspace from the visible recruitment-page text below. "
                "Remove navigation, login prompts, footers, recruitment-site slogans and duplicates. "
                "Keep only this job's responsibilities, requirements, preferred qualifications, location, company and role names. "
                "Do not fill gaps from general knowledge. Leave uncertain fields empty and explain them in warnings. "
                "Organize description into readable responsibilities, requirements and preferred qualifications.\n\n"
                f"Page title: {page_title}\nPage text:\n{raw_text[:30000]}"
            ),
            system_prompt=(
                "You are the FetchCV Job Posting Extraction Agent. Use only the page body. "
                "Do not treat page chrome, navigation or site branding as job requirements. "
                "Return output that strictly conforms to the JSON Schema. " + OUTPUT_LANGUAGE
            ),
            output_model=JobPostingExtraction,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def create_strategy(self, job: Job, facts: list[Fact], *, session_id: str | None = None) -> tuple[ResumeStrategy, RuntimeResult]:
        selected = [fact for fact in facts if fact.verified][:8]
        matches = [FactMatch(fact_id=fact.id, jd_requirement=(job.jd_raw or "")[:160], relevance="high", rationale="已确认事实可直接支持岗位表达") for fact in selected]
        mock = ResumeStrategy(
            positioning=f"面向 {job.company} · {job.role} 的事实驱动版本",
            selected_fact_ids=[fact.id for fact in selected],
            matches=matches,
            section_order=["summary", "experience", "projects", "skills"],
            warnings=[] if selected else ["没有已确认事实"],
        )
        fact_text = "\n".join(f"[{fact.id}] {fact.content}" for fact in selected)
        return self.runtime.generate(
            agent_name="resume_strategy",
            prompt=f"Create a resume strategy from the JD and verified facts. JD:\n{job.jd_raw or ''}\nFacts:\n{fact_text}",
            system_prompt=(
                "You are the FetchCV Resume Strategy Agent. Select only supplied fact_id values and do not strengthen factual claims. "
                "Specify the primary positioning, supporting capabilities, section order and content selection. " + OUTPUT_LANGUAGE
            ),
            output_model=ResumeStrategy,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def rank_facts(self, job: Job, facts: list[Fact], *, session_id: str | None = None) -> tuple[FactRanking, RuntimeResult]:
        job_text = (job.jd_raw or "").lower()
        local_items = []
        for fact in facts:
            tokens = set(re.findall(r"[a-z][a-z0-9+#.-]{1,}|[\u4e00-\u9fff]{2,6}", fact.content.lower()))
            matched = sorted(token for token in tokens if token in job_text)[:6]
            local_items.append(
                RankedFact(
                    fact_id=fact.id,
                    recommended=bool(matched),
                    relevance="medium" if matched else "low",
                    rationale=f"与 JD 共享关键词：{'、'.join(matched)}" if matched else "未发现直接关键词重合",
                    matched_jd_requirements=matched,
                )
            )
        mock = FactRanking(items=local_items, summary="本地关键词重合初筛")
        fact_text = "\n".join(f"[{fact.id}] ({fact.category}) {fact.content}" for fact in facts)
        return self.runtime.generate(
            agent_name="fact_matcher",
            prompt=(
                f"Role: {job.company} · {job.role}\nJD:\n{job.jd_raw or ''}\n\nCandidate facts:\n{fact_text}\n\n"
                "Assess whether each fact substantively supports this role. Return every input fact_id and never invent IDs. "
                "Recommend selectively and cite specific JD requirements."
            ),
            system_prompt=(
                "You are the FetchCV Fact Matching Agent for application materials. Assess relevance only. "
                "Do not modify facts, exaggerate roles or infer capabilities the candidate has not supplied. " + OUTPUT_LANGUAGE
            ),
            output_model=FactRanking,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def generate_assets(self, job: Job, facts: list[Fact], *, resume_context: dict | None = None, session_id: str | None = None) -> tuple[AssetGeneration, RuntimeResult]:
        proposals: list[GeneratedProposal] = []
        for index, fact in enumerate([fact for fact in facts if fact.verified][:12]):
            before = fact.content
            after = fact.content
            risk, _ = role_strength_risk(before, after)
            proposals.append(GeneratedProposal(section=f"section_{index + 1}", before=before, after=after, reason="本地模式不擅自改写事实", jd_evidence=[(job.jd_raw or "")[:240]], fact_ids=[fact.id], risk_level=risk))
        mock = AssetGeneration(proposals=proposals, summary=f"生成 {len(proposals)} 条可审核建议")
        return self.runtime.generate(
            agent_name="asset_generation",
            prompt=(
                f"Target role: {job.company} · {job.role}\nJD:\n{job.jd_raw or ''}\n\n"
                + "Base resume (preserve its sections, order, dates, companies, roles, education and identity details; propose diffs only where tailoring is necessary):\n"
                + json.dumps(resume_context or {}, ensure_ascii=False)
                + "\n\n"
                + "Candidate facts (brackets contain stable fact IDs; facts sharing an experience_id belong to the same complete experience):\n"
                + "\n".join(
                    f"[{fact.id}] experience_id={((fact.normalized_value or {}).get('experience_id') or fact.subject_id or 'unknown')} ({fact.category}) {fact.content}"
                    for fact in facts if fact.verified
                )
                + "\n\nUse the base resume to produce individual diff proposals instead of listing experiences again. "
                "Each proposal must change exactly one existing fact block: before must reproduce the input fact verbatim, "
                "and after must be a complete replacement for that same block. Omit proposals for facts that need no tailoring. "
                "Rewrite internship or project responsibilities only when the JD explicitly calls for it. "
                "Preserve the experience's work context while expressing relevant work more clearly. "
                "Keep education, identity details, companies, roles, dates and section order unchanged by default. "
                "Retain every original resume bullet not covered by a proposal. "
                "For data roles, foreground data analysis while retaining necessary product capabilities. "
                "For product roles, foreground product work and project delivery, using data skills as a supporting strength. "
                "Bind each proposal to one or more input fact_id values and cite specific JD evidence. "
                "Do not add numbers, tools, responsibilities or outcomes absent from the original facts. "
                "Do not turn participation into ownership or an internal prototype into a launched product."
            ),
            system_prompt=(
                "You are the FetchCV Resume Writer. Produce a complete resume with clear role positioning, "
                "not a collection of selected sentences. All results must first enter a draft; never directly overwrite or publish. "
                + OUTPUT_LANGUAGE
            ),
            output_model=AssetGeneration,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def audit(self, proposals: list[GeneratedProposal], *, session_id: str | None = None) -> tuple[QualityAudit, RuntimeResult]:
        issues: list[AuditIssue] = []
        for index, proposal in enumerate(proposals):
            risk, matches = role_strength_risk(proposal.before, proposal.after)
            if risk == "high":
                issues.append(AuditIssue(code="role_strength", message="检测到角色强度变化：" + "、".join(matches), severity="block", proposal_index=index))
            if not proposal.fact_ids:
                issues.append(AuditIssue(code="missing_fact_id", message="建议没有绑定事实", severity="block", proposal_index=index))
        mock = QualityAudit(passed=not issues, issues=issues, summary="通过" if not issues else "需要人工确认")
        return self.runtime.generate(
            agent_name="quality_auditor",
            prompt="Check proposals for factual provenance, role-strength changes and exaggeration risks.",
            system_prompt=(
                "You are the FetchCV Quality Auditor. Report risks without directly modifying materials. " + OUTPUT_LANGUAGE
            ),
            output_model=QualityAudit,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    def _conversation_request(self, job: Job, message: str, context: str, thinking_level: str) -> tuple[str, str]:
        return build_conversation_request(self.settings, job, message, context, thinking_level)

    def respond(self, job: Job, message: str, context: str, *, thinking_level: str = "balanced", session_id: str | None = None) -> tuple[ConversationReply, RuntimeResult]:
        prompt, system_prompt = self._conversation_request(job, message, context, thinking_level)
        mock = ConversationReply(
            message="我已记录这条调整意见。你可以继续讨论岗位定位，或回到经历策略生成一个保留旧版本的新修订。",
            intent="revise_resume" if any(word in message for word in ["简历", "突出", "弱化", "调整", "修改", "重写"]) else "discuss",
            suggested_actions=["查看简历预览", "重新生成修订版"],
        )
        return self.runtime.generate(
            agent_name="job_workspace_conversation",
            prompt=prompt,
            system_prompt=system_prompt,
            output_model=ConversationReply,
            mock_data=mock.model_dump(mode="json"),
            session_id=session_id,
        )

    async def stream_response(self, job: Job, message: str, context: str, *, thinking_level: str = "balanced", session_id: str | None = None) -> AsyncIterator[dict]:
        prompt, system_prompt = self._conversation_request(job, message, context, thinking_level)
        async for event in self.runtime.stream_text(
            agent_name="job_workspace_conversation",
            prompt=prompt,
            system_prompt=system_prompt,
            session_id=session_id,
        ):
            yield event
