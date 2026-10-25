"""Synthetic legacy DB from the frozen 25-table V1 schema, never user data."""
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone

root = Path(os.environ["M1_ALLOWED_DELETE_ROOT"]).resolve(strict=True)
output = Path(sys.argv[1]).resolve()
if not output.is_relative_to(root) or output.exists():
    raise SystemExit("fresh DB in approved root required")
attempts = []


def audit(event, args):
    if event in {"os.remove", "os.rmdir", "os.rename"}:
        attempts.append({"event": event, "path": str(args[0])})
        raise RuntimeError("fixture forbids all Python deletion/move attempts")


sys.addaudithook(audit)
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from applyos_domain.database import Database
from applyos_domain import models as m
from applyos_domain.enums import RunStatus
from sqlalchemy import inspect

# Keep this historical fixture aligned with packages/storage/legacy-tables.mjs.
# New runtime models and search indexes are not part of the V1 migration input.
LEGACY_TABLE_NAMES = (
    "candidates", "material_assets", "experiences", "facts", "jobs",
    "job_profiles", "interview_sources", "interview_briefs", "resume_versions",
    "portfolio_versions", "applications", "agent_runs", "agent_messages",
    "agent_run_steps", "agent_tasks", "queued_agent_messages", "agent_context_snapshots",
    "agent_skills", "mcp_server_configs", "workspace_settings", "rewrite_proposals",
    "approvals", "tool_invocations", "version_snapshots", "quality_reports",
)

db = Database(f"sqlite:///{output.as_posix()}")
m.Base.metadata.create_all(db.engine, tables=[m.Base.metadata.tables[name] for name in LEGACY_TABLE_NAMES])
stamp = datetime(2026, 9, 21, tzinfo=timezone.utc)
with db.session() as session:
    def add(cls, **values):
        row = cls(**values, created_at=stamp, **({"updated_at": stamp} if hasattr(cls, "updated_at") else {}))
        session.add(row)
        session.flush()
        return row

    candidate = add(m.Candidate, id="cand_a", name="Synthetic candidate", title="Analyst")
    other = add(m.Candidate, id="cand_b", name="Other synthetic candidate")
    job = add(m.Job, id="job_a", candidate_id=candidate.id, company="Synthetic Company", role="Analyst", jd_raw="Synthetic JD")
    material = add(m.MaterialAsset, id="material_a", candidate_id=candidate.id, kind="resume", name="Missing fixture", source_path=None)
    fact = add(m.Fact, id="fact_a", candidate_id=candidate.id, category="skill", content="SQL", verified=True)
    add(m.Experience, id="exp_a", candidate_id=candidate.id, source_asset_id=material.id, kind="project", title="Synthetic analysis")
    add(m.JobProfile, id="profile_a", job_id=job.id, hard_requirements=["SQL"])
    source = add(m.InterviewSource, id="source_a", candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role, source_url="https://example.test/interview", url_hash="synthetic-url-hash", raw_text="Synthetic interview")
    resume = add(m.ResumeVersion, id="resume_a", candidate_id=candidate.id, job_id=job.id, name="Synthetic resume", content_json={"name": "Original version"})
    portfolio = add(m.PortfolioVersion, id="portfolio_a", candidate_id=candidate.id, job_id=job.id, resume_version_id=resume.id)
    add(m.Application, id="application_a", candidate_id=candidate.id, job_id=job.id, resume_version_id=resume.id, portfolio_version_id=portfolio.id)
    run = add(m.AgentRun, id="run_a", candidate_id=candidate.id, job_id=job.id, run_type="synthetic", status=RunStatus.RUNNING)
    add(m.InterviewBrief, id="brief_a", candidate_id=candidate.id, job_id=job.id, run_id=run.id, company=job.company, role=job.role, source_ids=[source.id])
    for ident in ["msg_b", "msg_a"]:
        add(m.AgentMessage, id=ident, candidate_id=candidate.id, job_id=job.id, run_id=run.id, role="user" if ident == "msg_a" else "assistant", content=ident, metadata_json={"delivery_status": "completed", "custom": "retain"})
    add(m.AgentRunStep, id="step_a", run_id=run.id, stage="created", agent_name="synthetic", sequence=1)
    add(m.AgentTask, id="task_a", run_id=run.id, locked_by="old-worker", status="running")
    add(m.QueuedAgentMessage, id="queue_a", candidate_id=candidate.id, job_id=job.id, run_id=run.id, content="Do not automatically send", sequence=1)
    add(m.AgentContextSnapshot, id="context_a", job_id=job.id, run_id=run.id, summary="Summary is not active memory")
    add(m.AgentSkill, id="skill_a", name="Synthetic", path="missing-synthetic-skill.md", content_hash="not-a-verified-hash")
    add(m.McpServerConfig, id="mcp_a", name="Synthetic", command="node", args_json=["--synthetic-secret", "opaque-fixture"], enabled=True, approved=True)
    add(m.WorkspaceSetting, id="settings_a", values_json={"api_key": "fixture-provider-secret", "theme": "dark"})
    add(m.RewriteProposal, id="proposal_a", resume_version_id=resume.id, run_id=run.id, section="summary", before="Before", after="After", reason="Synthetic", fact_ids=[fact.id])
    add(m.Approval, id="approval_a", run_id=run.id, action_type="write", target_type="resume", target_id=resume.id)
    add(m.ToolInvocation, id="invocation_a", operation_id="synthetic-operation", run_id=run.id, tool_name="synthetic", stage="created", arguments_hash="synthetic-hash", status="unknown")
    add(m.VersionSnapshot, id="snapshot_a", target_type="resume", target_id=resume.id, run_id=run.id, sequence=1, payload={"old": "version"}, content_hash="synthetic-hash")
    add(m.QualityReport, id="quality_a", target_type="resume", target_id=resume.id, run_id=run.id)
table_count = len(inspect(db.engine).get_table_names())
db.engine.dispose()
Path(str(output) + ".audit.json").write_text(json.dumps({"python_delete_move_attempts": attempts, "synthetic": True, "native_coverage": "not exhaustive"}), encoding="utf-8")
if attempts:
    raise SystemExit(86)
print(json.dumps({"database": str(output), "tables": table_count, "synthetic": True}))
