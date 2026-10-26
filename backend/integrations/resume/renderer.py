from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path

from sqlalchemy.orm import Session

from applyos_domain.models import Candidate, ResumeVersion
from applyos_domain.paths import artifact_root
from applyos_harness.errors import HarnessError
from applyos_harness.gates import require_resume_exportable
from applyos_harness.versioning import VersionService, canonical_hash
from integrations.resume.native_artifacts import preview_artifact, attach_verified_artifact

ARTIFACT_ROOT = artifact_root() / "resumes"


@dataclass
class ResumeArtifact:
    pdf_path: Path
    bridge_payload_path: Path
    page_count: int


class ResumeRenderer:
    """Publish the exact XeLaTeX file used by the resume preview."""

    def __init__(self, session: Session):
        self.session = session
        self.versions = VersionService(session)

    def render(self, resume: ResumeVersion, *, run_id: str) -> ResumeArtifact:
        self.versions.assert_mutable(resume)
        require_resume_exportable(self.session, resume)
        if self.session.get(Candidate, resume.candidate_id) is None:
            raise HarnessError("candidate_not_found", "简历对应候选人不存在")
        self.session.flush()
        expected_hash = canonical_hash(resume.content_json)
        artifact = preview_artifact(resume)
        bridge_path = artifact.path.with_suffix(".json")
        bridge_path.write_text(json.dumps({"source": "fetchcv-native-latex", "resume_version_id": resume.id,
                                          "layout_hash": artifact.layout_hash}, ensure_ascii=False), encoding="utf-8")
        attach_verified_artifact(self.session, resume, artifact, expected_hash=expected_hash, run_id=run_id)
        return ResumeArtifact(artifact.path, bridge_path, artifact.pages)

    @staticmethod
    def _render_pdf(path: Path, candidate: Candidate, resume: ResumeVersion) -> int:
        from integrations.resume.latex_renderer import compile_snapshot
        snapshot = (resume.content_json or {}).get("editor_snapshot")
        if not snapshot:
            raise HarnessError("resume_snapshot_missing", "当前简历缺少可排版内容，请重新保存后重试")
        return compile_snapshot(snapshot, path)
