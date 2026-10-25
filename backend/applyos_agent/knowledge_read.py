"""Bounded, revision-checked source readback shared by both Pi entry points."""
from hashlib import sha256

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from applyos_domain.models import InterviewSource
from applyos_harness.errors import HarnessError


class ReadKnowledgeSourceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=40, description="Source ID returned by a local knowledge search. Do not invent an ID or supply a URL.")
    offset: int = Field(default=0, ge=0, description="Character offset. Start at 0; use the previous page's next_offset for continuation.")
    limit: int = Field(default=4000, ge=1, le=12000, description="Maximum number of source-text characters to return in this page.")
    expected_hash: str | None = Field(default=None, pattern="^[a-f0-9]{64}$", description="Previous page's content_hash. Required when offset is nonzero; detects source revisions so pages from different versions are not combined.")


def read_source(session, payload: ReadKnowledgeSourceInput, *, candidate_id: str | None):
    stmt = select(InterviewSource).where(InterviewSource.id == payload.source_id)
    if candidate_id is not None:
        stmt = stmt.where(InterviewSource.candidate_id == candidate_id)
    source = session.scalar(stmt)
    if source is None:
        raise HarnessError("source_not_found", "来源不存在或不在当前资料范围内")
    body = source.raw_text
    revision = sha256(body.encode("utf-8")).hexdigest()
    if payload.expected_hash and revision != payload.expected_hash:
        raise HarnessError("source_revision_changed", "原文已变化，请重新检索并读取")
    if payload.offset and not payload.expected_hash:
        raise HarnessError("source_revision_required", "分页续读必须携带上一页的 content_hash")
    end = min(len(body), payload.offset + payload.limit)
    return {"source_id": source.id, "url": source.source_url, "title": source.title,
            "content_hash": revision, "offset": payload.offset, "total_chars": len(body),
            "text": body[payload.offset:end], "next_offset": end if end < len(body) else None,
            "status": source.status, "evidence_notice": "搜索命中不代表事实已核验；引用须核对原文。"}
