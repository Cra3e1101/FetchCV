"""Synthetic reviewed resume, only in the smoke test's explicitly named DB."""
from __future__ import annotations

import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Fact, Job, ResumeVersion
from applyos_harness.validation import grounded_claim
from applyos_harness.gates import require_resume_exportable
from applyos_harness.versioning import canonical_hash
from integrations.resume.template import didi_settings

database_path = Path(sys.argv[1]).resolve()
if not database_path.parent.name.startswith("fetchcv-native-") or database_path.name != "smoke.sqlite":
    raise RuntimeError("The smoke seed requires its own temporary database")
database = Database(f"sqlite:///{database_path.as_posix()}")
database.create_schema()
snapshot = {
    "template": "didi", "settings": didi_settings(),
    "profile": {"name": "排版验收", "showPhoto": False},
    "sections": [
        {"id": "education", "title": "教育背景", "tab": "教育背景", "visible": True, "items": [{"id": "edu", "fields": {"school": "示例大学", "major": "数量经济学", "degree": "硕士", "timeRange": {"start": "2024-09", "end": "2027-06"}}, "body": "• 数据分析、统计建模与研究方法。"}]},
        {"id": "internship", "title": "实习经历", "tab": "实习经历", "visible": True, "items": [{"id": "work", "fields": {"company": "远山科技有限公司", "role": "策略运营", "timeRange": {"start": "2026-07", "end": "至今"}}, "body": "• 跟踪业务指标并维护运营看板。\n• 协同团队完成策略分析与方案迭代。"}]},
        {"id": "project", "title": "项目经历", "tab": "项目经历", "visible": True, "items": [{"id": "project", "fields": {"projectName": "多源数据融合视角下的无人驾驶技术消费者意愿研究", "role": "研究负责人", "timeRange": {"start": "2025-06", "end": "2025-10"}}, "body": "• 整理问卷与公开文本，分析影响用户决策的因素。"}]},
        {"id": "skills", "title": "专业技能", "tab": "专业技能", "visible": True, "items": [{"id": "skills", "fields": {}, "body": "数据分析：SQL | Python | Excel\n项目协作：资料整理与研究报告"}]},
    ],
}
for section in snapshot["sections"]:
    for item in section["items"]:
        date_range = item["fields"].setdefault("timeRange", {"start": "", "end": ""})
        date_range["current"] = date_range["end"] == "至今"
        if date_range["current"]:
            date_range["end"] = ""
proofs = set()
def collect(value):
    if isinstance(value, dict):
        for child in value.values():
            collect(child)
    elif isinstance(value, str) and value:
        proofs.add(value)
for section in snapshot["sections"]:
    for item in section["items"]:
        collect(item["fields"])
        if item["fields"].get("timeRange", {}).get("current"):
            proofs.add("至今")
        for line in item["body"].splitlines():
            proofs.add(line.lstrip("• "))
with database.session() as session:
    candidate = Candidate(name="排版验收")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="远山科技", role="策略运营", jd_raw="分析业务指标并支持策略迭代。")
    session.add(job)
    facts = [Fact(candidate_id=candidate.id, category="experience", content=value, verified=True, version=1, allowed_outputs=["resume"]) for value in sorted(proofs)]
    session.add_all(facts)
    session.flush()
    content = {"pdf_import_schema_version": 3, "verification_status": "verified", "editor_snapshot": snapshot, "claims": [grounded_claim(fact).model_dump(mode="json") for fact in facts]}
    resume = ResumeVersion(candidate_id=candidate.id, job_id=job.id, name="原生排版验收", content_json=content, content_hash=canonical_hash(content), source_fact_ids=[fact.id for fact in facts])
    session.add(resume)
    session.flush()
    require_resume_exportable(session, resume)
    chinese = lambda value: "".join(character for character in value if "\u4e00" <= character <= "\u9fff")
    expected_chinese = {chinese(value) for value in proofs if chinese(value)}
    expected_chinese.update(chinese(section["title"]) for section in snapshot["sections"])
    expected_chinese.add(chinese(snapshot["profile"]["name"]))
    result = {"resumeId": resume.id, "jobId": job.id, "candidateId": candidate.id,
              "expectedChinese": sorted(expected_chinese)}
print(json.dumps(result))
