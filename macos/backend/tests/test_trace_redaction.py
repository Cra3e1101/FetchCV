from applyos_domain.enums import RunStatus
from applyos_domain.models import AgentRun, Candidate
from applyos_harness.trace import TraceService


def test_trace_redacts_contact_data_and_secret_fields(database):
    with database.session() as session:
        candidate = Candidate(name="脱敏测试")
        session.add(candidate)
        session.flush()
        run = AgentRun(candidate_id=candidate.id, run_type="test", current_stage="created", status=RunStatus.CREATED)
        session.add(run)
        session.flush()
        step = TraceService(session).record(
            run=run,
            stage="created",
            agent_name="test",
            event_type="tool",
            tool_calls=[{"email": "user@example.com", "phone": "13912345678", "api_key": "secret"}],
            error="联系 user@example.com 或 13912345678",
        )
        assert step.tool_calls == [{"email": "[REDACTED_EMAIL]", "phone": "[REDACTED_PHONE]"}]
        assert "user@example.com" not in step.error
        assert "13912345678" not in step.error
