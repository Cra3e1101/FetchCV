import re

from applyos_agent.mcp_tools import McpArguments, register_mcp_tools
from applyos_domain.models import McpServerConfig
from applyos_harness.permissions import ToolGateway


def test_registered_mcp_names_are_valid_distinct_and_route_to_original(database, tmp_path):
    class Manager:
        def __init__(self):
            self.calls = []

        def call(self, server, name, arguments, allow_write):
            self.calls.append((server.id, name, arguments, allow_write))
            return {"original_name": name}

    originals = ["read", "a.b", "a_b", "x" * 90, "读取"]
    manager = Manager()
    with database.session() as session:
        # Distinct display names can collide after normalizing punctuation.
        servers = [McpServerConfig(name=display, command="synthetic-never-executed", enabled=True, approved=True,
                    discovered_tools=[{"name": n, "read_only": True, "input_schema": {"type": "object"}} for n in originals],
                    allowed_tools=originals) for display in ["same.", "same_"]]
        session.add_all(servers)
        session.flush()
        gateway = ToolGateway(session, workspace_root=tmp_path)
        register_mcp_tools(gateway, manager, include_writes=False)
        names = list(gateway.registry)
        assert len(names) == 10
        assert all(re.fullmatch(r"[A-Za-z0-9_-]{1,64}", n) for n in names)
        for tool in gateway.registry.values():
            tool.handler(None, McpArguments())
        assert {(s, n) for s, n, _, _ in manager.calls} == {(s.id, n) for s in servers for n in originals}
        assert all(not write for _, _, _, write in manager.calls)
        again = ToolGateway(session, workspace_root=tmp_path)
        register_mcp_tools(again, manager, include_writes=False)
        assert set(again.registry) == set(names)


def test_mcp_rejects_application_secrets_and_times_out_discovery(database, monkeypatch):
    import asyncio
    import sys
    import pytest
    import applyos_agent.mcp_tools as module
    from applyos_harness.errors import HarnessError
    with database.session() as session:
        config=McpServerConfig(name="isolated",command=sys.executable,transport="stdio",approved=True,env_keys=["FETCHCV_CONTROL_TOKEN"])
        with pytest.raises(HarnessError,match="控制令牌"):module.McpManager.validate(config)
        config.env_keys=[]
        session.add(config);session.flush()
        manager=module.McpManager(session)
        async def never(_):await asyncio.sleep(60)
        monkeypatch.setattr(manager,"_list_tools",never)
        monkeypatch.setattr(module,"MCP_SESSION_TIMEOUT",0.02)
        with pytest.raises(HarnessError,match="连接"):manager.probe(config)
        assert config.last_error=="TimeoutError"
