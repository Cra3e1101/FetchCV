# Parser worker

## Current status (2026-10-08)

The experimental status below is a retained 2026-09-22 snapshot, superseded by the later accepted AppContainer integration. The narrowly scoped parser profile was authorized; the worker is wired into APP ingestion and candidate packaging. See `docs/FETCHCV_M5_PARSER_CORPUS_20261003.md` and `docs/FETCHCV_BUILD_RECOVERY_20261005.md` for actual run evidence and its limits. This does not authorize access to other APPDATA directories.

`local-structured-1.1` preserves paragraph separators inside DOCX table cells. The ingestion job protocol stays at `local-structured-1`, accepts the explicit parser revisions 1 and 1.1, and stores the actual returned revision on each new Document. Existing documents are not rewritten or automatically re-parsed. The original 1 result remains accepted for compatibility; this is not a demand that every result came from the patched worker.

The current worker is `local-structured-1.2`, also accepted by protocol 1. It includes rotated PDF text instead of silently stripping it. Extraction warnings mark the document `needs_review` with `layoutWarning=true`; retained text is available for review but not promoted to trusted retrieval. The warning collector records only a boolean, not log contents. Warning absence is not proof of layout fidelity: `layoutVerified` remains false.

Optional OCR is still not integrated into this worker. The old Electron OCR queue launches Tesseract as a child process, which cannot simply be added to this worker's child-process prohibition. Scanned PDFs still yield `needs_review`; no OCR accuracy claim is made.

## Historical experiment snapshot (superseded)

`formats.py` is the tested pure bytes-to-IR parser used by the format tests. It has no filesystem, model, DB or network interface. APP ingestion validation remains authoritative for committing returned IR.

`windows_container.py`, `stage_runtime.py`, `entry.py` and `tests/fixtures/parser-container.py` are **unaccepted experimental isolation code**, not a production worker. They are not wired into APP or the installer. Do not infer OS isolation from a normal Python subprocess or the format tests.

2026-09-22 experiments retained:

- `m5-container-01`: low-integrity label failed under the Codex sandbox.
- `m5-container-02`: labeling succeeded in an approved elevated execution context; `CreateProcessW` returned Windows error 2. Required executable/DLL/entry/input files existed. No parsing process completed, and read/write/network canaries did not run.
- Both only changed ACLs on newly created synthetic runtime/job directories. Neither called `CreateAppContainerProfile`, changed registry/firewall, nor read existing APPDATA. Failure directories and logs are preserved.

Microsoft's documented sequence creates an AppContainer profile. This writes a dedicated OS-managed directory under the account's local APPDATA. The user previously prohibited APPDATA access; a narrowly scoped exception was requested and is pending. Do not execute profile creation on the assumption that an unanswered request was approved. The profile-free failure has **not** proven profile absence to be the sole cause.

After permission: create a dedicated profile, verify actual token plus denied outside reads/writes and denied loopback connection, and verify resource limits/cancellation before wiring into APP. No fallback to an unrestricted parser. Stage provenance/licenses must also be completed before redistributing a parser runtime; the current locally copied Python runtime is a test fixture only.

Until that gate passes, imports may be captured as durable pending jobs but the new APP has no automatic parser, native-file import UI or resumed parsing daemon. Existing migrated ready documents can be searched. Scan-only PDFs return `needs_review` in format tests; optional OCR has not been wired into this worker.
