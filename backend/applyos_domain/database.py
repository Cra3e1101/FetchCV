from __future__ import annotations

import os
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .base import Base
from .knowledge_search import register_search_functions, install_search_index, drop_search_index


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE_PATH = BACKEND_ROOT / "data" / "fetchcv.db"
LEGACY_DATABASE_PATH = BACKEND_ROOT / "data" / "applyos.db"


def default_database_url() -> str:
    configured = os.getenv("FETCHCV_DATABASE_URL", "").strip()
    if configured:
        return configured
    DEFAULT_DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not DEFAULT_DATABASE_PATH.exists() and LEGACY_DATABASE_PATH.exists():
        shutil.copy2(LEGACY_DATABASE_PATH, DEFAULT_DATABASE_PATH)
    return f"sqlite:///{DEFAULT_DATABASE_PATH.as_posix()}"


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    register_search_functions(dbapi_connection)
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


class Database:
    def __init__(self, url: str | None = None) -> None:
        self.url = url or default_database_url()
        connect_args = {"check_same_thread": False} if self.url.startswith("sqlite") else {}
        self.engine: Engine = create_engine(self.url, future=True, connect_args=connect_args)
        if self.url.startswith("sqlite"):
            event.listen(self.engine, "connect", _enable_sqlite_foreign_keys)
        self.session_factory = sessionmaker(
            bind=self.engine,
            class_=Session,
            expire_on_commit=False,
            autoflush=False,
            future=True,
        )

    def create_schema(self, on_stage: Callable[[str, float], None] | None = None) -> None:
        started = time.perf_counter()
        Base.metadata.create_all(self.engine)
        self._ensure_additive_columns()
        if on_stage is not None:
            on_stage("python.schema_ready", (time.perf_counter() - started) * 1000)
        started = time.perf_counter()
        with self.engine.begin() as connection:
            install_search_index(connection)
        if on_stage is not None:
            on_stage("python.index_ready", (time.perf_counter() - started) * 1000)

    def _ensure_additive_columns(self) -> None:
        """Apply tiny idempotent upgrades needed by packaged desktop installs.

        Alembic remains the source of truth for managed deployments. Existing
        local desktop databases predate migration stamping, so create_all alone
        cannot add newly introduced columns.
        """
        inspector = inspect(self.engine)
        tables = set(inspector.get_table_names())
        if "mcp_server_configs" in tables and "tool_policies" not in {item["name"] for item in inspector.get_columns("mcp_server_configs")}:
            with self.engine.begin() as connection:
                connection.execute(text("ALTER TABLE mcp_server_configs ADD COLUMN tool_policies JSON NOT NULL DEFAULT '{}'"))
        if "rewrite_proposals" in tables and "claim_contract" not in {item["name"] for item in inspector.get_columns("rewrite_proposals")}:
            with self.engine.begin() as connection:
                connection.execute(text("ALTER TABLE rewrite_proposals ADD COLUMN claim_contract JSON NOT NULL DEFAULT '{}'"))
        if "jobs" in tables:
            columns = {item["name"] for item in inspector.get_columns("jobs")}
            additions = {"context_json": "JSON NOT NULL DEFAULT '{}'", "jd_provenance": "JSON NOT NULL DEFAULT '{}'",
                         "input_revision": "INTEGER NOT NULL DEFAULT 1"}
            with self.engine.begin() as connection:
                for name, definition in additions.items():
                    if name not in columns:
                        connection.execute(text(f"ALTER TABLE jobs ADD COLUMN {name} {definition}"))

    def drop_schema(self) -> None:
        with self.engine.begin() as connection:
            drop_search_index(connection)
        Base.metadata.drop_all(self.engine)

    @contextmanager
    def session(self) -> Iterator[Session]:
        session = self.session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


_database: Database | None = None


def get_database() -> Database:
    global _database
    if _database is None:
        _database = Database()
    return _database


def reset_database(database: Database | None = None) -> None:
    global _database
    _database = database
