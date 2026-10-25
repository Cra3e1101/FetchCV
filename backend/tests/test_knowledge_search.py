from hashlib import sha256

from fastapi.testclient import TestClient
import pytest
from sqlalchemy import event, inspect, text, update, delete

from applyos_api.main import create_app
from applyos_domain.models import Candidate, InterviewSource, InterviewBrief, Job, AgentRun
from applyos_domain.knowledge_search import search_knowledge, drop_search_index
from applyos_agent.knowledge_read import ReadKnowledgeSourceInput, read_source
from applyos_harness.errors import HarnessError


def add_source(session, candidate, ident, **kw):
    values = dict(id=ident, candidate_id=candidate, company="示例公司", role="产品经理",
                  title="面试经验", source_url=f"https://example.com/{ident}",
                  url_hash=sha256(ident.encode()).hexdigest(), summary="已保存的原文", raw_text="")
    values.update(kw)
    source = InterviewSource(**values)
    session.add(source)
    session.flush()
    return source


@pytest.fixture
def candidates(database):
    with database.session() as session:
        session.add_all([Candidate(id="mine", name="合成甲"), Candidate(id="other", name="合成乙")])
    return "mine", "other"


def test_chinese_short_terms_phrases_mixed_english_and_literal_query(database, candidates):
    with database.session() as session:
        add_source(session, "mine", "good", raw_text="追问用户留存率和 SQL 窗口函数。")
        add_source(session, "mine", "broken", raw_text="留存 存率不能拼接成一个连续的词。")
    with database.session() as session:
        def ids(q): return [h.item.id for h in search_knowledge(session, query=q, candidate_id="mine")]
        assert ids("留存率 sql") == ["good"]
        assert set(ids("留存")) == {"good", "broken"}
        assert "good" in ids("留")
        assert ids("ＳＱＬ") == ["good"]
        assert ids('" OR 1=1 --') == []
        assert ids("***") == []
        assert ids("客户流失") == []  # Lexical retrieval does not pretend to understand synonyms.


def test_ranking_scope_before_limit_and_deferred_body(database, candidates):
    with database.session() as session:
        add_source(session, "mine", "title", title="留存", raw_text="正文" * 100)
        add_source(session, "mine", "body", title="其它", raw_text="正文" * 100 + "留存")
        for n in range(40):
            add_source(session, "other", f"foreign-{n}", title="留存")
    statements = []
    def capture(conn, cursor, statement, *args): statements.append(statement)
    event.listen(database.engine, "before_cursor_execute", capture)
    try:
        with database.session() as session:
            hits = search_knowledge(session, query="留存", candidate_id="mine", limit=1)
            assert [h.item.id for h in hits] == ["title"]
            assert "raw_text" in inspect(hits[0].item).unloaded
            assert len(hits[0].preview) <= 800
            assert hits[0].score < 0  # SQLite BM25: lower is better, not a confidence value.
        assert any("MATCH" in sql and "bm25(" in sql and "s.candidate_id =" in sql for sql in statements)
    finally:
        event.remove(database.engine, "before_cursor_execute", capture)


def test_sql_updates_rollback_delete_and_candidate_cascade_sync(database, candidates):
    with database.session() as session:
        add_source(session, "mine", "change", raw_text="留存")
    with database.session() as session:
        session.execute(update(InterviewSource).where(InterviewSource.id == "change").values(raw_text="转化"))
        assert not search_knowledge(session, query="留存")
        assert search_knowledge(session, query="转化")
        session.rollback()
        assert search_knowledge(session, query="留存")
        assert not search_knowledge(session, query="转化")
    with database.session() as session:
        session.execute(delete(InterviewSource).where(InterviewSource.id == "change"))
        assert not search_knowledge(session, query="留存")
        add_source(session, "mine", "cascade", raw_text="留存")
        session.execute(delete(Candidate).where(Candidate.id == "mine"))
        assert not search_knowledge(session, query="留存")
        assert session.execute(text("SELECT count(*) FROM interview_source_fts_v1")).scalar() == 0


def test_old_database_backfill_and_restart_are_idempotent(database, candidates):
    with database.engine.begin() as connection:
        drop_search_index(connection)
    with database.session() as session:
        add_source(session, "mine", "old", raw_text="留存率")
        session.add(InterviewBrief(id="old-brief", candidate_id="mine", company="示例", role="产品",
                                   summary="转化分析", common_questions=[{"question": "漏斗指标"}]))
    for _ in range(2):
        database.create_schema()
    database.engine.dispose()  # Fresh connections must register the token function too.
    with database.session() as session:
        assert [h.item.id for h in search_knowledge(session, query="留存")] == ["old"]
        assert [h.item.id for h in search_knowledge(session, query="漏斗", kind="brief")] == ["old-brief"]
        session.execute(update(InterviewSource).values(raw_text="新词"))
        assert search_knowledge(session, query="新词")


def test_default_api_chat_and_task_use_index_and_readback(database, candidates, tmp_path):
    from applyos_agent.interview_tools import register_interview_tools
    from applyos_harness.permissions import ToolGateway, ToolPermission
    with database.session() as session:
        add_source(session, "mine", "local", raw_text="背景" * 1000 + "留存率 SQL", status="analyzed")
        add_source(session, "other", "foreign", raw_text="留存率 SQL")
        session.add(Job(id="job", candidate_id="mine", company="示例公司", role="产品经理", jd_raw="合成"))
        session.flush()
        run = AgentRun(candidate_id="mine", job_id="job", run_type="conversation", current_stage="ready_to_publish")
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway)
        result = gateway.execute(tool_name="search_interview_knowledge", run=run, arguments={
            "company": "示例公司", "role": "产品经理", "query": "留存率 SQL"},
            granted_permissions={ToolPermission.READ}, idempotency_key="fts-task-search")
        assert result["data"]["retrieval"] == "fts5_bm25"
        assert [s["id"] for s in result["data"]["sources"]] == ["local"]
        assert "留存率" in result["data"]["sources"][0]["text_preview"]
    with TestClient(create_app(database)) as client:
        response = client.get("/api/candidates/mine/interview-knowledge", params={"q": "留存率 SQL"}).json()
        assert [s["id"] for s in response["sources"]] == ["local"]
        assert "raw_text" not in response["sources"][0]
        assert len(client.get("/api/interview-knowledge", params={"q": "留存率"}).json()["sources"]) == 2
        chat = client.post("/api/conversations").json()["id"]
        client.patch(f"/api/conversations/{chat}", json={"job_id": "job"})
        turn = client.post(f"/api/pi/conversations/{chat}/turns", json={"content": "检索", "provider": {"model": "synthetic"}}).json()
        prefix = f"/api/pi/chat-tools/{turn['user']['id']}"
        result = client.post(prefix + "/search_interview_knowledge", json={"arguments": {"query": "留存率"}, "idempotency_key": "fts-chat-search"}).json()["result"]
        assert [s["id"] for s in result["sources"]] == ["local"]
        assert result["ranking_policy"] == "interview-reference-v3"
        assert result["sources"][0]["reference_ranking"]["eligible"]
        page = client.post(prefix + "/read_interview_source", json={"arguments": {"source_id": "local", "limit": 10}, "idempotency_key": "fts-chat-read"}).json()["result"]
        assert len(page["text"]) == 10 and page["next_offset"] == 10
        denied = client.post(prefix + "/read_interview_source", json={"arguments": {"source_id": "foreign"}, "idempotency_key": "fts-chat-denied"})
        assert denied.status_code >= 400


def test_readback_revision_and_candidate_boundary(database, candidates):
    with database.session() as session:
        add_source(session, "mine", "read", raw_text="留存" * 20)
        payload = ReadKnowledgeSourceInput(source_id="read", limit=4)
        first = read_source(session, payload, candidate_id="mine")
        with pytest.raises(HarnessError, match="来源不存在"):
            read_source(session, payload, candidate_id="other")
        with pytest.raises(HarnessError, match="content_hash"):
            read_source(session, payload.model_copy(update={"offset": 4}), candidate_id="mine")
        next_page = payload.model_copy(update={"offset": 4, "expected_hash": first["content_hash"]})
        assert read_source(session, next_page, candidate_id="mine")["text"] == "留存留存"
        session.execute(update(InterviewSource).where(InterviewSource.id == "read").values(raw_text="变化"))
        with pytest.raises(HarnessError, match="原文已变化"):
            read_source(session, next_page, candidate_id="mine")


def test_managed_migration_up_down_up_preserves_documents(tmp_path, monkeypatch):
    from pathlib import Path
    from alembic import command
    from alembic.config import Config
    from applyos_domain.database import Database
    path = tmp_path / "managed.db"
    url = f"sqlite:///{path.as_posix()}"
    monkeypatch.setenv("FETCHCV_DATABASE_URL", url)
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(config, "head")
    db = Database(url)
    try:
        with db.session() as session:
            session.add(Candidate(id="managed", name="合成")); session.flush()
            add_source(session, "managed", "survives", raw_text="留存率")
            assert search_knowledge(session, query="留存")
        command.downgrade(config, "20261021_0008")
        with db.session() as session:
            assert session.get(InterviewSource, "survives").raw_text == "留存率"
        command.upgrade(config, "head")
        with db.session() as session:
            assert [hit.item.id for hit in search_knowledge(session, query="留存")] == ["survives"]
            session.execute(update(InterviewSource).values(raw_text="转化"))
            assert not search_knowledge(session, query="留存")
            assert search_knowledge(session, query="转化")
    finally:
        db.engine.dispose()


def test_structured_role_aliases_survive_index_recall(database, candidates, tmp_path):
    from applyos_agent.interview_tools import register_interview_tools
    from applyos_harness.permissions import ToolGateway, ToolPermission
    with database.session() as session:
        add_source(session, "mine", "alias", company="字节", role="数分实习", title="字节数分面经", status="analyzed")
        add_source(session, "mine", "unrelated", company="其它公司", role="数分实习", title="其它公司面经", status="analyzed")
        session.add(Job(id="alias-job", candidate_id="mine", company="字节跳动", role="数据分析师实习生", jd_raw="合成")); session.flush()
        run = AgentRun(candidate_id="mine", job_id="alias-job", run_type="conversation", current_stage="ready_to_publish")
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path); register_interview_tools(gateway)
        result = gateway.execute(tool_name="search_interview_knowledge", run=run,
                                 arguments={"company": "字节跳动", "role": "数据分析师实习生"},
                                 granted_permissions={ToolPermission.READ}, idempotency_key="structured-alias")
        assert [s["id"] for s in result["data"]["sources"]] == ["alias"]


def test_preview_finds_body_evidence_when_first_query_term_is_metadata(database, candidates):
    body = "背景说明。" * 500 + "用户留存率 SQL 窗口函数的详细讨论。" + "结束。" * 300
    with database.session() as session:
        add_source(session, "mine", "metadata-first", company="示例公司", raw_text=body)
    with database.session() as session:
        hit = search_knowledge(session, query="示例公司 留存率 SQL", candidate_id="mine")[0]
        assert "留存率 SQL" in hit.preview
        assert hit.preview in body and len(hit.preview) <= 800
        assert "raw_text" in inspect(hit.item).unloaded


def test_preview_prefers_distinct_term_coverage_to_earliest_match(database, candidates):
    body = "SQL 的基本语法。" + "一般背景。" * 500 + "SQL 留存率 实验分组：详细分析。" + "结束。" * 400
    with database.session() as session:
        add_source(session, "mine", "cluster", raw_text=body)
    with database.session() as session:
        hit = search_knowledge(session, query="SQL 留存率 实验分组", candidate_id="mine")[0]
        assert "SQL 留存率 实验分组" in hit.preview
        assert hit.preview in body and len(hit.preview) <= 800


@pytest.mark.parametrize("query, evidence", [("ＳＱＬ", "SQL"), ("SQL", "ＳＱＬ"), ("sql", "ｓｑｌ"), ("留", "留存")])
def test_preview_unicode_variants_keep_original_text_offsets(database, candidates, query, evidence):
    body = "🧑背景。" * 600 + evidence + "测试内容。" * 150
    with database.session() as session:
        add_source(session, "mine", "unicode-preview", raw_text=body)
    with database.session() as session:
        hit = search_knowledge(session, query=query, candidate_id="mine")[0]
        assert evidence in hit.preview and hit.preview in body
        assert len(hit.preview) <= 800


def test_preview_processing_follows_scoped_pagination(database, candidates):
    with database.session() as session:
        for n in range(12):
            add_source(session, "mine", f"page-{n:02}", raw_text="SQL " + "留存。" * 300)
            add_source(session, "other", f"other-{n:02}", raw_text="SQL " + "留存。" * 300)
    statements = []
    def capture(conn, cursor, statement, *args): statements.append(statement)
    event.listen(database.engine, "before_cursor_execute", capture)
    try:
        with database.session() as session:
            all_ids = [h.item.id for h in search_knowledge(session, query="SQL", candidate_id="mine", limit=None)]
            statements.clear()
            page = search_knowledge(session, query="SQL", candidate_id="mine", limit=3, offset=4)
            assert [h.item.id for h in page] == all_ids[4:7]
            assert "raw_text" not in statements[0]  # No body access in ranking/sort phase.
            assert len(statements) == 2
            assert "substr(" in statements[1] and " IN (?, ?, ?)" in statements[1]
            assert all("raw_text" in inspect(h.item).unloaded for h in page)
    finally:
        event.remove(database.engine, "before_cursor_execute", capture)


def test_preview_uncapped_library_still_hydrates_multiple_batches(database, candidates):
    with database.session() as session:
        for n in range(260):
            add_source(session, "mine", f"batch-{n}", raw_text="SQL 和留存")
    with database.session() as session:
        hits = search_knowledge(session, candidate_id="mine", limit=None)
        assert len(hits) == 260
        assert all(h.preview == "SQL 和留存" for h in hits)


def test_long_chinese_query_fallback_is_opt_in_scoped_and_keeps_english_exact(database, candidates):
    query = "请问如何计算用户留存率以及使用SQL分析"
    body = "背景。" * 500 + "用户留存率 SQL 窗口函数。"
    with database.session() as session:
        add_source(session, "mine", "answer", raw_text=body)
        add_source(session, "mine", "no-sql", raw_text="用户留存率的计算方法")
        add_source(session, "mine", "no-topic", raw_text="请问如何面试？SQL")
        add_source(session, "other", "foreign-answer", raw_text=query)
    with database.session() as session:
        assert not search_knowledge(session, query=query, candidate_id="mine")
        hits = search_knowledge(session, query=query, candidate_id="mine", relax_if_empty=True)
        assert [h.item.id for h in hits] == ["answer"]
        assert hits[0].match_strategy == "lexical_relaxed"
        assert "用户留存率 SQL" in hits[0].preview and hits[0].preview in body


def test_relaxation_does_not_mix_in_weak_hits_or_relax_beyond_last_page(database, candidates):
    query = "如何计算用户留存率"
    with database.session() as session:
        add_source(session, "mine", "exact", raw_text=query)
        add_source(session, "mine", "partial", raw_text="用户留存率")
    with database.session() as session:
        hits = search_knowledge(session, query=query, candidate_id="mine", relax_if_empty=True)
        assert [h.item.id for h in hits] == ["exact"]
        assert hits[0].match_strategy == "exact"
        assert not search_knowledge(session, query=query, candidate_id="mine", relax_if_empty=True, offset=1)


@pytest.mark.parametrize("query", ["客户流失", "留", "如何呢吗请问面试问题", "SQL missing", "***"])
def test_short_or_unrelated_queries_are_not_broadened(database, candidates, query):
    with database.session() as session:
        add_source(session, "mine", "unrelated", raw_text="SQL 窗口函数与产品指标")
    with database.session() as session:
        assert not search_knowledge(session, query=query, candidate_id="mine", relax_if_empty=True)


def test_agent_natural_language_fallback_and_library_strict_mode(database, candidates, tmp_path):
    from applyos_agent.interview_tools import register_interview_tools
    from applyos_harness.permissions import ToolGateway, ToolPermission
    query = "请问如何计算用户留存率以及使用SQL分析"
    with database.session() as session:
        add_source(session, "mine", "natural-local", raw_text="用户留存率 SQL 窗口函数", status="analyzed")
        add_source(session, "other", "natural-foreign", raw_text=query)
        session.add(Job(id="natural-job", candidate_id="mine", company="示例公司", role="产品经理", jd_raw="合成"))
        session.flush()
        run = AgentRun(candidate_id="mine", job_id="natural-job", run_type="conversation", current_stage="ready_to_publish")
        session.add(run); session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_interview_tools(gateway)
        result = gateway.execute(tool_name="search_interview_knowledge", run=run, arguments={
            "company": "示例公司", "role": "产品经理", "query": query},
            granted_permissions={ToolPermission.READ}, idempotency_key="natural-task-search")["data"]
        assert [s["id"] for s in result["sources"]] == ["natural-local"]
        assert result["sources"][0]["match_strategy"] == "lexical_relaxed"
        assert result["retrieval_notice"]
    with TestClient(create_app(database)) as client:
        strict = client.get("/api/candidates/mine/interview-knowledge", params={"q": query}).json()
        assert strict["sources"] == []
        chat = client.post("/api/conversations").json()["id"]
        client.patch(f"/api/conversations/{chat}", json={"job_id": "natural-job"})
        turn = client.post(f"/api/pi/conversations/{chat}/turns", json={"content": "检索", "provider": {"model": "synthetic"}}).json()
        result = client.post(f"/api/pi/chat-tools/{turn['user']['id']}/search_interview_knowledge", json={
            "arguments": {"query": query}, "idempotency_key": "natural-chat-search"}).json()["result"]
        assert [s["id"] for s in result["sources"]] == ["natural-local"]
        assert result["sources"][0]["match_strategy"] == "lexical_relaxed"
        assert result["retrieval_notice"]
