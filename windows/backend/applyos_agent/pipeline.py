from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from applyos_harness.pipeline import MockPipeline
from applyos_harness.errors import HarnessError
from applyos_domain.models import Fact

from .config import AgentSettings, RuntimeMode
from .service import AgentService


class ModelAssistedPipeline(MockPipeline):
    """Deterministic harness with SDK-backed semantic stages.

    State transitions, approvals, validation and publishing remain code-owned;
    JD analysis, semantic fact matching and resume strategy use the configured model.
    """

    def __init__(self, session: Session, settings: AgentSettings):
        super().__init__(session, execution_mode="model_assisted")
        self.agent_service = AgentService(session)
        self.settings = settings

    def _analyze_job(self, run):
        profile = self.agent_service.analyze_job(self._job(run), run=run)
        return [f"job_profile:{profile.id}"]

    def _generate_strategy(self, run):
        facts = self._verified_facts(run)
        result = self.agent_service.resume_strategy(self._job(run), run=run, fact_ids=[fact.id for fact in facts])
        return [f"strategy_snapshot:{result['snapshot_id']}"]

    def _proposal_specs(self, run, facts):
        adaptable = [fact for fact in facts if fact.category not in {"education", "profile", "profile.contact", "profile.identity"}]
        if not adaptable:
            return []
        result = self.agent_service.generate_assets(self._job(run), adaptable, run=run)
        return result["proposals"]

    def _match_facts(self, run):
        facts = list(
            self.session.scalars(
                select(Fact)
                .where(Fact.candidate_id == run.candidate_id)
                .order_by(Fact.updated_at.desc())
            ).all()
        )
        ranked = self.agent_service.rank_facts(self._job(run), facts, run=run)
        by_id = {fact.id: fact for fact in facts}
        items = []
        for item in ranked["items"]:
            fact = by_id[item["fact_id"]]
            items.append(
                {
                    "fact_id": fact.id,
                    "content": fact.content,
                    "category": fact.category,
                    "verified": fact.verified,
                    "score": {"high": 3, "medium": 2, "low": 1}.get(item.get("relevance"), 0),
                    "recommended": bool(item.get("recommended")),
                    "match_method": "model_semantic_v1",
                    "match_source": ranked["runtime"].get("provider", "custom"),
                    "matched_terms": item.get("matched_jd_requirements", []),
                    "match_reason": item.get("rationale", "模型语义匹配"),
                }
            )
        items.sort(key=lambda item: (item["recommended"], item["score"]), reverse=True)
        self.approvals.request(
            run_id=run.id,
            action_type="confirm_relevant_facts",
            target_type="job",
            target_id=run.job_id,
            items=items,
        )
        return [f"matched_fact:{fact.id}" for fact in facts]


def build_pipeline(session: Session):
    settings = AgentSettings.from_env()
    if settings.runtime in {RuntimeMode.CLAUDE, RuntimeMode.COMPATIBLE}:
        return ModelAssistedPipeline(session, settings)
    if not settings.allow_mock_runtime:
        raise HarnessError("model_required", "请先连接并启用一个模型；岗位分析不会使用本地规则冒充模型结果。")
    return MockPipeline(session)
