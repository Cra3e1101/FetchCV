# FetchCV Agent Platform

Updated: 2026-07-21

## Task lifecycle

The desktop queues pipeline work through `/api/agent-runs/{run_id}/tasks`. The sidecar owns one SQLite-backed worker. Task controls are cooperative and durable:

- `pause` interrupts a registered in-flight provider transport and otherwise stops before the next tool or model turn;
- `resume` continues the same run from its persisted stage;
- `retry` invokes recovery for failed or blocked runs and respects the attempt limit;
- `cancel` transitions the run and task without deleting trace history;
- worker restart changes orphaned `running` tasks back to `queued`.

Messages submitted during queued/running pipeline work use `/api/jobs/{job_id}/messages/queue`. They retain sequence, status, result message ID and a redacted error. The worker processes them only when no task for that run is active.

## Context contract

Compaction separates stable task truth from conversational history. Stable context includes the JD and source, resume ancestry and editor structure, verified facts and material provenance. Old messages become an ID-addressed deterministic summary; recent messages remain verbatim. This means a long conversation can be compacted without using model-generated memory as the source of truth.

## Event contract

`GET /api/agent-runs/{run_id}/events?follow=true&after_sequence=N` polls persisted trace rows and emits `trace`, `heartbeat` and `end` events. The UI uses sequence IDs for replay and shows the latest real action in a compact disclosure. Tool calls, task state and failures remain inspectable; private chain-of-thought is neither requested nor exposed.

Conversation and pipeline execution now build their capabilities through the same `build_capability_gateway`. The model—not UI keywords—selects the currently available web, browser, workspace, context, Skill and approved MCP tools. Pipeline mode additionally registers the resume business tools. Every execution still enters `ToolGateway`, so a conversation can perform bounded writes such as JD import or approved workspace/MCP actions without bypassing permission, approval, scope, idempotency or trace enforcement.

Web access is demand-driven. Opening FetchCV starts a loopback-controlled hidden renderer, but it creates and navigates a page only after the model calls a web tool. Static HTTPS remains the fast path; an optional Firecrawl provider and the embedded renderer handle richer pages. No terminal process is required from the user. Repeated calls and exhausted tool rounds switch to a no-tool synthesis turn instead of surfacing a loop-limit error.

## Security boundaries

- Skills are read-only Markdown resources with root, symlink and size checks. A bundled `web-research` Skill teaches source selection and verification but cannot execute or grant tools.
- MCP uses direct stdio process arguments, never a shell string.
- MCP child processes receive a minimal environment; model, browser and desktop-control secrets are never inherited implicitly.
- Read-only MCP requires server approval, probing, an allowed-tool list and `readOnlyHint=true`.
- Write MCP additionally requires closed-world/non-destructive annotations, a declared FetchCV resume/portfolio target argument, per-tool approval and per-run approval. ToolGateway records before/after snapshots and a local rollback reference.
- All MCP calls still pass through `ToolGateway` and persisted trace redaction.
- Web tools continue to enforce public-address, redirect, content-type and response-size controls.
- The Electron-owned browser bridge is loopback/token protected and exposes only open/read/status/close. Login and CAPTCHA pause for visible user action; cookies and credentials are not returned to the Agent.
- Workspace tools operate in an isolated user-data directory and expose text reads plus fixed hash/JSON/count checks, never shell strings or external executables.
