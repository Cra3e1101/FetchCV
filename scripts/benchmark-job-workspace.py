"""Measure the real workspace HTTP handler using deterministic local fixtures.

Run with the bundled backend Python via ``node scripts/run-python.mjs``.
An optional --baseline-source directory contains main.py, evaluation.py, ats.py
and optionally context.py captured before an optimization. Older three-file
snapshots use the current context.py and explicitly record that fallback.
No personal database or model is used.
"""

from __future__ import annotations

import argparse
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import hashlib
import importlib
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
SOURCE_MODULES = {
    # Context must be installed before evaluation imports ContextManager.
    "applyos_agent.context": BACKEND / "applyos_agent/context.py",
    "applyos_agent.evaluation": BACKEND / "applyos_agent/evaluation.py",
    "applyos_agent.ats": BACKEND / "applyos_agent/ats.py",
    "applyos_api.main": BACKEND / "applyos_api/main.py",
}
SCENARIOS = [
    ("blank", False, False, 0, 0),
    ("run-no-snapshot", True, False, 12, 0),
    ("run-with-snapshot", True, True, 12, 0),
    ("history-heavy", True, True, 200, 100),
]


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(data) -> bytes:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def load_sources(baseline: Path | None):
    paths = {}
    for name, source in SOURCE_MODULES.items():
        selected = baseline / source.name if baseline else source
        fallback = bool(baseline and name == "applyos_agent.context" and not selected.is_file())
        if fallback:
            selected = source
        paths[name] = {
            "path": str(selected), "sha256": digest(selected.read_bytes()),
            "source": "workspace_fallback_missing_optional_snapshot" if fallback else "baseline_snapshot" if baseline else "workspace",
        }
        if baseline:
            parent_name, attribute = name.rsplit(".", 1)
            parent = importlib.import_module(parent_name)
            spec = importlib.util.spec_from_file_location(name, selected)
            module = importlib.util.module_from_spec(spec)
            sys.modules[name] = module
            setattr(parent, attribute, module)
            spec.loader.exec_module(module)
    return paths


def seed(database):
    from applyos_agent.context import ContextManager
    from applyos_domain.enums import QualityStatus, StepStatus
    from applyos_domain.models import (
        AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, AgentTask,
        Candidate, Experience, Fact, InterviewSource, Job, JobProfile,
        MaterialAsset, QualityReport, ResumeVersion,
    )

    epoch = datetime(2026, 1, 1, 12)
    stamp = lambda offset=0: {"created_at": epoch + timedelta(seconds=offset), "updated_at": epoch + timedelta(seconds=offset)}
    descriptions = []
    for index, (name, has_run, snapshot, message_count, source_count) in enumerate(SCENARIOS):
        prefix = f"bench{index}"
        candidate_id, job_id = f"{prefix}-candidate", f"{prefix}-job"
        with database.session() as session:
            candidate = Candidate(id=candidate_id, name="合成测试用户", **stamp())
            session.add(candidate)
            session.flush()
            requirements = [f"使用 Skill{number} 完成数据分析与方案设计" for number in range(30)]
            job = Job(id=job_id, candidate_id=candidate_id, company="合成公司", role="测试岗位", jd_raw="；".join(requirements), **stamp())
            session.add(job)
            session.flush()
            if has_run:
                profile = JobProfile(id=f"{prefix}-profile", job_id=job_id, hard_requirements=requirements,
                                     keywords=[f"Skill{number}" for number in range(40)],
                                     business_context={"evidence": ["合成 JD 原文"]}, **stamp())
                run = AgentRun(id=f"{prefix}-run", candidate_id=candidate_id, job_id=job_id, run_type="resume", **stamp())
                sections = [{"id": name, "title": name, "items": [
                    {"id": f"{name}-{item}", "fields": {"organization": "合成团队"},
                     "body": (f"使用 Skill{item} 完成分析与验证。" * 50)}
                    for item in range(15)
                ]} for name in ("education", "experience", "skills")]
                base = ResumeVersion(id=f"{prefix}-base", candidate_id=candidate_id, name="基础简历",
                                     content_json={"editor_snapshot": {"profile": {"name": "合成测试用户"}, "sections": sections}}, **stamp())
                session.add_all([profile, run, base])
                session.flush()
                resume = ResumeVersion(id=f"{prefix}-resume", candidate_id=candidate_id, job_id=job_id,
                                       name="岗位简历", parent_version_id=base.id, content_json=base.content_json, **stamp(1))
                session.add(resume)
                session.add(Experience(id=f"{prefix}-experience", candidate_id=candidate_id, kind="experience", title="合成经历", **stamp()))
                for item in range(20):
                    session.add(Fact(id=f"{prefix}-fact-{item:03}", candidate_id=candidate_id, category="experience",
                                     content=f"完成数据分析项目 {item}", verified=True, **stamp(item)))
                session.add(MaterialAsset(id=f"{prefix}-material", candidate_id=candidate_id, kind="portfolio", name="合成作品", **stamp()))
                for item in range(8):
                    session.add(AgentRunStep(id=f"{prefix}-step-{item}", run_id=run.id, stage="analysis", agent_name="fixture",
                                            event_type="model_turn" if item % 2 else "tool", status=StepStatus.COMPLETED,
                                            sequence=item + 1, **stamp(item)))
                session.add(AgentTask(id=f"{prefix}-task", run_id=run.id, status="completed",
                                      result_json={"checkpoint": {"processing_trace": []}}, **stamp()))
                session.add(QualityReport(id=f"{prefix}-quality", run_id=run.id, target_type="resume", target_id=resume.id,
                                          status=QualityStatus.PASSED, created_at=epoch))
                for item in range(message_count):
                    session.add(AgentMessage(id=f"{prefix}-msg-{item:03}", candidate_id=candidate_id, job_id=job_id, run_id=run.id,
                                             role="user" if item % 2 == 0 else "assistant", content=f"第 {item} 条合成消息。" * 20, **stamp(item)))
                raw_text = "合成面经正文，用于检验数据库读取范围。\n" * 1000
                for item in range(source_count):
                    session.add(InterviewSource(id=f"{prefix}-source-{item:03}", candidate_id=candidate_id, job_id=job_id,
                                                company=job.company, role=job.role, title=f"合成面经 {item}",
                                                source_url=f"https://example.invalid/interview/{prefix}/{item}",
                                                url_hash=digest(f"{prefix}/{item}".encode()), content_hash=digest(raw_text.encode()),
                                                raw_text=raw_text, summary="合成测试摘要", extracted_questions=[{"question": "如何验证方案？"}], **stamp(item)))
                    # Keep FTS trigger transactions small while building the
                    # fixture; all setup is outside the measured interval.
                    if item % 5 == 4:
                        session.commit()
                session.flush()
                if snapshot:
                    session.add(AgentContextSnapshot(id=f"{prefix}-context", job_id=job_id, run_id=run.id,
                                                     pinned_context=ContextManager(session).pinned(job), **stamp()))
        descriptions.append({"scenario": name, "job_id": job_id, "has_run": has_run, "has_snapshot": snapshot,
                             "messages": message_count, "sources": source_count,
                             "source_raw_bytes_each": len(raw_text.encode()) if source_count else 0})
    return descriptions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-source", type=Path)
    parser.add_argument("--iterations", type=int, default=25)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--compare-report", type=Path)
    args = parser.parse_args()
    if args.iterations < 5:
        parser.error("--iterations must be at least 5")
    if args.baseline_source:
        args.baseline_source = args.baseline_source.resolve()
    evidence = ROOT / ".m1-evidence/job-workspace-performance"
    evidence.mkdir(parents=True, exist_ok=True)
    run_path = Path(tempfile.mkdtemp(prefix="baseline-" if args.baseline_source else "current-", dir=evidence))
    os.environ.update({
        "SQLITE_TMPDIR": str(run_path),
        "FETCHCV_DATABASE_URL": f"sqlite:///{(run_path / 'synthetic.db').as_posix()}",
        "FETCHCV_ARTIFACT_ROOT": str(run_path / "artifacts"),
        "FETCHCV_SETTINGS_FILE": str(run_path / "settings.json"),
        "FETCHCV_CONTROL_TOKEN": "benchmark-fixture-token",
        "FETCHCV_AGENT_RUNTIME": "mock", "FETCHCV_ALLOW_MOCK_RUNTIME": "1",
        "FETCHCV_DESKTOP_STARTUP_GATE": "0",
    })
    sys.path.insert(0, str(BACKEND))
    sources = load_sources(args.baseline_source)
    from fastapi.testclient import TestClient
    from sqlalchemy import event
    from applyos_api.main import create_app
    from applyos_domain.database import Database

    database = Database(os.environ["FETCHCV_DATABASE_URL"])
    if os.name == "nt":
        # SQLite on Windows ignores SQLITE_TMPDIR. Keep spill files inside the
        # explicitly writable fixture directory instead of the host temp path.
        with database.engine.connect() as connection:
            connection.exec_driver_sql("PRAGMA temp_store_directory = '" + run_path.as_posix().replace("'", "''") + "'")
    database.create_schema()
    scenarios = seed(database)
    statements = []

    def count_select(_connection, _cursor, statement, _parameters, _context, _executemany):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    event.listen(database.engine, "before_cursor_execute", count_select)
    # Schema was created above. Deliberately omit lifespan/background repair to
    # measure this endpoint alone rather than startup or maintenance work.
    application = create_app(database)

    @asynccontextmanager
    async def prepared_fixture(_application):
        yield

    application.router.lifespan_context = prepared_fixture
    client = TestClient(application, headers={"X-FetchCV-Control-Token": "benchmark-fixture-token"})
    # Reuse the ASGI loop and thread pool across requests, as the server does.
    client.__enter__()
    results = []
    try:
        for scenario in scenarios:
            samples, counts, hashes, sizes = [], [], [], []
            first_statements = None
            for iteration in range(args.iterations + 1):
                statements.clear()
                started = time.perf_counter()
                response = client.get(f"/api/jobs/{scenario['job_id']}/workspace")
                elapsed = (time.perf_counter() - started) * 1000
                response.raise_for_status()
                samples.append(elapsed)
                counts.append(len(statements))
                sizes.append(len(response.content))
                hashes.append(digest(canonical(response.json())))
                if iteration == 0:
                    first_statements = list(statements)
                    (run_path / f"{scenario['scenario']}-response.json").write_bytes(canonical(response.json()))
            assert len(set(hashes)) == 1, f"Non-deterministic fixture response: {scenario['scenario']}"
            warm = sorted(samples[1:])
            results.append({**scenario, "first_request_ms": round(samples[0], 3),
                            "warm_p50_ms": round(statistics.median(warm), 3),
                            "warm_p95_ms": round(warm[math.ceil(0.95 * len(warm)) - 1], 3),
                            "select_count": counts[0], "warm_select_counts": sorted(set(counts[1:])),
                            "response_bytes": sizes[0], "response_sha256": hashes[0],
                            "warm_samples_ms": [round(item, 3) for item in samples[1:]]})
            (run_path / f"{scenario['scenario']}-queries.json").write_text(json.dumps(first_statements, indent=2), encoding="utf-8")
    finally:
        client.__exit__(None, None, None)
        database.engine.dispose()
    report = {"synthetic": True, "baseline": bool(args.baseline_source), "iterations": args.iterations,
              "evidence_directory": str(run_path), "source_modules": sources, "scenarios": results,
              "limitations": [
                  "Deterministic synthetic data in a new isolated SQLite database; no user data, external services or model calls.",
                  "Times cover in-process TestClient HTTP handling, SQL, Python evaluation and response serialization; not Electron rendering or network transport.",
                  "First request is one sample after imports and fixture creation, not an operating-system cold-start benchmark.",
                  "Warm p95 uses the nearest-rank observation across the specified iterations; machine load can affect timings.",
                  "Database/schema setup and application lifespan/background maintenance are excluded.",
                  "A legacy baseline without context.py uses the workspace context implementation; source_modules records its path, hash and fallback status.",
              ]}
    if args.compare_report:
        before = json.loads(args.compare_report.read_text(encoding="utf-8"))
        previous = {item["scenario"]: item for item in before["scenarios"]}
        comparisons = []
        for item in results:
            old = previous[item["scenario"]]
            same = old["response_sha256"] == item["response_sha256"]
            comparisons.append({"scenario": item["scenario"], "response_identical": same,
                                "selects_before": old["select_count"], "selects_after": item["select_count"],
                                "warm_p50_before_ms": old["warm_p50_ms"], "warm_p50_after_ms": item["warm_p50_ms"],
                                "warm_p95_before_ms": old["warm_p95_ms"], "warm_p95_after_ms": item["warm_p95_ms"]})
        report["comparison"] = comparisons
    output = args.output.resolve() if args.output else run_path / "report.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"report": str(output), "scenarios": [{key: value for key, value in item.items() if key != "warm_samples_ms"} for item in results],
                      "comparison": report.get("comparison")}, ensure_ascii=False))
    if args.compare_report and not all(item["response_identical"] for item in report["comparison"]):
        raise SystemExit("Response equivalence failed; inspect the saved response JSON before claiming an optimization.")


if __name__ == "__main__":
    main()
