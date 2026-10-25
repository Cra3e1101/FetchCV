"""Evidence accounting is separate from relevance ranking.

Only an explicit user review bound to the current body can establish origin.
Text similarity is never evidence that two accounts describe one interview.
"""
from hashlib import sha256
import re
from urllib.parse import urlsplit, urlunsplit

MINIMUM_SOURCES = 4
EVIDENCE_CONTRACT_VERSION = "evidence-v2"
PRIMARY_PLATFORM = "xiaohongshu"
EVIDENCE_GUIDANCE = (
    "Report usable document groups separately from user-confirmed independent origins. "
    "Reposts and compilations do not add independent evidence; classification and similarity hints never certify origins. "
    "Explicitly disclose pending origin review and limited JD coverage."
)
SOURCE_KINDS = {"first_person", "compilation", "repost", "unknown"}


def _normalized_text(value):
    return re.sub(r"\s+", " ", str(value or "")).strip()


def current_source_questions(source):
    """Keep the recovery contract: only current, nonempty quoted questions."""
    body = _normalized_text(getattr(source, "raw_text", ""))
    return [item for item in (getattr(source, "extracted_questions", None) or [])
            if isinstance(item, dict) and _normalized_text(item.get("question"))
            and len(_normalized_text(item.get("evidence_quote"))) >= 2
            and _normalized_text(item.get("evidence_quote")) in body]


def source_ready(source):
    digest = sha256((getattr(source, "raw_text", "") or "").encode("utf-8")).hexdigest()
    return (source.status == "analyzed" and bool(current_source_questions(source))
            and (getattr(source, "metadata_json", None) or {}).get("analysis_content_hash", digest) == digest)


def analysis_reusable(source):
    meta = getattr(source, "metadata_json", None) or {}
    digest = sha256((getattr(source, "raw_text", "") or "").encode("utf-8")).hexdigest()
    if source.status != "analyzed" or meta.get("analysis_content_hash", digest) != digest:
        return False
    if meta.get("analysis_status") == "no_questions":
        return True
    questions = current_source_questions(source)
    return (bool(questions) and len(questions) == len(source.extracted_questions or [])
            and meta.get("analysis_status") != "partial"
            and not meta.get("rejected_unverified_questions"))


def canonical_source_url(value):
    """Drop fragments only; generic query parameters can identify documents."""
    try:
        parsed = urlsplit(str(value or ""))
        if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return ""
        return urlunsplit((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path.rstrip('/'), parsed.query, ""))
    except ValueError:
        return ""


def valid_evidence_review(source):
    """Return a current, explicitly human-reviewed record, otherwise None.

    This is data validation, not authorization: only the user review API may
    write evidence_review. A stale persisted hash must never preserve a review.
    """
    meta = getattr(source, "metadata_json", None) or {}
    review = meta.get("evidence_review")
    body = getattr(source, "raw_text", "") or ""
    if not isinstance(review, dict) or not body:
        return None
    quote = review.get("quote")
    if (review.get("reviewer") != "user" or review.get("source_kind") not in SOURCE_KINDS
            or review.get("content_hash") != sha256(body.encode("utf-8")).hexdigest()
            or not isinstance(quote, str) or not quote.strip() or quote not in body):
        return None
    return review


def evidence_summary(sources):
    verified = [s for s in sources if s.status == "analyzed" and s.extracted_questions]
    groups = []
    excluded = []
    unknown = []
    stale_reviews = []
    for source in verified:
        meta = getattr(source, "metadata_json", None) or {}
        review = valid_evidence_review(source)
        ident = getattr(source, "id", None)
        title = getattr(source, "title", "") or ""
        kind = review["source_kind"] if review else meta.get("source_kind", "unknown")
        if meta.get("evidence_review") and not review:
            stale_reviews.append(ident)
        if kind in {"compilation", "repost"} or (not review and re.search("面经合集|面经汇总|面经汇编|面经整理", title)):
            excluded.append(ident)
            continue
        keys = set()
        body = re.sub(r"\s+", " ", getattr(source, "raw_text", "") or "").strip()
        if body:
            keys.add("body:" + sha256(body.encode("utf-8")).hexdigest())
        # Do not trust a stale content_hash to merge different current bodies.
        url = canonical_source_url(getattr(source, "source_url", ""))
        if url:
            keys.add("url:" + url)
        origin = ""
        if review:
            cluster = review.get("origin_cluster")
            if isinstance(cluster, str) and cluster.strip():
                origin = "cluster:" + cluster.strip()
                keys.add("origin:" + origin)
            origin_url = canonical_source_url(review.get("origin_url"))
            if origin_url:
                keys.add("url:" + origin_url)
                origin = origin or "url:" + origin_url
        confirmed = bool(review and kind == "first_person" and origin)
        if not confirmed:
            unknown.append(ident)
        if not keys:
            excluded.append(ident)
            continue
        overlaps = [g for g in groups if g['keys'] & keys]
        merged = dict(keys=keys, ids=[ident], confirmed=confirmed)
        for group in overlaps:
            merged['keys'].update(group['keys'])
            merged['ids'].extend(group['ids'])
            merged['confirmed'] |= group['confirmed']
            groups.remove(group)
        groups.append(merged)
    return dict(verified_record_count=len(verified), source_group_count=len(groups),
        confirmed_independent_count=sum(g['confirmed'] for g in groups),
        groups=[list(dict.fromkeys(g['ids'])) for g in groups], excluded_source_ids=excluded,
        origin_unconfirmed_source_ids=unknown, invalidated_review_source_ids=stale_reviews,
        coverage_verified=False)


def evidence_status(sources):
    # There is no JD-coverage verification contract yet. Even four confirmed
    # origins cannot establish coverage, so never emit overall "sufficient".
    return "limited"


def _merge_identity_group(groups, keys, ident):
    """Exact identities may join; similarity hints never enter these keys."""
    overlaps = [group for group in groups if group["keys"] & keys]
    merged = {"keys": set(keys), "ids": [ident]}
    for group in overlaps:
        merged["keys"].update(group["keys"])
        merged["ids"].extend(group["ids"])
        groups.remove(group)
    groups.append(merged)


def evidence_receipt(sources, *, discovery_status="not_requested"):
    """Versioned document readiness and human-origin accounting.

    Legacy summary fields retain their historical algorithm. V2 documents use
    only current exact body/URL identity. Human origins use only valid reviews;
    an unreviewed duplicate never borrows another document's certification.
    """
    sources = list(sources)
    legacy = evidence_summary(sources)
    documents, origins, usable, excluded, pending = [], [], [], [], []
    reasons, seen = {}, set()
    for source in sources:
        ident = getattr(source, "id", None)
        if ident is None or ident in seen:
            continue
        seen.add(ident)
        meta = getattr(source, "metadata_json", None) or {}
        review = valid_evidence_review(source)
        kind = review["source_kind"] if review else meta.get("source_kind", "unknown")
        if not source_ready(source):
            excluded.append(ident)
            reasons[ident] = "current_quoted_analysis_required"
            continue
        if kind in {"compilation", "repost"} or (not review and re.search(
                "面经合集|面经汇总|面经汇编|面经整理", getattr(source, "title", "") or "")):
            excluded.append(ident)
            reasons[ident] = "compilation_or_repost"
            continue
        keys = set()
        body = _normalized_text(getattr(source, "raw_text", ""))
        if body:
            keys.add("body:" + sha256(body.encode("utf-8")).hexdigest())
        url = canonical_source_url(getattr(source, "source_url", ""))
        if url:
            keys.add("url:" + url)
        if not keys:
            excluded.append(ident)
            reasons[ident] = "document_identity_unavailable"
            continue
        usable.append(ident)
        _merge_identity_group(documents, keys, ident)
        origin_keys = set()
        if review and kind == "first_person":
            cluster = review.get("origin_cluster")
            if isinstance(cluster, str) and cluster.strip():
                origin_keys.add("cluster:" + cluster.strip())
            origin_url = canonical_source_url(review.get("origin_url"))
            if origin_url:
                origin_keys.add("url:" + origin_url)
        if origin_keys:
            _merge_identity_group(origins, origin_keys, ident)
        else:
            pending.append(ident)
    positions = {ident: index for index, ident in enumerate(usable)}
    document_ids = [sorted(set(group["ids"]), key=positions.get) for group in documents]
    document_ids.sort(key=lambda ids: positions[ids[0]])
    origin_ids = [sorted(set(group["ids"]), key=positions.get) for group in origins]
    origin_ids.sort(key=lambda ids: positions[ids[0]])
    pending_set = set(pending)
    ready = len(document_ids) >= MINIMUM_SOURCES
    legacy_ready = legacy["source_group_count"] >= MINIMUM_SOURCES
    actions = ["build_limited_brief"] if ready else []
    if pending:
        actions.append("review_origin_candidates")
    if discovery_status not in {"exhausted", "access_protected", "no_new_evidence"} and (not ready or pending):
        actions.append("discover_new_sources")
    return {**legacy, "evidence_contract_version": EVIDENCE_CONTRACT_VERSION,
            "evidence_status": "limited", "coverage_verified": False,
            "brief_readiness": "limited_brief_ready" if ready else "more_documents_needed",
            "limited_brief_ready": ready, "ready_for_brief": ready,
            "legacy_ready_for_brief": legacy_ready,
            "readiness_changed_from_legacy": ready != legacy_ready,
            "usable_document_group_count": len(document_ids),
            "confirmed_origin_count": len(origin_ids),
            "unresolved_origin_count": sum(bool(set(ids) & pending_set) for ids in document_ids),
            "minimum_documents_for_limited_brief": MINIMUM_SOURCES,
            "usable_document_ids": usable, "excluded_document_ids": excluded,
            "excluded_document_reasons": reasons,
            "representative_ids": [ids[0] for ids in document_ids],
            "origin_review_pending_ids": pending, "document_groups": document_ids,
            "confirmed_origin_groups": origin_ids, "next_actions": actions,
            "discovery_status": discovery_status,
            "deprecated_fields": {"minimum_sufficient_sources": "minimum_documents_for_limited_brief"}}


def question_evidence_summary(sources, question):
    """Count only citations for this extracted question in the current body.

    Whitespace/case normalization is permitted; semantic paraphrases must be
    explicitly analyzed first. A source containing a different verified question
    does not substantiate this one, and stored evidence_valid is not trusted.
    """
    def normalized(value):
        return re.sub(r"\s+", " ", str(value or "")).strip()

    target = normalized(question).casefold()
    supporting = []
    seen = set()
    for source in sources:
        ident = getattr(source, 'id', None)
        if not target or source.status != 'analyzed' or ident in seen:
            continue
        body = normalized(getattr(source, 'raw_text', ''))
        for item in source.extracted_questions or []:
            if not isinstance(item, dict):
                continue
            quote = normalized(item.get('evidence_quote'))
            if (normalized(item.get('question')).casefold() == target
                    and len(quote) >= 2 and quote in body):
                supporting.append(source)
                seen.add(ident)
                break
    summary = evidence_summary(supporting)
    observed = summary['source_group_count']
    confirmed = summary['confirmed_independent_count']
    status = ('unsupported' if not supporting else 'not_independent' if not observed else
              'unverified' if not confirmed else 'partial' if confirmed < observed else 'confirmed')
    return dict(observed_source_group_count=observed, confirmed_independent_count=confirmed,
                supporting_source_ids=[s.id for s in supporting], independence_status=status)


def ready_for_brief(sources):
    # May synthesize an explicitly limited brief; this is NOT evidence sufficiency.
    return evidence_receipt(sources)["limited_brief_ready"]


def refresh_briefs(session, candidate_id):
    """Recompute persisted receipts after review, reanalysis, OCR or deletion."""
    from sqlalchemy import select
    from applyos_domain.interview_queries import jd_topic_coverage
    from applyos_domain.models import InterviewSource, InterviewBrief, Job

    for brief in session.scalars(select(InterviewBrief).where(InterviewBrief.candidate_id == candidate_id)):
        sources = list(session.scalars(select(InterviewSource).where(
            InterviewSource.candidate_id == candidate_id, InterviewSource.id.in_(brief.source_ids or []))))
        by_id = {s.id:s for s in sources}
        questions = []
        for question in brief.common_questions or []:
            ids = list(dict.fromkeys(i for i in question.get('source_ids', []) if i in by_id))
            accounting = question_evidence_summary([by_id[i] for i in ids], question.get('question', ''))
            count = accounting['confirmed_independent_count']
            questions.append({**question, 'source_ids':ids, 'cited_source_count':len(ids),
                'frequency':count if accounting['independence_status'] == 'confirmed' else None,
                'question_evidence':accounting, 'confidence':'recurring'
                if accounting['independence_status'] == 'confirmed' and count >= 2 else 'independence_unverified'})
        brief.common_questions = questions
        job = session.get(Job, brief.job_id) if brief.job_id else None
        jd = job.jd_raw if job and job.candidate_id == candidate_id else ''
        # Recompute from current, still-analyzed evidence. OCR changes move a
        # source back to captured; its previous analysis must not imply coverage.
        coverage = jd_topic_coverage(jd or '', [s for s in sources if source_ready(s)])
        coverage['context_status'] = 'current_job_jd' if jd else 'jd_unavailable'
        coverage['jd_content_hash'] = sha256(jd.encode()).hexdigest() if jd else None
        receipt = evidence_receipt(sources)
        brief.metadata_json = {**(brief.metadata_json or {}), **receipt, 'evidence_accounting':receipt,
            'evidence_status':evidence_status(sources), 'source_count':len(sources),
            'jd_topic_coverage':coverage,
            'recurring_question_count':sum((q['frequency'] or 0) >= 2 for q in questions)}
