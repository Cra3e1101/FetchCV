"""Recovery regressions; these tests require explicit execution by the user."""
from hashlib import sha256

import pytest
from sqlalchemy import select

from applyos_agent.interview_tools import register_interview_tools
from applyos_domain.models import AgentRun, Candidate, InterviewSource, Job, ToolInvocation
from applyos_harness.errors import HarnessError
from applyos_harness.permissions import ToolGateway, ToolPermission


Q1 = "面试官问如何分析留存下降。"
Q2 = "随后问如何设计对照实验。"


def _workspace(session, tmp_path):
    candidate = Candidate(name="Synthetic recovery candidate")
    session.add(candidate)
    session.flush()
    job = Job(candidate_id=candidate.id, company="Example", role="数据分析")
    session.add(job)
    session.flush()
    run = AgentRun(candidate_id=candidate.id, job_id=job.id, run_type="conversation", current_stage="ready_to_publish")
    source = InterviewSource(candidate_id=candidate.id, job_id=job.id, company=job.company, role=job.role,
                             platform="nowcoder", source_url="https://www.nowcoder.com/discuss/123456",
                             url_hash="a" * 64, content_hash="b" * 64, title="数据分析面经",
                             raw_text=Q1 + Q2, status="captured")
    session.add_all([run, source])
    session.flush()
    return register_interview_tools(ToolGateway(session, workspace_root=tmp_path)), run, source


def _call(gateway, run, name, args, call_id):
    return gateway.execute(tool_name=name, run=run, arguments=args,
                           granted_permissions=set(ToolPermission), idempotency_key=call_id)


def _args(source, questions, summary="依据原文提取面试问题"):
    return {"source_id": source.id, "summary": summary,
            "questions": [{"question": question, "evidence_quote": quote} for question, quote in questions]}


def _attempts(session, run):
    rows = session.scalars(select(ToolInvocation).where(ToolInvocation.run_id == run.id)).all()
    return [row for row in rows if (row.error_json or {}).get("repair_argument_hash")]


def test_source_budget_survives_changed_arguments_and_call_ids(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        bad = _args(source, [("不存在的问题", "正文没有这段引文")])
        with pytest.raises(HarnessError) as first:
            _call(gateway, run, "analyze_interview_source", bad, "first")
        assert first.value.retryable is True
        assert first.value.details["rejected_questions"][0]["question_index"] == 0
        assert first.value.details["repair_attempts_used"] == 1
        with pytest.raises(HarnessError, match="相同参数") as unchanged:
            _call(gateway, run, "analyze_interview_source", bad, "different-call-id")
        assert unchanged.value.code == "interview_analysis_parameters_unchanged"
        assert len(_attempts(session, run)) == 1
        with pytest.raises(HarnessError) as whitespace:
            _call(gateway, run, "analyze_interview_source", {**bad, "summary": "  " + bad["summary"] + "  "}, "whitespace-change")
        assert whitespace.value.code == "interview_analysis_parameters_unchanged"
        assert len(_attempts(session, run)) == 1
        with pytest.raises(HarnessError) as second:
            _call(gateway, run, "analyze_interview_source", {**bad, "summary": "实际修改过的分析参数"}, "repair")
        assert second.value.retryable is False
        assert second.value.details["repair_attempts_remaining"] == 0
        with pytest.raises(HarnessError) as exhausted:
            _call(gateway, run, "analyze_interview_source", {**bad, "summary": "再次修改不能重置预算"}, "third")
        assert exhausted.value.code == "interview_analysis_repair_exhausted"
        assert exhausted.value.details["next_action"] == "continue_other_sources"
        assert len(_attempts(session, run)) == 2
        assert source.status == "captured" and not source.extracted_questions
        assert all(row.status == "failed" for row in _attempts(session, run))


def test_partial_repair_preserves_verified_questions_then_reuses_complete_analysis(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        partial = _call(gateway, run, "analyze_interview_source", _args(source, [
            ("如何分析留存下降？", Q1), ("如何设计实验？", "不在当前正文中的内容"),
        ]), "partial")
        assert partial["data"]["analysis_status"] == "partial"
        assert partial["data"]["rejected_questions"] == [
            {"question_index": 1, "field": "evidence_quote", "reason": "quote_not_in_current_source"}]
        repaired = _call(gateway, run, "analyze_interview_source", _args(source, [("如何设计实验？", Q2)]), "repair")
        assert repaired["data"]["analysis_status"] == "complete"
        assert {item["question"] for item in source.extracted_questions} == {"如何分析留存下降？", "如何设计实验？"}
        assert len(_attempts(session, run)) == 2
        reused = _call(gateway, run, "analyze_interview_source", _args(source, [("不应覆盖成功结果", "虚构引文")]), "repeat-success")
        assert reused["data"]["reused"] is True
        assert len(source.extracted_questions) == 2
        assert len(_attempts(session, run)) == 2


def test_explicit_replace_rebuilds_complete_analysis_without_resetting_shared_budget(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "initial")
        replacement = {**_args(source, [("如何设计实验？", Q2)]), "mode": "replace"}
        replaced = _call(gateway, run, "analyze_interview_source", replacement, "explicit-correction")
        assert replaced["data"]["analysis_mode"] == "replace"
        assert replaced["data"]["repair_attempts_used"] == 2
        assert [item["question"] for item in source.extracted_questions] == ["如何设计实验？"]
        reused = _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "back-to-default")
        assert reused["data"]["reused"] is True
        with pytest.raises(HarnessError) as exhausted:
            _call(gateway, run, "analyze_interview_source", {
                **_args(source, [("如何分析留存下降？", Q1)]), "mode": "replace",
            }, "switch-mode-again")
        assert exhausted.value.code == "interview_analysis_repair_exhausted"
        assert len(_attempts(session, run)) == 2
        assert [item["question"] for item in source.extracted_questions] == ["如何设计实验？"]


def test_explicit_partial_replace_keeps_only_new_verified_questions(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        _call(gateway, run, "analyze_interview_source", _args(source, [
            ("如何分析留存下降？", Q1), ("待修复问题", "不在正文的引用"),
        ]), "initial-partial")
        result = _call(gateway, run, "analyze_interview_source", {
            **_args(source, [("如何设计实验？", Q2), ("新待修复问题", "另一条无效引用")]), "mode": "replace",
        }, "partial-replacement")
        assert result["data"]["analysis_status"] == "partial"
        assert result["data"]["rejected_questions"][0]["question_index"] == 1
        assert [item["question"] for item in source.extracted_questions] == ["如何设计实验？"]
        assert result["data"]["repair_attempts_remaining"] == 0


def test_changed_current_body_never_replays_analysis_of_old_body(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        args = _args(source, [("如何分析留存下降？", Q1)])
        _call(gateway, run, "analyze_interview_source", args, "old-body")
        old_digest = source.metadata_json["analysis_content_hash"]
        source.raw_text += "新正文增加了第三轮讨论。"
        # Deliberately retain stale content_hash and prior analyzed status.
        session.flush()
        result = _call(gateway, run, "analyze_interview_source", args, "new-body-same-args")
        current_digest = sha256(source.raw_text.encode()).hexdigest()
        assert current_digest != old_digest
        assert source.metadata_json["analysis_content_hash"] == current_digest
        assert result["data"]["repair_attempts_used"] == 1
        assert len({row.error_json["repair_scope"]["content_hash"] for row in _attempts(session, run)}) == 2


def test_unknown_operation_blocks_analysis_without_consuming_budget(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        session.add(ToolInvocation(operation_id="op_unknown_recovery", run_id=run.id, tool_name="external_write",
                                   stage=run.current_stage, arguments_hash="c" * 64, status="outcome_unknown"))
        session.commit()
        with pytest.raises(HarnessError) as blocked:
            _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "blocked")
        assert blocked.value.code == "tool_outcome_unknown"
        assert not _attempts(session, run)
        assert source.status == "captured"


def test_source_change_across_prepare_commit_is_rejected_before_handler(database, tmp_path, monkeypatch):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        prepare = gateway._prepare_invocation

        def changed_after_prepare(**kwargs):
            invocation = prepare(**kwargs)
            source.raw_text += "在准备回执提交后正文已被修改。"
            session.commit()
            return invocation

        monkeypatch.setattr(gateway, "_prepare_invocation", changed_after_prepare)
        with pytest.raises(HarnessError) as changed:
            _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "racing")
        assert changed.value.code == "source_revision_changed"
        assert changed.value.details["next_action"] == "reread_source"
        assert not _attempts(session, run)
        assert source.status == "captured" and not source.extracted_questions
        rows = session.scalars(select(ToolInvocation).where(ToolInvocation.run_id == run.id)).all()
        assert len(rows) == 1 and rows[0].status == "failed"
        assert rows[0].error_json["pre_execution_rejection"] is True


def test_source_change_across_claim_commit_releases_unused_budget(database, tmp_path, monkeypatch):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        commit = session.commit
        changed = False

        def change_body_after_claim():
            nonlocal changed
            commit()
            running = session.scalar(select(ToolInvocation).where(
                ToolInvocation.run_id == run.id, ToolInvocation.status == "running"))
            if running is not None and not changed:
                changed = True
                source.raw_text += "在领取回执提交后正文已修改。"
                commit()

        monkeypatch.setattr(session, "commit", change_body_after_claim)
        with pytest.raises(HarnessError) as stale:
            _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "claim-race")
        assert changed and stale.value.code == "source_revision_changed"
        assert not _attempts(session, run)
        assert source.status == "captured" and not source.extracted_questions
        rows = session.scalars(select(ToolInvocation).where(ToolInvocation.run_id == run.id)).all()
        assert len(rows) == 1 and rows[0].status == "failed"
        assert rows[0].error_json["pre_execution_rejection"] is True


def test_no_questions_is_distinct_from_rejected_quotes_and_cannot_support_brief(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        result = _call(gateway, run, "analyze_interview_source", _args(source, []), "no-questions")
        assert result["data"]["analysis_status"] == "no_questions"
        with pytest.raises(HarnessError) as invalid:
            _call(gateway, run, "build_interview_brief", {"company": "Example", "role": "数据分析",
                  "summary": "证据有限的简报", "source_ids": [source.id]}, "brief")
        assert invalid.value.code == "interview_brief_source_not_analyzed"
        assert invalid.value.details["invalid_source_ids"] == [source.id]
        assert invalid.value.details["ready_source_ids"] == []


@pytest.mark.parametrize("question,quote,reason", [
    ("  ", Q1, "question_empty"), ("如何分析留存下降？", "  ", "quote_too_short"),
])
def test_whitespace_only_question_or_quote_never_becomes_verified(database, tmp_path, question, quote, reason):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        with pytest.raises(HarnessError) as invalid:
            _call(gateway, run, "analyze_interview_source", _args(source, [(question, quote)]), "whitespace")
        assert invalid.value.details["rejected_questions"][0]["question_index"] == 0
        assert invalid.value.details["rejected_questions"][0]["reason"] == reason
        assert source.status == "captured" and not source.extracted_questions


def test_ocr_confirmation_and_permission_denial_do_not_spend_analysis_budget(database, tmp_path):
    with database.session() as session:
        gateway, run, source = _workspace(session, tmp_path)
        source.status = "ocr_pending"
        session.flush()
        with pytest.raises(HarnessError) as pending:
            _call(gateway, run, "analyze_interview_source", _args(source, [("如何分析留存下降？", Q1)]), "ocr")
        assert pending.value.code == "interview_source_ocr_pending"
        assert pending.value.retryable is False
        assert pending.value.details["next_action"] == "await_user_ocr_review"
        with pytest.raises(HarnessError) as denied:
            gateway.execute(tool_name="analyze_interview_source", run=run, arguments=_args(source, []),
                            granted_permissions={ToolPermission.READ}, idempotency_key="denied")
        assert denied.value.code == "tool_permission_denied"
        assert not _attempts(session, run)
