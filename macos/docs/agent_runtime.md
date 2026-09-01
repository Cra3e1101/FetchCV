# FetchCV Agent Runtime

Updated: 2026-07-19

## Implemented in this phase

`AgentEngine` now runs a provider-independent loop:

```text
model turn -> structured tool call -> ToolGateway -> persisted tool result -> next model turn
```

The loop persists model turns, tool calls, tool results, usage, duration and failures in `AgentRunStep`. It stops at user approval stages, can recover a failed stage with retry, rejects stage-invalid tools and duplicate calls, and limits each model turn to one side-effecting tool.

Provider adapters support OpenAI-compatible `tool_calls`, Anthropic-compatible `tool_use`, and a JSON Schema decision fallback for providers that reject native tool definitions. Hidden chain-of-thought is neither requested nor stored; the UI may show only actual tool events and concise action summaries.

## Registered business tools

- `validate_run_input`
- `analyze_job`
- `match_candidate_experiences`
- `generate_resume_strategy`
- `propose_resume_rewrites`
- `apply_approved_resume_changes`
- `validate_resume`
- `build_portfolio_preview`
- `run_consistency_checks`
- `finalize_publish_ready`
- `inspect_job_context`
- `search_web`
- `read_web_page`
- `import_job_posting`
- `list_skills`
- `read_skill`
- approved read-only MCP tools under `mcp__<server>__<tool>`

The tools wrap the existing state machine, approval service, fact validator, version service and publish gate. The model has no direct database, Shell or arbitrary file access.

Job-specific resumes branch from the latest base `ResumeVersion`, preserve its editor template and unchanged content, and apply only approved fact-bound rewrites to the corresponding experience body.

## Acceptance coverage

Automated tests cover:

- OpenAI and Anthropic native tool parsing;
- structured fallback and API-key non-leakage;
- model -> tool -> model progression;
- stage restrictions, duplicate-call rejection and persisted tool results;
- approval pauses, tool failure, retry and model failure;
- cancellation while no model is connected;
- the real files in `test use/`, including PDF import, JD analysis flow, three approval gates, base-template inheritance, one targeted rewrite and publish readiness.
- SSRF blocking, redirect revalidation, response limits, real search-provider smoke testing, JSON-LD job import, recoverable empty-JD import and approved JD replacement.

## Durable execution and context

`AgentTask` persists queued, running, paused, failed, cancelled and completed work. A single local worker claims tasks, recovers orphaned running records after sidecar restart, and cooperatively checks pause/cancel requests between model turns and before each tool. Messages submitted while a task is active are stored in `QueuedAgentMessage` and processed in sequence after the task stops.

`AgentContextSnapshot` compacts old conversation messages while pinning the full current JD, source URL, latest base and job resume structures, verified facts and material provenance. Hidden chain-of-thought is never placed in snapshots.

The run event endpoint supports `after_sequence` and `follow=true`. The desktop client renders only persisted `AgentRunStep` model/tool/task events and reconnects by sequence; it does not synthesize pipeline progress.

## Skills and MCP

The Skill loader scans project `skills/`, `~/.fetchcv/skills/` and `FETCHCV_SKILL_ROOTS`, reads complete `SKILL.md` files up to 128 KB, blocks symlink/path escapes and preserves enable state across reloads. Skill text is untrusted instruction context and cannot grant permissions.

MCP supports explicit stdio configurations only. Commands and working directories must be absolute, and child processes receive a minimal environment plus only explicitly named variables. A server must be approved and probed before it can be enabled. Read-only tools require `readOnlyHint=true` and a whitelist. Write tools must additionally declare non-destructive closed-world annotations, a FetchCV resume/portfolio target argument, global tool approval and per-run approval; local versions receive before/after snapshots and a rollback reference.

Provider requests register cancellable transports for the full Agent run. Pause or cancel closes an in-flight compatible-provider HTTP client or interrupts `ClaudeSDKClient`, and the resulting transport exception is normalized to task pause/cancel instead of model failure.

The desktop also owns an isolated persistent browser partition behind a loopback bearer-token bridge. It can open and read client-rendered HTTPS pages. Visible login or CAPTCHA controls pause the task for the user; FetchCV does not bypass challenges or return cookies/credentials to the model. Arbitrary Shell remains unavailable; the workspace command tool accepts only fixed hash, JSON validation and text-count operations.

## Controlled web boundary

The Agent does not receive SDK-native WebFetch or arbitrary HTTP access. `WebClient` allows public HTTPS on ports 80/443 only, resolves and rejects non-public addresses, revalidates redirects, disables environment proxies, limits content types and caps responses at 2 MB. Search uses configurable HTTPS endpoints with Bing/DuckDuckGo fallback.

Recruiting-page import prefers Schema.org `JobPosting` JSON-LD and records the final URL and SHA-256 in a `job_posting_page` material. Existing JD text cannot be overwritten without a persisted `replace_job_description` approval. When static HTTP cannot read a page, the Agent may use the Electron-controlled browser and pause for user login/CAPTCHA.
