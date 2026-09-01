import pytest
from sqlalchemy import func, select

from applyos_domain.enums import AssetStatus
from applyos_domain.models import AgentRun, Candidate, ResumeVersion, VersionSnapshot
from applyos_harness.errors import HarnessError
from applyos_harness.versioning import VersionService


def test_write_creates_before_and_after_snapshots_and_frozen_version_cannot_change(database):
    with database.session() as session:
        candidate = Candidate(name="版本测试")
        session.add(candidate)
        session.flush()
        resume = ResumeVersion(candidate_id=candidate.id, name="v1", content_json={"claims": []})
        session.add(resume)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, run_type="test", current_stage="draft_generating")
        session.add(run)
        session.flush()
        service = VersionService(session)
        service.update_resume(resume, content_json={"claims": [{"text": "真实内容", "fact_ids": []}]}, source_fact_ids=[], run_id=run.id, reason="test")
        assert session.scalar(select(func.count()).select_from(VersionSnapshot).where(VersionSnapshot.target_id == resume.id)) == 2
        service.freeze(resume, run_id=run.id)
        assert resume.status == AssetStatus.FROZEN
        assert resume.frozen_at is not None
        with pytest.raises(HarnessError) as error:
            service.update_resume(resume, content_json={}, source_fact_ids=[], run_id=run.id, reason="forbidden")
        assert error.value.code == "frozen_version"
