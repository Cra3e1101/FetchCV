from __future__ import annotations

from sqlalchemy import select

from applyos_agent.application_tools import register_application_tools
from applyos_domain.models import AgentRun, Candidate, Fact, Job, MaterialAsset, ResumeVersion
from applyos_harness.permissions import ToolGateway, ToolPermission


def _gateway(session, tmp_path):
    return register_application_tools(ToolGateway(session, workspace_root=tmp_path))


def _seed(session):
    candidate = Candidate(name="测试候选人")
    session.add(candidate)
    session.flush()
    fact = Fact(
        candidate_id=candidate.id,
        category="experience",
        content="在产品实习中使用 SQL 分析转化漏斗，并形成业务复盘建议",
        verified=True,
        allowed_outputs=["resume", "portfolio"],
    )
    job = Job(candidate_id=candidate.id, company="目标公司", role="数据分析师", jd_raw="负责使用 SQL 分析业务数据，并持续优化转化漏斗。")
    session.add_all([fact, job])
    session.flush()
    resume = ResumeVersion(
        candidate_id=candidate.id,
        job_id=job.id,
        name="岗位简历",
        content_json={"editor_snapshot": {"profile": {"name": candidate.name}, "sections": []}},
        source_fact_ids=[fact.id],
    )
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent", current_stage="ready_to_publish")
    session.add_all([resume, run])
    session.flush()
    return fact, job, resume, run


def test_cover_letter_is_saved_with_fact_and_jd_evidence(database, tmp_path):
    with database.session() as session:
        fact, job, resume, run = _seed(session)
        result = _gateway(session, tmp_path).execute(
            tool_name="save_cover_letter_draft",
            run=run,
            arguments={
                "title": "应聘数据分析师",
                "salutation": "尊敬的招聘团队：",
                "paragraphs": [
                    {"text": "我希望应聘贵公司的数据分析岗位，并理解该岗位强调业务数据分析能力。", "fact_ids": [fact.id], "jd_evidence": ["使用 SQL 分析业务数据"]},
                    {"text": "我曾在产品实习中使用 SQL 分析转化漏斗，并据此形成业务复盘建议。", "fact_ids": [fact.id], "jd_evidence": ["持续优化转化漏斗"]},
                ],
                "closing": "感谢阅读，期待进一步交流。",
                "signature": "测试候选人",
            },
            granted_permissions={ToolPermission.READ, ToolPermission.DRAFT_WRITE},
            idempotency_key="cover-letter-valid",
        )

        material = session.scalar(select(MaterialAsset).where(MaterialAsset.id == result["data"]["cover_letter_id"]))
        assert material is not None
        assert material.kind == "cover_letter"
        assert material.metadata_json["job_id"] == job.id
        assert material.metadata_json["resume_version_id"] == resume.id
        assert material.metadata_json["source_fact_ids"] == [fact.id]
        assert "SQL 分析转化漏斗" in material.metadata_json["content"]


def test_cover_letter_rejects_untraceable_jd_quote(database, tmp_path):
    with database.session() as session:
        fact, _, _, run = _seed(session)
        try:
            _gateway(session, tmp_path).execute(
                tool_name="save_cover_letter_draft",
                run=run,
                arguments={"paragraphs": [
                    {"text": "我理解岗位需要管理大型跨国团队，并愿意承担相关职责。", "fact_ids": [fact.id], "jd_evidence": ["管理大型跨国团队"]},
                    {"text": "我的产品实习经历能够支持我快速理解业务问题并开展分析。", "fact_ids": [fact.id], "jd_evidence": []},
                ]},
                granted_permissions={ToolPermission.DRAFT_WRITE},
                idempotency_key="cover-letter-invalid-jd",
            )
        except Exception as exc:
            assert getattr(exc, "code", "") == "jd_evidence_not_found"
        else:
            raise AssertionError("untraceable JD evidence must be rejected")


def test_cover_letter_rejects_number_not_supported_by_fact(database, tmp_path):
    with database.session() as session:
        fact, _, _, run = _seed(session)
        try:
            _gateway(session, tmp_path).execute(
                tool_name="save_cover_letter_draft",
                run=run,
                arguments={"paragraphs": [
                    {"text": "我在产品实习中使用 SQL 分析转化漏斗，并推动转化率提升 80%。", "fact_ids": [fact.id], "jd_evidence": []},
                    {"text": "这段经历让我能够从数据出发理解业务问题并形成复盘建议。", "fact_ids": [fact.id], "jd_evidence": []},
                ]},
                granted_permissions={ToolPermission.DRAFT_WRITE},
                idempotency_key="cover-letter-invalid-number",
            )
        except Exception as exc:
            assert getattr(exc, "code", "") == "cover_letter_fact_validation_failed"
        else:
            raise AssertionError("unsupported numbers must be rejected")
