"""Application collateral tools shared by conversation and task Agent loops."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session
from sqlalchemy import select

from applyos_domain.models import InterviewSource, Job, MaterialAsset, ResumeVersion
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from applyos_harness.validation import Claim, FactValidator, normalized_excerpt

from .ats import AtsReadinessEvaluator


class ApplicationModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyApplicationInput(ApplicationModel):
    pass


class CoverLetterParagraphInput(ApplicationModel):
    text: str = Field(min_length=20, max_length=2200, description="One complete cover letter paragraph ready for user review.")
    fact_ids: list[str] = Field(min_length=1, max_length=16, description="Confirmed fact_id values supporting the claims in this paragraph.")
    jd_evidence: list[str] = Field(default_factory=list, max_length=5, description="Contiguous verbatim quotes from the original JD; do not paraphrase or translate them.")


class CoverLetterDraftInput(ApplicationModel):
    title: str = Field(default="求职信", min_length=1, max_length=160)
    salutation: str = Field(default="尊敬的招聘团队：", min_length=1, max_length=160)
    paragraphs: list[CoverLetterParagraphInput] = Field(min_length=2, max_length=6)
    closing: str = Field(default="感谢您的阅读，期待进一步交流。", min_length=1, max_length=400)
    signature: str = Field(default="", max_length=160)
    language: Literal["zh-CN", "en"] = "zh-CN"


class InterviewAnswerReferenceInput(ApplicationModel):
    evidence_type: Literal["job_description", "interview_source"]
    source_id: str | None = None
    source_quote: str = Field(min_length=1, max_length=4000)


class InterviewAnswerInput(ApplicationModel):
    question: str = Field(min_length=1, max_length=1200)
    answer: str = Field(min_length=1, max_length=12000, description="Personal answer only. It must consist of personal_claims.text in their original order; keep job references and practice suggestions in their separate slots.")
    personal_claims: list[Claim] = Field(default_factory=list, max_length=32)
    job_references: list[InterviewAnswerReferenceInput] = Field(default_factory=list, max_length=16)
    practice_advice: list[str] = Field(default_factory=list, max_length=16, description="Imperative practice suggestions only, never first-person experiences. These are explicitly unverified practice advice, not facts about the candidate.")


class ApplicationToolResult(ApplicationModel):
    summary: str
    artifacts: list[str] = Field(default_factory=list)
    data: dict[str, Any] = Field(default_factory=dict)


def _normalized(value: str) -> str:
    return re.sub(r"\s+", "", value or "").lower()


def _job(context: ToolContext) -> Job:
    if not context.run.job_id:
        raise HarnessError("job_context_not_found", "当前 Agent 运行没有岗位上下文")
    job = context.session.get(Job, context.run.job_id)
    if job is None:
        raise HarnessError("job_not_found", "岗位不存在")
    if job.candidate_id != context.run.candidate_id:
        raise HarnessError("job_candidate_mismatch", "岗位不属于当前候选人")
    return job


def _latest_resume(context: ToolContext, job: Job) -> ResumeVersion | None:
    return context.session.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.candidate_id == context.run.candidate_id, ResumeVersion.job_id == job.id)
        .order_by(ResumeVersion.updated_at.desc())
    ) or context.session.scalar(
        select(ResumeVersion)
        .where(ResumeVersion.candidate_id == context.run.candidate_id, ResumeVersion.job_id.is_(None))
        .order_by(ResumeVersion.updated_at.desc())
    )


def refresh_interview_answer_evidence(session: Session, material: MaterialAsset) -> MaterialAsset:
    """Compute present-tense readiness on save and on every material read.

    Stored/caller-provided ready flags and verification labels are never used
    as evidence. Invalid legacy metadata remains a readable needs-evidence draft.
    """
    if material.kind != "interview_answer":
        return material
    metadata = dict(material.metadata_json) if isinstance(material.metadata_json, dict) else {}
    issues: list[dict[str, Any]] = []
    try:
        raw_references = metadata.get("job_references", [])
        references_input = [
            {key: value for key, value in ref.items() if key != "support_status"} if isinstance(ref, dict) else ref
            for ref in raw_references
        ] if isinstance(raw_references, list) else raw_references
        payload = InterviewAnswerInput.model_validate({
            "question": metadata.get("question", ""), "answer": metadata.get("answer", ""),
            "personal_claims": metadata.get("personal_claims", []),
            "job_references": references_input, "practice_advice": metadata.get("practice_advice", []),
        })
    except ValidationError:
        material.status = "needs_evidence"
        metadata.update({
            "claim_contract": {"claims": [], "needs_evidence": True, "verification_status": "needs_evidence",
                               "issues": [{"code": "interview_answer_contract_invalid", "message": "面试答案缺少有效结构化证据合同，请补证后重新保存"}]},
            "practice_advice_status": "unverified_practice_only",
            "content": "未核验面试答案草稿：结构化证据合同缺失或无效，请补证后重新保存。",
        })
        material.metadata_json = metadata
        return material
    job_id = metadata.get("job_id")
    job = session.get(Job, job_id) if isinstance(job_id, str) else None
    if job is None or job.candidate_id != material.candidate_id:
        issues.append({"code": "interview_answer_job_mismatch", "message": "答案未绑定当前候选人的有效岗位"})
    result = FactValidator(session).validate(candidate_id=material.candidate_id, asset_type="interview_answer", claims=payload.personal_claims)
    issues.extend(item.model_dump(mode="json") for item in result.issues)
    claimed_answer = "\n".join(item.text for item in payload.personal_claims)
    if not payload.personal_claims or normalized_excerpt(payload.answer) != normalized_excerpt(claimed_answer):
        issues.append({"code": "interview_answer_not_covered", "message": "个人答案正文必须由逐条已核验陈述完整组成；补充内容需单独提供个人事实合同", "details": {"follow_up": "请为答案每一段提供当前版本本人事实及完整支持原句，或删除无依据内容"}})
    references = []
    for index, ref in enumerate(payload.job_references):
        reference = ref.model_dump(mode="json")
        source = session.get(InterviewSource, ref.source_id) if ref.evidence_type == "interview_source" and ref.source_id else None
        owned_source = bool(job) and ((ref.evidence_type == "job_description" and ref.source_id in (None, job.id)) or (
            source is not None and source.candidate_id == material.candidate_id and source.job_id == job.id
            and source.status not in {"deleted", "stale", "invalid", "failed"}
        ))
        source_text = (job.jd_raw or "") if ref.evidence_type == "job_description" and job else (source.raw_text or "") if source else ""
        supported = owned_source and bool(ref.source_quote.strip()) and ref.source_quote in source_text
        reference["support_status"] = "reference_only" if supported else "needs_evidence"
        if not supported:
            issues.append({"code": "interview_reference_not_supported", "message": "岗位参考无法在当前岗位的 JD 或面经原文中定位", "details": {"reference_index": index}})
        references.append(reference)
    advice_prefix = re.compile(r"^(?:(?:建议|请)(?:练习|准备|复盘|思考|梳理|核对|比较|解释|澄清)|练习|考虑|尝试|围绕|practice\b|consider\b|try\b|prepare\b)", re.IGNORECASE)
    personal_voice = re.compile(r"(?:我|本人|咱|个人经历|个人答案|曾|已完成|已上线|声称|宣称|编造|伪造|假装|说自己)|\b(?:I|my|mine|we|our|claim|you\s+(?:have|had|led|built|achieved))\b", re.IGNORECASE)
    for index, advice in enumerate(payload.practice_advice):
        if not advice_prefix.search(advice.strip()) or personal_voice.search(advice):
            issues.append({"code": "practice_advice_not_separated", "message": "练习建议必须使用建议或提问口吻，不能包含未经核验的本人经历", "details": {"advice_index": index, "follow_up": "将个人经历移入 personal_claims 并补充证据；练习槽只保留明确的练习指令"}})
    material.status = "needs_evidence" if issues else "ready"
    claims = [item.model_dump(mode="json") for item in payload.personal_claims]
    content = f"# {payload.question.strip()}\n\n个人答案（{'待补证' if issues else '已核验'}）\n\n{payload.answer.strip()}"
    if references:
        content += "\n\n岗位参考（不作为个人经历依据）\n\n" + "\n\n".join(item["source_quote"] for item in references)
    if payload.practice_advice:
        content += "\n\n练习建议（未核验建议）\n\n" + "\n".join(payload.practice_advice)
    metadata.update({
        "question": payload.question, "answer": payload.answer, "personal_claims": claims, "job_references": references,
        "practice_advice": payload.practice_advice, "practice_advice_status": "unverified_practice_only",
        "claim_contract": {"claims": claims, "issues": issues, "needs_evidence": bool(issues), "verification_status": "needs_evidence" if issues else "verified"},
        "source_fact_ids": list(dict.fromkeys(ref.fact_id for claim in payload.personal_claims for ref in claim.evidence)),
        "content": content,
    })
    # Avoid changing timestamps or creating write churn on ordinary reads.
    if material.metadata_json != metadata:
        material.metadata_json = metadata
    return material


def register_application_tools(gateway: ToolGateway) -> ToolGateway:
    allowed_stages = set(PipelineStage) - {PipelineStage.CANCELLED}

    def read_ats_readiness(context: ToolContext, _: EmptyApplicationInput) -> ApplicationToolResult:
        job = _job(context)
        resume = _latest_resume(context, job)
        result = AtsReadinessEvaluator(context.session).evaluate(job=job, run=context.run, resume=resume)
        return ApplicationToolResult(
            summary=result["summary"],
            artifacts=[f"resume:{resume.id}"] if resume else [],
            data=result,
        )

    def save_cover_letter_draft(context: ToolContext, payload: CoverLetterDraftInput) -> ApplicationToolResult:
        job = _job(context)
        resume = _latest_resume(context, job)
        if resume is None:
            raise HarnessError("resume_required", "请先导入或生成一份简历，再创建求职信")
        source_jd = _normalized(job.jd_raw or "")
        invalid_quotes = [
            quote
            for paragraph in payload.paragraphs
            for quote in paragraph.jd_evidence
            if not _normalized(quote) or _normalized(quote) not in source_jd
        ]
        if invalid_quotes:
            raise HarnessError(
                "jd_evidence_not_found",
                "求职信引用了无法在 JD 原文中定位的要求",
                details={"invalid_quotes": invalid_quotes[:8]},
                retryable=True,
            )

        validation = FactValidator(context.session).validate(
            candidate_id=context.run.candidate_id,
            asset_type="cover_letter",
            claims=[Claim(text=item.text, fact_ids=item.fact_ids) for item in payload.paragraphs],
            require_contract=False,
        )
        if not validation.passed:
            raise HarnessError(
                "cover_letter_fact_validation_failed",
                "求职信包含未经确认或事实不支持的陈述",
                details={"issues": [item.model_dump(mode="json") for item in validation.issues]},
                retryable=True,
            )

        paragraph_data = [item.model_dump(mode="json") for item in payload.paragraphs]
        content = "\n\n".join([
            payload.title.strip(),
            payload.salutation.strip(),
            *[item.text.strip() for item in payload.paragraphs],
            payload.closing.strip(),
            payload.signature.strip(),
        ]).strip()
        source_fact_ids = list(dict.fromkeys(fact_id for item in payload.paragraphs for fact_id in item.fact_ids))
        jd_evidence = list(dict.fromkeys(quote for item in payload.paragraphs for quote in item.jd_evidence))
        material = MaterialAsset(
            candidate_id=context.run.candidate_id,
            kind="cover_letter",
            name=f"{job.company}-{job.role}-求职信",
            mime_type="text/markdown",
            status="draft",
            metadata_json={
                "job_id": job.id,
                "run_id": context.run.id,
                "resume_version_id": resume.id,
                "title": payload.title,
                "salutation": payload.salutation,
                "paragraphs": paragraph_data,
                "closing": payload.closing,
                "signature": payload.signature,
                "language": payload.language,
                "content": content,
                "source_fact_ids": source_fact_ids,
                "jd_evidence": jd_evidence,
                "generator": "pi_agent_core",
            },
        )
        context.session.add(material)
        context.session.flush()
        return ApplicationToolResult(
            summary="已生成一份绑定当前 JD 与已确认事实的求职信草稿，请用户审阅后再使用。",
            artifacts=[f"cover_letter:{material.id}", f"resume:{resume.id}"],
            data={
                "cover_letter_id": material.id,
                "name": material.name,
                "content": content,
                "source_fact_ids": source_fact_ids,
                "jd_evidence": jd_evidence,
                "status": material.status,
            },
        )

    def save_interview_answer(context: ToolContext, payload: InterviewAnswerInput) -> ApplicationToolResult:
        job = _job(context)
        material = MaterialAsset(
            candidate_id=context.run.candidate_id,
            kind="interview_answer",
            name=f"{job.company}-{job.role}-面试答案",
            mime_type="text/markdown",
            status="needs_evidence",
            metadata_json={
                "job_id": job.id, "run_id": context.run.id, "question": payload.question,
                "answer": payload.answer, "personal_claims": [item.model_dump(mode="json") for item in payload.personal_claims],
                "job_references": [item.model_dump(mode="json") for item in payload.job_references],
                "practice_advice": payload.practice_advice, "practice_advice_status": "unverified_practice_only",
                "generator": "pi_agent_core",
            },
        )
        refresh_interview_answer_evidence(context.session, material)
        context.session.add(material)
        context.session.flush()
        metadata = material.metadata_json
        return ApplicationToolResult(
            summary="个人答案已保存并通过逐条事实核验；岗位参考与练习建议已分开标明。" if material.status == "ready" else "面试答案草稿已保存为待补证；请补齐证据后再作为本人经历使用。",
            artifacts=[f"interview_answer:{material.id}"],
            data={"interview_answer_id": material.id, "name": material.name, "status": material.status,
                  **{key: metadata[key] for key in ("content", "question", "answer", "personal_claims", "job_references", "practice_advice", "claim_contract", "source_fact_ids")}},
        )

    gateway.register(ToolSpec(
        name="read_ats_readiness",
        description="Read explainable ATS text coverage, missing hard requirements, keyword gaps, and document checks for the current job resume. This is not a third-party ATS pass probability.",
        input_model=EmptyApplicationInput,
        output_model=ApplicationToolResult,
        permission=ToolPermission.READ,
        allowed_stages=allowed_stages,
        handler=read_ats_readiness,
        read_only=True,
        side_effect=False,
    ))
    gateway.register(ToolSpec(
        name="save_cover_letter_draft",
        description="Save a cover letter draft grounded in the current JD, job resume, and confirmed fact_id values. Every paragraph must cite supporting facts. Numbers, dates, and verbatim JD quotes are validated deterministically; do not translate source quotes.",
        input_model=CoverLetterDraftInput,
        output_model=ApplicationToolResult,
        permission=ToolPermission.DRAFT_WRITE,
        allowed_stages=allowed_stages,
        handler=save_cover_letter_draft,
        read_only=False,
        side_effect=True,
    ))
    gateway.register(ToolSpec(
        name="save_interview_answer",
        description="Save a personalized interview answer with an auditable claim contract. Every personal answer segment must cite the current candidate's verified/current-version candidate_fact with a full verbatim source_quote plus action/object/metrics/status. Keep JD/interview references and unverified practice suggestions in separate slots. Missing, stale or unsupported claims remain needs_evidence; the caller cannot mark them ready.",
        input_model=InterviewAnswerInput,
        output_model=ApplicationToolResult,
        permission=ToolPermission.DRAFT_WRITE,
        allowed_stages=allowed_stages,
        handler=save_interview_answer,
        read_only=False,
        side_effect=True,
    ))
    return gateway
