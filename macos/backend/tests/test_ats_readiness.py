from applyos_agent.ats import AtsReadinessEvaluator
from applyos_domain.enums import QualityStatus
from applyos_domain.models import AgentRun, Candidate, Job, JobProfile, QualityReport, ResumeVersion


def test_ats_readiness_is_explainable_coverage_not_pass_probability(database):
    with database.session() as session:
        candidate = Candidate(name="测试候选人")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="目标公司", role="数据分析师", jd_raw="岗位要求：熟练使用 SQL 进行业务数据分析；熟悉 Python。")
        session.add(job)
        session.flush()
        profile = JobProfile(
            job_id=job.id,
            hard_requirements=["熟练使用 SQL 进行业务数据分析", "熟悉 Python"],
            keywords=["SQL", "Python", "数据分析"],
            competencies=["业务分析"],
        )
        run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="resume")
        resume = ResumeVersion(
            candidate_id=candidate.id,
            job_id=job.id,
            name="岗位简历",
            content_json={
                "editor_snapshot": {
                    "profile": {"name": "测试候选人"},
                    "sections": [
                        {"id": "education", "items": [{"body": "统计学硕士"}]},
                        {"id": "experience", "items": [{"body": "使用 SQL 完成业务数据分析与监控"}]},
                        {"id": "skills", "items": [{"body": "SQL、Excel"}]},
                    ],
                }
            },
        )
        session.add_all([profile, run, resume])
        session.flush()
        session.add(QualityReport(run_id=run.id, target_type="resume", target_id=resume.id, status=QualityStatus.PASSED))
        session.flush()

        result = AtsReadinessEvaluator(session).evaluate(job=job, run=run, resume=resume)

        assert result["coverage_percent"] < 100
        assert any(item["text"] == "SQL" and item["matched"] for item in result["keywords"])
        assert any(item["text"] == "Python" and not item["matched"] for item in result["keywords"])
        assert any(item["support_status"] == "supported" for item in result["requirements"])
        assert any(item["support_status"] == "unsupported" for item in result["requirements"])
        assert all(item["requirement_id"].startswith("req_") for item in result["requirements"])
        assert len({item["requirement_id"] for item in result["requirements"]}) == len(result["requirements"])
        sql_requirement = next(item for item in result["requirements"] if "SQL" in item["text"])
        assert sql_requirement["jd_context"]["match"] == "熟练使用 SQL 进行业务数据分析"
        assert sql_requirement["resume_evidence"][0]["section_id"] == "experience"
        assert sql_requirement["resume_evidence"][0]["matched_terms"] == ["SQL", "数据分析"]
        assert "使用 SQL 完成业务数据分析" in sql_requirement["resume_evidence"][0]["snippet"]
        assert "Python" in result["gaps"]
        assert "不代表任何招聘系统的通过概率" in result["disclaimer"]


def test_ats_readiness_waits_for_profile_and_resume(database):
    with database.session() as session:
        candidate = Candidate(name="测试候选人")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="目标公司", role="产品经理", jd_raw="负责产品规划")
        session.add(job)
        session.flush()

        result = AtsReadinessEvaluator(session).evaluate(job=job, run=None, resume=None)

        assert result["status"] == "not_ready"
        assert result["coverage_percent"] is None
