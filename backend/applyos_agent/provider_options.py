"""Request settings shared by the structured extraction paths.

The main process validates/encrypts settings. These guards also protect direct
authenticated runtime configuration calls; they never permit replacing prompts.
"""
import math
import re


def validate_request_options(options: dict, protocol: str) -> dict:
    if not isinstance(options, dict):
        raise ValueError("request_options_must_be_object")
    auth = options.get("authMode") or "auto"
    if auth not in {"auto", "bearer", "x-api-key"}:
        raise ValueError("invalid_auth_mode")
    headers = options.get("requestHeaders") or {}
    if not isinstance(headers, dict) or len(headers) > 32:
        raise ValueError("invalid_request_headers")
    normalized = {}
    protected = {"authorization", "x-api-key", "host", "content-type", "content-length", "connection", "transfer-encoding", "proxy-authorization", "user-agent"}
    for name, value in headers.items():
        key = name.strip().lower()
        if not re.fullmatch(r"[!#$%&'*+\-.^_`|~0-9A-Za-z]+", key) or key in protected or key in normalized:
            raise ValueError("invalid_request_header_name")
        if not isinstance(value, str) or len(value) > 4096 or re.search(r"[^\x20-\x7e\t]", value):
            raise ValueError("invalid_request_header_value")
        normalized[key] = value
    user_agent = options.get("userAgent") or ""
    if not isinstance(user_agent, str) or re.search(r"[^\x20-\x7e\t]", user_agent):
        raise ValueError("invalid_user_agent")
    body = options.get("requestBody") or {}
    ranges = {"temperature": (0, 2), "top_p": (0, 1), "seed": (-2147483648, 2147483647), "frequency_penalty": (-2, 2), "presence_penalty": (-2, 2)}
    if not isinstance(body, dict):
        raise ValueError("invalid_request_body")
    for key, value in body.items():
        if key not in ranges or isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not ranges[key][0] <= value <= ranges[key][1]:
            raise ValueError("invalid_request_parameter")
        if key == "seed" and int(value) != value:
            raise ValueError("invalid_request_seed")
        if protocol == "anthropic" and (key not in {"temperature", "top_p"} or value > 1):
            raise ValueError("unsupported_anthropic_parameter")
    if protocol == "anthropic" and "temperature" in body and "top_p" in body:
        raise ValueError("conflicting_anthropic_sampling")
    return {"authMode": auth, "requestHeaders": normalized, "requestBody": body, "userAgent": user_agent}


def request_headers(settings) -> dict:
    options = validate_request_options(settings.provider_request_options, settings.provider_protocol)
    mode = options["authMode"]
    if mode == "auto":
        mode = "x-api-key" if settings.provider_protocol == "anthropic" else "bearer"
    headers = {"content-type": "application/json", **options["requestHeaders"]}
    if settings.provider_protocol == "anthropic":
        headers["anthropic-version"] = "2023-06-01"
    if options["userAgent"]:
        headers["user-agent"] = options["userAgent"]
    headers.update({"Authorization": f"Bearer {settings.provider_api_key}"} if mode == "bearer" else {"x-api-key": settings.provider_api_key})
    return headers


def request_body(settings, body: dict) -> dict:
    return {**body, **validate_request_options(settings.provider_request_options, settings.provider_protocol)["requestBody"]}


def redact_provider_message(settings, value) -> str:
    text = str(value)
    for secret in [settings.provider_api_key, *(settings.provider_request_options.get("requestHeaders") or {}).values()]:
        if isinstance(secret, str) and secret:
            text = text.replace(secret, "[已隐藏]")
    return text
