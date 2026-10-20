# Pi ecosystem review for FetchCV

Updated: 2026-07-21

## Selection criteria

The review focused on projects that embed or extend Pi through typed tools,
sessions, queues, provider adapters or external UIs. Popularity alone was not
treated as architectural evidence.

| Project | Useful pattern | FetchCV decision |
| --- | --- | --- |
| `earendil-works/pi` | `AgentHarness`, session tree, structured hooks, dynamic tools, steering/follow-up queues | Adopt natively as the Electron runtime |
| `can1357/oh-my-pi` | Typed RPC/session state, serialized persistence, explicit approval tiers, compaction race handling | Adopt typed boundaries and keep approvals in ToolGateway; do not import coding-only tools |
| `openclaw/openclaw` | Large embedded Pi runner, provider isolation, context pruning | Adopt provider-registry authentication and avoid replacing auth-aware streams |
| `dnouri/pi-coding-agent` | Queue while busy, abort, collapsed completed reasoning and tool output | Project real queue/tool events into FetchCV's desktop UI |
| `mksglu/context-mode` | Preserve useful tool evidence while reducing context growth | Keep newest evidence first and trim older outputs head-and-tail |

## Resulting FetchCV boundary

```text
AgentHarness
  -> Pi Models and provider auth
  -> native structured tool calls
  -> FetchCV capability adapter
  -> ToolGateway
       -> permission / approval / scope / idempotency
       -> resume, web, workspace, Skill and MCP capabilities
  -> SQLite messages, task state, snapshots and audit trace
```

Pi owns model-turn mechanics. FetchCV owns business truth and side-effect
policy. The renderer consumes normalized events and never depends on Pi types.

## Deliberately not adopted

- unrestricted Shell or coding-agent file tools;
- a second JSON-over-stdio subprocess around the already embedded Harness;
- terminal themes, editor commands or coding-specific subagents;
- provider stream overrides that bypass Pi's request-time auth resolution;
- copying entire upstream repositories into the application bundle.

The purpose of the ecosystem review is to reuse mature boundaries, not to turn
FetchCV into a generic coding agent or increase desktop startup cost.
