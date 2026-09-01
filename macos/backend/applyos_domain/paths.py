from __future__ import annotations

import os
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def artifact_root() -> Path:
    configured = os.getenv("FETCHCV_ARTIFACT_ROOT", "").strip()
    root = Path(configured) if configured else PROJECT_ROOT / "artifacts"
    root = root.resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root
