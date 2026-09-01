from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from applyos_domain.database import Database  # noqa: E402


@pytest.fixture
def database(tmp_path: Path) -> Database:
    db = Database(f"sqlite:///{(tmp_path / 'test.db').as_posix()}")
    db.create_schema()
    try:
        yield db
    finally:
        db.engine.dispose()


@pytest.fixture(autouse=True)
def allow_test_mock_runtime(monkeypatch):
    monkeypatch.setenv("FETCHCV_ALLOW_MOCK_RUNTIME", "1")
