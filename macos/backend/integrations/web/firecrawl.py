from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Any
from urllib.parse import urlsplit

import httpx

from applyos_harness.errors import HarnessError

from .client import WebClient, WebSearchResult


@dataclass
class FirecrawlPage:
    source_url: str
    title: str
    text: str
    metadata: dict[str, Any]


class FirecrawlClient:
    """Optional Firecrawl v2 adapter for a hosted or local server."""

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

    def _endpoint(self, resource: str = "scrape") -> str:
        parsed = urlsplit(self.base_url)
        local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
        if parsed.scheme != "https" and not local_http:
            raise HarnessError("firecrawl_url_invalid", "Firecrawl 地址必须使用 HTTPS，或绑定到本机回环地址")
        if not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
            raise HarnessError("firecrawl_url_invalid", "Firecrawl 地址无效")
        base = self.base_url
        if base.endswith("/v2/scrape") or base.endswith("/v2/search"):
            base = base.rsplit("/", 1)[0]
        if base.endswith("/v2"):
            return f"{base}/{resource}"
        return f"{base}/v2/{resource}"

    def _headers(self) -> dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.api_key:
            headers["authorization"] = f"Bearer {self.api_key}"
        return headers

    def scrape(self, url: str) -> FirecrawlPage:
        if not self.configured:
            raise HarnessError("firecrawl_not_configured", "Firecrawl 尚未配置")
        target = self.web_client.validate_url(url)
        try:
            with httpx.Client(timeout=httpx.Timeout(55.0, connect=8.0), trust_env=False, transport=self.transport) as client:
                response = client.post(
                    self._endpoint("scrape"),
                    headers=self._headers(),
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

    def search(self, query: str, *, max_results: int = 5) -> list[WebSearchResult]:
        if not self.configured:
            raise HarnessError("firecrawl_not_configured", "Firecrawl 尚未配置")
        normalized = " ".join(str(query or "").split())
        if len(normalized) < 2:
            raise HarnessError("web_search_query_invalid", "搜索关键词至少需要 2 个字符")
        try:
            with httpx.Client(timeout=httpx.Timeout(55.0, connect=8.0), trust_env=False, transport=self.transport) as client:
                response = client.post(
                    self._endpoint("search"),
                    headers=self._headers(),
                    json={"query": normalized, "limit": max(1, min(int(max_results), 8)), "scrapeOptions": {"formats": ["markdown"], "onlyMainContent": True}},
                )
                response.raise_for_status()
                payload = response.json()
        except (httpx.HTTPError, ValueError, TypeError) as exc:
            raise HarnessError("firecrawl_search_failed", "Firecrawl 搜索失败", retryable=True, details={"error_type": type(exc).__name__}) from exc
        data = payload.get("data") if isinstance(payload, dict) else None
        raw_results = data.get("web") if isinstance(data, dict) else data
        if not isinstance(raw_results, list):
            return []
        results: list[WebSearchResult] = []
        seen: set[str] = set()
        for item in raw_results:
            if not isinstance(item, dict):
                continue
            raw_url = str(item.get("url") or item.get("sourceURL") or "")
            try:
                safe_url = self.web_client.redact_url(self.web_client.validate_url(raw_url))
            except HarnessError:
                continue
            if safe_url in seen:
                continue
            seen.add(safe_url)
            results.append(WebSearchResult(title=str(item.get("title") or safe_url)[:500], url=safe_url))
            if len(results) >= max_results:
                break
        return results
