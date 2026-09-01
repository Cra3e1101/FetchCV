# Agent runtime compatibility

## Locked version

- Python package: `claude-agent-sdk==0.2.120`
- Python: 3.12 (project supports 3.11+)
- Runtime surface: `query()` + `ClaudeAgentOptions`
- Default FetchCV runtime: `mock`（仅测试）
- Real runtime: `FETCHCV_AGENT_RUNTIME=claude|compatible`

The SDK package bundles a compatible Claude Code CLI. FetchCV does not expose credentials to the Electron renderer. Compatible-provider credentials are passed from Electron safeStorage to the sidecar process environment and are never written to business tables or traces.

## Compatibility boundary

All SDK and provider protocol code is isolated in `applyos_agent/runtime.py`. The rest of FetchCV depends on the internal `AgentRuntime` protocol, `RuntimeTurnResult` and JSON Schema tool definitions, not directly on Anthropic or OpenAI response classes.

The wrapper is responsible for:

- translating Pydantic JSON Schema into SDK structured output;
- collecting text, structured output, session id and usage;
- mapping SDK exceptions to FetchCV structured errors;
- applying allowed/disallowed tools and lifecycle hooks;
- resuming the job-bound session when available.
- parsing OpenAI-compatible native `tool_calls`;
- parsing Anthropic-compatible native `tool_use` and grouping tool results;
- falling back to a structured decision schema when a provider rejects native tools.

The SDK is not a business-security boundary. Every persisted output still passes through the Stage 3 state machine, Fact Validator, Approval Service, Version Service and publish gate.

`AgentEngine` owns the provider-independent model/tool/result loop. `ToolGateway` is the only business tool execution boundary and enforces stage, permission, approval, scope, path and idempotency checks. Web tools, Skills, workspace tools and approved MCP tools are exposed only through this boundary; arbitrary Shell and unconstrained filesystem access remain unavailable.
