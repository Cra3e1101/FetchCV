from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any
from urllib.parse import urlsplit

import httpx

from applyos_harness.errors import HarnessError

from .client import WebClient


@dataclass
class FirecrawlPage:
    source_url: str
    title: str
    text: str
    metadata: dict[str, Any]


class FirecrawlClient:
    """Optional Firecrawl v2 adapter; no Firecrawl server code is bundled."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        api_key: str | None = None,
        transport: httpx.BaseTransport | None = None,
        web_client: WebClient | None = None,
    ):
        self.base_url = (base_url if base_url is not None else os.getenv("FETCHCV_FIRECRAWL_URL", "")).strip().rstrip("/")
        self.api_key = api_key if api_key is not None else os.getenv("FETCHCV_FIRECRAWL_API_KEY", "").strip()
        self.transport = transport
        self.web_client = web_client or WebClient()

    @property
    def configured(self) -> bool:
        return bool(self.base_url)

    def _endpoint(self) -> str:
        parsed = urlsplit(self.base_url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme != "https" and not local_http:
            raise HarnessError("firecrawl_url_invalid", "Firecrawl 地址必须使用 HTTPS，或绑定到本机回环地址")
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise HarnessError("firecrawl_url_invalid", "Firecrawl 地址无效")
        base = self.base_url
        if base.endswith("/v2/scrape"):
            return base
        if base.endswith("/v2"):
            return f"{base}/scrape"
        return f"{base}/v2/scrape"

    def scrape(self, url: str) -> FirecrawlPage:
        if not self.configured:
            raise HarnessError("firecrawl_not_configured", "Firecrawl 尚未配置")
        target = self.web_client.validate_url(url)
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        try:
            with httpx.Client(timeout=httpx.Timeout(55.0, connect=8.0), trust_env=False, transport=self.transport) as client:
                response = client.post(
                    self._endpoint(),
                    headers=headers,
                    json={
                        "url": target,
                        "formats": ["markdown"],
                        "onlyMainContent": True,
                        "waitFor": 2500,
                        "timeout": 40000,
                    },
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise HarnessError("firecrawl_request_failed", "Firecrawl 抓取失败", retryable=True, details={"error_type": type(exc).__name__}) from exc
        data = payload.get("data") if isinstance(payload, dict) else None
        if not payload.get("success") or not isinstance(data, dict):
            raise HarnessError("firecrawl_response_invalid", "Firecrawl 返回了无效结果", retryable=True)
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        text = str(data.get("markdown") or data.get("content") or data.get("html") or "").strip()
        if not text:
            raise HarnessError("firecrawl_content_empty", "Firecrawl 没有返回可用正文", retryable=True)
        return FirecrawlPage(
            source_url=str(metadata.get("sourceURL") or metadata.get("url") or target),
            title=str(metadata.get("title") or "")[:500],
            text=text[:50000],
            metadata=metadata,
        )
