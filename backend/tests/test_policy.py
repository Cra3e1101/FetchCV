from pydantic import BaseModel

from applyos_harness.permissions import ToolGateway, ToolPermission, ToolSpec
from applyos_harness.policy import apply_gateway_policy


class EmptyInput(BaseModel):
    pass


class EmptyOutput(BaseModel):
    ok: bool = True


def test_ask_policy_keeps_tools_and_attaches_stable_approval_actions(database, tmp_path):
    with database.session() as session:
        gateway = ToolGateway(session, workspace_root=tmp_path)
        for name in ("read_web_page", "open_browser_page"):
            gateway.register(ToolSpec(
                name=name,
                input_model=EmptyInput,
                output_model=EmptyOutput,
                permission=ToolPermission.NETWORK_READ,
                allowed_stages=set(),
                handler=lambda *_args: {"ok": True},
            ))

        apply_gateway_policy(gateway, {"web_access": "allow", "browser_bridge": "ask", "workspace_read": "allow", "workspace_write": "ask", "file_delete": "ask"})

        assert "open_browser_page" in gateway.registry
        assert gateway.registry["open_browser_page"].approval_action == "permission:open_browser_page"
        assert gateway.registry["open_browser_page"].auto_request_approval is True
