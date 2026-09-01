from applyos_domain.enums import AssetStatus, FactSourceType
from applyos_domain.models import Candidate, Experience, Fact, Job, ResumeVersion
from integrations.resume.editor_schema import build_editor_snapshot


def test_job_resume_revision_preserves_unedited_blocks_and_template(database):
    with database.session() as session:
        candidate = Candidate(name="完整经历测试")
        session.add(candidate)
        session.flush()

        education = Experience(
            candidate_id=candidate.id,
            kind="education",
            title="中南财经政法大学",
            organization="中南财经政法大学",
            role="统计学硕士",
            start_date="2024-09",
            end_date="2027-06",
            summary="统计学硕士",
            sort_order=0,
        )
        work = Experience(
            candidate_id=candidate.id,
            kind="experience",
            title="数据分析实习",
            organization="甲公司",
            role="产品实习生",
            start_date="2026-03",
            end_date="2026-06",
            summary="原始第一条\n原始第二条",
            sort_order=1,
        )
        session.add_all([education, work])
        session.flush()

        education_fact = Fact(
            candidate_id=candidate.id,
            subject_type="experience",
            subject_id=education.id,
            category="education",
            content="中南财经政法大学 统计学硕士",
            normalized_value={"experience_id": education.id},
            source_type=FactSourceType.DOCUMENT_IMPORT,
            verified=True,
        )
        first_fact = Fact(
            candidate_id=candidate.id,
            subject_type="experience",
            subject_id=work.id,
            category="experience",
            content="原始第一条",
            normalized_value={"experience_id": work.id},
            source_type=FactSourceType.DOCUMENT_IMPORT,
            verified=True,
        )
        second_fact = Fact(
            candidate_id=candidate.id,
            subject_type="experience",
            subject_id=work.id,
            category="experience",
            content="原始第二条",
            normalized_value={"experience_id": work.id},
            source_type=FactSourceType.DOCUMENT_IMPORT,
            verified=True,
        )
        session.add_all([education_fact, first_fact, second_fact])
        session.flush()

        base_snapshot = {
            "schema": 6,
            "template": "custom-template",
            "settings": {"fontSize": 16, "customAccent": "#123456"},
            "profile": {"name": "完整经历测试", "phone": "13800000000"},
            "sections": [
                {
                    "id": "education",
                    "title": "教育背景",
                    "items": [{"id": "education-item-1", "metaLeft": "2024-09 ~ 2027-06", "metaRight": "中南财经政法大学 统计学硕士", "body": "中南财经政法大学 统计学硕士", "fields": {"school": "中南财经政法大学"}}],
                },
                {
                    "id": "internship",
                    "title": "工作与实习",
                    "items": [{"id": "internship-item-1", "metaLeft": "2026-03 ~ 2026-06", "metaRight": "甲公司  产品实习生", "body": "原始第一条\n原始第二条", "fields": {"company": "甲公司", "role": "产品实习生"}}],
                },
            ],
        }
        session.add(ResumeVersion(
            candidate_id=candidate.id,
            job_id=None,
            name="基础简历",
            status=AssetStatus.DRAFT,
            content_json={"editor_snapshot": base_snapshot},
        ))
        job = Job(candidate_id=candidate.id, company="乙公司", role="数据分析师", jd_raw="负责数据分析")
        session.add(job)
        session.flush()

        snapshot, strategy = build_editor_snapshot(
            session,
            candidate=candidate,
            job=job,
            facts=[education_fact, first_fact, second_fact],
            text_overrides={first_fact.id: "岗位化后的数据分析表述"},
            strategy_override={
                "positioning": "以业务指标分析为主线，保留产品判断作为辅助能力",
                "section_order": ["summary", "projects", "internship", "skills"],
                "warnings": ["不扩写没有事实支撑的业务结果"],
            },
        )

        education_item = snapshot["sections"][0]["items"][0]
        work_item = snapshot["sections"][1]["items"][0]
        assert snapshot["template"] == "custom-template"
        assert snapshot["settings"] == base_snapshot["settings"]
        assert education_item["body"] == "中南财经政法大学 统计学硕士"
        assert work_item["body"] == "岗位化后的数据分析表述\n原始第二条"
        assert work_item["fields"] == base_snapshot["sections"][1]["items"][0]["fields"]
        assert strategy["positioning"] == "以业务指标分析为主线，保留产品判断作为辅助能力"
        assert strategy["section_order"][:4] == ["summary", "project", "experience", "skill"]
        assert strategy["strategy_source"] == "model"
        assert strategy["experience_plan"]
        assert strategy["selected_fact_ids"] == sorted([education_fact.id, first_fact.id, second_fact.id])
