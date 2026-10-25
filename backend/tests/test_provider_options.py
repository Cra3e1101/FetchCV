import json
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel

from applyos_agent.config import AgentSettings
from applyos_agent.provider_options import validate_request_options
from applyos_agent.runtime import CompatibleAgentRuntime


class Answer(BaseModel):
    answer: str


@pytest.mark.parametrize("protocol", ["openai", "anthropic"])
@pytest.mark.parametrize("auth_mode", ["auto", "bearer", "x-api-key"])
def test_structured_extraction_applies_same_configuration(monkeypatch, protocol, auth_mode):
    options = {"authMode": auth_mode, "userAgent": "FetchCV-Test/1", "requestHeaders": {"X-Title": "synthetic"}, "requestBody": {"temperature": 0.2}}
    seen = []
    client_class = httpx.Client

    def handle(request):
        seen.append(request)
        content = json.dumps({"answer": "synthetic"})
        body = {"content": [{"type": "text", "text": content}]} if protocol == "anthropic" else {"choices": [{"message": {"content": content}}]}
        return httpx.Response(200, json=body)

    monkeypatch.setattr("applyos_agent.runtime.httpx.Client", lambda **kwargs: client_class(**kwargs, transport=httpx.MockTransport(handle)))
    settings = AgentSettings(workspace_root=Path.cwd(), model="synthetic", provider_protocol=protocol, provider_base_url="https://example.invalid/v1", provider_api_key="synthetic-key", provider_request_options=options)
    answer, _ = CompatibleAgentRuntime(settings).generate(agent_name="test", prompt="Synthetic input", system_prompt="Synthetic instructions", output_model=Answer, mock_data={})
    assert answer.answer == "synthetic"
    request = seen[0]
    bearer = auth_mode == "bearer" or (auth_mode == "auto" and protocol == "openai")
    assert request.headers.get("authorization") == ("Bearer synthetic-key" if bearer else None)
    assert request.headers.get("x-api-key") == (None if bearer else "synthetic-key")
    assert request.headers["x-title"] == "synthetic"
    assert request.headers["user-agent"] == "FetchCV-Test/1"
    assert json.loads(request.content)["temperature"] == 0.2
    assert json.loads(request.content)["model"] == "synthetic"
    assert request.url.path == ("/v1/messages" if protocol == "anthropic" else "/v1/chat/completions")


@pytest.mark.parametrize("options", [
    {"requestHeaders": {"Authorization": "not-allowed"}},
    {"requestHeaders": {"X-Title": "line\ninjection"}},
    {"requestBody": {"messages": []}},
    {"requestBody": {"temperature": 8}},
    {"authMode": "unknown"},
])
def test_rejects_invalid_runtime_options(options):
    with pytest.raises(ValueError):
        validate_request_options(options, "openai")


def test_environment_configuration_survives_restart_without_public_secret(monkeypatch):
    options = {"authMode": "bearer", "requestHeaders": {"x-token": "synthetic-header-secret"}}
    monkeypatch.setenv("FETCHCV_PROVIDER_REQUEST_OPTIONS", json.dumps(options))
    settings = AgentSettings.from_env()
    assert settings.provider_request_options == options
    assert "synthetic-header-secret" not in repr(settings)
    assert "synthetic-header-secret" not in json.dumps(settings.public_status())
