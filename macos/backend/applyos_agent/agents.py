from __future__ import annotations

from collections import Counter
from collections.abc import AsyncIterator
import json
import re

from applyos_domain.models import Fact, Job
from applyos_harness.validation import role_strength_risk

from .config import AgentSettings
from .conversation_prompt import build_conversation_request
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
            prompt=f"分析以下岗位 JD，只依据原文，不根据公司名称推断：\n\n{job.jd_raw or ''}",
            system_prompt="你是 FetchCV JD Analyst。输出必须逐项保留 JD 原文证据，不预测录用概率，不虚构要求。",
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
                "请从下面的招聘网页可见文本中提取一个干净、可用于岗位项目的 JD。"
                "删除导航、登录提示、页脚、招聘网站宣传语和重复内容；只保留当前职位的职责、任职要求、加分项、工作地点和公司/岗位名称。"
                "不要根据常识补写，不确定的字段留空并写入 warnings。description 要按职责、要求、加分项组织成可读正文。\n\n"
                f"页面标题：{page_title}\n网页文本：\n{raw_text[:30000]}"
            ),
            system_prompt="你是 FetchCV 的招聘网页结构化 Agent。只依据网页正文，不把页面壳、导航或网站品牌宣传当成岗位要求。输出严格符合 JSON Schema。",
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
            prompt=f"根据 JD 与已确认事实制定简历策略。JD：\n{job.jd_raw or ''}\n事实：\n{fact_text}",
            system_prompt="你是 FetchCV Resume Strategy Agent。只能选择给定 fact_id，不得增加事实强度。你需要明确主定位、辅助能力、模块顺序和内容取舍。",
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
                f"岗位：{job.company} · {job.role}\nJD：\n{job.jd_raw or ''}\n\n候选事实：\n{fact_text}\n\n"
                "逐条判断事实对该岗位是否有实际支持。必须返回所有输入 fact_id，不得编造 ID；推荐应克制，并引用具体 JD 要求。"
            ),
            system_prompt="你是求职材料事实匹配 Agent。你只判断相关性，不修改事实、不夸大角色、不推测候选人没有提供的能力。",
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
                f"目标岗位：{job.company} · {job.role}\nJD：\n{job.jd_raw or ''}\n\n"
                + "基础简历（必须保留原有模块、顺序、时间、公司、岗位、教育与身份信息，只对有必要的岗位化表述提出 diff）：\n"
                + json.dumps(resume_context or {}, ensure_ascii=False)
                + "\n\n"
                + "候选事实（括号内为稳定事实 ID；同一 experience_id 属于同一段完整经历）：\n"
                + "\n".join(
                    f"[{fact.id}] experience_id={((fact.normalized_value or {}).get('experience_id') or fact.subject_id or 'unknown')} ({fact.category}) {fact.content}"
                    for fact in facts if fact.verified
                )
                + "\n\n请以基础简历为底稿生成逐条 Diff 建议，而不是重新罗列经历。每条建议必须只改一个已有事实块：before 必须是输入事实中的原文，after 是同一事实块的完整替代表述；如果该事实不需要岗位化，不要返回建议。只有当 JD 明确需要时才改写对应实习或项目中的职责表述；同一段经历可以保留原有工作背景，同时把其中与岗位相关的工作换一种更清楚的表达。教育背景、身份信息、公司、岗位、日期、模块顺序默认不变，原简历中未被建议覆盖的 bullet 也必须保留。数据岗位突出数据分析主线并保留必要产品能力；产品岗位突出产品与项目落地，并将数据能力作为辅助优势。每条必须绑定一个或多个输入 fact_id，并引用具体 JD 证据。不得增加原事实没有的数字、工具、职责或成果，不得把参与写成负责，不得把内部原型写成上线产品。"
            ),
            system_prompt="你是 FetchCV Resume Writer。你的任务是形成岗位定位清晰的完整简历，而不是罗列选中句子。所有结果先进入草稿，禁止直接覆盖和发布。",
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
            prompt="检查提案的事实来源、角色强度和夸大风险。",
            system_prompt="你是 FetchCV Quality Auditor。发现风险只报告，不直接修改材料。",
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
