"""Real network smoke test; copies only the target job into an isolated test DB."""
import json
import os
from pathlib import Path
import sqlite3
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Job, AgentRun
from applyos_agent.interview_tools import register_interview_tools
from applyos_harness.permissions import ToolGateway, ToolPermission

OUT = ROOT / "artifacts" / "didi-live"
OUT.mkdir(parents=True, exist_ok=True)
previous = {}
if (OUT / "result.json").exists():
    previous = json.loads((OUT / "result.json").read_text(encoding="utf-8"))
    (OUT / f"result-{int(time.time())}.json").write_bytes((OUT / "result.json").read_bytes())
original = Path(os.environ["APPDATA"]) / "fetchcv-desktop/data/fetchcv.db"
with sqlite3.connect(f"file:{original.as_posix()}?mode=ro", uri=True) as con:
    con.row_factory = sqlite3.Row
    job_data = dict(con.execute("SELECT company, role, jd_raw FROM jobs WHERE id=?", ("job_49106d4b69e84705bbb3f455163b6f25",)).fetchone())
report = {"job": job_data, "captures": [], "external_search_seeds": [
    "https://www.nowcoder.com/discuss/796355474110054400",
    "https://www.nowcoder.com/discuss/353159413437505536",
    "https://www.nowcoder.com/discuss/633014845876490240",
]}
def save():
    (OUT / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
def emit(message):
    print(message, flush=True)

db = Database(f"sqlite:///{(OUT / ('test-' + str(int(time.time())) + '.db')).as_posix()}")
db.create_schema()
with db.session() as session:
    candidate = Candidate(name="真实岗位采集测试")
    session.add(candidate); session.flush()
    job = Job(candidate_id=candidate.id, **job_data)
    session.add(job); session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
    session.add(run); session.flush()
    gateway = ToolGateway(session, workspace_root=OUT)
    register_interview_tools(gateway)
    permissions = {ToolPermission.NETWORK_READ, ToolPermission.DRAFT_WRITE, ToolPermission.READ}
    def execute(name, args, key):
        return gateway.execute(tool_name=name, run=run, arguments=args, granted_permissions=permissions, idempotency_key=key)
    emit("Starting default discovery with real job and controlled browser")
    try:
        report["discovery"] = execute("discover_interview_sources", {"company": job.company, "business_unit": "两轮车事业部", "role": "策略运营", "nowcoder_page_limit": 3}, "discover")
    except Exception as exc:
        report["discovery_error"] = {"type": type(exc).__name__, "code": getattr(exc, "code", ""), "message": str(exc)}
    save()
    results = report.get("discovery", {}).get("data", {}).get("results", [])
    emit(f"Discovery completed: {len(results)} candidates")
    # Independently found public URLs are explicitly recorded, never counted as automatic discovery.
    completed = {item["url"] for item in previous.get("captures", []) if item.get("result", {}).get("data", {}).get("source", {}).get("status") == "captured"}
    ranked = sorted(results, key=lambda item: (item["url"] in completed, item.get("scope") != "same_business_role", item.get("platform") != "xiaohongshu"))
    urls = list(dict.fromkeys([item["url"] for item in ranked] + report["external_search_seeds"]))
    xhs_stopped = False

    for index, url in enumerate(urls):
        if xhs_stopped and "xiaohongshu.com" in url:
            report.setdefault("pending_urls", []).append(url)
            continue
        if "xiaohongshu.com" not in url:
            time.sleep(2)
        try:
            value = execute("capture_interview_source", {"url": url, "company": job.company, "business_unit": "两轮车事业部", "role": "策略运营"}, f"capture-{index}")
            report["captures"].append({"url": url, "result": value})
            source = value.get("data", {}).get("source", {})
            emit(f"Captured {url}: {len(source.get('raw_text', ''))} chars, status={source.get('status')}, OCR={source.get('metadata_json', {}).get('ocr_status', '')}")
        except Exception as exc:
            report["captures"].append({"url": url, "error": str(exc), "code": getattr(exc, "code", "")})
            if "xiaohongshu.com" in url and getattr(exc, "code", "") == "interview_source_public_access_stopped":
                xhs_stopped = True
                report.setdefault("pending_urls", []).append(url)
            emit(f"Capture stopped: {getattr(exc, 'code', type(exc).__name__)}")
        save()
    # Local processing runs concurrently with capture. Poll only this local
    # localhost job queue after the browser phase; never revisit a website.
    deadline = time.monotonic() + 90
    pending = [item for item in report["captures"] if item.get("result", {}).get("data", {}).get("source", {}).get("metadata_json", {}).get("ocr_job_id")]
    cycle = 0
    while pending and time.monotonic() < deadline:
        remaining = []
        for item in pending:
            source = item["result"]["data"]["source"]
            collected = execute("collect_interview_ocr", {"source_id": source["id"]}, f"collect-{cycle}-{source['id']}")
            item["result"]["data"]["source"] = collected["data"]["source"]
            if collected["data"]["ocr_status"] in {"queued", "running"}:
                remaining.append(item)
            else:
                emit(f"Local OCR completed: {source['title']}")
        pending = remaining
        save()
        cycle += 1
        if pending:
            time.sleep(3)
emit(str(OUT / "result.json"))
