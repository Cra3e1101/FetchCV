# Parser worker

This directory contains the structured document parser used by the optional JS/V2 ingestion path. The default desktop backend is Python Sidecar; see the [architecture guide](../../docs/architecture.md) for that distinction.

## Components

- `formats.py`: converts document bytes into structured intermediate results.
- `entry.py`: implements the worker entry point.
- `stage_runtime.py`: prepares the worker runtime.
- `windows_container.py`: provides Windows AppContainer integration.

## Protocol and review

The ingestion protocol is `local-structured-1`. Parser revisions preserve compatibility with stored documents; the `local-structured-1.2` implementation retains rotated PDF text and marks extraction warnings for review. Existing documents are not automatically re-parsed.

DOCX table cells retain paragraph separators. Extraction warnings result in `needs_review` and `layoutWarning=true`; absence of a warning is not proof of layout fidelity. `layoutVerified` remains false.

OCR is not integrated into this worker. Scan-only PDFs require review or external OCR before use. Worker output is validated by the ingestion layer before it is committed.

## Runtime boundary

The Windows worker uses a dedicated AppContainer profile and a staged runtime. A normal Python subprocess alone does not provide the same isolation. Changes to worker packaging must preserve file, network, child-process and resource restrictions.

Runtime redistribution requires appropriate provenance and license materials. Do not distribute a copied development interpreter as a verified runtime.
