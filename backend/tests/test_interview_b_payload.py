"""Synthetic payload contracts loaded without the application's import graph."""
import __future__
import ast
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

from applyos_agent.interview_source_hints import NORMALIZER_VERSION, current_source_hints, source_hints


def production_helpers():
    # Compile the actual production function bodies, never copied test versions.
    # Importing interview_tools also imports the renderer's artifact-root setup.
    path = Path(__file__).resolve().parents[1] / "applyos_agent" / "interview_tools.py"
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    names = {"_source_payload", "_refresh_missing_source_hints"}
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert {node.name for node in functions} == names
    module = ast.Module(body=functions, type_ignores=[])
    namespace = {"current_source_hints":current_source_hints, "NORMALIZER_VERSION":NORMALIZER_VERSION}
    exec(compile(module, str(path), "exec", flags=__future__.annotations.compiler_flag,
                 dont_inherit=True), namespace)
    return namespace


def source(index, body):
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return SimpleNamespace(id=str(index), candidate_id="synthetic-owner", job_id=None, platform="nowcoder",
        company="Example", role="产品经理", business_unit=None, title="产品经理面经", raw_text=body,
        source_url=f"https://www.nowcoder.com/discuss/{1000 + index}", author=None,
        published_at="2026-01-01T00:00:00+00:00", summary="合成面试记录", extracted_questions=[], tags=[], status="captured",
        created_at=now, updated_at=now, metadata_json={"provider":"synthetic"})


def store_hints(item, peers):
    hints = source_hints(item, peers)
    item.metadata_json = {**item.metadata_json, **{
        key:{name:value for name,value in hints[key].items() if name != "status"}
        for key in ("classification_v1", "similarity_v1")}}


def test_list_payload_hides_unverified_edges_and_never_reads_peers(monkeypatch):
    helpers = production_helpers()
    body = "我参加了产品经理一面。面试官问如何分析留存下降、开展用户研究和设计实验。" * 12
    first, other = source(1, body), source(2, body)
    store_hints(first, [other])
    assert first.metadata_json["similarity_v1"]["candidates"]
    def unexpected_read(*_args):
        raise AssertionError("A bulk/pure payload must not query peer bodies")
    monkeypatch.setitem(helpers, "read_source_hints", unexpected_read)
    payload = helpers["_source_payload"](first)
    assert "classification_v1" not in payload["metadata_json"]
    assert "similarity_v1" not in payload["metadata_json"]
    assert payload["metadata_json"]["provider"] == "synthetic"
    assert payload["source_hints"]["classification_v1"]["status"] == "current"
    assert payload["source_hints"]["similarity_v1"]["candidates"] == []
    assert first.metadata_json["similarity_v1"]["candidates"]


def test_detail_payload_uses_the_explicit_session_validator(monkeypatch):
    helpers = production_helpers()
    item = source(1, "我参加面试，面试官问如何开展用户研究。")
    session = object()
    calls = []
    validated = {"status":"current", "classification_v1":{"status":"current"},
                 "similarity_v1":{"status":"current", "candidates":[]}}
    def read(bound_session, bound_source):
        calls.append((bound_session, bound_source))
        return validated
    monkeypatch.setitem(helpers, "read_source_hints", read)
    payload = helpers["_source_payload"](item, include_text=True, session=session)
    assert calls == [(session, item)]
    assert payload["source_hints"] is validated and payload["raw_text"] == item.raw_text


def test_duplicate_reuse_keeps_valid_incoming_edges_without_refresh(monkeypatch):
    helpers = production_helpers()
    body = "我参加产品面试，面试官问如何分析指标。" * 15
    item, peer = source(1, body), source(2, body)
    store_hints(item, [peer])
    calls = []
    monkeypatch.setitem(helpers, "refresh_source_hints", lambda session, value: calls.append(value.id))
    helpers["_refresh_missing_source_hints"](object(), item)
    assert calls == []
    item.raw_text += "正文有新内容。"
    helpers["_refresh_missing_source_hints"](object(), item)
    assert calls == ["1"]


def test_duplicate_reuse_refreshes_stale_similarity_headers_with_current_classification(monkeypatch):
    helpers = production_helpers()
    body = "我参加产品面试，面试官问如何开展用户研究。" * 15
    item, peer = source(1, body), source(2, body)
    store_hints(item, [peer])
    original = dict(item.metadata_json["similarity_v1"])
    stale_headers = {"schema_version":0, "normalizer_version":"old-segments",
                     "method":"old-method", "mode":"old-mode", "input_body_hash":"0" * 64,
                     "coverage":"old-coverage"}
    calls = []
    monkeypatch.setitem(helpers, "refresh_source_hints", lambda session, value: calls.append(value.id))
    for key, value in stale_headers.items():
        item.metadata_json = {**item.metadata_json, "similarity_v1":{**original, key:value}}
        assert current_source_hints(item, None)["classification_v1"]["status"] == "current"
        calls.clear()
        helpers["_refresh_missing_source_hints"](object(), item)
        assert calls == ["1"], key
