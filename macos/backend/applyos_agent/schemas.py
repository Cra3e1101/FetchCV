from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class EvidenceItem(BaseModel):
    text: str = ""
    source_quote: str = ""


class JDAnalysis(BaseModel):
    responsibilities: list[EvidenceItem] = Field(default_factory=list)
    hard_requirements: list[EvidenceItem] = Field(default_factory=list)
    preferred_requirements: list[EvidenceItem] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    competencies: list[str] = Field(default_factory=list)
    uncertain_items: list[str] = Field(default_factory=list)


class FactMatch(BaseModel):
    fact_id: str = ""
    jd_requirement: str = ""
    relevance: str = "low"
    rationale: str = ""


class RankedFact(BaseModel):
    fact_id: str = ""
    recommended: bool = False
    relevance: str = "low"
    rationale: str = ""
    matched_jd_requirements: list[str] = Field(default_factory=list)


class FactRanking(BaseModel):
    items: list[RankedFact] = Field(default_factory=list)
    summary: str = ""


class ResumeStrategy(BaseModel):
    positioning: str = "围绕岗位要求组织最相关的真实经历"
    selected_fact_ids: list[str] = Field(default_factory=list)
    matches: list[FactMatch] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class GeneratedProposal(BaseModel):
    section: str = "experience"
    before: str = ""
    after: str = ""
    reason: str = ""
    jd_evidence: list[str] = Field(default_factory=list)
    fact_ids: list[str] = Field(default_factory=list)
    experience_id: str | None = None
    risk_level: str = "low"


class AssetGeneration(BaseModel):
    proposals: list[GeneratedProposal] = Field(default_factory=list)
    summary: str = ""


class AuditIssue(BaseModel):
    code: str
    message: str
    severity: str
    proposal_index: int | None = None


class QualityAudit(BaseModel):
    passed: bool
    issues: list[AuditIssue] = Field(default_factory=list)
    summary: str


class RuntimeResult(BaseModel):
    data: dict[str, Any]
    session_id: str | None = None
    text: str = ""
    usage: dict[str, Any] = Field(default_factory=dict)
    hook_events: list[dict[str, Any]] = Field(default_factory=list)


class RuntimeToolDefinition(BaseModel):
    name: str
    description: str
    input_schema: dict[str, Any] = Field(default_factory=dict)


class RuntimeToolCall(BaseModel):
    id: str = ""
    name: str
    arguments: dict[str, Any] = Field(default_factory=dict)


class AgentTurnDecision(BaseModel):
    message: str = ""
    tool_calls: list[RuntimeToolCall] = Field(default_factory=list)


class RuntimeTurnResult(BaseModel):
    text: str = ""
    tool_calls: list[RuntimeToolCall] = Field(default_factory=list)
    finish_reason: str = "stop"
    session_id: str | None = None
    usage: dict[str, Any] = Field(default_factory=dict)


class ConversationReply(BaseModel):
    message: str = "我已经记录了你的要求。"
    intent: str = "discuss"
    suggested_actions: list[str] = Field(default_factory=list)


class JobPostingExtraction(BaseModel):
    company: str = ""
    title: str = ""
    location: str = ""
    description: str = ""
    responsibilities: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    preferred: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0, le=1)
    warnings: list[str] = Field(default_factory=list)
