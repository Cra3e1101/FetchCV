"""Synthetic contract regressions; execute only in an isolated test environment."""
from hashlib import sha256
from types import SimpleNamespace

from applyos_agent.interview_evidence import (
    analysis_reusable, evidence_receipt, evidence_summary, refresh_briefs, source_ready,
)


def synthetic_source(index, *, body=None, metadata=None, **overrides):
    body = body or f"我参加第{index}次面试，面试官问如何分析留存变化。"
    values = dict(id=str(index), raw_text=body, source_url=f"https://example.com/interview/{index}",
                  content_hash=sha256(body.encode()).hexdigest(), title="面经", status="analyzed",
                  extracted_questions=[{"question":"如何分析留存变化", "evidence_quote":body}],
                  metadata_json={"analysis_content_hash":sha256(body.encode()).hexdigest(), **(metadata or {})})
    values.update(overrides)
    return SimpleNamespace(**values)


def confirm_origin(source, origin):
    source.metadata_json = {**source.metadata_json, "evidence_review":{
        "reviewer":"user", "content_hash":sha256(source.raw_text.encode()).hexdigest(),
        "source_kind":"first_person", "quote":source.raw_text,
        "origin_cluster":origin, "origin_url":f"https://example.com/origin/{origin}"}}
    return source


def test_four_unknown_documents_are_limited_ready_and_keep_origin_work_pending():
    items = [synthetic_source(index) for index in range(4)]
    receipt = evidence_receipt(items)
    assert receipt["evidence_contract_version"] == "evidence-v2"
    assert receipt["limited_brief_ready"] is receipt["ready_for_brief"] is True
    assert receipt["evidence_status"] == "limited" and not receipt["coverage_verified"]
    assert receipt["usable_document_group_count"] == 4
    assert receipt["confirmed_origin_count"] == 0
    assert receipt["unresolved_origin_count"] == 4
    assert receipt["origin_review_pending_ids"] == ["0", "1", "2", "3"]
    assert receipt["next_actions"] == ["build_limited_brief", "review_origin_candidates", "discover_new_sources"]
    assert receipt["minimum_documents_for_limited_brief"] == 4
    assert "discover_new_sources" not in evidence_receipt(items, discovery_status="exhausted")["next_actions"]


def test_document_readiness_and_origin_count_have_explicit_legacy_difference():
    items = [confirm_origin(synthetic_source(index), "same") for index in range(4)]
    legacy = evidence_summary(items)
    receipt = evidence_receipt(items)
    for key, value in legacy.items():
        assert receipt[key] == value
    assert receipt["source_group_count"] == 1
    assert receipt["confirmed_independent_count"] == receipt["confirmed_origin_count"] == 1
    assert receipt["usable_document_group_count"] == 4
    assert receipt["limited_brief_ready"] and not receipt["legacy_ready_for_brief"]
    assert receipt["readiness_changed_from_legacy"]


def test_unknown_duplicate_does_not_borrow_review_from_another_member():
    first = confirm_origin(synthetic_source(1), "original")
    unknown = synthetic_source(2, body=first.raw_text)
    receipt = evidence_receipt([first, unknown])
    assert receipt["document_groups"] == [["1", "2"]]
    assert receipt["representative_ids"] == ["1"]
    assert receipt["confirmed_origin_count"] == 1
    assert receipt["unresolved_origin_count"] == 1
    assert receipt["origin_review_pending_ids"] == ["2"]


def test_stale_or_unquoted_analysis_is_not_usable_but_legacy_summary_is_unchanged():
    stale = confirm_origin(synthetic_source(1), "first")
    stale.raw_text += "新增正文。"
    no_quote = synthetic_source(2, extracted_questions=[{"question":"无引文问题"}])
    receipt = evidence_receipt([stale, no_quote])
    assert receipt["source_group_count"] == 2
    assert receipt["usable_document_group_count"] == receipt["confirmed_origin_count"] == 0
    assert receipt["excluded_document_ids"] == ["1", "2"]
    assert receipt["invalidated_review_source_ids"] == ["1"]


def test_partial_recovery_remains_usable_without_becoming_reusable_complete_analysis():
    partial = synthetic_source(1, metadata={"analysis_status":"partial", "rejected_unverified_questions":1})
    assert source_ready(partial)
    assert not analysis_reusable(partial)
    assert evidence_receipt([partial])["usable_document_ids"] == ["1"]


def test_no_questions_complete_analysis_is_reusable_but_never_ready():
    empty = synthetic_source(1, metadata={"analysis_status":"no_questions"}, extracted_questions=[])
    assert analysis_reusable(empty)
    assert not source_ready(empty)
    assert evidence_receipt([empty])["usable_document_ids"] == []
    empty.raw_text += "新正文。"
    assert not analysis_reusable(empty)


def test_classification_similarity_and_exact_duplicate_hints_never_create_origin():
    items = [synthetic_source(index, metadata={
        "classification_v1":{"predicted_kind":"first_person_candidate", "confirmed":True},
        "similarity_v1":{"candidates":[{"source_id":"other", "origin_cluster":"invented"}]},
        "source_kind":"first_person", "origin_verified":True,
    }) for index in range(4)]
    receipt = evidence_receipt(items)
    assert receipt["usable_document_group_count"] == 4
    assert receipt["confirmed_origin_count"] == receipt["confirmed_independent_count"] == 0
    assert receipt["unresolved_origin_count"] == 4


def test_known_compilation_or_repost_is_excluded_without_erasing_legacy_record_count():
    compilation = synthetic_source(1, metadata={"source_kind":"compilation"})
    repost = synthetic_source(2, metadata={"source_kind":"repost"})
    receipt = evidence_receipt([compilation, repost])
    assert receipt["verified_record_count"] == 2
    assert receipt["usable_document_group_count"] == receipt["confirmed_origin_count"] == 0
    assert receipt["excluded_document_ids"] == ["1", "2"]


def test_refresh_receipts_uses_only_explicit_in_memory_synthetic_database():
    # Never use the application's Database/get_database or its default path.
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session
    from applyos_domain.base import Base
    from applyos_domain.models import Candidate, InterviewBrief, InterviewSource

    engine = create_engine("sqlite+pysqlite:///:memory:")
    try:
        Base.metadata.create_all(engine)
        with Session(engine) as session:
            session.add(Candidate(id="synthetic-owner", name="Synthetic evidence v2"))
            session.flush()
            items = []
            for index in range(4):
                snapshot = confirm_origin(synthetic_source(index), str(index))
                item = InterviewSource(id=snapshot.id, candidate_id="synthetic-owner", company="Example", role="产品经理",
                    title=snapshot.title, raw_text=snapshot.raw_text, source_url=snapshot.source_url,
                    url_hash=sha256(snapshot.source_url.encode()).hexdigest(), content_hash=snapshot.content_hash,
                    status=snapshot.status, extracted_questions=snapshot.extracted_questions, metadata_json=snapshot.metadata_json)
                items.append(item)
            session.add_all(items)
            brief = InterviewBrief(id="synthetic-brief", candidate_id="synthetic-owner", company="Example", role="产品经理",
                source_ids=[item.id for item in items], common_questions=[])
            session.add(brief)
            session.flush()
            refresh_briefs(session, "synthetic-owner")
            assert brief.metadata_json["evidence_accounting"]["limited_brief_ready"]
            assert brief.metadata_json["evidence_accounting"]["confirmed_origin_count"] == 4
            items[0].raw_text += "审核以后正文改变。"
            refresh_briefs(session, "synthetic-owner")
            receipt = brief.metadata_json["evidence_accounting"]
            assert receipt["usable_document_group_count"] == 3
            assert receipt["confirmed_origin_count"] == 3
            assert receipt["invalidated_review_source_ids"] == ["0"]
            assert not receipt["limited_brief_ready"]
    finally:
        engine.dispose()
