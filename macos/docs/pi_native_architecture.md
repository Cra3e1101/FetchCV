# FetchCV on Pi: native architecture

Updated: 2026-07-21

## Decision

FetchCV embeds the `AgentHarness` from `@earendil-works/pi-agent-core` as a
minimal stateful application runtime. It
does not embed the Pi terminal coding agent, and it does not translate the old
FetchCV stage runner one-for-one into Pi tools.

Pi owns only the capabilities it is designed to own:

- provider-independent model turns;
- native structured tool calls;
- streaming lifecycle events;
- steering and follow-up queues;
- per-turn tool refresh and context transformation;
- cancellation propagation.

FetchCV composes the rest around that core:

```text
React desktop UI
  -> FetchCVAgentHost (Electron)
       -> Pi AgentHarness
       -> pi-ai provider adapter
       -> context policy
       -> event projector
       -> capability adapter
            -> authenticated loopback bridge
                 -> ToolGateway policy boundary
                      -> Pi domain tools
                      -> web/browser providers
                      -> workspace tools
                      -> Skills
                      -> MCP tools
                 -> SQLite state, approvals, versions and traces
```

## Domain capability design

The previous task surface exposed every internal state transition as a model
tool. It also called a second model inside semantic tools. The desktop Pi path
now exposes four coarse business outcomes instead:

1. `prepare_job_review`
   - Pi reads the job and candidate workspace on demand.
   - Pi submits a structured job analysis with exact JD quotes and semantic
     fact rankings.
   - The backend validates evidence, persists the profile and creates one user
     review checkpoint.
2. `prepare_resume_review`
   - Pi submits a structured positioning strategy and concrete patches against
     the original resume.
   - The backend rejects unknown fact IDs, unchanged patches and unsupported
     claims, then creates one proposal review checkpoint.
3. `apply_and_verify_resume`
   - The backend applies only approved patches to a child version.
   - Fact validation, template rendering, consistency checks and the export
     gate run deterministically.
4. `finalize_resume_version`
   - The backend marks the verified version ready only after final approval.

`inspect_application_workspace` is the on-demand context capability. Large JD,
resume and fact payloads are no longer copied into every task prompt.

## No nested agent loops

The Pi desktop task route imports `build_pi_task_gateway()` directly. That
gateway never constructs `AgentService`, `AgentSuite`, `AgentEngine`,
`ConversationToolAgent` or `ModelAssistedPipeline`. Semantic decisions are Pi
tool arguments; Python validates and persists them but does not ask another
model for the answer.

The older Python loop remains isolated for API/browser compatibility tests. It
is not reachable from Electron Pi conversation or task routes and can be
removed after those compatibility routes are migrated.

## Extension equivalents

Pi Agent Core intentionally stays smaller than the full coding-agent package,
so FetchCV supplies application-specific equivalents instead of importing a
terminal UI and shell toolset:

| Pi extension concern | FetchCV implementation |
| --- | --- |
| Tool registration | JSON Schema capability adapter + ToolGateway |
| Tool preflight/blocking | permission, approval, scope and path checks |
| Context hook | native message hydration + `transformContext` pruning |
| In-run session and queues | Pi session tree, steering, follow-up and next-turn queues |
| Durable persistence | SQLite `AgentMessage`, `AgentTask`, snapshots and trace |
| Compaction | `AgentContextSnapshot` plus newest-first tool-evidence pruning |
| Skills | description catalog + on-demand `read_skill` |
| MCP | approved server registry mapped into ToolGateway |
| UI events | Pi lifecycle events projected into FetchCV activity events |

This keeps the Pi loop replaceable and the business state authoritative. A
model or provider change cannot bypass approvals or mutate the resume database
directly.

## Ecosystem patterns adopted

- Pi's native Harness owns the run instead of FetchCV reimplementing the loop.
- Provider authentication remains inside Pi `Models` and resolves per request.
- Tool availability can refresh after a stage-changing tool result without
  restarting the conversation.
- Busy-session messages use steering queues; queue state is projected to the UI.
- Completed reasoning and verbose tool output are compacted for model context,
  while the full auditable result stays in FetchCV traces.

These choices follow the reusable boundaries demonstrated by Pi itself,
Oh My Pi, OpenClaw's embedded runner and pi-coding-agent. FetchCV does not copy
their terminal/editor surfaces or grant their coding-oriented shell powers.

## Invariants

- The model never receives the SQLite session, API key, unrestricted HTTP or
  arbitrary shell access.
- Every side effect has an idempotency key and durable trace.
- JD claims require a source quote that can be located in the imported JD.
- Resume patches can reference only facts approved for the current run.
- Education and identity facts are preserved automatically unless the user
  explicitly edits source data.
- User approvals, not model prose, release write and export gates.
- Full tool results stay local; context trimming changes only what is sent to
  later model calls.
