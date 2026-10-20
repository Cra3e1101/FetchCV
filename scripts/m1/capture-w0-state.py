"""Capture create-only W0 authority and immutable-file evidence."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / ".m1-evidence"
BASELINE = "1959bb8d3832fd405d77db9fb53d3b40e6c35644"


def digest(path: Path) -> dict[str, object]:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return {"path": path.relative_to(ROOT).as_posix(), "bytes": path.stat().st_size, "sha256": hasher.hexdigest()}


def write_new(name: str, value: object) -> None:
    with (EVIDENCE / name).open("x", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")


status = subprocess.run(
    ["git", "-c", "safe.directory=D:/hesan/Desktop/VSCODES/FetchCV_Windows", "status", "--short"],
    cwd=ROOT, check=True, text=True, encoding="utf-8", capture_output=True,
)
write_new("w0-baseline-authority.json", {
    "source": "user-observed normal-permission baseline",
    "gitBaseline": BASELINE,
    "trackedFiles": 266,
    "python": {"passed": 157, "durationSeconds": 65.12},
    "node": {"total": 100, "workspace": 5, "unit": 92, "unitFiles": 18, "sidecar": 3},
    "importMilliseconds": 1559,
    "historicalSandbox": {"passed": 155, "skipped": 2, "note": "symlink behavior differs; retained as historical evidence only"},
    "statement": "Authority record only. W0 did not rerun the old baseline.",
})
write_new("w0-handoff-git-status.json", {"command": status.args, "exitCode": status.returncode, "stdout": status.stdout, "stderr": status.stderr})

targets = [
    ROOT / "test use" / "高子强的简历.pdf",
    ROOT / "package.json",
    ROOT / "package-lock.json",
    ROOT / "backend" / "pyproject.toml",
]
targets.extend(sorted((ROOT / "artifacts").rglob("*")))
targets.extend(sorted((ROOT / "release").rglob("*.exe")))
targets.extend(sorted((ROOT / "backend" / "data").rglob("*.db")))
files = []
for target in targets:
    if target.is_symlink():
        raise SystemExit(f"Refusing to hash symlink: {target}")
    if target.is_file():
        files.append(digest(target))
write_new("w0-immutable-files.json", {
    "scope": ["test use/高子强的简历.pdf", "package manifests", "artifacts/**", "release/**/*.exe", "backend/data/**/*.db"],
    "count": len(files),
    "files": files,
})
