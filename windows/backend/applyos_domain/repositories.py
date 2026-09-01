from __future__ import annotations

from collections.abc import Sequence
from typing import Generic, TypeVar

from sqlalchemy import select
from sqlalchemy.orm import Session

from .base import Base
from .models import Candidate, Fact, Job, ResumeVersion

ModelT = TypeVar("ModelT", bound=Base)


class Repository(Generic[ModelT]):
    model: type[ModelT]

    def __init__(self, session: Session):
        self.session = session

    def add(self, entity: ModelT) -> ModelT:
        self.session.add(entity)
        self.session.flush()
        return entity

    def get(self, entity_id: str) -> ModelT | None:
        return self.session.get(self.model, entity_id)

    def list(self, *, limit: int = 100, offset: int = 0) -> Sequence[ModelT]:
        return self.session.scalars(select(self.model).offset(offset).limit(limit)).all()


class CandidateRepository(Repository[Candidate]):
    model = Candidate

    def by_legacy_id(self, legacy_id: str) -> Candidate | None:
        return self.session.scalar(select(Candidate).where(Candidate.legacy_id == legacy_id))


class FactRepository(Repository[Fact]):
    model = Fact

    def for_candidate(self, candidate_id: str, *, verified: bool | None = None) -> Sequence[Fact]:
        statement = select(Fact).where(Fact.candidate_id == candidate_id).order_by(Fact.created_at)
        if verified is not None:
            statement = statement.where(Fact.verified.is_(verified))
        return self.session.scalars(statement).all()

    def by_legacy_source_key(self, key: str) -> Fact | None:
        return self.session.scalar(select(Fact).where(Fact.legacy_source_key == key))


class JobRepository(Repository[Job]):
    model = Job

    def for_candidate(self, candidate_id: str) -> Sequence[Job]:
        return self.session.scalars(select(Job).where(Job.candidate_id == candidate_id).order_by(Job.updated_at.desc())).all()

    def by_legacy_id(self, legacy_id: str) -> Job | None:
        return self.session.scalar(select(Job).where(Job.legacy_id == legacy_id))


class ResumeVersionRepository(Repository[ResumeVersion]):
    model = ResumeVersion

    def by_legacy_id(self, legacy_id: str) -> ResumeVersion | None:
        return self.session.scalar(select(ResumeVersion).where(ResumeVersion.legacy_id == legacy_id))

    def for_candidate(self, candidate_id: str) -> Sequence[ResumeVersion]:
        return self.session.scalars(select(ResumeVersion).where(ResumeVersion.candidate_id == candidate_id).order_by(ResumeVersion.updated_at.desc())).all()
