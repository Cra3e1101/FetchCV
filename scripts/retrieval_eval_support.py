"""Offline fixtures and honest evaluation summaries; no application database access."""
from __future__ import annotations

from collections import defaultdict, deque
from contextlib import contextmanager
from hashlib import sha256
import json
import math
from pathlib import Path
import socket
from unittest.mock import patch


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def contained(root, name):
    root = Path(root).resolve()
    path = (root / name).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"path escapes input root: {name}")
    return path


def hash_file(path):
    return sha256(Path(path).read_bytes()).hexdigest()


def freeze_inputs(out, cases, dataset, seeds, repo, *, replay_from=None):
    """Copy all actual JD inputs, not just mutable absolute paths. Never overwrite."""
    target = Path(out) / "inputs"
    target.mkdir()
    (target / "jd").mkdir()
    frozen = []
    origins = []
    for index, case in enumerate(cases):
        source = contained(dataset, case["file"])
        relative = f"jd/{index:03d}.md"
        content = source.read_bytes()
        (target / relative).write_bytes(content)
        frozen.append({**case, "file": relative})
        origins.append({"case_id": case["id"], "original_file": str(source),
                        "frozen_file": relative, "sha256": sha256(content).hexdigest()})
    write_json(target / "cases.json", frozen)
    write_json(target / "seeds.json", seeds)
    source_hashes = {}
    for folder in ("scripts", "backend/applyos_agent", "backend/applyos_domain",
                   "backend/applyos_harness", "backend/integrations/web"):
        for source in sorted((Path(repo) / folder).glob("*.py")):
            source_hashes[source.relative_to(repo).as_posix()] = hash_file(source)
    files = {p.relative_to(out).as_posix(): hash_file(p) for p in target.rglob("*") if p.is_file()}
    write_json(Path(out) / "input-manifest.json", {
        "schema": "retrieval-inputs-v1", "files": files, "origins": origins,
        "source_hashes": source_hashes, "replay_from": str(replay_from) if replay_from else None,
        "legacy_source_inputs_verified": False if replay_from and not (Path(replay_from) / "input-manifest.json").exists() else None,
        "note": "Hashes freeze this invocation. Legacy runs without manifests cannot prove the original JD bytes or code version."})
    return frozen, target


class SnapshotReplay:
    """Consume exact URLs in recorded per-URL order. Missing recordings never fall back."""
    def __init__(self, source):
        self.source = Path(source)
        self.queues = defaultdict(deque)
        self.used = []
        self.missing = []
        records = self.source / "evidence/responses.jsonl"
        self.records_sha256 = hash_file(records)
        for index, line in enumerate(records.read_text(encoding="utf-8-sig").splitlines()):
            if not line.strip():
                continue
            row = json.loads(line)
            if "error_code" not in row:
                body = contained(records.parent, row["body_file"])
                if hash_file(body) != row["sha256"]:
                    raise ValueError(f"snapshot hash mismatch at record {index + 1}")
            self.queues[row["requested_url"]].append((index + 1, row))

    def take(self, url):
        if not self.queues[url]:
            self.missing.append(url)
            raise LookupError(f"offline snapshot missing or exhausted: {url}")
        index, row = self.queues[url].popleft()
        self.used.append(index)
        if row.get('error_code') == 'offline_snapshot_missing':
            # A previous failed replay is not a recording of a real HTTP error.
            self.missing.append(url)
        return row

    def read_body(self, row):
        content = contained(self.source / "evidence", row["body_file"]).read_bytes()
        if sha256(content).hexdigest() != row["sha256"]:
            raise ValueError("snapshot changed during replay")
        return content

    def report(self):
        return {"responses_index_sha256": self.records_sha256,
                "consumed_records": len(self.used), "unused_records": sum(map(len, self.queues.values())),
                "missing_urls": self.missing, "complete_for_requested_urls": not self.missing,
                "network_disabled": True, "network_latency_comparable": False}


@contextmanager
def no_network():
    """Defence in depth for offline CLI; URL validation uses a non-network resolver."""
    def blocked(*args, **kwargs):
        raise RuntimeError("network access forbidden in offline replay")
    with patch.object(socket.socket, "connect", blocked), patch.object(socket.socket, "connect_ex", blocked), \
            patch.object(socket, "create_connection", blocked), patch.object(socket, "getaddrinfo", blocked):
        yield


def summarize_stages(pairs, events):
    rows = []
    for pair in pairs:
        calls = [e for e in events if e["case_id"] == pair["case_id"]]
        discovery = [e for e in calls if e["tool"] == "discover_interview_sources"]
        capture = [e for e in calls if e["tool"] == "capture_interview_source"]
        retrieval = [e for e in calls if e["tool"] == "search_interview_knowledge"]
        observations = [e.get('result', {}).get('data', {}) for e in discovery if e['ok']]
        rows.append({"case_id": pair["case_id"], "discovery_mode": pair.get("discovery_mode", "unknown"),
            "discovery_executed": bool(discovery), "discovery_tool_failures": sum(not e["ok"] for e in discovery),
            "discovery_page_failures": [p for d in observations for p in d.get('nowcoder_pages', [])
                                        if p.get('failure_reason') or p.get('status') not in {'read'}],
            "public_access_stopped": any(d.get('public_access_stopped', False) for d in observations),
            "continuations_remaining": sum(len(d.get('nowcoder_continuations', [])) for d in observations),
            "automatic_candidate_urls": len(set(pair.get("automatic_urls", []))),
            "external_seed_urls": len(set(pair.get("external_seed_urls", []))),
            "excluded_cards": len(pair.get("excluded_candidates", [])),
            "capture_attempts": len(capture), "capture_failures": sum(not e["ok"] for e in capture),
            "capture_provenance": pair.get('capture_records', 'legacy_not_recorded'),
            "captured_source_ids": len(set(pair["captured_source_ids"])),
            "retrieval_executed": bool(retrieval), "retrieval_tool_failures": sum(not e["ok"] for e in retrieval),
            "retrieved_candidates": len(pair["matches"]), "readback_ok": pair.get("readback_ok"),
            "status": pair["status"], "failure_codes": [e.get("code") for e in calls if not e["ok"]]})
    return {"cases": rows, "automatic_discovery_recall": None, "ranking_ndcg_at_5": None,
            "quality_status": "withheld_without_complete_independent_labels",
            "interpretation": "Counts measure pipeline outcomes, not relevance. Zero candidates is not proof that no interviews exist."}


def evaluate_labels(pairs, labels):
    """Only complete independently pooled labels enable pool-relative metrics.

    Label rows: case_id, url, relevance_0_to_3, reviewer, rationale,
    independent_origin_cluster, split, pool_origin='independent_search_pool'.
    Clusters cannot cross splits. Duplicate URL judgments are rejected.
    No inference from machine ranks, seed links or unmatched rows.
    """
    by_case = defaultdict(dict)
    cluster_splits = defaultdict(set)
    errors = []
    for n, row in enumerate(labels, 1):
        grade = row.get("relevance_0_to_3")
        required = ("case_id", "url", "reviewer", "rationale", "independent_origin_cluster", "split")
        if type(grade) is not int or grade not in range(4) or any(not row.get(k) for k in required):
            errors.append(f"row {n}: incomplete or invalid label")
            continue
        if row.get("pool_origin") != "independent_search_pool":
            errors.append(f"row {n}: independent pool provenance missing")
        key = row["case_id"]
        if row["url"] in by_case[key]:
            errors.append(f"row {n}: duplicate case/URL label")
        by_case[key][row["url"]] = row
        cluster_splits[row["independent_origin_cluster"]].add(row["split"])
    if any(len(splits) > 1 for splits in cluster_splits.values()):
        errors.append("origin cluster crosses dataset splits")
    for pair in pairs:
        judged = by_case[pair["case_id"]]
        if not judged:
            errors.append(pair["case_id"] + ": no reviewed independent pool")
        if any(m["source_url"] not in judged for m in pair["matches"]):
            errors.append(pair["case_id"] + ": retrieved URL is unjudged")
        if any(url not in judged for url in pair.get("automatic_urls", [])):
            errors.append(pair["case_id"] + ": automatic candidate is unjudged")
    if errors:
        return {"status": "withheld", "reasons": errors, "pool_recall": None, "ndcg_at_5": None}
    results = []
    for pair in pairs:
        judged = by_case[pair["case_id"]]
        # One independent origin contributes once; the strongest segment grade
        # defines that origin's pooled relevance. Ranking keeps first occurrence.
        grades = {}
        for row in judged.values():
            cluster = row["independent_origin_cluster"]
            grades[cluster] = max(grades.get(cluster, 0), row["relevance_0_to_3"])
        positives = {c for c, grade in grades.items() if grade > 0}
        found = {judged[u]["independent_origin_cluster"] for u in pair.get("automatic_urls", [])}
        ranked, seen = [], set()
        for hit in pair["matches"]:
            cluster = judged[hit["source_url"]]["independent_origin_cluster"]
            if cluster not in seen:
                ranked.append(grades[cluster]); seen.add(cluster)
        def dcg(values):
            return sum((2**v - 1) / math.log2(i + 2) for i, v in enumerate(values[:5]))
        ideal = dcg(sorted(grades.values(), reverse=True))
        executed = pair.get("discovery_mode") in {"production_discovery", "production_plus_external_seeds"}
        results.append({"case_id": pair["case_id"], "positive_origin_clusters": len(positives),
            "automatic_discovery_pool_recall": len(found & positives) / len(positives) if positives and executed else None,
            "ndcg_at_5": dcg(ranked) / ideal if ideal else None})
    return {"status": "pool_relative_only", "cases": results,
            "note": "Independent human pooling is asserted by label provenance, not verified by this script. Not Internet-wide recall."}
