from __future__ import annotations

import os
import shutil
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import Session, sessionmaker

from .base import Base


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

    def create_schema(self) -> None:
        Base.metadata.create_all(self.engine)
        self._ensure_additive_columns()

    def _ensure_additive_columns(self) -> None:
        """Apply tiny idempotent upgrades needed by packaged desktop installs.

        Alembic remains the source of truth for managed deployments. Existing
        local desktop databases predate migration stamping, so create_all alone
        cannot add newly introduced columns.
        """
        inspector = inspect(self.engine)
        if "mcp_server_configs" not in inspector.get_table_names():
            return
        columns = {item["name"] for item in inspector.get_columns("mcp_server_configs")}
        if "tool_policies" not in columns:
            with self.engine.begin() as connection:
                connection.execute(text("ALTER TABLE mcp_server_configs ADD COLUMN tool_policies JSON NOT NULL DEFAULT '{}'"))

    def drop_schema(self) -> None:
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
