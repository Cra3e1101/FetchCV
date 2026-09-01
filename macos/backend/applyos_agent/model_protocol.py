from __future__ import annotations

import html
import json
import re

from .schemas import RuntimeToolCall


_DSML_MARKER = r"[|｜]{1,2}\s*DSML\s*[|｜]{1,2}"
_DSML_INVOKE = re.compile(
    rf"<\s*{_DSML_MARKER}\s*invoke\b(?P<attrs>[^>]*)>(?P<body>.*?)<\s*/\s*{_DSML_MARKER}\s*invoke\s*>",
    flags=re.DOTALL | re.IGNORECASE,
)
_DSML_PARAMETER = re.compile(
    rf"<\s*{_DSML_MARKER}\s*parameter\b(?P<attrs>[^>]*)>(?P<value>.*?)<\s*/\s*{_DSML_MARKER}\s*parameter\s*>",
    flags=re.DOTALL | re.IGNORECASE,
)
_DSML_BLOCK = re.compile(
    rf"<\s*{_DSML_MARKER}\s*tool_calls\b[^>]*>.*?<\s*/\s*{_DSML_MARKER}\s*tool_calls\s*>",
    flags=re.DOTALL | re.IGNORECASE,
)
_DSML_TRAILING_BLOCK = re.compile(
    rf"<\s*{_DSML_MARKER}\s*tool_calls\b[^>]*>.*$",
    flags=re.DOTALL | re.IGNORECASE,
)
_DSML_TAG = re.compile(rf"<\s*/?\s*{_DSML_MARKER}[^>]*>", flags=re.IGNORECASE)


def contains_dsml(value: str) -> bool:
    return bool(re.search(_DSML_MARKER, str(value or ""), flags=re.IGNORECASE))


def strip_model_protocol(value: str) -> str:
    text = str(value or "")
    if not contains_dsml(text):
        return text
    text = _DSML_BLOCK.sub("", text)
    text = _DSML_TRAILING_BLOCK.sub("", text)
    return _DSML_TAG.sub("", text).strip()


def parse_dsml_tool_calls(value: str) -> tuple[list[RuntimeToolCall], str]:
    text = str(value or "")
    if not contains_dsml(text):
        return [], text

    def attribute(attrs: str, name: str) -> str:
        match = re.search(rf"\b{re.escape(name)}\s*=\s*([\"'])(.*?)\1", attrs, flags=re.DOTALL | re.IGNORECASE)
        return html.unescape(match.group(2)).strip() if match else ""

    calls: list[RuntimeToolCall] = []
    for index, invoke in enumerate(_DSML_INVOKE.finditer(text), start=1):
        name = attribute(invoke.group("attrs"), "name")
        if not name:
            continue
        arguments: dict = {}
        for parameter in _DSML_PARAMETER.finditer(invoke.group("body")):
            parameter_name = attribute(parameter.group("attrs"), "name")
            if not parameter_name:
                continue
            raw_value = html.unescape(parameter.group("value")).strip()
            if attribute(parameter.group("attrs"), "string").lower() != "false":
                parsed_value = raw_value
            else:
                try:
                    parsed_value = json.loads(raw_value)
                except json.JSONDecodeError:
                    parsed_value = raw_value
            arguments[parameter_name] = parsed_value
        calls.append(RuntimeToolCall(id=f"dsml:{index}", name=name, arguments=arguments))
    return calls, strip_model_protocol(text)
