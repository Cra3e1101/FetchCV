import json
import pytest
from applyos_agent.result_archive import archive_result, read_result
from applyos_harness.errors import HarnessError

def test_archive_survives_new_session_and_cannot_cross_scope(database):
    value={"data":{"fact_ids":[f"fact_{i}" for i in range(120)],"jd":"真实岗位"*10000,"facts":[{"id":f"fact_{i}"} for i in range(120)]}}
    with database.session() as session:
        ref=archive_result(session,"run:one",value)
    with database.session() as session:
        with pytest.raises(HarnessError):read_result(session,"run:two",ref["arguments"])
        parts=[];args=ref["arguments"]
        while True:
            page=read_result(session,"run:one",args);parts.append(page["text"])
            if page["next_offset"] is None:break
            args={**args,"offset":page["next_offset"]}
        assert json.loads("".join(parts))==value
        assert archive_result(session,"run:one",value)==ref


def test_migration_upgrades_existing_database_and_preserves_rows(database, tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    from sqlalchemy import inspect
    from applyos_domain.models import Candidate
    from pathlib import Path
    with database.session() as session:
        candidate=Candidate(name="preserved")
        session.add(candidate);session.flush();ident=candidate.id
    from applyos_domain.models import ToolResultArchive
    ToolResultArchive.__table__.drop(database.engine)
    cfg=Config(str(Path(__file__).resolve().parents[1]/"alembic.ini"))
    cfg.set_main_option("script_location",str(Path(__file__).resolve().parents[1]/"alembic"))
    monkeypatch.setenv("FETCHCV_DATABASE_URL",database.url)
    command.stamp(cfg,"20260721_0006")
    command.upgrade(cfg,"head")
    with database.session() as session:assert session.get(Candidate,ident).name=="preserved"
    assert "tool_result_archives" in inspect(database.engine).get_table_names()
