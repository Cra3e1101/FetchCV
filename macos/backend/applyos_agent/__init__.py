"""Public Agent API without eagerly importing the complete runtime graph.

Python executes a package's ``__init__`` before importing any submodule.  The
old eager re-exports therefore loaded the Agent engine, MCP SDK and provider
clients even for a lightweight ``applyos_agent.config`` import during desktop
startup.  Keep the public imports compatible while resolving them only when a
caller actually asks for one of these symbols.
"""

from __future__ import annotations

from importlib import import_module


__all__ = ["AgentEngine", "AgentRuntime", "AgentSettings", "AgentSuite", "MockAgentRuntime", "RuntimeMode"]

_LAZY_EXPORTS = {
    "AgentSuite": (".agents", "AgentSuite"),
    "AgentSettings": (".config", "AgentSettings"),
    "RuntimeMode": (".config", "RuntimeMode"),
    "AgentEngine": (".engine", "AgentEngine"),
    "AgentRuntime": (".runtime", "AgentRuntime"),
    "MockAgentRuntime": (".runtime", "MockAgentRuntime"),
}


def __getattr__(name: str):
    try:
        module_name, attribute = _LAZY_EXPORTS[name]
    except KeyError as exc:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from exc
    value = getattr(import_module(module_name, __name__), attribute)
    globals()[name] = value
    return value
