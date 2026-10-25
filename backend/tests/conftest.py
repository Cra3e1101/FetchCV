from __future__ import annotations

import sys
import os
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


def _private_fixture_path(env_key, filename):
    """Legacy personal fixtures are not distributed with the source tree."""
    configured = os.environ.get(env_key)
    path = Path(configured) if configured else BACKEND_ROOT.parent / "test use" / filename
    if not path.is_file():
        reason = f"Private legacy fixture unavailable: {path}; supply {env_key} with the original fixture"
        if configured or os.environ.get("FETCHCV_REQUIRE_PRIVATE_FIXTURES") == "1":
            pytest.fail(reason)
        pytest.skip(reason)
    return path


@pytest.fixture
def legacy_resume_pdf():
    return _private_fixture_path("FETCHCV_TEST_LEGACY_RESUME", "高子强的简历.pdf")


@pytest.fixture
def legacy_job_descriptions():
    return _private_fixture_path("FETCHCV_TEST_LEGACY_JDS", "JD.txt")
