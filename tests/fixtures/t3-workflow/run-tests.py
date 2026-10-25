"""Offline test launcher; validate synthetic paths before importing application modules."""
import os
from pathlib import Path
import sys
from common import block_external_connections

root = Path(os.environ["FETCHCV_T3_TEST_ROOT"]).resolve()
repo = Path(__file__).resolve().parents[3]
root.relative_to(repo / "artifacts" / "t3-independent")
for name in ["APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "FETCHCV_SETTINGS_FILE", "FETCHCV_ARTIFACT_ROOT", "FETCHCV_WORKSPACE_ROOT"]:
    Path(os.environ[name]).resolve().relative_to(root)
Path(os.environ["FETCHCV_DATABASE_URL"][10:]).resolve().relative_to(root)
assert os.environ["FETCHCV_AGENT_RUNTIME"] == "mock"
block_external_connections()
sys.path.insert(0, str(repo / "backend"))
import pytest
raise SystemExit(pytest.main(sys.argv[1:]))
