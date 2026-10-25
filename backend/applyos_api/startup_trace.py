"""Opt-in, data-free launch timings shared by the source and frozen sidecar."""
from __future__ import annotations

import time

_STARTED = time.perf_counter()

import json
import os
import sys

_entry_emitted = False


def mark_startup(stage: str, duration_ms: float | None = None) -> None:
    trace_id = os.getenv("FETCHCV_STARTUP_TRACE_ID", "")
    if not trace_id:
        return
    event = {
        "traceId": trace_id,
        "stage": stage,
        "elapsedMs": round((time.perf_counter() - _STARTED) * 1000, 3),
        "timestampMs": round(time.time() * 1000, 3),
    }
    if duration_ms is not None:
        event["durationMs"] = round(duration_ms, 3)
    try:
        print("FETCHCV_STARTUP " + json.dumps(event, separators=(",", ":")), file=sys.stderr, flush=True)
    except (OSError, ValueError):
        # Diagnostics must not prevent startup when the parent closes its pipe.
        pass


def mark_python_entry() -> None:
    global _entry_emitted
    if not _entry_emitted:
        _entry_emitted = True
        mark_startup("python.entry")
