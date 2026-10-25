"""Synthetic data only. ORM lifecycle tests explicitly use SQLite :memory:."""
from copy import deepcopy
from hashlib import sha256
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session

from applyos_agent.interview_source_hints import (
    MAX_BODY_CHARS, MAX_CANDIDATES, MAX_PEERS, MAX_POOL_CHARS,
    current_source_hints, invalidate_source_hint_edges, read_source_hints,
    refresh_source_hints, source_hints,
)
from applyos_domain.base import Base
from applyos_domain.models import Candidate, InterviewSource


def body():
    return "我参加面试，面试官让我说明项目中的选择。" + "".join(chr(0x4e00 + n) for n in range(300))


def source(identifier="one", **overrides):
    fields = dict(id=identifier, candidate_id="candidate", title="面试记录", raw_text=body(),
                  metadata_json={}, content_hash="deliberately-not-trusted")
    fields.update(overrides)
    return SimpleNamespace(**fields)


def store(item, peers=()):
    result = source_hints(item, peers)
    item.metadata_json = {**item.metadata_json, **{
        key: {k: deepcopy(v) for k, v in result[key].items() if k != "status"}
        for key in ("classification_v1", "similarity_v1")}}
    return result


@pytest.mark.parametrize("title,text,kind", [
    ("普通标题", "面经01：第一段\n面经02：第二段", "suspected_compilation"),
    ("普通标题", "面经 01/02/03 的整理内容", "suspected_compilation"),
    ("产品面经汇总", "内容", "suspected_compilation"),
    ("转载", "内容", "suspected_repost"),
    ("普通标题", "本文转载自公开帖子", "suspected_repost"),
    ("普通标题", "我参加了面试，面试官询问项目", "first_person_candidate"),
    ("普通标题", "内容不足", "unknown"),
    ("面经汇总转载", "内容", "unknown"),
])
def test_explainable_classification_only(title, text, kind):
    item = source(title=title, raw_text=text)
    result = source_hints(item, [])
    classification = result["classification_v1"]
    assert classification["predicted_kind"] == kind
    assert classification["mode"] == "review_hint_only"
    for signal in classification["signals"]:
        original = item.title if signal["location"] == "title" else item.raw_text
        assert original[slice(*signal["span"])] == signal["quote"]
    assert item.metadata_json == {}
    assert "source_kind" not in classification
    assert "origin_cluster" not in classification


def test_current_body_and_title_are_bound_separately_without_writes():
    item, peer = source(), source("two")
    store(item, [peer])
    before = deepcopy(item.metadata_json)
    assert current_source_hints(item, {peer.id: peer})["status"] == "current"
    item.title += "新标题"
    result = current_source_hints(item, {peer.id: peer})
    assert result["classification_v1"]["status"] == "stale"
    assert result["classification_v1"]["signals"] == []
    assert result["similarity_v1"]["status"] == "current"
    item.raw_text += "新正文"
    assert current_source_hints(item, {peer.id: peer})["similarity_v1"]["candidates"] == []
    assert item.metadata_json == before


def test_direct_edges_are_pairwise_and_not_transitive_or_certified():
    first, peer, third = source(), source("two"), source("three")
    store(peer, [third])
    review = {"reviewer": "user", "source_kind": "unknown", "quote": "preserved"}
    first.metadata_json = {"source_kind": "unknown", "evidence_review": review}
    result = store(first, [peer])
    edges = result["similarity_v1"]["candidates"]
    assert [edge["source_id"] for edge in edges] == [peer.id]
    assert edges[0]["jaccard"] == 1
    assert edges[0]["containment"] == [1, 1]
    assert first.metadata_json["source_kind"] == "unknown"
    assert first.metadata_json["evidence_review"] == review


def test_short_contained_text_is_weak_and_preserves_spans():
    first = source(raw_text="我参加面试后讨论的项目决策和结果")
    peer = source("two", raw_text=first.raw_text + body())
    result = source_hints(first, [peer])["similarity_v1"]
    edge = result["candidates"][0]
    assert edge["containment"][0] == 1
    assert edge["strength"] == "weak"
    assert edge["spans"] == [[0, len(first.raw_text)]]
    assert "short_text_weak_hint" in result["limitations"]


def test_explicit_jd_partition_does_not_claim_narrative_or_origin():
    first = source(raw_text="岗位职责：\n" + body())
    peer = source("two", raw_text=first.raw_text)
    result = source_hints(first, [peer])["similarity_v1"]
    assert result["candidates"][0]["region"] == "shared_jd"
    assert "shared_jd_or_template_is_not_origin_evidence" in result["limitations"]


@pytest.mark.parametrize("change", ["missing", "cross_candidate", "changed_body", "deleted", "version"])
def test_stale_or_unverifiable_edges_are_hidden_without_repair(change):
    item, peer = source(), source("two")
    store(item, [peer])
    if change == "cross_candidate":
        peer.candidate_id = "another-candidate"
    elif change == "changed_body":
        peer.raw_text += "changed"
    elif change == "version":
        item.metadata_json["similarity_v1"]["normalizer_version"] = "old"
    before = deepcopy(item.metadata_json)
    snapshots = None if change == "missing" else {} if change == "deleted" else {peer.id: peer}
    result = current_source_hints(item, snapshots)
    assert result["similarity_v1"]["status"] == "stale"
    assert result["similarity_v1"]["candidates"] == []
    assert item.metadata_json == before


def test_missing_hints_are_explicitly_stale_and_empty_edges_need_no_snapshot():
    item = source()
    assert current_source_hints(item)["status"] == "stale"
    store(item)
    assert current_source_hints(item)["status"] == "current"


def test_pure_pool_output_and_body_budgets_are_bounded():
    item = source()
    result = source_hints(item, [source(f"peer-{n:03}") for n in range(MAX_PEERS + 10)])
    similarity = result["similarity_v1"]
    assert similarity["peers_examined"] == MAX_PEERS
    assert len(similarity["candidates"]) == MAX_CANDIDATES
    assert similarity["pool_truncated"]
    assert source_hints(item, [source("large", raw_text="x" * (MAX_BODY_CHARS + 1))])["similarity_v1"]["pool_truncated"]
    large = source(raw_text="x" * (MAX_BODY_CHARS + 1))
    assert source_hints(large, [item])["similarity_v1"]["limitations"] == ["source_body_exceeds_limit"]


@pytest.fixture
def memory_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    try:
        with Session(engine, expire_on_commit=False) as session:
            session.add_all([Candidate(id="candidate", name="synthetic"),
                             Candidate(id="another-candidate", name="synthetic other")])
            session.flush()
            yield session
    finally:
        engine.dispose()


def add_source(session, identifier, **overrides):
    values = dict(id=identifier, candidate_id="candidate", company="synthetic", role="synthetic",
                  title="面试记录", source_url=f"https://example.invalid/{identifier}",
                  url_hash=sha256(identifier.encode()).hexdigest(), raw_text=body(), metadata_json={})
    values.update(overrides)
    item = InterviewSource(**values)
    session.add(item)
    session.flush()
    return item


def test_memory_refresh_and_body_change_invalidate_only_derived_edges(memory_session):
    session = memory_session
    first, second = add_source(session, "one"), add_source(session, "two")
    second.metadata_json = {"source_kind": "first_person", "evidence_review": {"reviewer": "user", "note": "preserve"}, "other": {"x": 1}}
    refresh_source_hints(session, second)
    session.flush()
    assert read_source_hints(session, second)["similarity_v1"]["candidates"][0]["source_id"] == first.id
    original = deepcopy(second.metadata_json)
    first.raw_text = "正文已经被用户改写"
    refresh_source_hints(session, first)
    session.flush()
    session.refresh(second)
    assert second.metadata_json["similarity_v1"]["candidates"] == []
    for key in ("source_kind", "evidence_review", "other"):
        assert second.metadata_json[key] == original[key]
    assert read_source_hints(session, first)["status"] == "current"


def test_memory_read_filters_cross_candidate_and_deleted_without_writes(memory_session):
    session = memory_session
    first, second = add_source(session, "one"), add_source(session, "two")
    other = add_source(session, "other", candidate_id="another-candidate")
    refresh_source_hints(session, first)
    session.flush()
    # Synthetic malformed cross-candidate edge, not a user/production record.
    edge = deepcopy(first.metadata_json["similarity_v1"]["candidates"][0])
    edge["source_id"] = other.id
    first.metadata_json = {**first.metadata_json, "similarity_v1": {
        **first.metadata_json["similarity_v1"], "candidates": [edge]}}
    session.flush()
    before = deepcopy(first.metadata_json)
    assert read_source_hints(session, first)["similarity_v1"]["candidates"] == []
    assert first.metadata_json == before
    refresh_source_hints(session, first)
    session.flush()
    session.delete(second)
    session.flush()
    before = deepcopy(first.metadata_json)
    assert read_source_hints(session, first)["similarity_v1"]["status"] == "stale"
    assert first.metadata_json == before


def test_memory_delete_invalidation_is_candidate_scoped_metadata_only(memory_session):
    session = memory_session
    target, peer = add_source(session, "one"), add_source(session, "two")
    other = add_source(session, "other", candidate_id="another-candidate")
    refresh_source_hints(session, peer)
    session.flush()
    other.metadata_json = {"similarity_v1": {"candidates": [{"source_id": target.id}]}, "keep": True}
    session.flush()
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    event.listen(session.bind, "before_cursor_execute", capture)
    try:
        invalidate_source_hint_edges(session, "candidate", target.id)
    finally:
        event.remove(session.bind, "before_cursor_execute", capture)
    session.refresh(peer)
    session.refresh(other)
    assert peer.metadata_json["similarity_v1"]["candidates"] == []
    assert other.metadata_json["similarity_v1"]["candidates"] == [{"source_id": target.id}]
    assert all("raw_text" not in sql for sql in statements)
    assert any("json_each" in sql for sql in statements)


def test_memory_invalidation_ignores_legacy_non_object_edge_values(memory_session):
    session = memory_session
    target, peer = add_source(session, "one"), add_source(session, "two")
    peer.metadata_json = {"source_kind": "unknown", "evidence_review": {"reviewer": "user", "keep": True},
                          "similarity_v1": {"candidates": ["bad", 42, None, {"source_id": target.id}]}}
    session.flush()
    invalidate_source_hint_edges(session, "candidate", target.id)
    session.refresh(peer)
    assert peer.metadata_json["similarity_v1"]["candidates"] == ["bad", 42, None]
    assert peer.metadata_json["source_kind"] == "unknown"
    assert peer.metadata_json["evidence_review"] == {"reviewer": "user", "keep": True}


def test_memory_refresh_selects_bodies_only_with_sql_and_total_budgets(memory_session):
    session = memory_session
    item = add_source(session, "own")
    for n in range(MAX_PEERS + 2):
        add_source(session, f"peer-{n:03}", raw_text=body() * 100)
    add_source(session, "oversized", raw_text="x" * (MAX_BODY_CHARS + 1))
    statements = []
    def capture(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    event.listen(session.bind, "before_cursor_execute", capture)
    try:
        result = refresh_source_hints(session, item)
    finally:
        event.remove(session.bind, "before_cursor_execute", capture)
    similarity = result["similarity_v1"]
    assert similarity["pool_truncated"]
    assert similarity["peers_examined"] * len(body() * 100) <= MAX_POOL_CHARS
    body_queries = [sql for sql in statements if sql.lstrip().startswith("select") and "raw_text" in sql]
    assert body_queries
    assert all("length(" in sql for sql in body_queries)
    assert any("substr(" in sql for sql in body_queries)
    assert all("interview_sources.summary" not in sql for sql in body_queries)
