"""Measure imports and run existing tests without changing the old environment."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys


parser = argparse.ArgumentParser()
parser.add_argument("--python", required=True)
parser.add_argument("--label", required=True)
parser.add_argument("--basetemp", required=True)
args = parser.parse_args()
if not re.fullmatch(r"[a-z][a-z0-9-]*", args.label):
    raise SystemExit("Invalid evidence label")
root = Path(__file__).resolve().parents[2]
evidence = root / ".m1-evidence"
approved_temp_root = Path(r"D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136").resolve()
basetemp = Path(args.basetemp).resolve()
if basetemp == approved_temp_root or not basetemp.is_relative_to(approved_temp_root):
    raise SystemExit(f"--basetemp must be a fresh child of {approved_temp_root}")
if not approved_temp_root.is_dir():
    raise SystemExit(f"Approved M1 temporary root does not exist: {approved_temp_root}")
if basetemp.exists() or os.path.lexists(basetemp):
    raise SystemExit(f"Refusing to reuse or delete an existing pytest root: {basetemp}")
import_root = approved_temp_root / f"{args.label}-imports"
if import_root == basetemp:
    raise SystemExit("Import and pytest roots must be independent")
if import_root.exists() or os.path.lexists(import_root):
    raise SystemExit(f"Refusing to reuse or delete an existing import root: {import_root}")
outputs = [
    evidence / f"{args.label}-imports.json",
    evidence / f"{args.label}-deletions.jsonl",
    evidence / f"{args.label}-pytest.xml",
    evidence / f"{args.label}-pytest.log",
    evidence / f"{args.label}-pytest-exit.json",
]
if any(path.exists() for path in outputs):
    raise SystemExit("Refusing to overwrite existing M1 evidence")
env = {key: value for key, value in os.environ.items()
       if not key.startswith("FETCHCV_") and not key.endswith("API_KEY")}
env.update(PYTHONDONTWRITEBYTECODE="1", PYTHONUTF8="1", PYTHONIOENCODING="utf-8", PYTHONPATH=str(root / "backend"),
           FETCHCV_DISABLE_TASK_WORKER="1", FETCHCV_ALLOW_MOCK_RUNTIME="1",
           FETCHCV_DATABASE_URL="sqlite:///:memory:", TEMP=str(import_root), TMP=str(import_root),
           TMPDIR=str(import_root), FETCHCV_ARTIFACT_ROOT=str(import_root / "artifacts"),
           FETCHCV_WORKSPACE_ROOT=str(import_root / "workspace"),
           FETCHCV_XHS_CREDENTIAL_FILE=str(import_root / "synthetic-credentials.bin"))
import_root.mkdir(mode=0o700)
samples = []
for index in range(3):
    command = [args.python, "-B", "-c",
               "import time,json; t=time.perf_counter(); import applyos_api.main; "
               "print(json.dumps({'import_ms':(time.perf_counter()-t)*1000}))"]
    result = subprocess.run(command, cwd=root, env=env, text=True, encoding="utf-8", capture_output=True)
    samples.append({"exit_code": result.returncode, "stdout": result.stdout, "stderr": result.stderr})
    if result.returncode:
        break
with (evidence / f"{args.label}-imports.json").open("x", encoding="utf-8") as stream:
    json.dump(samples, stream, ensure_ascii=False, indent=2)
print(json.dumps({"label": args.label, "imports": samples}, ensure_ascii=False), flush=True)
if any(sample["exit_code"] for sample in samples):
    raise SystemExit("Import failed; tests were not started")
env.update(M1_PYTEST_BASETEMP=str(basetemp),
           M1_DELETE_LOG=str(evidence / f"{args.label}-deletions.jsonl"),
           M1_JUNIT=str(evidence / f"{args.label}-pytest.xml"))
command = [args.python, "-B", str(root / "scripts/m1/guarded-pytest.py")]
with (evidence / f"{args.label}-pytest.log").open("x", encoding="utf-8") as stream:
    result = subprocess.run(command, cwd=root, env=env, stdout=stream, stderr=subprocess.STDOUT)
with (evidence / f"{args.label}-pytest-exit.json").open("x", encoding="utf-8") as stream:
    json.dump({"command": command, "exit_code": result.returncode, "basetemp": env["M1_PYTEST_BASETEMP"]}, stream, indent=2)
print(f"{args.label} pytest exit={result.returncode}", flush=True)
raise SystemExit(result.returncode)
