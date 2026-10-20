"""Capture and validate the locked M1 Python environment without modifying it."""
from __future__ import annotations

import argparse
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from packaging.utils import canonicalize_name


parser = argparse.ArgumentParser()
parser.add_argument("--runtime-lock", required=True)
parser.add_argument("--dev-lock", required=True)
parser.add_argument("--build-lock", required=True)
parser.add_argument("--registry-artifacts", required=True)
parser.add_argument("--wheelhouse", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()

output = Path(args.output).resolve()
if output.exists():
    raise SystemExit(f"Refusing to overwrite evidence: {output}")


def lock_entries(path: str) -> dict[str, dict[str, str]]:
    entries: dict[str, dict[str, str]] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        match = re.match(r"^([A-Za-z0-9_.-]+)==([^ ]+) --hash=sha256:([0-9a-f]{64})$", line)
        if match:
            name, version, digest = match.groups()
            entries[canonicalize_name(name)] = {"version": version, "sha256": digest}
    return entries


categories = {
    "runtime": lock_entries(args.runtime_lock),
    "dev_policy": lock_entries(args.dev_lock),
    "build": lock_entries(args.build_lock),
    "bootstrap": {"pip": {"version": "24.2", "sha256": "provided by CPython venv bootstrap"}},
}
expected = {name: item for values in categories.values() for name, item in values.items()}
registry = json.loads(Path(args.registry_artifacts).read_text(encoding="utf-8"))
registry_by_name = {canonicalize_name(item["name"]): item for item in registry["artifacts"]}

installed: list[dict[str, object]] = []
installed_names: set[str] = set()
for dist in sorted(metadata.distributions(), key=lambda item: canonicalize_name(item.metadata["Name"])):
    name = canonicalize_name(dist.metadata["Name"])
    installed_names.add(name)
    artifact = registry_by_name.get(name)
    local_wheel = None
    if name == "fetchcv-backend":
        candidates = list(Path(args.wheelhouse).glob("fetchcv_backend-0.1.0-*.whl"))
        if len(candidates) != 1:
            raise SystemExit(f"Expected one local wheel, found {len(candidates)}")
        wheel = candidates[0]
        local_wheel = {
            "filename": wheel.name,
            "bytes": wheel.stat().st_size,
            "sha256": hashlib.sha256(wheel.read_bytes()).hexdigest(),
            "source": "local staged project source",
        }
    installed.append({
        "name": dist.metadata["Name"],
        "normalized_name": name,
        "version": dist.version,
        "categories": [category for category, entries in categories.items() if name in entries],
        "license_expression": dist.metadata.get("License-Expression"),
        "license": dist.metadata.get("License"),
        "license_classifiers": dist.metadata.get_all("Classifier") or [],
        "project_urls": dist.metadata.get_all("Project-URL") or [],
        "artifact": local_wheel or artifact,
    })

discarded = [
    "ansicon", "apify-fingerprint-datapoints", "blessed", "browser-cookie3", "browserforge",
    "camoufox", "claude-agent-sdk", "editor", "inquirer", "jinxed", "language-tags", "lz4",
    "markdown-it-py", "mdurl", "numpy", "orjson", "platformdirs", "playwright", "pycryptodomex",
    "pyee", "pysocks", "qrcode", "readchar", "rich", "rich-click", "runs", "screeninfo",
    "shadowcopy", "sniffio", "ua-parser", "ua-parser-builtins", "wcwidth", "wmi", "xhshow",
    "xiaohongshu-cli", "xmod",
]
discarded_present = sorted(set(discarded) & installed_names)
missing = sorted(set(expected) - installed_names)
unexpected = sorted(installed_names - set(expected))
version_mismatches = sorted(
    name for name, item in expected.items()
    if name in installed_names and metadata.version(name) != item["version"]
)
pip_check = subprocess.run(
    [sys.executable, "-m", "pip", "check"], text=True, capture_output=True, check=False
)

venv_root = Path(sys.prefix)
venv_files = [path for path in venv_root.rglob("*") if path.is_file()]
payload = {
    "schema_version": 1,
    "python": sys.version,
    "executable": sys.executable,
    "prefix": sys.prefix,
    "commands": {
        "pip_check": [sys.executable, "-m", "pip", "check"],
        "capture": sys.argv,
    },
    "pip_check": {
        "exit_code": pip_check.returncode,
        "stdout": pip_check.stdout,
        "stderr": pip_check.stderr,
    },
    "expected_category_counts": {key: len(value) for key, value in categories.items()},
    "expected_union_count": len(expected),
    "installed_count": len(installed),
    "missing": missing,
    "unexpected": unexpected,
    "version_mismatches": version_mismatches,
    "discarded_policy_count": len(discarded),
    "discarded_policy_present": discarded_present,
    "venv_file_count": len(venv_files),
    "venv_bytes": sum(path.stat().st_size for path in venv_files),
    "installed": installed,
}
payload["acceptance"] = (
    pip_check.returncode == 0
    and len(installed) == 65
    and not missing
    and not unexpected
    and not version_mismatches
    and len(discarded) == 36
    and not discarded_present
)
output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({key: payload[key] for key in (
    "expected_category_counts", "expected_union_count", "installed_count", "missing",
    "unexpected", "version_mismatches", "discarded_policy_count", "discarded_policy_present",
    "venv_file_count", "venv_bytes", "pip_check", "acceptance",
)}, ensure_ascii=False, indent=2))
raise SystemExit(0 if payload["acceptance"] else 1)
