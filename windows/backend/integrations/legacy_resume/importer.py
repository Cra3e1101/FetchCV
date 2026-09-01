from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from datetime import datetime
from html import unescape
from pathlib import Path
from typing import Any

from sqlalchemy import select

from applyos_domain.database import Database
from applyos_domain.enums import AssetStatus, FactSourceType
from applyos_domain.models import Application, Candidate, Fact, Job, ResumeVersion
from applyos_domain.repositories import CandidateRepository, FactRepository, JobRepository, ResumeVersionRepository


@dataclass
class ImportReport:
    source_path: str
    source_sha256: str
    candidates_created: int = 0
    jobs_created: int = 0
    applications_created: int = 0
    resume_versions_created: int = 0
    facts_created: int = 0
    skipped_existing: int = 0
    warnings: list[str] = field(default_factory=list)

    def model_dump(self) -> dict[str, Any]:
        return asdict(self)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _plain_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = re.sub(r"<br\s*/?>", "\n", value, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return re.sub(r"[ \t]+", " ", unescape(text)).strip()


def _content_hash(payload: Any) -> str:
    canonical = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class LegacyWorkspaceImporter:
    """Read-only adapter for resume-editor-prototype workspace exports.

    The source file is opened only for reading. Imported facts deliberately remain
    unverified so the ApplyOS fact-lock flow can ask the user to confirm them.
    """

    def __init__(self, database: Database):
        self.database = database

    def preview(self, source_path: str | Path) -> dict[str, int | str]:
        path, raw, payload = self._read(source_path)
        workbench = payload.get("workbench") or {}
        return {
            "source_path": str(path),
            "source_sha256": hashlib.sha256(raw).hexdigest(),
            "candidates": len(workbench.get("candidates") or []),
            "versions": len(workbench.get("versions") or []),
            "applications": len(workbench.get("applications") or []),
        }

    def import_file(self, source_path: str | Path) -> ImportReport:
        path, raw, payload = self._read(source_path)
        report = ImportReport(source_path=str(path), source_sha256=hashlib.sha256(raw).hexdigest())
        workbench = payload.get("workbench") or {}
        candidates = workbench.get("candidates") or []
        versions = workbench.get("versions") or []
        applications = workbench.get("applications") or []

        if payload.get("source") != "resume-editor-prototype":
            report.warnings.append("source 标识不是 resume-editor-prototype，已按兼容格式尝试导入。")

        latest_by_candidate = self._latest_versions(versions)
        with self.database.session() as session:
            candidate_repo = CandidateRepository(session)
            fact_repo = FactRepository(session)
            job_repo = JobRepository(session)
            resume_repo = ResumeVersionRepository(session)
            candidate_map: dict[str, Candidate] = {}
            resume_map: dict[str, ResumeVersion] = {}

            for item in candidates:
                legacy_id = str(item.get("id") or "").strip()
                if not legacy_id:
                    report.warnings.append("跳过缺少 id 的候选人。")
                    continue
                candidate = candidate_repo.by_legacy_id(legacy_id)
                latest = latest_by_candidate.get(legacy_id) or {}
                profile = (latest.get("snapshot") or {}).get("profile") or {}
                if candidate is None:
                    candidate = candidate_repo.add(
                        Candidate(
                            legacy_id=legacy_id,
                            name=str(item.get("name") or profile.get("name") or "未命名候选人"),
                            title=str(latest.get("targetRole") or item.get("note") or "") or None,
                            email=str(profile.get("email") or "") or None,
                            phone=str(profile.get("phone") or "") or None,
                        )
                    )
                    report.candidates_created += 1
                else:
                    report.skipped_existing += 1
                candidate_map[legacy_id] = candidate

            for item in versions:
                legacy_id = str(item.get("id") or "").strip()
                candidate = candidate_map.get(str(item.get("candidateId") or ""))
                if not legacy_id or candidate is None:
                    report.warnings.append(f"跳过无法关联候选人的简历版本：{legacy_id or '<missing-id>'}")
                    continue
                resume = resume_repo.by_legacy_id(legacy_id)
                if resume is None:
                    snapshot = item.get("snapshot") or {}
                    resume = resume_repo.add(
                        ResumeVersion(
                            legacy_id=legacy_id,
                            candidate_id=candidate.id,
                            name=str(item.get("name") or "导入简历"),
                            status=AssetStatus.DRAFT,
                            content_json=snapshot,
                            content_hash=_content_hash(snapshot),
                            created_at=_parse_datetime(item.get("createdAt")) or datetime.now().astimezone(),
                            updated_at=_parse_datetime(item.get("updatedAt")) or datetime.now().astimezone(),
                        )
                    )
                    report.resume_versions_created += 1
                else:
                    report.skipped_existing += 1
                resume_map[legacy_id] = resume

            for item in applications:
                app_legacy_id = str(item.get("id") or "").strip()
                candidate = candidate_map.get(str(item.get("candidateId") or ""))
                if not app_legacy_id or candidate is None:
                    report.warnings.append(f"跳过无法关联候选人的投递：{app_legacy_id or '<missing-id>'}")
                    continue
                job_legacy_id = f"legacy-job:{app_legacy_id}"
                job = job_repo.by_legacy_id(job_legacy_id)
                if job is None:
                    job = job_repo.add(
                        Job(
                            legacy_id=job_legacy_id,
                            candidate_id=candidate.id,
                            company=str(item.get("company") or "未知公司"),
                            role=str(item.get("role") or "未知岗位"),
                            source_type="legacy_resume_workspace",
                            status=str(item.get("status") or "draft"),
                        )
                    )
                    report.jobs_created += 1
                else:
                    report.skipped_existing += 1

                existing_application = session.scalar(select(Application).where(Application.legacy_id == app_legacy_id))
                if existing_application is None:
                    current_timeline = next((step for step in item.get("timeline") or [] if step.get("state") == "current"), {})
                    submitted_step = next((step for step in item.get("timeline") or [] if step.get("key") == "apply"), {})
                    session.add(
                        Application(
                            legacy_id=app_legacy_id,
                            candidate_id=candidate.id,
                            job_id=job.id,
                            resume_version_id=getattr(resume_map.get(str(item.get("versionId") or "")), "id", None),
                            status=str(item.get("status") or current_timeline.get("label") or "planned"),
                            submitted_at=_parse_datetime(submitted_step.get("at")),
                            next_action=str(item.get("next") or "") or None,
                            notes=json.dumps(item.get("timeline") or [], ensure_ascii=False),
                        )
                    )
                    report.applications_created += 1
                else:
                    report.skipped_existing += 1

            for legacy_candidate_id, version in latest_by_candidate.items():
                candidate = candidate_map.get(legacy_candidate_id)
                if candidate is None:
                    continue
                report.facts_created += self._import_version_facts(candidate, version, fact_repo, path)

        return report

    @staticmethod
    def _read(source_path: str | Path) -> tuple[Path, bytes, dict[str, Any]]:
        path = Path(source_path).expanduser().resolve(strict=True)
        if not path.is_file():
            raise ValueError("legacy workspace path must be a file")
        raw = path.read_bytes()
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("legacy workspace root must be an object")
        return path, raw, payload

    @staticmethod
    def _latest_versions(versions: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        latest: dict[str, dict[str, Any]] = {}
        for version in versions:
            candidate_id = str(version.get("candidateId") or "")
            if not candidate_id:
                continue
            if candidate_id not in latest or str(version.get("updatedAt") or "") > str(latest[candidate_id].get("updatedAt") or ""):
                latest[candidate_id] = version
        return latest

    @staticmethod
    def _import_version_facts(candidate: Candidate, version: dict[str, Any], fact_repo: FactRepository, source_path: Path) -> int:
        created = 0
        legacy_version_id = str(version.get("id") or "unknown")
        snapshot = version.get("snapshot") or {}
        profile = snapshot.get("profile") or {}
        for field_name, value in profile.items():
            if field_name in {"photo", "showPhoto", "custom"} or value in (None, "", [], {}):
                continue
            key = f"{legacy_version_id}:profile:{field_name}"
            if fact_repo.by_legacy_source_key(key) is None:
                fact_repo.add(
                    Fact(
                        candidate_id=candidate.id,
                        category=f"profile.{field_name}",
                        content=str(value),
                        source_type=FactSourceType.LEGACY_IMPORT,
                        source_reference=f"{source_path}#version={legacy_version_id}",
                        legacy_source_key=key,
                        verified=False,
                    )
                )
                created += 1

        for section in snapshot.get("sections") or []:
            section_id = str(section.get("id") or section.get("sectionType") or "section")
            for item in section.get("items") or []:
                item_id = str(item.get("id") or _content_hash(item)[:12])
                body = _plain_text(item.get("body"))
                fields = item.get("fields") or {}
                content = body or json.dumps(fields, ensure_ascii=False, sort_keys=True)
                if not content or content == "{}":
                    continue
                key = f"{legacy_version_id}:section:{section_id}:{item_id}"
                if fact_repo.by_legacy_source_key(key) is not None:
                    continue
                fact_repo.add(
                    Fact(
                        candidate_id=candidate.id,
                        subject_type="resume_section",
                        subject_id=section_id,
                        category=str(section.get("sectionType") or section_id),
                        content=content,
                        normalized_value={"fields": fields, "section_title": section.get("title")},
                        source_type=FactSourceType.LEGACY_IMPORT,
                        source_reference=f"{source_path}#version={legacy_version_id}&section={section_id}&item={item_id}",
                        legacy_source_key=key,
                        verified=False,
                    )
                )
                created += 1
        return created
