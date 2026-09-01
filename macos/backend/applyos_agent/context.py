from __future__ import annotations

import json
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from applyos_domain.models import AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, Fact, Job, MaterialAsset, ResumeVersion


class ContextManager:
    def __init__(self, session: Session, *, recent_message_limit: int = 10, max_chars: int = 60000):
        self.session = session
        self.recent_message_limit = recent_message_limit
        self.max_chars = max_chars

    def pinned(self, job: Job) -> dict[str, Any]:
        base_resume = self.session.scalar(
            select(ResumeVersion).where(ResumeVersion.candidate_id == job.candidate_id, ResumeVersion.job_id.is_(None)).order_by(ResumeVersion.updated_at.desc())
        )
        job_resume = self.session.scalar(
            select(ResumeVersion).where(ResumeVersion.job_id == job.id).order_by(ResumeVersion.updated_at.desc())
        )
        facts = list(
            self.session.scalars(
                select(Fact).where(Fact.candidate_id == job.candidate_id, Fact.verified.is_(True)).order_by(Fact.updated_at.desc()).limit(40)
            ).all()
        )
        materials = list(
            self.session.scalars(
                select(MaterialAsset).where(MaterialAsset.candidate_id == job.candidate_id).order_by(MaterialAsset.updated_at.desc()).limit(20)
            ).all()
        )
        return {
            "job": {
                "id": job.id,
                "company": job.company,
                "role": job.role,
                "location": job.location,
                "jd": (job.jd_raw or "")[:24000],
                "source_url": job.source_url,
                "source_type": job.source_type,
            },
            "base_resume": self._resume_context(base_resume),
            "job_resume": self._resume_context(job_resume),
            "verified_facts": [
                {"id": fact.id, "category": fact.category, "content": fact.content[:2000], "source_reference": fact.source_reference}
                for fact in facts
            ],
            "materials": [{"id": item.id, "kind": item.kind, "name": item.name, "source_url": item.source_url} for item in materials],
        }

    def compact(self, *, job: Job, run: AgentRun | None) -> AgentContextSnapshot | None:
        messages = list(self.session.scalars(select(AgentMessage).where(AgentMessage.job_id == job.id).order_by(AgentMessage.created_at)).all())
        if len(messages) <= self.recent_message_limit:
            return self.latest(job.id, run.id if run else None)
        compacted = messages[:-self.recent_message_limit]
        recent = messages[-self.recent_message_limit:]
        compacted_ids = [item.id for item in compacted]
        existing = self.latest(job.id, run.id if run else None)
        if existing and existing.compacted_message_ids == compacted_ids:
            return existing
        summary_lines = []
        for item in compacted:
            content = " ".join(item.content.split())[:1000]
            summary_lines.append(f"[{item.id}] {item.role}: {content}")
        summary = "\n".join(summary_lines)[-28000:]
        version = int(
            self.session.scalar(
                select(func.max(AgentContextSnapshot.version)).where(AgentContextSnapshot.job_id == job.id, AgentContextSnapshot.run_id == (run.id if run else None))
            ) or 0
        ) + 1
        pinned = self.pinned(job)
        snapshot = AgentContextSnapshot(
            run_id=run.id if run else None,
            job_id=job.id,
            version=version,
            summary=summary,
            pinned_context=pinned,
            compacted_message_ids=compacted_ids,
            recent_message_ids=[item.id for item in recent],
            token_estimate=max(1, (len(summary) + len(json.dumps(pinned, ensure_ascii=False))) // 4),
        )
        self.session.add(snapshot)
        self.session.flush()
        return snapshot

    def conversation_context(self, *, job: Job, run: AgentRun | None, include_job_context: bool) -> str:
        snapshot = self.compact(job=job, run=run)
        recent = list(
            self.session.scalars(
                select(AgentMessage).where(AgentMessage.job_id == job.id).order_by(AgentMessage.created_at.desc()).limit(self.recent_message_limit)
            ).all()
        )
        payload: dict[str, Any] = {
            "context_scope": "job" if include_job_context else "general",
            "compacted_history": snapshot.summary if snapshot else "",
            "recent_messages": [{"id": item.id, "role": item.role, "content": item.content[:6000]} for item in reversed(recent)],
        }
        if include_job_context:
            payload["pinned"] = snapshot.pinned_context if snapshot else self.pinned(job)
            payload["run"] = {"id": run.id, "stage": run.current_stage, "status": getattr(run.status, "value", run.status)} if run else None
        return json.dumps(payload, ensure_ascii=False)[: self.max_chars]

    def agent_context(self, *, run: AgentRun, objective: str) -> str:
        job = self.session.get(Job, run.job_id)
        if job is None:
            return json.dumps({"objective": objective, "run_id": run.id}, ensure_ascii=False)
        snapshot = self.compact(job=job, run=run)
        recent_steps = list(
            self.session.scalars(
                select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence.desc()).limit(20)
            ).all()
        )
        payload = {
            "objective": objective,
            "run": {"id": run.id, "stage": run.current_stage, "status": getattr(run.status, "value", run.status)},
            "pinned": snapshot.pinned_context if snapshot else self.pinned(job),
            "compacted_history": snapshot.summary if snapshot else "",
            "recent_events": [
                {"sequence": item.sequence, "stage": item.stage, "event_type": item.event_type, "status": item.status.value, "output_refs": item.output_refs, "error_code": item.error_code}
                for item in reversed(recent_steps)
            ],
        }
        return "<fetchcv_task_context>\n" + json.dumps(payload, ensure_ascii=False)[: self.max_chars] + "\n</fetchcv_task_context>"

    def latest(self, job_id: str, run_id: str | None) -> AgentContextSnapshot | None:
        statement = select(AgentContextSnapshot).where(AgentContextSnapshot.job_id == job_id)
        statement = statement.where(AgentContextSnapshot.run_id == run_id) if run_id else statement.where(AgentContextSnapshot.run_id.is_(None))
        return self.session.scalar(statement.order_by(AgentContextSnapshot.version.desc()))

    @staticmethod
    def _resume_context(resume: ResumeVersion | None) -> dict[str, Any] | None:
        if resume is None:
            return None
        content = resume.content_json or {}
        snapshot = content.get("editor_snapshot") or {}
        sections = []
        for section in snapshot.get("sections") or []:
            sections.append({
                "id": section.get("id"),
                "title": section.get("title"),
                "items": [
                    {"id": item.get("id"), "experience_id": item.get("experienceId"), "meta_left": item.get("metaLeft"), "meta_right": item.get("metaRight"), "body": str(item.get("body") or "")[:4000]}
                    for item in (section.get("items") or [])
                ],
            })
        return {
            "id": resume.id,
            "parent_version_id": resume.parent_version_id,
            "name": resume.name,
            "content_hash": resume.content_hash,
            "template": snapshot.get("template"),
            "profile": {key: value for key, value in (snapshot.get("profile") or {}).items() if key not in {"photo", "avatar", "image"}},
            "sections": sections,
            "strategy": content.get("strategy") or {},
        }
