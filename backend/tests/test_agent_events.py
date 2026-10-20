from applyos_agent.events import AgentEventStream


def test_public_agent_events_keep_identity_order_and_scope():
    events = []
    stream = AgentEventStream(
        callback=events.append,
        thread_id="job-1",
        run_id="run-1",
        turn_id="turn-1",
    )
    first = stream.emit({"id": "tool-1", "type": "tool", "label": "读取网页", "status": "active"})
    completed = stream.emit({"id": "tool-1", "type": "tool", "detail": "已读取正文", "status": "completed"})
    second = stream.emit({"id": "model-2", "type": "model", "label": "组织回答", "status": "active"})

    assert first["protocol_version"] == 1
    assert completed["sequence"] == first["sequence"]
    assert completed["revision"] == 2
    assert completed["label"] == "读取网页"
    assert second["sequence"] == 2
    assert second["thread_id"] == "job-1"
    assert second["run_id"] == "run-1"
    assert second["turn_id"] == "turn-1"


def test_public_agent_event_bounds_observable_detail():
    events = []
    stream = AgentEventStream(callback=events.append, thread_id="job", run_id="run", turn_id="turn")
    event = stream.emit({"id": "model", "type": "model", "label": "模型正在推理", "detail": "行动摘要 " * 500})
    assert len(event["detail"]) <= 1200
