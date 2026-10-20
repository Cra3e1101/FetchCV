"""Fresh in-memory conversation bootstrap using the production prompt and tools."""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
# No user workspace, files, credentials or application database are used.
os.environ["FETCHCV_WORKSPACE_ROOT"] = sys.argv[1]
os.environ["FETCHCV_ARTIFACT_ROOT"] = sys.argv[1]
from applyos_domain.database import Database
from applyos_domain.models import Candidate, Job
from applyos_api.pi_bridge import PiTurnStart, start_turn

db = Database("sqlite:///:memory:")
db.create_schema()
try:
    with db.session() as session:
        candidate = Candidate(name="Synthetic budget test")
        session.add(candidate)
        session.flush()
        job = Job(candidate_id=candidate.id, company="Synthetic", role="Test", jd_raw="")
        session.add(job)
        session.flush()
        payload = PiTurnStart(
            content="你是什么模型", thinking_level="balanced",
            provider={"provider_name": "DeepSeek", "protocol": "openai",
                      "base_url": "https://api.deepseek.com", "model": "deepseek-v4-flash"},
        )
        print(json.dumps(start_turn(job.id, payload, session), ensure_ascii=True))
finally:
    db.engine.dispose()
