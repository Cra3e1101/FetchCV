from __future__ import annotations

from sqlalchemy.orm import Session

from .enums import FactSourceType
from .models import Candidate, Fact, Job
from .repositories import CandidateRepository, FactRepository, JobRepository


class DomainService:
    def __init__(self, session: Session):
        self.candidates = CandidateRepository(session)
        self.facts = FactRepository(session)
        self.jobs = JobRepository(session)

    def create_candidate(self, **values: object) -> Candidate:
        return self.candidates.add(Candidate(**values))

    def record_fact(self, *, candidate_id: str, category: str, content: str, source_type: FactSourceType = FactSourceType.USER_INPUT, verified: bool = False, **values: object) -> Fact:
        return self.facts.add(Fact(candidate_id=candidate_id, category=category, content=content, source_type=source_type, verified=verified, **values))

    def create_job(self, *, candidate_id: str, company: str, role: str, **values: object) -> Job:
        return self.jobs.add(Job(candidate_id=candidate_id, company=company, role=role, **values))
