"""Application collateral tools shared by conversation and task Agent loops."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from applyos_domain.models import Job, MaterialAsset, ResumeVersion
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage
from applyos_harness.validation import Claim, FactValidator

from .ats import AtsReadinessEvaluator


class ApplicationModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EmptyApplicationInput(ApplicationModel):
    pass


class CoverLetterParagraphInput(ApplicationModel):
    text: str = Field(min_length=20, max_length=2200, description="一段可直接审阅的求职信正文")
    fact_ids: list[str] = Field(min_length=1, max_length=16, description="支撑本段陈述的已确认 fact_id")
    jd_evidence: list[str] = Field(default_factory=list, max_length=5, description="JD 原文中的连续引文，不得改写")


class CoverLetterDraftInput(ApplicationModel):
    title: str = Field(default="求职信", min_length=1, max_length=160)
    salutation: str = Field(default="尊敬的招聘团队：", min_length=1, max_length=160)
    paragraphs: list[CoverLetterParagraphInput] = Field(min_length=2, max_length=6)
    closing: str = Field(default="感谢您的阅读，期待进一步交流。", min_length=1, max_length=400)
    signature: str = Field(default="", max_length=160)
    language: Literal["zh-CN", "en"] = "zh-CN"


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
            asset_type="resume",
            claims=[Claim(text=item.text, fact_ids=item.fact_ids) for item in payload.paragraphs],
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

    gateway.register(ToolSpec(
        name="read_ats_readiness",
        description="读取当前岗位简历的可解释 ATS 文本覆盖度、硬要求缺口、关键词缺口和文档检查。该结果不是第三方 ATS 通过概率。",
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
        description="基于当前 JD、岗位简历和已确认 fact_id 保存求职信草稿。每段必须绑定真实事实；数字、日期和 JD 引文会被确定性校验。",
        input_model=CoverLetterDraftInput,
        output_model=ApplicationToolResult,
        permission=ToolPermission.DRAFT_WRITE,
        allowed_stages=allowed_stages,
        handler=save_cover_letter_draft,
        read_only=False,
        side_effect=True,
    ))
    return gateway
