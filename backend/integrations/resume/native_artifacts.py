"""One immutable XeLaTeX artifact shared by preview and verified export."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import hashlib
from pathlib import Path
import re
import threading
import unicodedata

from pypdf import PdfReader
from sqlalchemy import select

from applyos_domain.models import AgentRun
from applyos_domain.paths import artifact_root
from applyos_harness.errors import HarnessError
from applyos_harness.gates import PublishGate, require_resume_exportable, resume_semantic_payload
from applyos_harness.validation import normalized_excerpt
from integrations.resume.docx_export import _plain
from integrations.resume.latex_renderer import RENDERER_NAME as RENDERER, RENDERER_VERSION, document_fingerprint
from applyos_harness.versioning import VersionService, canonical_hash

_compile_lock = threading.Lock()


@dataclass(frozen=True)
class NativeArtifact:
    path: Path
    pages: int
    layout_hash: str
    sha256: str


def _pdf_prose(value: str) -> str:
    # The fixed renderer typesets R^2 / R² as raised glyphs; PDF text extraction
    # drops their vertical position. Normalize only that explicit math notation.
    value = unicodedata.normalize("NFKC", value)
    value = re.sub(r"([A-Za-z])\^([0-9]+)", r"\1\2", value)
    return normalized_excerpt(value)


def _require_pdf_prose(reader, snapshot: dict) -> None:
    """Preserve words while accommodating glyph-spacing extraction differences."""
    plain = _pdf_prose("\n".join(page.extract_text() or "" for page in reader.pages))
    missing = []
    for section in snapshot.get("sections", []):
        if section.get("visible") is False:
            continue
        for item in section.get("items", []):
            body = _plain(item.get("body") or item.get("description") or item.get("summary") or "")
            for paragraph in body.splitlines():
                prose = _pdf_prose(paragraph.strip(" •·▪◦"))
                if prose and prose not in plain:
                    missing.append(prose)
    if not missing:
        return
    # Plain extraction can insert spaces inside kerned Termes words (T ableau).
    # Layout extraction recovers those words, while plain extraction preserves
    # math superscript order. Neither view discards actual word boundaries.
    layout = _pdf_prose("\n".join(page.extract_text(extraction_mode="layout", layout_mode_space_vertically=False) or "" for page in reader.pages))
    if any(prose not in layout for prose in missing):
        raise HarnessError("resume_pdf_text_unverified", "排版未完整保留当前正文，请检查文字与特殊符号后重试")


def preview_artifact(resume) -> NativeArtifact:
    from integrations.resume.latex_renderer import compile_snapshot

    snapshot = deepcopy((resume.content_json or {}).get("editor_snapshot"))
    if not isinstance(snapshot, dict) or not isinstance(snapshot.get("profile"), dict) or not isinstance(snapshot.get("sections"), list):
        raise HarnessError("resume_snapshot_missing", "当前简历缺少可排版内容，请重新导入或保存后重试")
    try:
        key = document_fingerprint(snapshot)
    except (RuntimeError, ValueError, OSError) as error:
        raise HarnessError("resume_latex_failed", str(error)) from error
    root = (artifact_root() / "resumes").resolve()
    folder = (root / resume.id / "previews").resolve()
    if not folder.is_relative_to(root):
        raise HarnessError("path_outside_workspace", "简历预览路径无效")
    path = folder / f"{key}.pdf"
    with _compile_lock:
        if not path.is_file():
            folder.mkdir(parents=True, exist_ok=True)
            try:
                compile_snapshot(snapshot, path)
            except (RuntimeError, ValueError, OSError) as error:
                raise HarnessError("resume_latex_failed", str(error)) from error
        try:
            payload = path.read_bytes()
            pages = len(PdfReader(path).pages)
            if not payload.startswith(b"%PDF") or not 1 <= pages <= 100 or len(payload) > 25 * 1024 * 1024:
                raise ValueError("invalid artifact")
        except Exception as error:
            path.unlink(missing_ok=True)
            raise HarnessError("resume_latex_failed", "排版文件不完整，请重新生成") from error
    return NativeArtifact(path, pages, key, hashlib.sha256(payload).hexdigest())


def attach_verified_artifact(session, resume, artifact: NativeArtifact, *, expected_hash: str, run_id: str | None = None):
    # Compilation can outlive an editor save. Never attach output to a newer revision.
    session.expire_all()
    session.refresh(resume)
    VersionService(session).assert_mutable(resume)
    require_resume_exportable(session, resume)
    if (expected_hash != canonical_hash(resume.content_json)
            and document_fingerprint(resume.content_json.get("editor_snapshot") or {}) != artifact.layout_hash):
        raise HarnessError("resume_pdf_revision_mismatch", "排版期间简历已修改，请重新导出")
    payload = artifact.path.read_bytes()
    if hashlib.sha256(payload).hexdigest() != artifact.sha256:
        raise HarnessError("resume_pdf_invalid", "排版文件已变化，请重新生成")
    # Native output comes from our escaped, fixed template, not arbitrary client
    # PDF bytes. Verify the complete visible prose; template labels/date glyphs
    # may differ without altering a claim. The client-upload gate is unchanged.
    _require_pdf_prose(PdfReader(artifact.path), resume.content_json.get("editor_snapshot", {}))
    versions = VersionService(session)
    versions.snapshot_entity(resume, run_id=run_id, reason="before:attach native latex pdf")
    # Use the immutable preview file itself, guaranteeing byte-for-byte identity.
    content = dict(resume.content_json or {})
    content.update({"page_count": artifact.pages, "pdf_renderer": RENDERER, "pdf_renderer_version": RENDERER_VERSION,
                    "pdf_semantic_hash": canonical_hash(resume_semantic_payload(content)), "pdf_sha256": artifact.sha256,
                    "pdf_layout_hash": artifact.layout_hash})
    resume.content_json = content
    resume.content_hash = canonical_hash(content)
    resume.pdf_path = str(artifact.path)
    run = session.get(AgentRun, run_id) if run_id else session.scalar(select(AgentRun).where(
        AgentRun.candidate_id == resume.candidate_id, AgentRun.job_id == resume.job_id
    ).order_by(AgentRun.created_at.desc()))
    if run is None:
        run = AgentRun(candidate_id=resume.candidate_id, job_id=resume.job_id, run_type="artifact_validation")
        session.add(run)
        session.flush()
    quality = PublishGate(session).evaluate_resume(run=run, resume=resume, pdf_generated=True, page_count=artifact.pages, artifact_required=True)
    quality.checks = [*quality.checks, {"code": "artifact_revision", "passed": True, "details": {
        "content_hash": resume.content_hash, "pdf_sha256": artifact.sha256, "layout_hash": artifact.layout_hash,
    }}]
    versions.snapshot_entity(resume, run_id=run_id, reason="after:attach native latex pdf")
    session.flush()
    return quality
