"""Run venv or pip in-process while constraining and recording Python deletions."""
from __future__ import annotations

import argparse
import atexit
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import time


parser = argparse.ArgumentParser()
parser.add_argument("--module", choices=("venv", "pip"), required=True)
parser.add_argument("--log", required=True)
parser.add_argument("--allowed-root", action="append", required=True)
parser.add_argument("--module-path")
parser.add_argument("args", nargs=argparse.REMAINDER)
options = parser.parse_args()

log_path = Path(options.log).resolve()
roots = tuple(Path(value).resolve() for value in options.allowed_root)
project_root = Path(__file__).resolve().parents[2]
work_root = (project_root / ".m1-work").resolve()
evidence_root = (project_root / ".m1-evidence").resolve()
venv_root = (project_root / "backend" / ".venv-m1").resolve()
external_root = Path(r"D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136").resolve()
if not external_root.is_dir():
    raise SystemExit(f"Approved external M1 root does not exist: {external_root}")
for root in roots:
    approved = root == venv_root or (
        root != work_root and root.is_relative_to(work_root)
    ) or (
        root != external_root and root.is_relative_to(external_root)
    )
    if not approved:
        raise SystemExit(f"Unapproved deletion root: {root}")
temp_values = {os.environ.get(name) for name in ("TEMP", "TMP", "TMPDIR")}
if None in temp_values or len(temp_values) != 1:
    raise SystemExit("TEMP, TMP, and TMPDIR must name the same approved run directory")
temp_root = Path(next(iter(temp_values))).resolve()
if (not temp_root.is_dir() or temp_root == external_root
        or not temp_root.is_relative_to(external_root)
        or temp_root not in roots):
    raise SystemExit(f"Python temp root is not an existing approved run directory: {temp_root}")
tempfile.tempdir = str(temp_root)
if log_path == evidence_root or not log_path.is_relative_to(evidence_root):
    raise SystemExit(f"Audit log must be a child of {evidence_root}")
if log_path.exists() or os.path.lexists(log_path):
    raise SystemExit(f"Refusing to overwrite audit log: {log_path}")
log_path.parent.mkdir(parents=True, exist_ok=True)

successful: list[tuple[str, str, str]] = []
subprocesses = 0


def write(event: str, operation: str, path: str, **details: object) -> None:
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write(json.dumps({
            "event": event,
            "operation": operation,
            "path": path,
            "pid": os.getpid(),
            "time": time.time(),
            **details,
        }, ensure_ascii=False) + "\n")


def checked_path(raw: object, operation: str, dir_fd: object = None) -> Path:
    if dir_fd not in (None, -1) or not isinstance(raw, (str, bytes, os.PathLike)):
        write("blocked", operation, str(raw), reason="unresolved directory descriptor")
        os._exit(86)
    decoded = os.fsdecode(raw)
    if decoded.startswith("\\\\?\\UNC\\"):
        decoded = "\\\\" + decoded[8:]
    elif decoded.startswith("\\\\?\\"):
        decoded = decoded[4:]
    candidate = Path(decoded)
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate
    candidate = candidate.parent.resolve() / candidate.name
    if not any(candidate != root and candidate.is_relative_to(root) for root in roots):
        write("blocked", operation, str(candidate), reason="outside approved child paths")
        os._exit(86)
    return candidate


def audit(event: str, args: tuple[object, ...]) -> None:
    global subprocesses
    if event in ("os.remove", "os.rmdir"):
        descriptor = args[1] if len(args) > 1 else None
        target = checked_path(args[0], event, descriptor)
        write("attempt", event, str(target))
    elif event == "subprocess.Popen":
        subprocesses += 1
        write("native_boundary", event, str(args[0]),
              note="Child-process filesystem operations are outside this process audit hook")


sys.addaudithook(audit)


def wrap_delete(name: str) -> None:
    original = getattr(os, name)

    def guarded(path: object, *args: object, **kwargs: object) -> object:
        checked = checked_path(path, name, kwargs.get("dir_fd"))
        existed = os.path.lexists(checked)
        kind = "directory" if existed and checked.is_dir() and not checked.is_symlink() else "file"
        result = original(path, *args, **kwargs)
        successful.append((name, str(checked), kind))
        write("deleted", name, str(checked), existed_before=existed, kind=kind)
        return result

    setattr(os, name, guarded)


for operation in ("unlink", "remove", "rmdir"):
    wrap_delete(operation)

if options.module_path:
    module_path = Path(options.module_path).resolve()
    if not module_path.is_file():
        raise SystemExit(f"Module path is not a file: {module_path}")
    sys.path.insert(0, str(module_path))

module_args = options.args[1:] if options.args[:1] == ["--"] else options.args
sys.argv = [options.module, *module_args]
exit_code = 0


def summarize() -> None:
    unique = {(path, kind) for _, path, kind in successful}
    write("summary", options.module, "", exit_code=exit_code,
          successful_api_calls=len(successful), unique_paths=len(unique),
          deleted_files=sum(kind == "file" for _, kind in unique),
          deleted_directories=sum(kind == "directory" for _, kind in unique),
          native_or_child_boundaries=subprocesses)


# Register before pip imports tempfile helpers; atexit runs later registrations
# first, so their cleanup is included in this final summary.
atexit.register(summarize)
try:
    runpy.run_module(options.module, run_name="__main__", alter_sys=True)
except SystemExit as exc:
    exit_code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
except BaseException:
    exit_code = 1
    raise
raise SystemExit(exit_code)
