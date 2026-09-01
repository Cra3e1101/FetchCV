from __future__ import annotations

import argparse
import getpass
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from applyos_agent.agents import AgentSuite
from applyos_agent.config import AgentSettings, RuntimeMode
from applyos_domain.models import Fact, Job


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a secret-safe compatible-provider smoke test")
    parser.add_argument("--name", default="Custom provider")
    parser.add_argument("--protocol", choices=["openai", "anthropic"], required=True)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--model", required=True)
    args = parser.parse_args()
    api_key = getpass.getpass("API Key (input hidden): ").strip()
    settings = AgentSettings(
        runtime=RuntimeMode.COMPATIBLE,
        model=args.model,
        workspace_root=Path.cwd(),
        api_key_configured=bool(api_key),
        provider_name=args.name,
        provider_protocol=args.protocol,
        provider_base_url=args.base_url.rstrip("/"),
        provider_api_key=api_key,
    )
    suite = AgentSuite(settings=settings)
    job = Job(id="smoke-job", candidate_id="smoke-candidate", company="示例公司", role="数据分析实习生", jd_raw="使用 SQL 和 Python 进行数据清洗、指标分析与可视化，支持业务决策。")
    facts = [
        Fact(id="fact-sql", candidate_id="smoke-candidate", category="experience", content="使用 SQL 清洗审查结果并构建指标分析表。", verified=True),
        Fact(id="fact-writing", candidate_id="smoke-candidate", category="experience", content="负责校园公众号文章排版与活动摄影。", verified=True),
        Fact(id="fact-python", candidate_id="smoke-candidate", category="project", content="使用 Python 完成数据预处理与可视化。", verified=True),
    ]
    started = time.perf_counter()
    analysis, analysis_runtime = suite.analyze_jd(job)
    ranking, ranking_runtime = suite.rank_facts(job, facts)
    payload = {
        "ok": True,
        "provider": args.name,
        "protocol": args.protocol,
        "model": args.model,
        "elapsed_ms": round((time.perf_counter() - started) * 1000),
        "jd_responsibilities": len(analysis.responsibilities),
        "ranked_facts": len(ranking.items),
        "recommended_facts": sum(1 for item in ranking.items if item.recommended),
        "runtime": ranking_runtime.usage.get("runtime"),
        "usage_reported": bool(analysis_runtime.usage or ranking_runtime.usage),
    }
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
