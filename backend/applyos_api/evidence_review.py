"""Explicit local-user review; not registered as an agent tool."""
from hashlib import sha256
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import BaseModel, ConfigDict, Field

from applyos_agent.interview_evidence import refresh_briefs
from applyos_domain.base import utc_now
from applyos_harness.errors import HarnessError


class EvidenceReviewInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    content_hash: str = Field(pattern=r'^[a-f0-9]{64}$')
    source_kind: Literal['first_person', 'compilation', 'repost', 'unknown']
    origin_url: str = Field(default='', max_length=4096)
    quote: str = Field(default='', max_length=2000)
    confirmed: Literal[True]


def review_source(session, source, payload):
    body = source.raw_text or ''
    digest = sha256(body.encode()).hexdigest()
    if payload.content_hash != digest:
        raise HarnessError('evidence_review_stale', '正文已变化，请重新打开原文核验')
    quote = payload.quote.strip()
    if payload.source_kind != 'unknown' and (len(quote) < 2 or quote not in body):
        raise HarnessError('evidence_review_quote_invalid', '请粘贴当前正文中的逐字依据')
    origin = payload.origin_url.strip()
    if payload.source_kind == 'first_person' and not origin:
        raise HarnessError('evidence_review_origin_required', '请填写已核对的原始来源链接')
    if origin:
        try:
            parsed = urlsplit(origin)
            if parsed.scheme not in {'http', 'https'} or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError()
            origin = urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/'), parsed.query, ''))
        except ValueError:
            raise HarnessError('evidence_review_origin_invalid', '原始来源必须是有效的 HTTP 或 HTTPS 链接')
    source.metadata_json = {**(source.metadata_json or {}), 'evidence_review': {
        'reviewer':'user', 'content_hash':digest, 'source_kind':payload.source_kind,
        'origin_url':origin, 'origin_cluster':origin, 'quote':quote,
        'reviewed_at':utc_now().isoformat()}}
    session.flush()
    refresh_briefs(session, source.candidate_id)
