from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.inspection import inspect
from sqlalchemy.orm import Session

from applyos_domain.enums import AssetStatus
from applyos_domain.models import PortfolioVersion, ResumeVersion, VersionSnapshot

from .errors import HarnessError


def canonical_hash(payload: Any) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def model_payload(entity: Any) -> dict[str, Any]:
    return {column.key: _json_value(getattr(entity, column.key)) for column in inspect(entity).mapper.column_attrs}


def _json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    return value


class VersionService:
    def __init__(self, session: Session):
        self.session = session

    def snapshot(self, *, target_type: str, target_id: str, payload: dict[str, Any], run_id: str | None, reason: str) -> VersionSnapshot:
        maximum = self.session.scalar(
            select(func.max(VersionSnapshot.sequence)).where(
                VersionSnapshot.target_type == target_type,
                VersionSnapshot.target_id == target_id,
            )
        )
        snapshot = VersionSnapshot(
            target_type=target_type,
            target_id=target_id,
            run_id=run_id,
            sequence=int(maximum or 0) + 1,
            payload=payload,
            content_hash=canonical_hash(payload),
            reason=reason,
        )
        self.session.add(snapshot)
        self.session.flush()
        return snapshot

    def snapshot_entity(self, entity: Any, *, run_id: str | None, reason: str) -> VersionSnapshot:
        return self.snapshot(target_type=entity.__tablename__, target_id=entity.id, payload=model_payload(entity), run_id=run_id, reason=reason)

    @staticmethod
    def assert_mutable(entity: ResumeVersion | PortfolioVersion) -> None:
        if entity.status == AssetStatus.FROZEN or entity.frozen_at is not None:
            raise HarnessError("frozen_version", "冻结版本禁止覆盖", details={"version_id": entity.id})

    def update_resume(self, resume: ResumeVersion, *, content_json: dict[str, Any], source_fact_ids: list[str], run_id: str, reason: str) -> ResumeVersion:
        self.assert_mutable(resume)
        self.snapshot_entity(resume, run_id=run_id, reason=f"before:{reason}")
        resume.content_json = content_json
        resume.source_fact_ids = source_fact_ids
        resume.content_hash = canonical_hash(content_json)
        self.session.flush()
        self.snapshot_entity(resume, run_id=run_id, reason=f"after:{reason}")
        return resume

    def restore_snapshot(self, snapshot: VersionSnapshot, *, run_id: str) -> ResumeVersion | PortfolioVersion:
        models = {"resume_versions": ResumeVersion, "portfolio_versions": PortfolioVersion}
        model = models.get(snapshot.target_type)
        if model is None:
            raise HarnessError("snapshot_target_unsupported", "该快照类型不支持自动回滚")
        target = self.session.get(model, snapshot.target_id)
        if target is None:
            raise HarnessError("snapshot_target_not_found", "快照对应的版本不存在")
        self.assert_mutable(target)
        self.snapshot_entity(target, run_id=run_id, reason=f"before:rollback:{snapshot.id}")
        fields = (
            ("name", "content_json", "source_fact_ids", "pdf_path", "content_hash")
            if isinstance(target, ResumeVersion)
            else ("page_schema", "source_fact_ids", "preview_url", "published_url", "artifact_path", "content_hash")
        )
        for field in fields:
            if field in snapshot.payload:
                setattr(target, field, snapshot.payload[field])
        self.session.flush()
        self.snapshot_entity(target, run_id=run_id, reason=f"after:rollback:{snapshot.id}")
        return target

    def freeze(self, entity: ResumeVersion | PortfolioVersion, *, run_id: str, reason: str = "approved freeze") -> None:
        self.assert_mutable(entity)
        self.snapshot_entity(entity, run_id=run_id, reason="before:freeze")
        payload = entity.content_json if isinstance(entity, ResumeVersion) else entity.page_schema
        entity.content_hash = canonical_hash(payload)
        entity.frozen_at = datetime.now(timezone.utc)
        entity.status = AssetStatus.FROZEN
        self.session.flush()
        self.snapshot_entity(entity, run_id=run_id, reason=f"after:{reason}")
