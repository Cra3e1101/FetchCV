from applyos_agent.model_protocol import parse_dsml_tool_calls, strip_model_protocol


def test_parses_full_width_double_pipe_dsml_from_compatible_provider():
    raw = (
        '<｜｜DSML｜｜tool_calls>\n<｜｜DSML｜｜invoke name="search_web">'
        '<｜｜DSML｜｜parameter name="query" string="true">昌平天气</｜｜DSML｜｜parameter>'
        '<｜｜DSML｜｜parameter name="max_results" string="false">5</｜｜DSML｜｜parameter>'
        '</｜｜DSML｜｜invoke>\n</｜｜DSML｜｜tool_calls>'
    )
    calls, text = parse_dsml_tool_calls(raw)
    assert text == ""
    assert calls[0].name == "search_web"
    assert calls[0].arguments == {"query": "昌平天气", "max_results": 5}


def test_strips_protocol_but_keeps_surrounding_assistant_text():
    raw = "准备查询。\n<|DSML|tool_calls><|DSML|invoke name=\"search_web\"></|DSML|invoke></|DSML|tool_calls>\n查询完成。"
    assert strip_model_protocol(raw) == "准备查询。\n\n查询完成。"
