"""Context views preserve evidence while avoiding unrelated storage reads."""
import json

import pytest
from sqlalchemy import event

from applyos_agent.context import ContextManager
from applyos_domain.models import AgentRun, Candidate, Fact, Job
from applyos_harness.errors import HarnessError


def seed(session):
    candidate = Candidate(name="合成测试")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="示例公司", role="研发", jd_raw="Python 检索")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="pi_agent")
    session.add(run)
    session.add(Fact(candidate_id=candidate.id, category="experience", content="已核对的经历", verified=True))
    session.flush()
    return job, run


def test_projection_queries_only_requested_sections(database):
    with database.session() as session:
        job, _ = seed(session)
        statements = []
        def capture(conn, cursor, statement, parameters, context, many):
            statements.append(statement)
        event.listen(database.engine, "before_cursor_execute", capture)
        try:
            manager = ContextManager(session)
            job_only = manager.pinned(job, sections=["job"])
            assert statements == []
            assert set(job_only) == {"job", "source_fingerprint"}
            facts = manager.pinned(job, sections=["facts", "facts"])
            assert len(statements) == 1
            assert "FROM facts" in statements[0]
            assert facts["verified_facts"][0]["content"] == "已核对的经历"
            full = manager.pinned(job)
            assert len(statements) == 8  # Full projection uses seven additional reads.
            assert job_only["job"] == full["job"]
            assert facts["verified_facts"] == full["verified_facts"]
            assert len(full["source_fingerprint"]) == 64
        finally:
            event.remove(database.engine, "before_cursor_execute", capture)


def test_short_conversation_does_not_load_unused_pinned_context(database, monkeypatch):
    with database.session() as session:
        job, run = seed(session)
        manager = ContextManager(session)
        def unexpected(*args, **kwargs):
            pytest.fail("short history should not read all candidate context")
        monkeypatch.setattr(manager, "pinned", unexpected)
        assert manager.compact(job=job, run=run) is None


def test_unknown_section_fails_before_read(database):
    with database.session() as session:
        job, _ = seed(session)
        with pytest.raises(ValueError, match="Unknown context section"):
            ContextManager(session).pinned(job, sections=["arbitrary"])


def test_serialization_drops_whole_history_lines_and_preserves_facts():
    payload = {
        "compacted_history": "\n".join(f"[message-{i}] user: " + "旧历史" * 100 for i in range(30)),
        "pinned": {"verified_facts": [{"id": "fact-1", "content": '保留引号"和换行\n证据'}],
                   "explicit_memory": {"approvals": [{"id": "approval-1", "status": "approved"}]}},
        "recent_messages": [{"id": "latest", "content": "当前用户要求"}],
    }
    original = json.dumps(payload, ensure_ascii=False)
    result = ContextManager(None, max_chars=1500)._serialize_context(payload)
    view = json.loads(result)
    assert len(result) <= 1500
    assert view["pinned"] == payload["pinned"]
    assert view["recent_messages"] == payload["recent_messages"]
    assert view["compacted_history"].startswith("[message-")
    assert "message-29" in view["compacted_history"]
    assert view["context_budget"]["omitted"]["history_lines"] > 0
    assert json.dumps(payload, ensure_ascii=False) == original


def test_serialization_keeps_latest_message_and_discloses_omissions():
    payload = {"recent_messages": [{"id": str(i), "content": "文" * 200} for i in range(10)]}
    view = json.loads(ContextManager(None, max_chars=700)._serialize_context(payload))
    assert view["recent_messages"][-1] == payload["recent_messages"][-1]
    assert view["context_budget"]["omitted"]["recent_messages"] > 0


@pytest.mark.parametrize("key", ["objective", "pinned", "recent_messages"])
def test_serialization_fails_when_protected_context_cannot_fit(key):
    value = [{"content": "重要" * 1000}] if key == "recent_messages" else "重要" * 1000
    with pytest.raises(HarnessError) as error:
        ContextManager(None, max_chars=300)._serialize_context({key: value})
    assert error.value.code == "context_overflow"


def test_unbudgeted_serialization_remains_compatible():
    payload = {"objective": "当前任务", "pinned": {"verified_facts": []}}
    assert ContextManager(None)._serialize_context(payload) == json.dumps(payload, ensure_ascii=False)
