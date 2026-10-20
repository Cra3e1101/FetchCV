"""Run unchanged tests with a deletion boundary and JSONL receipts."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
BASE = Path(os.environ["M1_PYTEST_BASETEMP"]).resolve()
LOG = Path(os.environ["M1_DELETE_LOG"]).resolve()
APPROVED_TEMP_ROOT = Path(r"D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136").resolve()
if BASE == APPROVED_TEMP_ROOT or not BASE.is_relative_to(APPROVED_TEMP_ROOT):
    raise SystemExit("M1 pytest root must be a fresh child of the approved external root")
if not APPROVED_TEMP_ROOT.is_dir():
    raise SystemExit("Approved external M1 root does not exist")
if not LOG.is_relative_to(ROOT / ".m1-evidence"):
    raise SystemExit("M1 deletion log must remain inside .m1-evidence")
if BASE.exists() or os.path.lexists(BASE) or LOG.exists():
    raise SystemExit("Refusing to reuse an existing test root or deletion log")


def receipt(status: str, operation: str, path: str, **details: object) -> None:
    with LOG.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({"status": status, "operation": operation, "path": path,
                                 "pid": os.getpid(), "time": time.time(), **details}, ensure_ascii=False) + "\n")


def check_path(raw: object, operation: str, dir_fd: object = None) -> str:
    if dir_fd is not None or not isinstance(raw, (str, bytes, os.PathLike)):
        receipt("blocked", operation, str(raw), reason="unresolved directory descriptor")
        os._exit(86)
    decoded = os.fsdecode(raw)
    if decoded.startswith("\\\\?\\UNC\\"):
        decoded = "\\\\" + decoded[8:]
    elif decoded.startswith("\\\\?\\"):
        decoded = decoded[4:]
    candidate = Path(decoded)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    # Resolve the parent, not the leaf: unlinking a symlink removes the link.
    candidate = candidate.parent.resolve() / candidate.name
    if candidate != BASE and not candidate.is_relative_to(BASE):
        receipt("blocked", operation, str(candidate), reason="outside pytest temporary root")
        os._exit(86)
    return str(candidate)


def audit(event: str, args: tuple[object, ...]) -> None:
    if event in ("os.remove", "os.rmdir"):
        descriptor = args[1] if len(args) > 1 and args[1] != -1 else None
        check_path(args[0], event, descriptor)


sys.addaudithook(audit)


def wrap_delete(name: str) -> None:
    original = getattr(os, name)

    def guarded(path: object, *args: object, **kwargs: object) -> object:
        checked = check_path(path, name, kwargs.get("dir_fd"))
        existed = os.path.lexists(checked)
        result = original(path, *args, **kwargs)
        receipt("deleted", name, checked, existed_before=existed)
        return result

    setattr(os, name, guarded)


for operation in ("unlink", "remove", "rmdir"):
    wrap_delete(operation)

os.environ.update(TEMP=str(BASE), TMP=str(BASE), TMPDIR=str(BASE))
tempfile.tempdir = str(BASE)
os.environ["FETCHCV_DATABASE_URL"] = "sqlite:///:memory:"
os.environ["FETCHCV_ARTIFACT_ROOT"] = str(BASE / "artifacts")
os.environ["FETCHCV_WORKSPACE_ROOT"] = str(BASE / "workspace")
# Every fixture gets a separate database. Let settings follow that database;
# a shared settings file contaminates permission state across tests.
os.environ.pop("FETCHCV_SETTINGS_FILE", None)
os.environ["FETCHCV_XHS_CREDENTIAL_FILE"] = str(BASE / "synthetic-credentials.bin")

import pytest  # noqa: E402

raise SystemExit(pytest.main([
    "backend/tests", "--basetemp", str(BASE), "-p", "no:cacheprovider", "-s",
    "--junitxml=" + os.environ["M1_JUNIT"], *sys.argv[1:],
]))
