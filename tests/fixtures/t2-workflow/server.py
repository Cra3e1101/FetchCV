"""T2 offline browser fixture: production API/SQLite; deterministic task receipts.

This is deliberately not a real model or collection pipeline. Only fixture routes
advance synthetic Agent phases. Production create/read/approval routes are used.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import socket
import sys

parser = argparse.ArgumentParser()
parser.add_argument("--run-root", required=True)
parser.add_argument("--scenario", choices=["usable", "empty", "restricted", "no-profile"], required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[3]
run_root = Path(args.run_root).resolve()
run_root.relative_to(repo / "artifacts" / "t2-independent")
for name in ["APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "FETCHCV_SETTINGS_FILE", "FETCHCV_ARTIFACT_ROOT", "FETCHCV_WORKSPACE_ROOT"]:
    Path(os.environ[name]).resolve().relative_to(run_root)
assert os.environ["FETCHCV_DATABASE_URL"] == "sqlite:///" + (run_root / "fixture.db").as_posix()
assert os.environ["FETCHCV_AGENT_RUNTIME"] == "mock"

# Block outbound Python connections before importing application capabilities.
original_connect = socket.socket.connect
def local_connect(sock, address):
    if isinstance(address, tuple):
        host = address[0]
        try:
            allowed = ipaddress.ip_address(host).is_loopback
        except ValueError:
            allowed = host == "localhost"
        if not allowed:
            raise RuntimeError("T2 fixture blocked external network")
    return original_connect(sock, address)
socket.socket.connect = local_connect
sys.path.insert(0, str(repo / "backend"))

from fastapi import HTTPException
from sqlalchemy import select
from applyos_domain.database import Database
from applyos_domain.models import (AgentMessage, AgentRun, Approval, Candidate, Experience, Fact,
    InterviewBrief, InterviewSource, Job, JobProfile, ResumeVersion, RewriteProposal, ToolInvocation)
from applyos_domain.enums import RunStatus
from applyos_harness.approval import ApprovalService
from applyos_harness.validation import FactValidator, grounded_claim
from applyos_harness.versioning import canonical_hash
from applyos_api.main import create_app
from integrations.resume_pdf.importer import PDF_IMPORT_SCHEMA_VERSION, _normalize_editor_snapshot
import uvicorn

database = Database(os.environ["FETCHCV_DATABASE_URL"])
database.create_schema()
source_sentence = "整理订单项目的数据。保留原型状态。"
def seed_library():
  with database.session() as session:
    candidate = Candidate(id="t2-candidate", name="合成验收同学")
    session.add(candidate)
    session.flush()
    fact = Fact(id="t2-fact", candidate_id=candidate.id, category="project", content=source_sentence,
                verified=True, version=3, allowed_outputs=["resume", "portfolio", "interview_answer"])
    session.add(fact)
    session.flush()
    session.add(Experience(id="t2-experience", candidate_id=candidate.id, kind="project", title="合成订单项目",
                          role="参与数据整理", fact_ids=[fact.id], summary=source_sentence))
    snapshot, _ = _normalize_editor_snapshot({"profile": {"name": candidate.name}, "sections": [
                          {"id": "experience", "title": "项目经历", "visible": True,
                           "items": [{"id": "t2-item", "body": source_sentence, "fields": {}}]}]})
    session.add(ResumeVersion(id="t2-base", candidate_id=candidate.id, name="合成基础简历", source_fact_ids=[fact.id],
        content_json={"claims": [grounded_claim(fact).model_dump(mode="json")], "verification_status": "verified",
                      "pdf_import_schema_version": PDF_IMPORT_SCHEMA_VERSION, "editor_snapshot": snapshot}))

if args.scenario != "no-profile":
    seed_library()

app = create_app(database)

@app.post("/fixture/task/{run_id}")
def task(run_id: str):
    with database.session() as session:
        agent_run = session.get(AgentRun, run_id)
        if agent_run is None:
            raise HTTPException(404)
        job = session.get(Job, agent_run.job_id)
        if agent_run.current_stage == "awaiting_user_review":
            approval = session.scalar(select(Approval).where(Approval.run_id == run_id, Approval.action_type == "apply_resume_changes"))
            assert approval.status.value == "approved"
            agent_run.current_stage = "ready_to_publish"
            agent_run.status = RunStatus.COMPLETED
        elif agent_run.current_stage == "awaiting_fact_review":
            approval = session.scalar(select(Approval).where(Approval.run_id == run_id, Approval.action_type == "confirm_relevant_facts"))
            assert approval.status.value == "approved" and approval.decision_payload["fact_ids"] == ["t2-fact"]
            base = session.get(ResumeVersion, "t2-base")
            fact = session.get(Fact, "t2-fact")
            resume = ResumeVersion(id="t2-draft", candidate_id=job.candidate_id, job_id=job.id,
                                   name="合成岗位草稿", content_json=deepcopy(base.content_json), source_fact_ids=[fact.id])
            session.add(resume)
            session.flush()
            verified_claim = grounded_claim(fact)
            assert FactValidator(session).validate(candidate_id=job.candidate_id, asset_type="resume", claims=[verified_claim]).passed
            good = verified_claim.model_dump(mode="json")
            common = {"source_resume_id": base.id, "source_resume_hash": canonical_hash(base.content_json)}
            session.add(RewriteProposal(id="t2-safe", resume_version_id=resume.id, run_id=run_id, section="项目经历",
                before=source_sentence, after=source_sentence, reason="保留支持原句（合成正例）。", fact_ids=[fact.id],
                jd_evidence=["整理订单数据"], risk_level="low", claim_contract={**common, "claims": [good], "needs_evidence": False, "issues": []}))
            bad = deepcopy(good)
            bad.update(text="主导上线数据库并提升转化率90%。", action="主导上线", object="数据库", metrics=["90%"])
            invalid_claim = type(verified_claim).model_validate(bad)
            assert not FactValidator(session).validate(candidate_id=job.candidate_id, asset_type="resume", claims=[invalid_claim]).passed
            bad = invalid_claim.model_dump(mode="json")
            session.add(RewriteProposal(id="t2-unsupported", resume_version_id=resume.id, run_id=run_id, section="项目经历",
                before=source_sentence, after=bad["text"], reason="无支持的合成攻击草稿，必须待补证。", fact_ids=[fact.id],
                jd_evidence=["整理订单数据"], claim_contract={**common, "claims": [bad], "needs_evidence": True,
                    "issues": [{"code": "claim_needs_evidence", "message": "缺少主导、上线和90%成果的本人原句。"}],
                    "followups": ["请提供本人实际负责范围和成果原始记录。"]}))
            session.flush()
            ApprovalService(session).request(run_id=run_id, action_type="apply_resume_changes", target_type="resume", target_id=resume.id)
            agent_run.current_stage = "awaiting_user_review"
            agent_run.status = RunStatus.PAUSED
        else:
            session.add(JobProfile(job_id=job.id, responsibilities=["整理订单数据"], keywords=["数据整理", "SQL"],
                                   competencies=["数据整理"], source_run_id=run_id))
            ApprovalService(session).request(run_id=run_id, action_type="confirm_relevant_facts", target_type="job", target_id=job.id,
                items=[{"fact_id": "t2-fact", "recommended": True}])
            agent_run.current_stage = "awaiting_fact_review"
            agent_run.status = RunStatus.PAUSED
    return {"synthetic_mock_task": True, "run_id": run_id}

@app.post("/fixture/research/{job_id}")
def research(job_id: str):
    with database.session() as session:
        job = session.get(Job, job_id)
        agent_run = session.scalar(select(AgentRun).where(AgentRun.job_id == job_id).order_by(AgentRun.created_at.desc()))
        if agent_run is None:
            raise HTTPException(409, "create the resume run first")
        source_ids = []
        if args.scenario == "usable":
            text = "我参加了合成科技的数据分析岗位面试。面试官问：如何核对订单数据质量？"
            source = InterviewSource(id="t2-usable", candidate_id=job.candidate_id, job_id=job_id,
                platform="nowcoder", company=job.company, role=job.role, title="合成数据分析岗位面经",
                source_url="https://example.invalid/synthetic/usable", url_hash="a"*64,
                raw_text=text, content_hash=hashlib.sha256(text.encode()).hexdigest(), status="analyzed",
                extracted_questions=[{"question": "如何核对订单数据质量？", "evidence_quote": "面试官问：如何核对订单数据质量？"}],
                metadata_json={"coverage_scope": "same_business_role", "text_source": "public_body"})
            session.add(source)
            session.add(InterviewSource(id="t2-ocr", candidate_id=job.candidate_id, job_id=job_id,
                platform="xiaohongshu", company=job.company, role=job.role, title="待识别的合成图片",
                source_url="https://example.invalid/synthetic/ocr", url_hash="b"*64, raw_text="", status="ocr_pending",
                metadata_json={"ocr_status": "pending", "needs_ocr": True}))
            source_ids = [source.id]
        elif args.scenario == "restricted":
            agent_run.error = "合成离线：平台出现验证码，本轮停止读取；可粘贴有权使用的面经正文。"
        question_ids = source_ids or ["missing-stale-source"]
        session.add(InterviewBrief(id="t2-brief", candidate_id=job.candidate_id, job_id=job_id, run_id=agent_run.id,
            company=job.company, role=job.role, summary="基于已核验面经的有限准备建议。" if source_ids else "遗留简报：多源高频，必须隐藏。",
            source_ids=question_ids, common_questions=[{"question": "如何核对订单数据质量？" if source_ids else "悬空旧问题不应显示",
                "frequency": 1 if source_ids else 9, "source_ids": question_ids, "supporting_source_ids": question_ids,
                "question_evidence": {"independence_status": "confirmed", "confirmed_independent_count": 1 if source_ids else 9,
                                      "supporting_source_ids": question_ids}}],
            recommendations=[] if source_ids else [{"title": "错误残留个人经历", "action": "我主导上线了数据库。"}],
            metadata_json={"evidence_status": "limited" if source_ids else "sufficient", "evidence_accounting": {"coverage_verified": bool(source_ids)}}))
        session.flush()
        for index in range(7):
            is_capture = index < 3
            failed = index >= 3 and args.scenario != "empty"
            receipt = {"artifacts": ["interview_source:t2-usable"], "source_id": "t2-usable", "status": "captured"} if source_ids and is_capture else {"artifacts": [], "sources": [], "results": [], "discovery_exhausted": True}
            error = {}
            if failed:
                error = {"code": "browser_rate_limited" if args.scenario == "restricted" else "read_timeout",
                    "message": "合成离线：平台出现验证码，本轮停止读取" if args.scenario == "restricted" else "合成离线：原文读取超时",
                    "details": {"stop_reason": "captcha" if args.scenario == "restricted" else "read_failed", "retry_after_ms": 60000}}
            session.add(ToolInvocation(id=f"t2-tool-{index}", operation_id=f"t2-op-{index}", run_id=agent_run.id,
                tool_name="discover_interview_sources" if args.scenario == "empty" else "capture_interview_source" if is_capture else "read_web_page", stage="interview_research",
                provider_call_id=f"t2-capture-{index}", arguments_hash=str(index)*64,
                status="failed" if failed else "completed", result_json={"data": receipt, "artifacts": receipt["artifacts"]}, error_json=error))
        message = AgentMessage(candidate_id=job.candidate_id, job_id=job_id, run_id=agent_run.id, role="assistant",
            content="本轮调研已结束，当前证据有限。", metadata_json={"task_kind": "interview_research", "tool_count": 7,
                "tool_receipts": [{"tool_name": "capture_interview_source", "tool_call_id": f"t2-capture-{index}", "status": "completed", "artifacts": ["interview_source:t2-usable"]} for index in range(3)] if source_ids else [
                    {"tool_name": "discover_interview_sources" if args.scenario == "empty" else "read_web_page", "tool_call_id": f"t2-capture-{index}", "status": "completed" if args.scenario == "empty" else "failed", "artifacts": []} for index in range(7)]})
        session.add(message)
        session.flush()
        return {"assistant": {"id": message.id, "role": "assistant", "content": message.content, "metadata_json": message.metadata_json}}

@app.get("/fixture/inspect")
def inspect_fixture():
    with database.session() as session:
        return {"synthetic_data": True, "scenario": args.scenario,
            "candidates": len(session.scalars(select(Candidate)).all()),
            "jobs": len(session.scalars(select(Job)).all()),
            "facts": [{"id": f.id, "version": f.version, "verified": f.verified} for f in session.scalars(select(Fact)).all()],
            "approvals": [{"action_type": a.action_type, "status": a.status.value, "payload": a.decision_payload} for a in session.scalars(select(Approval)).all()]}

@app.post("/fixture/reason/{job_id}/{reason}")
def reason_fixture(job_id: str, reason: str):
    assert args.scenario == "empty" and reason in {"read_failed", "irrelevant"}
    with database.session() as session:
        agent_run = session.scalar(select(AgentRun).where(AgentRun.job_id == job_id).order_by(AgentRun.created_at.desc()))
        records = session.scalars(select(ToolInvocation).where(ToolInvocation.run_id == agent_run.id).order_by(ToolInvocation.id)).all()
        for index, row in enumerate(records):
            row.tool_name = "read_web_page" if reason == "read_failed" else "analyze_interview_source"
            row.status = "failed" if reason == "read_failed" else "completed"
            row.error_json = {"code": "read_timeout", "message": "合成离线：原文读取超时"} if reason == "read_failed" else {}
            row.result_json = {"data": {"rejected_irrelevant_count": 2 if reason == "irrelevant" and index == 0 else 0}}
    return {"synthetic_reason": reason}

sock = socket.socket()
sock.bind(("127.0.0.1", 0))
(run_root / "api-address.json").write_text(json.dumps({"port": sock.getsockname()[1]}), encoding="utf-8")
uvicorn.Server(uvicorn.Config(app, log_level="warning")).run(sockets=[sock])
