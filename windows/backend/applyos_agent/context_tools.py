from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from applyos_domain.models import Job, JobProfile
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolContext, ToolGateway, ToolPermission, ToolSpec
from applyos_harness.state_machine import PipelineStage

from .context import ContextManager
from .tools import PipelineToolResult


ContextSection = Literal["job", "resume", "facts", "materials", "decisions"]


class ReadWorkspaceContextInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sections: list[ContextSection] = Field(default_factory=lambda: ["job"], min_length=1, max_length=4)


def register_context_tools(gateway: ToolGateway) -> ToolGateway:
    stages = set(PipelineStage)

    def read_context(context: ToolContext, payload: ReadWorkspaceContextInput) -> PipelineToolResult:
        job = context.session.get(Job, context.run.job_id) if context.run.job_id else None
        if job is None:
            raise HarnessError("job_context_not_found", "当前 Agent 没有关联岗位工作区", run_id=context.run.id)
        pinned = ContextManager(context.session).pinned(job)
        requested = list(dict.fromkeys(payload.sections))
        data = {}
        if "job" in requested:
            profile = context.session.scalar(select(JobProfile).where(JobProfile.job_id == job.id))
            data["job"] = pinned["job"]
            data["job_profile"] = None if profile is None else {
                "responsibilities": profile.responsibilities,
                "hard_requirements": profile.hard_requirements,
                "preferred_requirements": profile.preferred_requirements,
                "keywords": profile.keywords,
                "competencies": profile.competencies,
                "uncertain_items": profile.uncertain_items,
            }
        if "resume" in requested:
            data["base_resume"] = pinned["base_resume"]
            data["job_resume"] = pinned["job_resume"]
        if "facts" in requested:
            data["verified_facts"] = pinned["verified_facts"]
        if "materials" in requested:
            data["materials"] = pinned["materials"]
        if "decisions" in requested:
            data["explicit_memory"] = pinned["explicit_memory"]
        return PipelineToolResult(
            stage=context.run.current_stage or PipelineStage.CREATED.value,
            status=context.run.status.value,
            summary=f"已按模型判断读取当前工作区上下文：{', '.join(requested)}。",
            data=data,
            artifacts=[f"job:{job.id}"],
        )

    gateway.register(ToolSpec(
        name="read_job_workspace_context",
        description=(
            "按需读取当前岗位工作区的真实上下文。仅当用户语义涉及当前/这个岗位、JD、简历、候选人经历、事实或资料时调用；"
            "通用知识、闲聊、API/UI 问题不要调用。sections 可选择 job、resume、facts、materials、decisions；"
            "用户要求沿用、撤销或核对已确认选择时读取 decisions。"
        ),
        input_model=ReadWorkspaceContextInput,
        output_model=PipelineToolResult,
        permission=ToolPermission.READ,
        allowed_stages=stages,
        handler=read_context,
    ))
    return gateway
