# Pi runtime compatibility

## Locked versions

- `@earendil-works/pi-agent-core==0.80.10`
- `@earendil-works/pi-ai==0.80.10`
- `typebox==1.1.38`
- Electron `43.1.1` (Node 22.19+ requirement satisfied)

The desktop runtime uses Pi's `AgentHarness`, session abstraction and native
event protocol. Provider
adapters are loaded lazily for OpenAI-compatible or Anthropic-compatible
endpoints. The active API key is decrypted only in Electron and resolved through
Pi `Models` for the active provider request; it is not sent to the renderer,
Python tool bridge, business database or trace log.

## Compatibility boundary

Pi hosting lives in `electron/pi-agent-runtime.mjs`; Harness construction,
provider adaptation and context policy live under `electron/pi/`.
Renderer code consumes normalized `status`, `reasoning`, `delta`, `user` and
`done` events and does not depend on Pi types. Python capabilities are exposed
as JSON Schema and executed only by the authenticated `/api/pi` bridge.

Pi is not a business-security boundary. ToolGateway still enforces stage,
permission, approval, candidate/job scope, path containment, idempotency,
versioning and trace rules. The model cannot call arbitrary Shell or bypass
the resume workflow state machine.

The desktop task bridge uses `build_pi_task_gateway()` rather than the legacy
`build_pipeline()` path. Pi itself produces typed job analysis, fact ranking,
strategy and resume-patch arguments. The corresponding domain tools perform
only validation, persistence, rendering and approval transitions; they do not
construct a nested Python Agent runtime.

The old `claude-agent-sdk` dependency and bundled Claude CLI were removed from
the sidecar build. Legacy Python compatible-provider code remains only as a
temporary browser-preview/specialized extraction fallback; desktop chat and
task orchestration do not use it.
