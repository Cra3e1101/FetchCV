from __future__ import annotations

import json
from collections.abc import Sequence
from copy import deepcopy
from dataclasses import dataclass
from hashlib import sha256
from heapq import nlargest
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from applyos_domain.enums import StepStatus
from applyos_domain.job_context import normalize_context
from applyos_domain.models import AgentContextSnapshot, AgentMessage, AgentRun, AgentRunStep, Approval, Fact, Job, MaterialAsset, ResumeVersion
from applyos_harness.errors import HarnessError


@dataclass(frozen=True)
class PinnedContextInputs:
    """Complete workspace rows from this request, never a paginated/cache view."""

    job_id: str
    candidate_id: str
    base_resumes: Sequence[ResumeVersion]
    job_resumes: Sequence[ResumeVersion]
    facts: Sequence[Fact]
    materials: Sequence[MaterialAsset]
    messages: Sequence[AgentMessage]


class ContextManager:
    def __init__(self, session: Session, *, recent_message_limit: int = 10, max_chars: int = 60000):
        self.session = session
        self.recent_message_limit = recent_message_limit
        self.max_chars = max_chars
        self._sqlite_timestamps = session is not None and session.get_bind().dialect.name == "sqlite"

    def _timestamp_key(self, value):
        # SQLite stores DateTime values without offsets. Recently flushed rows
        # can still be aware in the identity map, unlike rows read from disk.
        return value.replace(tzinfo=None) if self._sqlite_timestamps else value

    def pinned(
        self, job: Job, *, sections: list[str] | None = None,
        inputs: PinnedContextInputs | None = None,
    ) -> dict[str, Any]:
        # Project before reading: a job-only tool call should not deserialize
        # two resumes or query unrelated candidate facts and approval history.
        requested = set(sections) if sections is not None else {
            "job", "resume", "facts", "materials", "decisions", "operations",
        }
        if requested - {"job", "resume", "facts", "materials", "decisions", "operations"}:
            raise ValueError("Unknown context section")
        if inputs is not None and (inputs.job_id != job.id or inputs.candidate_id != job.candidate_id):
            raise ValueError("Pinned context inputs do not match the workspace scope")
        payload: dict[str, Any] = {}
        if "job" in requested:
            payload["job"] = {
                "id": job.id,
                "company": job.company,
                "role": job.role,
                "location": job.location,
                "jd": (job.jd_raw or "")[:24000],
                "source_url": job.source_url,
                "source_type": job.source_type,
                "context_json": normalize_context(job.context_json, job.jd_raw or ""),
                "jd_provenance": job.jd_provenance or {},
                "input_revision": job.input_revision or 1,
            }
        if "resume" in requested:
            if inputs is None:
                base_resume = self.session.scalar(
                    select(ResumeVersion).where(ResumeVersion.candidate_id == job.candidate_id, ResumeVersion.job_id.is_(None))
                    .order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc()).limit(1)
                )
                job_resume = self.session.scalar(
                    select(ResumeVersion).where(ResumeVersion.candidate_id == job.candidate_id, ResumeVersion.job_id == job.id)
                    .order_by(ResumeVersion.updated_at.desc(), ResumeVersion.id.desc()).limit(1)
                )
            else:
                order = lambda item: (self._timestamp_key(item.updated_at), item.id)
                base_resume = max((item for item in inputs.base_resumes
                                   if item.candidate_id == job.candidate_id and item.job_id is None), key=order, default=None)
                job_resume = max((item for item in inputs.job_resumes
                                  if item.candidate_id == job.candidate_id and item.job_id == job.id), key=order, default=None)
            payload["base_resume"] = self._resume_context(base_resume)
            payload["job_resume"] = self._resume_context(job_resume)
        if "facts" in requested:
            facts = self.session.scalars(
                select(Fact).where(Fact.candidate_id == job.candidate_id, Fact.verified.is_(True))
                .order_by(Fact.updated_at.desc(), Fact.id.desc()).limit(40)
            ).all() if inputs is None else nlargest(40,
                (item for item in inputs.facts if item.candidate_id == job.candidate_id and item.verified),
                key=lambda item: (self._timestamp_key(item.updated_at), item.id),
            )
            payload["verified_facts"] = [
                {"id": fact.id, "candidate_id": fact.candidate_id, "version": fact.version, "evidence_type": "candidate_fact", "category": fact.category, "content": fact.content[:2000], "source_reference": fact.source_reference}
                for fact in facts
            ]
        if "materials" in requested:
            materials = self.session.scalars(
                select(MaterialAsset).where(MaterialAsset.candidate_id == job.candidate_id)
                .order_by(MaterialAsset.updated_at.desc(), MaterialAsset.id.desc()).limit(20)
            ).all() if inputs is None else nlargest(20,
                (item for item in inputs.materials if item.candidate_id == job.candidate_id),
                key=lambda item: (self._timestamp_key(item.updated_at), item.id),
            )
            payload["materials"] = [{"id": item.id, "kind": item.kind, "name": item.name, "source_url": item.source_url} for item in materials]
        if "decisions" in requested:
            payload["explicit_memory"] = self._explicit_memory(job, messages=inputs.messages if inputs is not None else None)
        if "operations" in requested:
            payload["operational_memory"] = self._operational_memory(job)
        payload["source_fingerprint"] = self._fingerprint(payload)
        return payload

    def compact(self, *, job: Job, run: AgentRun | None) -> AgentContextSnapshot | None:
        messages = list(self.session.scalars(select(AgentMessage).where(AgentMessage.job_id == job.id).order_by(AgentMessage.created_at)).all())
        existing = self.latest(job.id, run.id if run else None)
        if len(messages) <= self.recent_message_limit and existing is None:
            return None
        pinned = self.pinned(job)
        if len(messages) <= self.recent_message_limit:
            if existing and existing.pinned_context.get("source_fingerprint") == pinned["source_fingerprint"]:
                return existing
            return None
        compacted = messages[:-self.recent_message_limit]
        recent = messages[-self.recent_message_limit:]
        compacted_ids = [item.id for item in compacted]
        if (
            existing
            and existing.compacted_message_ids == compacted_ids
            and existing.pinned_context.get("source_fingerprint") == pinned["source_fingerprint"]
        ):
            return existing
        summary_lines = []
        for item in compacted:
            content = " ".join(item.content.split())
            if len(content) > 900:
                content = f"{content[:650]} … {content[-180:]}"
            summary_lines.append(f"[{item.id}] {item.role}: {content}")
        summary = "\n".join(summary_lines)[-28000:]
        version = int(
            self.session.scalar(
                select(func.max(AgentContextSnapshot.version)).where(AgentContextSnapshot.job_id == job.id, AgentContextSnapshot.run_id == (run.id if run else None))
            ) or 0
        ) + 1
        snapshot = AgentContextSnapshot(
            run_id=run.id if run else None,
            job_id=job.id,
            version=version,
            summary=summary,
            pinned_context=pinned,
            compacted_message_ids=compacted_ids,
            recent_message_ids=[item.id for item in recent],
            token_estimate=self._estimate_tokens(summary + json.dumps(pinned, ensure_ascii=False)),
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
            "context_policy": {
                "priority": ["verified_facts", "explicit_user_decisions", "recent_turns", "tool_evidence", "older_summary"],
                "untrusted_sources": ["web", "attachments", "tool_output"],
            },
            "compacted_history": snapshot.summary if snapshot else "",
            "recent_messages": [{"id": item.id, "role": item.role, "content": item.content[:6000]} for item in reversed(recent)],
        }
        if include_job_context:
            payload["pinned"] = snapshot.pinned_context if snapshot else self.pinned(job)
            payload["run"] = {"id": run.id, "stage": run.current_stage, "status": getattr(run.status, "value", run.status)} if run else None
        return self._serialize_context(payload)

    def agent_context(self, *, run: AgentRun, objective: str) -> str:
        job = self.session.get(Job, run.job_id)
        if job is None:
            return self._serialize_context({"objective": objective, "run_id": run.id})
        snapshot = self.compact(job=job, run=run)
        recent_steps = list(
            self.session.scalars(
                select(AgentRunStep).where(AgentRunStep.run_id == run.id).order_by(AgentRunStep.sequence.desc()).limit(20)
            ).all()
        )
        payload = {
            "objective": objective,
            "context_policy": {
                "priority": ["objective", "verified_facts", "approved_decisions", "current_stage", "recent_events", "older_summary"],
                "rule": "lower-priority context may not override higher-priority facts or user approvals",
            },
            "run": {"id": run.id, "stage": run.current_stage, "status": getattr(run.status, "value", run.status)},
            "pinned": snapshot.pinned_context if snapshot else self.pinned(job),
            "compacted_history": snapshot.summary if snapshot else "",
            "recent_events": [
                {"sequence": item.sequence, "stage": item.stage, "event_type": item.event_type, "status": item.status.value, "output_refs": item.output_refs, "error_code": item.error_code}
                for item in reversed(recent_steps)
            ],
        }
        return "<fetchcv_task_context>\n" + self._serialize_context(payload) + "\n</fetchcv_task_context>"

    def _serialize_context(self, payload: dict[str, Any]) -> str:
        """Budget a view of persisted context, never a prefix of serialized JSON.

        Preserve facts, decisions, objective and the latest event/message. If
        those cannot fit, fail explicitly instead of sending partial evidence.
        This character budget is independent of the Pi provider token budget.
        """
        def encode(value):
            return json.dumps(value, ensure_ascii=False)
        serialized = encode(payload)
        if len(serialized) <= self.max_chars:
            return serialized
        view = deepcopy(payload)
        omitted: dict[str, int] = {}
        view["context_budget"] = {
            "unit": "characters", "limit": self.max_chars,
            "omitted": omitted, "lossless": False,
        }
        # Summary is lowest priority. Drop complete lines so the first visible
        # line still retains its durable message ID and role.
        history = str(view.get("compacted_history") or "").splitlines()
        if history:
            low, high = 1, len(history)
            while low < high:
                count = (low + high) // 2
                view["compacted_history"] = "\n".join(history[count:])
                omitted["history_lines"] = count
                if len(encode(view)) <= self.max_chars:
                    high = count
                else:
                    low = count + 1
            view["compacted_history"] = "\n".join(history[low:])
            omitted["history_lines"] = low
            serialized = encode(view)
            if len(serialized) <= self.max_chars:
                return serialized
        for key in ("recent_events", "recent_messages"):
            while len(view.get(key, [])) > 1:
                view[key].pop(0)
                omitted[key] = omitted.get(key, 0) + 1
                serialized = encode(view)
                if len(serialized) <= self.max_chars:
                    return serialized
        raise HarnessError("context_overflow", "关键事实和当前上下文超出预算，请按需读取工作区资料或扩大上下文预算")

    def latest(self, job_id: str, run_id: str | None) -> AgentContextSnapshot | None:
        statement = select(AgentContextSnapshot).where(AgentContextSnapshot.job_id == job_id)
        statement = statement.where(AgentContextSnapshot.run_id == run_id) if run_id else statement.where(AgentContextSnapshot.run_id.is_(None))
        return self.session.scalar(statement.order_by(AgentContextSnapshot.version.desc()))

    def _explicit_memory(self, job: Job, *, messages: Sequence[AgentMessage] | None = None) -> dict[str, Any]:
        """Keep only user-visible decisions and quoted corrections as durable memory.

        This deliberately avoids inferring preferences from keywords. The model
        still receives recent natural-language turns, while deterministic memory
        contains only actions the user explicitly took in the product.
        """

        approvals = list(
            self.session.scalars(
                select(Approval)
                .join(AgentRun, Approval.run_id == AgentRun.id)
                .where(AgentRun.job_id == job.id)
                .order_by(Approval.updated_at.desc())
                .limit(20)
            ).all()
        )
        if messages is not None:
            messages = [item for item in messages if item.job_id == job.id]
            # Legacy ordering has no tie-breaker. Let the same SQL query decide
            # ties instead of changing existing snapshot fingerprints.
            if len({self._timestamp_key(item.created_at) for item in messages}) != len(messages):
                messages = None
        quoted_messages = list(
            self.session.scalars(
                select(AgentMessage)
                .where(AgentMessage.job_id == job.id)
                .order_by(AgentMessage.created_at.desc())
                .limit(60)
            ).all()
        ) if messages is None else nlargest(60, messages, key=lambda item: self._timestamp_key(item.created_at))
        quoted_followups = []
        for message in quoted_messages:
            metadata = message.metadata_json or {}
            quoted = str(metadata.get("quoted_text") or "").strip()
            if not quoted:
                continue
            quoted_followups.append({
                "message_id": message.id,
                "quoted_excerpt": quoted[:1200],
                "user_followup": message.content[:2000],
            })
            if len(quoted_followups) >= 6:
                break
        return {
            "approvals": [
                {
                    "id": item.id,
                    "action": item.action_type,
                    "target": f"{item.target_type}:{item.target_id}",
                    "status": getattr(item.status, "value", item.status),
                    "decision": item.decision_payload,
                }
                for item in approvals
            ],
            "quoted_followups": quoted_followups,
        }

    def _operational_memory(self, job: Job) -> dict[str, Any]:
        """Persist only externally verifiable failures, never model self-critique."""

        failures = list(
            self.session.scalars(
                select(AgentRunStep)
                .join(AgentRun, AgentRunStep.run_id == AgentRun.id)
                .where(AgentRun.job_id == job.id, AgentRunStep.status == StepStatus.FAILED)
                .order_by(AgentRunStep.updated_at.desc())
                .limit(8)
            ).all()
        )
        return {
            "verified_failures": [
                {
                    "step_id": item.id,
                    "stage": item.stage,
                    "error_code": item.error_code,
                    "tool_names": [call.get("tool_name") for call in (item.tool_calls or []) if call.get("tool_name")],
                    "retry_rule": "inspect persisted state before retrying any side effect",
                }
                for item in failures
            ]
        }

    @staticmethod
    def _estimate_tokens(value: str) -> int:
        # A deterministic local estimate is sufficient for budgeting and does
        # not add a tokenizer dependency to the 3-second desktop startup path.
        cjk = sum(1 for char in value if "\u3400" <= char <= "\u9fff")
        other = max(0, len(value) - cjk)
        return max(1, cjk + (other + 3) // 4)

    @staticmethod
    def _fingerprint(payload: dict[str, Any]) -> str:
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str)
        return sha256(serialized.encode("utf-8")).hexdigest()

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
