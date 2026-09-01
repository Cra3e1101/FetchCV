# FetchCV Pi Agent Runtime

Updated: 2026-07-21

## Runtime boundary

The desktop application uses Pi as its only interactive Agent Loop:

```text
React renderer
  -> Electron IPC
  -> Pi Agent Runtime (@earendil-works/pi-agent-core)
  -> provider adapter (@earendil-works/pi-ai)
  -> structured tool call
  -> authenticated loopback bridge
  -> FetchCV ToolGateway
  -> domain/PDF/web/workspace/MCP capability
  -> persisted tool result and trace
  -> next Pi model turn
```

Pi owns model streaming, tool-call parsing, multi-turn continuation, steering,
follow-up queues, provider cancellation and per-turn context transformation.
The Python sidecar does not own the desktop Agent Loop. It remains the local
domain service for SQLite data, resume parsing/rendering, workflow state,
version snapshots and bounded capabilities.

## Why ToolGateway remains

Pi intentionally does not provide an application permission system. FetchCV
therefore keeps ToolGateway as the only tool execution path. The gateway
enforces:

- stage and candidate/job scope;
- read/network/write/delete permissions;
- persisted user approvals;
- path containment and SSRF protection;
- side-effect idempotency;
- before/after version snapshots;
- durable tool traces.

The model never receives a database handle, API key, arbitrary HTTP client or
Shell. API keys stay in Electron `safeStorage`; only the Pi provider adapter
receives the decrypted key for the active request.

## Conversation execution

`electron/pi-agent-runtime.mjs` creates a Pi `AgentHarness` for each user turn. The
backend returns a compacted conversation envelope, current system contract and
the ToolGateway definitions. The Harness owns its in-run session tree, provider
authentication, steering/follow-up queues and dynamic active-tool set; SQLite
remains authoritative across application restarts. Pi events are normalized
directly into the UI:

- provider `thinking_delta` -> visible, collapsible processing detail;
- `text_delta` -> assistant stream;
- tool start/update/end -> real activity events;
- abort -> provider and active tools receive the same abort signal.

No DSML/XML text protocol is parsed. Tool calls are native structured provider
events, so malformed protocol text cannot appear as an assistant answer.

Provider credentials are resolved through Pi `Models` at request time. FetchCV
does not replace the Harness stream function with a bare provider stream, which
would bypass provider-aware authentication and retry hooks.

## Resume task execution

Resume optimization tasks are also started by the Electron Pi runtime. A task
is atomically persisted as `running` before Pi begins, so the legacy Python
queue worker cannot claim it. High-level domain tools are refreshed after every
turn. Pi submits semantic analysis and resume patches as typed tool arguments;
Python does not start a nested model call inside those tools.

The state machine is a background policy/checkpoint service rather than the
model-visible workflow. Pi works with four business outcomes:
`prepare_job_review`, `prepare_resume_review`, `apply_and_verify_resume` and
`finalize_resume_version`. It cannot skip fact confirmation, proposal review,
publish approval, validation or version gates. Messages sent while a Pi task is
active use Pi steering instead of a second chat runtime.

## Context and recovery

Recent cross-turn history is hydrated into Pi as native user/assistant
messages; older history is compacted in `AgentContextSnapshot`. JD, resume,
facts and materials are read on demand through `inspect_application_workspace`
instead of being copied into every task prompt. Within a single Pi run,
unusually large earlier tool results are trimmed head-and-tail before the next
provider request. Newest tool evidence is retained first, older reasoning blocks
are removed, and full results remain in local traces.

Tasks and messages are persisted before execution. Pause/cancel flags are
polled while Pi is active and abort the provider plus active tool signal.
Approvals survive a blocked tool call and can replay the exact idempotent action
after user confirmation.

## Provider support

The current desktop provider store supports OpenAI-compatible and
Anthropic-compatible endpoints. Pi receives a normalized model descriptor and
uses the corresponding lazy provider adapter. Provider modules are warmed only
after the desktop window and local API are ready so they do not delay the first
visible window.

The Python package no longer depends on `claude-agent-sdk`, and the packaged
sidecar no longer bundles the Claude CLI. Legacy Python compatible-provider
classes remain temporarily for browser API fallback and isolated extraction
tests; they are not reachable from the desktop Pi conversation or task routes.
See `docs/pi_native_architecture.md`.
