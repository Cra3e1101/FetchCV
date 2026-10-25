"""Compare the prior FTS5 retrieval path with bounded evidence previews.

Only creates a temporary synthetic database. Never opens the user's library.
Run: backend/.venv/Scripts/python.exe scripts/benchmark-search-previews.py
     --output .m1-work/preview-benchmark.json --documents 500 --repeats 10
This is a microbenchmark and constructed regression fixture, not real recall.
"""
import argparse
from contextlib import ExitStack
import json
import math
from pathlib import Path
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import insert, select, text
from sqlalchemy.orm import defer
from applyos_domain.database import Database
from applyos_domain.models import Candidate, InterviewSource
from applyos_domain.knowledge_search import _words, match_query, search_knowledge


def previous_fts(session, query, limit):
    """The immediately preceding FTS5 SQL + deferred ORM hydration, verbatim logic."""
    rows = session.execute(text("""SELECT s.id,
        bm25(interview_source_fts_v1,6,5,4,4,2,2,1,1) AS score,
        substr(s.raw_text, max(1, instr(lower(s.raw_text), :needle)-80), 800) AS preview
        FROM interview_sources s
        JOIN interview_source_fts_v1 ON interview_source_fts_v1.rowid=s.rowid
        WHERE s.candidate_id = :candidate AND interview_source_fts_v1 MATCH :match
        ORDER BY score, s.updated_at DESC, s.id LIMIT :limit OFFSET 0"""),
        {"needle": _words(query)[0], "match": match_query(query),
         "candidate": "synthetic", "limit": limit if limit is not None else -1}).mappings().all()
    items = {}
    for start in range(0, len(rows), 256):
        stmt = select(InterviewSource).where(
            InterviewSource.id.in_([r["id"] for r in rows[start:start + 256]]),
            InterviewSource.candidate_id == "synthetic").options(defer(InterviewSource.raw_text))
        items.update((item.id, item) for item in session.scalars(stmt))
    return [(row["id"], row["preview"]) for row in rows if row["id"] in items]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--documents", type=int, default=500)
    parser.add_argument("--repeats", type=int, default=10)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("output must be a new file")
    if not 100 <= args.documents <= 2000 or not 5 <= args.repeats <= 100:
        parser.error("documents: 100..2000; repeats: 5..100")
    marker = "SQL 留存率"
    terms = "SQL 留存率 实验分组 归因 漏斗 点击 转化 复购 用户 指标 同比"
    body = "Synthetic background for local retrieval measurements. " * 100 + terms
    reports = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fetchcv-preview-bench-", dir=args.output.resolve().parent) as directory, ExitStack() as cleanup:
        db = Database(f"sqlite:///{(Path(directory) / 'synthetic.db').as_posix()}")
        cleanup.callback(db.engine.dispose)
        db.create_schema()
        with db.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA temp_store=MEMORY")
        with db.session() as session:
            session.add(Candidate(id="synthetic", name="Synthetic fixture")); session.flush()
            session.execute(insert(InterviewSource), [dict(
                id=f"source-{i:05}", candidate_id="synthetic", company="示例公司", role="产品经理",
                title=f"Synthetic interview {i}", source_url=f"https://example.com/{i}",
                url_hash=f"{i:064x}", summary="Synthetic only", raw_text=body,
            ) for i in range(args.documents)])
        for query, limit in [("示例公司 SQL 留存率", 30), ("示例公司 SQL 留存率", None),
                             ("示例公司 " + terms, None)]:
            def run(which):
                with db.session() as session:
                    if which == "previous_fts5":
                        return previous_fts(session, query, limit)
                    return [(h.item.id, h.preview) for h in search_knowledge(
                        session, query=query, candidate_id="synthetic", limit=limit)]
            for _ in range(2):
                old, new = run("previous_fts5"), run("bounded_previews")
                assert [item[0] for item in old] == [item[0] for item in new]
            samples = {"previous_fts5": [], "bounded_previews": []}
            for iteration in range(args.repeats):
                for name in list(samples)[::1 if iteration % 2 else -1]:
                    start = time.perf_counter(); result = run(name)
                    samples[name].append((time.perf_counter() - start) * 1000)
                    assert len(result) == (limit or args.documents)
            reports.append({
                "query": query, "query_terms": len(_words(query)), "limit": limit,
                "matched_ids_equal": True, "returned_hits": len(new),
                "preview_evidence_hits": {"previous_fts5": sum(marker in p for _, p in old),
                                          "bounded_previews": sum(marker in p for _, p in new)},
                "timing": {name: {"p50_ms": statistics.median(values),
                                  "p95_ms": sorted(values)[math.ceil(.95 * len(values)) - 1]}
                           for name, values in samples.items()}, "samples_ms": samples,
            })
        with db.session() as session:
            question = "请问如何计算用户留存率以及使用SQL分析"
            fallback = {"strict_hits": len(search_knowledge(session, query=question)),
                        "relaxed_hits": len(search_knowledge(session, query=question, relax_if_empty=True))}
        db.engine.dispose()
    report = {"synthetic": True, "documents": args.documents, "body_chars": len(body),
              "repeats": args.repeats, "warmups": 2, "sqlite_temp_store": "MEMORY for both paths", "scenarios": reports,
              "constructed_natural_language_case": fallback,
              "limits": ["Prior FTS5 code is the baseline, not the older Python full-table scan.",
                         "Same synthetic body on each row; no real user recall or SLA claim.",
                         "Up to 12 x 800 characters internally; one <=800-character excerpt is exposed.",
                         "Uncapped callers still process every match to preserve business ranking."]}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({**report, "scenarios": [{k: v for k, v in r.items() if k != "samples_ms"}
                                            for r in reports]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
