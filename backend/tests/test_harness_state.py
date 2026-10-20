import pytest

from applyos_domain.enums import RunStatus
from applyos_domain.models import AgentRun, Candidate, Job
from applyos_harness.errors import HarnessError
from applyos_harness.state_machine import PipelineStage, RunStateMachine


def _run(session):
    candidate = Candidate(name="状态测试")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="甲", role="分析师", jd_raw="负责数据分析")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="test", current_stage="created", status=RunStatus.CREATED)
    session.add(run)
    session.flush()
    return run


def test_illegal_transition_is_blocked_and_legal_transition_is_traced(database):
    with database.session() as session:
        run = _run(session)
        machine = RunStateMachine(session)
        with pytest.raises(HarnessError) as error:
            machine.transition(run, PipelineStage.READY_TO_PUBLISH)
        assert error.value.code == "illegal_state_transition"
        machine.transition(run, PipelineStage.INPUT_VALIDATING, actor="test", reason="valid")
        assert run.current_stage == "input_validating"
        assert run.steps[0].event_type == "transition"
        assert run.steps[0].actor == "test"


def test_review_and_publish_transitions_require_approval_flag(database):
    with database.session() as session:
        run = _run(session)
        run.current_stage = PipelineStage.AWAITING_USER_REVIEW.value
        machine = RunStateMachine(session)
        with pytest.raises(HarnessError) as error:
            machine.transition(run, PipelineStage.APPROVED_CHANGES_APPLYING)
        assert error.value.code == "approval_required"
        machine.transition(run, PipelineStage.APPROVED_CHANGES_APPLYING, review_approved=True)
        assert run.current_stage == "approved_changes_applying"


def test_failed_run_recovers_to_saved_stage(database):
    with database.session() as session:
        run = _run(session)
        run.current_stage = PipelineStage.JD_ANALYZING.value
        machine = RunStateMachine(session)
        machine.transition(run, PipelineStage.FAILED, reason="synthetic failure")
        assert run.resume_stage == "jd_analyzing"
        machine.recover(run)
        assert run.current_stage == "jd_analyzing"
        assert run.status == RunStatus.RUNNING


def test_cancelled_run_is_terminal(database):
    with database.session() as session:
        run = _run(session)
        machine = RunStateMachine(session)
        machine.transition(run, PipelineStage.CANCELLED, actor="user")
        with pytest.raises(HarnessError) as error:
            machine.transition(run, PipelineStage.INPUT_VALIDATING)
        assert error.value.code == "terminal_state"
