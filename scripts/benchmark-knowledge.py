"""Synthetic local retrieval benchmark. Never opens a user's database.

Run with the backend Python; --output must name a NEW directory. Results are
not a production SLA, semantic-recall benchmark or a resume-ready percentage.
"""
import argparse
import json
import math
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from sqlalchemy import insert, select
from applyos_domain.database import Database
from applyos_domain.models import Candidate, InterviewSource
from applyos_domain.knowledge_search import search_knowledge


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--documents", type=int, default=1200)
    parser.add_argument("--repeats", type=int, default=30)
    args = parser.parse_args()
    if not 100 <= args.documents <= 10000 or not 10 <= args.repeats <= 200:
        parser.error("documents must be 100..10000; repeats 10..200")
    args.output.mkdir(parents=True, exist_ok=False)
    db = Database(f"sqlite:///{(args.output.resolve() / 'synthetic.db').as_posix()}")
    db.create_schema()
    start = time.perf_counter()
    with db.session() as session:
        session.add(Candidate(id="synthetic", name="Synthetic benchmark")); session.flush()
        session.execute(insert(InterviewSource), [dict(
            id=f"s-{i:05}", candidate_id="synthetic", company="示例公司", role="产品经理",
            title=f"合成面经 {i}", source_url=f"https://example.com/{i}", url_hash=f"{i:064x}",
            summary="讨论留存 SQL 指标" if i < 10 else "讨论项目协作与需求管理",
            raw_text="这是合成的面试材料，用于测量数据库读取与匹配开销。" * 160,
        ) for i in range(args.documents)])
    indexed_write_seconds = time.perf_counter() - start
    query = "留存 SQL"

    def scan():
        with db.session() as session:
            rows = session.scalars(select(InterviewSource).where(InterviewSource.candidate_id == "synthetic")).all()
            return sorted(s.id for s in rows if all(t in f"{s.company} {s.role} {s.title} {s.summary}".casefold() for t in query.casefold().split()))[:30]

    def indexed():
        with db.session() as session:
            return sorted(h.item.id for h in search_knowledge(session, query=query, candidate_id="synthetic", limit=30))

    expected = [f"s-{i:05}" for i in range(10)]
    for _ in range(3):
        assert scan() == indexed() == expected
    measurements = {"scan": [], "fts5": []}
    for i in range(args.repeats):
        for name, action in (("scan", scan), ("fts5", indexed))[::1 if i % 2 else -1]:
            start = time.perf_counter(); result = action(); elapsed = time.perf_counter() - start
            assert result == expected
            measurements[name].append(elapsed * 1000)
    def stats(values):
        return {"p50_ms": statistics.median(values), "p95_ms": sorted(values)[math.ceil(.95 * len(values)) - 1]}
    scan_stats, fts_stats = stats(measurements["scan"]), stats(measurements["fts5"])
    report = {
        "synthetic": True, "documents": args.documents, "repeats": args.repeats, "warmups": 3,
        "query": query, "matching_documents": 10, "result_ids_equal": True,
        "baseline": "SQLAlchemy materializes scoped source rows then Python substring AND matching",
        "indexed": "FTS5/BM25 with SQL candidate filter, top 30 metadata + 800-char previews",
        "scan": scan_stats, "fts5": fts_stats,
        "p95_reduction_percent": (1 - fts_stats["p95_ms"] / scan_stats["p95_ms"]) * 100,
        "insert_with_index_seconds": indexed_write_seconds,
        "database_bytes": (args.output / "synthetic.db").stat().st_size,
        "samples_ms": measurements,
        "limits": ["Warm local synthetic run, not a user workload or production SLA",
                   "No semantic recall or end-to-end model latency claim",
                   "Includes eager body transfer cost in the former scan approach"],
    }
    (args.output / "benchmark.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in report.items() if k != "samples_ms"}, ensure_ascii=False, indent=2))
    db.engine.dispose()


if __name__ == "__main__":
    main()
