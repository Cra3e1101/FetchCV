"""Production API for T3 browser checks; only synthetic library and web IO fixture."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socket
import sys
from common import block_external_connections, importer, BODY

parser=argparse.ArgumentParser()
parser.add_argument("--run-root",required=True)
args=parser.parse_args()
repo=Path(__file__).resolve().parents[3]
run_root=Path(args.run_root).resolve()
run_root.relative_to(repo/"artifacts/t3-independent")
for name in ["APPDATA","LOCALAPPDATA","TEMP","TMP","FETCHCV_SETTINGS_FILE","FETCHCV_ARTIFACT_ROOT","FETCHCV_WORKSPACE_ROOT"]:
    Path(os.environ[name]).resolve().relative_to(run_root)
assert os.environ["FETCHCV_DATABASE_URL"]=="sqlite:///"+(run_root/"fixture.db").as_posix()
assert os.environ["FETCHCV_AGENT_RUNTIME"]=="mock"
block_external_connections()
sys.path.insert(0,str(repo/"backend"))

from sqlalchemy import select
from applyos_api.main import create_app
import applyos_api.main as api
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Job, JobProfile, InterviewBrief, MaterialAsset, ResumeVersion, AgentRun
from applyos_domain.job_context import current_analysis_marker
from integrations.resume_pdf.importer import PDF_IMPORT_SCHEMA_VERSION, _normalize_editor_snapshot
import uvicorn

database=Database(os.environ["FETCHCV_DATABASE_URL"])
database.create_schema()
with database.session() as session:
    candidate=Candidate(id="t3-candidate",name="T3 合成验收同学")
    session.add(candidate)
    session.flush()
    snapshot,_=_normalize_editor_snapshot({"profile":{"name":candidate.name},"sections":[{"id":"experience","title":"项目经历","visible":True,"items":[{"id":"t3-item","body":"整理合成项目数据。","fields":{}}]}]})
    session.add(ResumeVersion(id="t3-base",candidate_id=candidate.id,name="T3 合成基础简历",source_fact_ids=[],content_json={"pdf_import_schema_version":PDF_IMPORT_SCHEMA_VERSION,"editor_snapshot":snapshot}))

api._job_posting_importer=lambda session:importer(session,"static")[0]
app=create_app(database)

@app.get("/fixture/inspect")
def inspect():
    with database.session() as session:
        return {"jobs":[{"id":job.id,"jd_raw":job.jd_raw,"context_json":job.context_json,"input_revision":job.input_revision,"jd_provenance":job.jd_provenance} for job in session.scalars(select(Job))],
                "materials":len(session.scalars(select(MaterialAsset)).all()),
                "briefs":[{"id":brief.id,"metadata_json":brief.metadata_json} for brief in session.scalars(select(InterviewBrief))]}

@app.post("/fixture/analysis/{job_id}")
def seed_analysis(job_id:str):
    with database.session() as session:
        job=session.get(Job,job_id)
        marker=current_analysis_marker(job)
        profile=session.scalar(select(JobProfile).where(JobProfile.job_id==job.id))
        if profile is None:
            profile=JobProfile(job_id=job.id)
            session.add(profile)
        profile.responsibilities=["合成旧岗位职责"]
        profile.keywords=["SQL"]
        profile.business_context=marker
        if session.get(ResumeVersion,"t3-old-draft") is None:
            base=session.get(ResumeVersion,"t3-base")
            session.add(ResumeVersion(id="t3-old-draft",candidate_id=job.candidate_id,job_id=job.id,name="T3 旧合成岗位草稿",content_json=base.content_json,source_fact_ids=[]))
            session.add(AgentRun(id="t3-old-run",candidate_id=job.candidate_id,job_id=job.id,run_type="job_resume",current_stage="ready_to_publish"))
        session.add(InterviewBrief(candidate_id=job.candidate_id,job_id=job.id,company=job.company,role=job.role,summary="旧简报不得继续作为当前成果",metadata_json=marker))
    return {"synthetic_analysis":True,"marker":marker}

@app.post("/fixture/new-profile/{job_id}")
def new_profile(job_id:str):
    from types import SimpleNamespace
    from applyos_agent.service import AgentService
    from applyos_agent.schemas import JDAnalysis
    class Suite:
        def analyze_jd(self,job,**_):
            return JDAnalysis(keywords=["新合成分析"]),SimpleNamespace(usage={},session_id=None,hook_events=[])
    with database.session() as session:
        profile=AgentService(session,suite=Suite()).analyze_job(session.get(Job,job_id))
        return {"synthetic_analysis":True,"business_context":profile.business_context}

sock=socket.socket()
sock.bind(("127.0.0.1",0))
(run_root/"api-address.json").write_text(json.dumps({"port":sock.getsockname()[1]}),encoding="utf-8")
uvicorn.Server(uvicorn.Config(app,log_level="warning")).run(sockets=[sock])
