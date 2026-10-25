"""Bounded, local review hints; never source-kind or origin certification.

The pure functions accept objects or mappings. ORM helpers deliberately select
body projections only after selecting a bounded pool of ids and lengths. They
do not initialize a database, commit a transaction, or call a model/service.
"""
from __future__ import annotations

from collections.abc import Iterable, Mapping
from copy import deepcopy
from hashlib import sha256
from itertools import islice
from math import isfinite
import re
from types import SimpleNamespace
import unicodedata

RULES_VERSION = "source-hints-v1"
NORMALIZER_VERSION = "interview-segments-v1"
MAX_CANDIDATES = 8
MAX_PEERS = 64
MAX_BODY_CHARS = 50_000
MAX_POOL_CHARS = 200_000
SHINGLE_SIZE = 4
KINDS = {"suspected_compilation", "suspected_repost", "first_person_candidate", "unknown"}
REGIONS = {"whole_body", "interview_narrative", "shared_jd", "shared_template"}

_NUMBERED = re.compile(r"面经[ \t]*(?:第[ \t]*)?([0-9０-９]{1,3}|[一二三四五六七八九十]{1,3})(?![0-9０-９])")
_NUMBER_SERIES = re.compile(r"面经[ \t]*[0-9０-９]{1,3}(?:[ \t]*[/／、][ \t]*[0-9０-９]{1,3})+(?![0-9０-９])")
_COMPILATION = re.compile(r"面经(?:合集|汇总|汇编|整理)|(?:合集|汇总|汇编|整理)(?:版|的)?面经|整理自|汇编自")
_REPOST = re.compile(r"转载自|转自|原作者[：:]|本文(?:为|系)转载|转载")
_PERSONAL = re.compile(r"我(?:在|的|是|当时|参加|面试|投递|收到)|面试官")
_HEADING = re.compile(
    r"^[ \t]*(?:#{1,6}[ \t]*)?(?P<label>岗位描述|岗位职责|职位描述|职位要求|任职要求|岗位要求|招聘要求|JD|Job Description|"
    r"面试经历|面试经过|面试过程|面试复盘|面试记录|一面|二面|三面|终面|HR面|技术面|业务面|笔试|"
    r"通用题库|常见面试题|面试题汇总|导航|广告)[ \t]*(?:[：:].*|)$", re.I)
_JD = {"岗位描述", "岗位职责", "职位描述", "职位要求", "任职要求", "岗位要求", "招聘要求", "jd", "job description"}
_TEMPLATE = {"通用题库", "常见面试题", "面试题汇总", "导航", "广告"}


def _value(source, key, default=None):
    return source.get(key, default) if isinstance(source, Mapping) else getattr(source, key, default)


def _text(source, key):
    value = _value(source, key, "")
    return value if isinstance(value, str) else ""


def _hash(value):
    # Always hash current raw text, never the possibly stale content_hash column.
    return sha256(value.encode("utf-8")).hexdigest()


def _classification(source):
    body, title = _text(source, "raw_text"), _text(source, "title")
    signals = []
    for location, text in (("title", title), ("body", body[:MAX_BODY_CHARS])):
        numbered = list(islice(_NUMBERED.finditer(text), 8))
        if len({unicodedata.normalize("NFKC", m.group(1)) for m in numbered}) >= 2:
            signals.extend({"rule_id": "numbered_interviews", "location": location,
                            "span": list(m.span()), "quote": m.group()} for m in numbered)
        series = _NUMBER_SERIES.search(text)
        if series:
            end = min(series.end(), series.start() + 160)
            signals.append({"rule_id": "numbered_interviews", "location": location,
                            "span": [series.start(), end], "quote": text[series.start():end]})
        for rule, pattern in (("explicit_compilation", _COMPILATION), ("explicit_repost", _REPOST)):
            match = pattern.search(text)
            if match:
                signals.append({"rule_id": rule, "location": location,
                                "span": list(match.span()), "quote": match.group()})
    personal = _PERSONAL.search(body[:MAX_BODY_CHARS])
    if personal:
        signals.append({"rule_id": "first_person_wording_weak", "location": "body",
                        "span": list(personal.span()), "quote": personal.group()})
    rules = {item["rule_id"] for item in signals}
    compilation = bool(rules & {"numbered_interviews", "explicit_compilation"})
    repost = "explicit_repost" in rules
    # Conflicting strong cues retain their quotes without resolving provenance.
    kind = ("unknown" if compilation and repost else "suspected_compilation" if compilation else
            "suspected_repost" if repost else "first_person_candidate" if personal else "unknown")
    return {"schema_version": 1, "rules_version": RULES_VERSION,
            "input_body_hash": _hash(body), "input_title_hash": _hash(title),
            "predicted_kind": kind, "signals": signals[:16], "mode": "review_hint_only",
            "limitations": (["classification_prefix_only"] if len(body) > MAX_BODY_CHARS else [])}


def _regions(body):
    """Only explicit section headings establish regions; retain raw offsets."""
    headings, offset = [], 0
    for line in body.splitlines(keepends=True):
        match = _HEADING.fullmatch(line.rstrip("\r\n")) if len(line) <= 300 else None
        if match:
            label = match.group("label").lower()
            region = "shared_jd" if label in _JD else "shared_template" if label in _TEMPLATE else "interview_narrative"
            headings.append((offset, region))
        offset += len(line)
    if not headings:
        return {"whole_body": [[0, len(body)]]}, ["whole_body_fallback"]
    regions = {}
    # An unlabelled preamble is not silently promoted to interview narrative.
    if headings[0][0] and body[:headings[0][0]].strip():
        regions["whole_body"] = [[0, headings[0][0]]]
    for index, (start, region) in enumerate(headings[:32]):
        end = headings[index + 1][0] if index + 1 < len(headings) else len(body)
        regions.setdefault(region, []).append([start, end])
    return regions, (["section_limit"] if len(headings) > 32 else [])


def _normalized(value):
    return "".join(c for c in unicodedata.normalize("NFKC", value).casefold() if c.isalnum())


def _region_features(body):
    regions, limitations = _regions(body)
    result = {}
    for region, spans in regions.items():
        shingles, char_count = set(), 0
        for start, end in spans:
            text = _normalized(body[start:end])
            char_count += len(text)
            # Do not invent shingles across omitted sections or paragraphs.
            shingles.update(text[i:i + SHINGLE_SIZE] for i in range(max(0, len(text) - SHINGLE_SIZE + 1)))
        result[region] = (shingles, char_count, spans)
    return result, limitations


def _empty_similarity(source):
    return {"schema_version": 1, "input_body_hash": _hash(_text(source, "raw_text")),
            "normalizer_version": NORMALIZER_VERSION, "method": "char_shingle_exact",
            "mode": "review_candidates_only", "coverage": "bounded_candidates",
            "peers_examined": 0, "pool_truncated": False, "candidates": [], "limitations": []}


def source_hints(source, peers: Iterable, *, max_candidates=MAX_CANDIDATES) -> dict:
    """Compute pairwise hints without mutation, transitive grouping, or counts."""
    classification, similarity = _classification(source), _empty_similarity(source)
    body, candidate_id = _text(source, "raw_text"), _value(source, "candidate_id")
    pool = list(islice(iter(peers), MAX_PEERS + 1))
    similarity["pool_truncated"] = len(pool) > MAX_PEERS
    if len(body) > MAX_BODY_CHARS:
        similarity["pool_truncated"] = True
        similarity["limitations"] = ["source_body_exceeds_limit"]
    elif not body or not candidate_id:
        similarity["limitations"] = ["empty_body" if not body else "missing_candidate_scope"]
    else:
        features, limitations = _region_features(body)
        similarity["limitations"] = limitations
        budget = 0
        edges = []
        seen = set()
        for peer in sorted(pool[:MAX_PEERS], key=lambda item: str(_value(item, "id", ""))):
            peer_id, other = _value(peer, "id"), _text(peer, "raw_text")
            if (not peer_id or peer_id == _value(source, "id") or peer_id in seen
                    or _value(peer, "candidate_id") != candidate_id):
                continue
            seen.add(peer_id)
            if len(other) > MAX_BODY_CHARS or budget + len(other) > MAX_POOL_CHARS:
                similarity["pool_truncated"] = True
                continue
            budget += len(other)
            similarity["peers_examined"] += 1
            other_features, _ = _region_features(other)
            pair_edges = []
            for region in sorted(features.keys() & other_features.keys()):
                left, left_chars, spans = features[region]
                right, right_chars, other_spans = other_features[region]
                if not left or not right:
                    continue
                overlap = len(left & right)
                jaccard = overlap / len(left | right)
                containment = [overlap / len(left), overlap / len(right)]
                if jaccard < .65 and max(containment) < .85:
                    continue
                pair_edges.append({"source_id": peer_id, "other_body_hash": _hash(other), "region": region,
                                   "jaccard": round(jaccard, 6), "containment": [round(v, 6) for v in containment],
                                   "strength": "weak" if min(left_chars, right_chars) < 200 or min(len(left), len(right)) < 50 else "review_candidate",
                                   "spans": spans, "other_spans": other_spans})
            if pair_edges:
                # One direct edge per peer; prefer a narrative comparison when available.
                edges.append(max(pair_edges, key=lambda e: (e["region"] == "interview_narrative", e["jaccard"], max(e["containment"]))))
        edges.sort(key=lambda e: (-e["jaccard"], -max(e["containment"]), str(e["source_id"])))
        limit = max(0, min(MAX_CANDIDATES, int(max_candidates)))
        similarity["candidates"] = edges[:limit]
        if len(edges) > limit:
            similarity["pool_truncated"] = True
        if any(e["region"] in {"shared_jd", "shared_template"} for e in similarity["candidates"]):
            similarity["limitations"].append("shared_jd_or_template_is_not_origin_evidence")
        if any(e["strength"] == "weak" for e in similarity["candidates"]):
            similarity["limitations"].append("short_text_weak_hint")
    return {"status": "current", "classification_v1": {"status": "current", **classification},
            "similarity_v1": {"status": "current", **similarity}}


def _snapshot_map(peer_snapshots):
    if peer_snapshots is None:
        return {}
    if isinstance(peer_snapshots, Mapping):
        return dict(islice(peer_snapshots.items(), MAX_CANDIDATES))
    return {_value(item, "id"): item for item in islice(iter(peer_snapshots), MAX_CANDIDATES)}


def _valid_spans(spans, body):
    return (isinstance(spans, list) and 0 < len(spans) <= 32 and all(
        isinstance(span, list) and len(span) == 2 and all(type(v) is int for v in span)
        and 0 <= span[0] < span[1] <= len(body) for span in spans))


def current_source_hints(source, peer_snapshots=None) -> dict:
    """Read-only validation. Missing snapshots cannot establish a current edge."""
    metadata = _value(source, "metadata_json", {})
    metadata = metadata if isinstance(metadata, Mapping) else {}
    stored_class, stored_sim = metadata.get("classification_v1"), metadata.get("similarity_v1")
    expected_class = _classification(source)
    class_valid = isinstance(stored_class, Mapping) and all(stored_class.get(k) == v for k, v in expected_class.items())
    classification = ({**deepcopy(dict(stored_class)), "status": "current"} if class_valid else
                      {"status": "stale", "reason": "missing_or_changed_input_or_rules", **expected_class,
                       "predicted_kind": "unknown", "signals": []})
    similarity = _empty_similarity(source)
    headers = ("schema_version", "input_body_hash", "normalizer_version", "method", "mode", "coverage")
    sim_valid = isinstance(stored_sim, Mapping) and all(stored_sim.get(k) == similarity[k] for k in headers)
    candidates = stored_sim.get("candidates") if sim_valid else None
    sim_valid = (sim_valid and isinstance(candidates, list) and len(candidates) <= MAX_CANDIDATES
                 and type(stored_sim.get("peers_examined")) is int and 0 <= stored_sim["peers_examined"] <= MAX_PEERS
                 and type(stored_sim.get("pool_truncated")) is bool)
    if sim_valid:
        similarity = deepcopy(dict(stored_sim))
        similarity["candidates"] = []
        snapshots, seen = _snapshot_map(peer_snapshots), set()
        body, scope = _text(source, "raw_text"), _value(source, "candidate_id")
        for edge in candidates:
            if not isinstance(edge, Mapping):
                sim_valid = False
                continue
            other_id = edge.get("source_id")
            peer = snapshots.get(other_id) if isinstance(other_id, str) else None
            other = _text(peer, "raw_text")
            metrics = [edge.get("jaccard"), *(edge.get("containment") if isinstance(edge.get("containment"), list) else [])]
            valid = (peer is not None and bool(scope) and _value(peer, "candidate_id") == scope
                     and _value(peer, "id", other_id) == other_id and other_id != _value(source, "id") and other_id not in seen
                     and edge.get("other_body_hash") == _hash(other) and len(other) <= MAX_BODY_CHARS
                     and edge.get("region") in REGIONS and len(metrics) == 3
                     and all(type(v) in (int, float) and isfinite(v) and 0 <= v <= 1 for v in metrics)
                     and edge.get("strength") in {"weak", "review_candidate"}
                     and _valid_spans(edge.get("spans"), body) and _valid_spans(edge.get("other_spans"), other))
            if valid:
                similarity["candidates"].append(deepcopy(dict(edge)))
                seen.add(other_id)
            else:
                sim_valid = False
    similarity["status"] = "current" if sim_valid else "stale"
    if not sim_valid:
        similarity["reason"] = "missing_or_changed_input_version_or_peer"
    return {"status": "current" if class_valid and sim_valid else "stale",
            "classification_v1": classification, "similarity_v1": similarity}


def read_source_hints(session, source) -> dict:
    """Validate at most eight same-candidate current body snapshots; never write."""
    from sqlalchemy import func, select
    from applyos_domain.models import InterviewSource

    metadata = _value(source, "metadata_json", {})
    stored = metadata.get("similarity_v1", {}) if isinstance(metadata, Mapping) else {}
    edges = stored.get("candidates", []) if isinstance(stored, Mapping) else []
    ids = [e.get("source_id") for e in edges[:MAX_CANDIDATES] if isinstance(e, Mapping) and isinstance(e.get("source_id"), str)] if isinstance(edges, list) else []
    snapshots = {}
    if ids and _value(source, "candidate_id"):
        query = select(InterviewSource.id, InterviewSource.candidate_id,
                       func.substr(InterviewSource.raw_text, 1, MAX_BODY_CHARS).label("raw_text")).where(
            InterviewSource.candidate_id == _value(source, "candidate_id"), InterviewSource.id.in_(ids),
            func.length(InterviewSource.raw_text) <= MAX_BODY_CHARS).limit(MAX_CANDIDATES)
        with session.no_autoflush:
            snapshots = {row.id: SimpleNamespace(**row._mapping) for row in session.execute(query)}
    return current_source_hints(source, snapshots)


def invalidate_source_hint_edges(session, candidate_id, source_id) -> None:
    """Remove incoming edges using JSON filtering and metadata-only projections."""
    from sqlalchemy import case, exists, func, select, update
    from applyos_domain.models import InterviewSource

    if not candidate_id or not source_id:
        return
    edges = func.json_each(InterviewSource.metadata_json, "$.similarity_v1.candidates").table_valued("value", "type")
    edge_id = case((edges.c.type == "object", func.json_extract(edges.c.value, "$.source_id")), else_=None)
    matching = exists(select(1).select_from(edges).where(edge_id == source_id))
    query = select(InterviewSource.id, InterviewSource.metadata_json).where(
        InterviewSource.candidate_id == candidate_id, InterviewSource.id != source_id, matching)
    with session.no_autoflush:
        for row in session.execute(query).yield_per(MAX_PEERS):
            metadata = row.metadata_json if isinstance(row.metadata_json, dict) else {}
            similarity = metadata.get("similarity_v1")
            if not isinstance(similarity, dict) or not isinstance(similarity.get("candidates"), list):
                continue
            remaining = [edge for edge in similarity["candidates"] if not isinstance(edge, dict) or edge.get("source_id") != source_id]
            session.execute(update(InterviewSource).where(InterviewSource.id == row.id,
                            InterviewSource.candidate_id == candidate_id).values(metadata_json={
                                **metadata, "similarity_v1": {**similarity, "candidates": remaining,
                                "pool_truncated": True, "invalidated_peer_edges": True}}))


def refresh_source_hints(session, source) -> dict:
    """Transaction hook: invalidate incoming edges, then replace only own hints.

    Flushes existing changes for a current id/body. The caller owns the final
    flush/commit, including the new metadata assignment.
    """
    from sqlalchemy import func, select
    from applyos_domain.models import InterviewSource

    session.flush()
    scope, source_id = _value(source, "candidate_id"), _value(source, "id")
    invalidate_source_hint_edges(session, scope, source_id)
    body_length = func.length(InterviewSource.raw_text)
    base = (InterviewSource.candidate_id == scope, InterviewSource.id != source_id)
    lengths = session.execute(select(InterviewSource.id, body_length.label("body_length")).where(
        *base, body_length <= MAX_BODY_CHARS).order_by(InterviewSource.id).limit(MAX_PEERS + 1)).all()
    truncated = len(lengths) > MAX_PEERS
    truncated |= session.scalar(select(InterviewSource.id).where(*base, body_length > MAX_BODY_CHARS).limit(1)) is not None
    ids, budget = [], 0
    for row in lengths[:MAX_PEERS]:
        if budget + row.body_length > MAX_POOL_CHARS:
            truncated = True
            continue
        ids.append(row.id)
        budget += row.body_length
    peers = []
    if ids:
        query = select(InterviewSource.id, InterviewSource.candidate_id,
                       func.substr(InterviewSource.raw_text, 1, MAX_BODY_CHARS).label("raw_text")).where(
            *base, InterviewSource.id.in_(ids), body_length <= MAX_BODY_CHARS).order_by(InterviewSource.id).limit(MAX_PEERS)
        peers = [SimpleNamespace(**row._mapping) for row in session.execute(query)]
    result = source_hints(source, peers)
    result["similarity_v1"]["pool_truncated"] |= truncated
    metadata = _value(source, "metadata_json", {})
    metadata = dict(metadata) if isinstance(metadata, Mapping) else {}
    source.metadata_json = {**metadata, **{key: {k: deepcopy(v) for k, v in result[key].items() if k != "status"}
                                          for key in ("classification_v1", "similarity_v1")}}
    return result
