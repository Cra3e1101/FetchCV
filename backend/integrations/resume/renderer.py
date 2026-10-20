from __future__ import annotations

import json
from dataclasses import dataclass
from html import escape
from pathlib import Path

from sqlalchemy.orm import Session

from applyos_domain.models import Candidate, ResumeVersion
from applyos_domain.paths import artifact_root
from applyos_harness.errors import HarnessError
from applyos_harness.versioning import VersionService


ARTIFACT_ROOT = artifact_root() / "resumes"


@dataclass
class ResumeArtifact:
    pdf_path: Path
    bridge_payload_path: Path
    page_count: int


class ResumeRenderer:
    """Render the same structured document used by the FetchCV resume studio."""

    def __init__(self, session: Session):
        self.session = session
        self.versions = VersionService(session)

    def render(self, resume: ResumeVersion, *, run_id: str) -> ResumeArtifact:
        self.versions.assert_mutable(resume)
        candidate = self.session.get(Candidate, resume.candidate_id)
        if candidate is None:
            raise HarnessError("candidate_not_found", "简历对应候选人不存在")
        target = (ARTIFACT_ROOT / resume.id).resolve()
        if not target.is_relative_to(ARTIFACT_ROOT.resolve()):
            raise HarnessError("path_outside_workspace", "简历产物路径越界")
        target.mkdir(parents=True, exist_ok=True)
        bridge_payload = {
            "source": "fetchcv-resume-studio-bridge",
            "resume_version_id": resume.id,
            "candidate": {"name": candidate.name, "title": candidate.title, "email": candidate.email, "phone": candidate.phone},
            "content": resume.content_json,
            "source_fact_ids": resume.source_fact_ids,
        }
        bridge_path = target / "legacy-editor-payload.json"
        bridge_path.write_text(json.dumps(bridge_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        pdf_path = target / "resume.pdf"
        self._render_pdf(pdf_path, candidate, resume)
        self.versions.snapshot_entity(resume, run_id=run_id, reason="before:attach rendered pdf")
        resume.pdf_path = str(pdf_path)
        self.session.flush()
        self.versions.snapshot_entity(resume, run_id=run_id, reason="after:attach rendered pdf")
        return ResumeArtifact(pdf_path=pdf_path, bridge_payload_path=bridge_path, page_count=1)

    @staticmethod
    def _render_pdf(path: Path, candidate: Candidate, resume: ResumeVersion) -> None:
        from reportlab.lib import colors
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.cidfonts import UnicodeCIDFont
        from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

        font_name = "STSong-Light"
        try:
            pdfmetrics.registerFont(UnicodeCIDFont(font_name))
        except Exception:
            font_name = "Helvetica"
        styles = getSampleStyleSheet()
        title = ParagraphStyle("FetchCVTitle", parent=styles["Title"], fontName=font_name, fontSize=22, leading=28, textColor=colors.HexColor("#141413"), alignment=TA_LEFT, spaceAfter=4)
        meta = ParagraphStyle("FetchCVMeta", parent=styles["BodyText"], fontName=font_name, fontSize=9.5, leading=14, textColor=colors.HexColor("#6c6a64"), spaceAfter=12)
        section = ParagraphStyle("FetchCVSection", parent=styles["Heading2"], fontName=font_name, fontSize=12, leading=16, textColor=colors.HexColor("#a9583e"), spaceBefore=10, spaceAfter=5)
        item_meta = ParagraphStyle("FetchCVItemMeta", parent=styles["BodyText"], fontName=font_name, fontSize=10.5, leading=14, textColor=colors.HexColor("#1f1e1c"), spaceBefore=3, spaceAfter=3)
        body = ParagraphStyle("FetchCVBody", parent=styles["BodyText"], fontName=font_name, fontSize=10.2, leading=15, textColor=colors.HexColor("#35322e"), leftIndent=9, firstLineIndent=-9, bulletIndent=0, spaceAfter=4)
        doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm, title=resume.name)
        story = [Paragraph(escape(candidate.name), title)]
        contact = " · ".join(part for part in [candidate.title, candidate.email, candidate.phone, candidate.location] if part)
        if contact:
            story.append(Paragraph(escape(contact), meta))
        snapshot = resume.content_json.get("editor_snapshot") or {}
        for block in snapshot.get("sections", []):
            if block.get("visible") is False:
                continue
            story.append(Paragraph(escape(str(block.get("title") or block.get("tab") or "经历")), section))
            for item in block.get("items", []):
                left = str(item.get("metaLeft") or "").strip()
                right = str(item.get("metaRight") or "").strip()
                meta_text = "　".join(part for part in [left, right] if part)
                if meta_text:
                    story.append(Paragraph(escape(meta_text), item_meta))
                lines = [line.strip(" •·") for line in str(item.get("body") or "").splitlines() if line.strip(" •·")]
                for line in lines:
                    story.append(Paragraph("• " + escape(line), body))
        if not snapshot.get("sections"):
            story.append(Paragraph("简历草稿尚未形成完整结构。", body))
        doc.build(story)
