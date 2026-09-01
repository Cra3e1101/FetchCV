from applyos_agent.loop_utils import ToolCallLedger, append_tool_message, tool_call_signature
from applyos_agent.schemas import RuntimeToolCall


def _call(name: str, arguments: dict, call_id: str = "call-1") -> RuntimeToolCall:
    return RuntimeToolCall(id=call_id, name=name, arguments=arguments)


def test_tool_call_signature_is_stable_and_stage_scoped():
    call = _call("read_workspace_file", {"path": "notes.md"})

    assert tool_call_signature(call, stage="created") == tool_call_signature(call, stage="created")
    assert tool_call_signature(call, stage="created") != tool_call_signature(call, stage="input_validating")


def test_tool_call_ledger_deduplicates_and_caps_side_effects_per_turn():
    ledger = ToolCallLedger()
    call = _call("write_workspace_file", {"path": "notes.md"})

    ledger.begin_turn()
    assert ledger.duplicate(call, stage="created") is False
    assert ledger.duplicate(_call(call.name, call.arguments, "different-id"), stage="created") is True
    assert ledger.side_effect_allowed(True) is True
    assert ledger.side_effect_allowed(True) is False

    ledger.begin_turn()
    assert ledger.side_effect_allowed(True) is True


def test_append_tool_message_preserves_protocol_fields():
    messages = []
    call = _call("read_workspace_file", {"path": "notes.md"})

    append_tool_message(messages, call, {"ok": True, "result": {"text": "hello"}})

    assert messages == [{
        "role": "tool",
        "tool_call_id": "call-1",
        "name": "read_workspace_file",
        "content": '{"ok": true, "result": {"text": "hello"}}',
        "is_error": False,
    }]
