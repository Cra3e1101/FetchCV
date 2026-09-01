import hashlib
import json
from pathlib import Path

from sqlalchemy import func, select

from applyos_domain.models import Application, Candidate, Fact, Job, ResumeVersion
from integrations.legacy_resume.importer import LegacyWorkspaceImporter


def _workspace() -> dict:
    return {
        "source": "resume-editor-prototype",
        "formatVersion": 1,
        "workbench": {
            "candidates": [{"id": "candidate-1", "name": "张三", "note": "主简历"}],
            "versions": [
                {
                    "id": "version-1",
                    "candidateId": "candidate-1",
                    "name": "数据分析版",
                    "targetRole": "数据分析师",
                    "createdAt": "2026-01-01T00:00:00.000Z",
                    "updatedAt": "2026-01-02T00:00:00.000Z",
                    "snapshot": {
                        "profile": {"name": "张三", "email": "z@example.com", "photo": ""},
                        "sections": [
                            {
                                "id": "experience",
                                "sectionType": "experience",
                                "title": "工作经历",
                                "items": [{"id": "exp-1", "body": "<strong>分析</strong> 100 万条数据", "fields": {"company": "甲公司"}}],
                            }
                        ],
                    },
                }
            ],
            "applications": [
                {
                    "id": "application-1",
                    "candidateId": "candidate-1",
                    "company": "乙公司",
                    "role": "商业分析师",
                    "status": "已投递",
                    "versionId": "version-1",
                    "next": "等待反馈",
                    "timeline": [{"key": "apply", "label": "投递", "state": "done", "at": "2026-01-03T00:00:00.000Z"}],
                }
            ],
        },
    }


def test_legacy_import_is_read_only_and_idempotent(database, tmp_path: Path):
    source = tmp_path / "workspace.json"
    source.write_text(json.dumps(_workspace(), ensure_ascii=False), encoding="utf-8")
    original = source.read_bytes()
    original_hash = hashlib.sha256(original).hexdigest()
    importer = LegacyWorkspaceImporter(database)

    preview = importer.preview(source)
    assert preview["source_sha256"] == original_hash
    first = importer.import_file(source)
    second = importer.import_file(source)

    assert source.read_bytes() == original
    assert first.candidates_created == 1
    assert first.resume_versions_created == 1
    assert first.jobs_created == 1
    assert first.applications_created == 1
    assert first.facts_created == 3
    assert second.candidates_created == 0
    assert second.resume_versions_created == 0
    assert second.jobs_created == 0
    assert second.applications_created == 0
    assert second.facts_created == 0

    with database.session() as session:
        assert session.scalar(select(func.count()).select_from(Candidate)) == 1
        assert session.scalar(select(func.count()).select_from(ResumeVersion)) == 1
        assert session.scalar(select(func.count()).select_from(Job)) == 1
        assert session.scalar(select(func.count()).select_from(Application)) == 1
        facts = session.scalars(select(Fact)).all()
        assert len(facts) == 3
        assert all(fact.verified is False for fact in facts)
        assert any(fact.content == "分析 100 万条数据" for fact in facts)
