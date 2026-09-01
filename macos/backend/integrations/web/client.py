from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
from html.parser import HTMLParser
import ipaddress
import os
import socket
from typing import Callable
from urllib.parse import parse_qs, parse_qsl, quote_plus, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from applyos_harness.errors import HarnessError


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
ALLOWED_CONTENT_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "application/json")
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
BLOCKED_HOSTS = {"localhost", "metadata.google.internal", "instance-data", "169.254.169.254"}
SENSITIVE_QUERY_KEYS = {"access_token", "api_key", "apikey", "auth", "authorization", "code", "credential", "key", "password", "secret", "sig", "signature", "token"}
BLOCK_TAGS = {"address", "article", "aside", "blockquote", "br", "div", "footer", "h1", "h2", "h3", "h4", "header", "li", "main", "nav", "p", "section", "table", "tr"}
# Navigation, account chrome and footer copy are frequent false positives on
# recruitment sites. JSON-LD is still captured before these nodes are skipped.
SKIP_TAGS = {"script", "style", "noscript", "svg", "canvas", "template", "nav", "footer", "aside", "form"}


@dataclass
class WebPage:
    requested_url: str
    final_url: str
    status_code: int
    content_type: str
    title: str
    description: str
    text: str
    headings: list[str] = field(default_factory=list)
    links: list[dict[str, str]] = field(default_factory=list)
    json_ld: list[str] = field(default_factory=list)
    content_sha256: str = ""
    truncated: bool = False


@dataclass
class WebSearchResult:
    title: str
    url: str
    snippet: str = ""


class _PageParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.title_parts: list[str] = []
        self.description = ""
        self.text_parts: list[str] = []
        self.headings: list[str] = []
        self.links: list[dict[str, str]] = []
        self.json_ld: list[str] = []
        self._skip_depth = 0
        self._capture_title = False
        self._capture_heading = False
        self._heading_parts: list[str] = []
        self._capture_link = False
        self._link_parts: list[str] = []
        self._link_href = ""
        self._capture_json_ld = False
        self._json_ld_parts: list[str] = []

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {str(key).lower(): str(value or "") for key, value in attrs}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        values = self._attrs(attrs)
        if tag == "script" and values.get("type", "").lower().split(";", 1)[0].strip() == "application/ld+json":
            self._capture_json_ld = True
            self._json_ld_parts = []
            return
        if tag in SKIP_TAGS:
            self._skip_depth += 1
            return
        if self._skip_depth:
            return
        if tag in BLOCK_TAGS:
            self.text_parts.append("\n")
        if tag == "title":
            self._capture_title = True
        if tag in {"h1", "h2", "h3"}:
            self._capture_heading = True
            self._heading_parts = []
        if tag == "meta":
            key = (values.get("name") or values.get("property") or "").lower()
            if key in {"description", "og:description", "twitter:description"} and values.get("content") and not self.description:
                self.description = values["content"].strip()
        if tag == "a" and values.get("href"):
            self._capture_link = True
            self._link_parts = []
            self._link_href = urljoin(self.base_url, values["href"])

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "script" and self._capture_json_ld:
            raw = "".join(self._json_ld_parts).strip()
            if raw:
                self.json_ld.append(raw)
            self._capture_json_ld = False
            self._json_ld_parts = []
            return
        if tag in SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
            return
        if self._skip_depth:
            return
        if tag == "title":
            self._capture_title = False
        if tag in {"h1", "h2", "h3"} and self._capture_heading:
            value = _clean_text(" ".join(self._heading_parts))
            if value and value not in self.headings:
                self.headings.append(value)
            self._capture_heading = False
        if tag == "a" and self._capture_link:
            label = _clean_text(" ".join(self._link_parts))
            parsed = urlsplit(self._link_href)
            if parsed.scheme in {"http", "https"} and label and len(self.links) < 80:
                self.links.append({"title": label[:240], "url": self._link_href})
            self._capture_link = False
        if tag in BLOCK_TAGS:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._capture_json_ld:
            self._json_ld_parts.append(data)
            return
        if self._skip_depth:
            return
        if self._capture_title:
            self.title_parts.append(data)
        if self._capture_heading:
            self._heading_parts.append(data)
        if self._capture_link:
            self._link_parts.append(data)
        self.text_parts.append(data)


class _SearchParser(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.results: list[dict[str, str]] = []
        self._bing_depth = 0
        self._heading_depth = 0
        self._capture_link = False
        self._href = ""
        self._parts: list[str] = []

    @staticmethod
    def _attrs(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {str(key).lower(): str(value or "") for key, value in attrs}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = self._attrs(attrs)
        classes = set(values.get("class", "").split())
        if tag == "li" and "b_algo" in classes:
            self._bing_depth += 1
        if tag == "h3":
            self._heading_depth += 1
        if tag == "a" and values.get("href") and ("result__a" in classes or self._bing_depth or self._heading_depth):
            self._capture_link = True
            self._href = urljoin(self.base_url, values["href"])
            self._parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture_link:
            title = _clean_text(" ".join(self._parts))
            if title and self._href:
                self.results.append({"title": title[:240], "url": self._href})
            self._capture_link = False
        if tag == "h3" and self._heading_depth:
            self._heading_depth -= 1
        if tag == "li" and self._bing_depth:
            self._bing_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._capture_link:
            self._parts.append(data)


def _clean_text(value: str) -> str:
    lines = [" ".join(line.split()) for line in value.replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


class WebClient:
    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        resolver: Callable[..., list[tuple]] = socket.getaddrinfo,
        allow_http: bool | None = None,
    ):
        self.transport = transport
        self.resolver = resolver
        self.allow_http = os.getenv("FETCHCV_WEB_ALLOW_HTTP", "").strip() == "1" if allow_http is None else allow_http
        configured_search = [item.strip() for item in os.getenv("FETCHCV_WEB_SEARCH_ENDPOINT", "").split(",") if item.strip()]
        self.search_endpoints = configured_search or ["https://www.bing.com/search", "https://html.duckduckgo.com/html/"]

    def validate_url(self, value: str, *, preserve_fragment: bool = False) -> str:
        raw = str(value or "").strip()
        if len(raw) > 4096:
            raise HarnessError("web_url_invalid", "网页 URL 过长")
        parsed = urlsplit(raw)
        allowed_schemes = {"https", "http"} if self.allow_http else {"https"}
        if parsed.scheme.lower() not in allowed_schemes:
            raise HarnessError("web_url_scheme_denied", "网页访问只允许 HTTPS", details={"scheme": parsed.scheme})
        if parsed.username or parsed.password:
            raise HarnessError("web_url_credentials_denied", "网页 URL 不允许包含用户名或密码")
        hostname = (parsed.hostname or "").rstrip(".").casefold()
        if not hostname or hostname in BLOCKED_HOSTS or hostname.endswith(".local"):
            raise HarnessError("web_host_denied", "网页主机不在允许的公网范围", details={"host": hostname})
        try:
            port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
        except ValueError as exc:
            raise HarnessError("web_url_invalid", "网页 URL 端口无效") from exc
        if port not in {80, 443}:
            raise HarnessError("web_port_denied", "网页访问只允许 80 或 443 端口", details={"port": port})
        ascii_host = hostname.encode("idna").decode("ascii")
        self._require_public_host(ascii_host, port)
        host_for_url = f"[{ascii_host}]" if ":" in ascii_host else ascii_host
        netloc = host_for_url if port == (443 if parsed.scheme.lower() == "https" else 80) else f"{host_for_url}:{port}"
        fragment = self._safe_fragment(parsed.fragment) if preserve_fragment else ""
        return urlunsplit((parsed.scheme.lower(), netloc, parsed.path or "/", parsed.query, fragment))

    def _require_public_host(self, hostname: str, port: int) -> None:
        try:
            literal = ipaddress.ip_address(hostname)
            addresses = [literal]
        except ValueError:
            try:
                answers = self.resolver(hostname, port, type=socket.SOCK_STREAM)
            except OSError as exc:
                raise HarnessError("web_dns_failed", "网页域名解析失败", retryable=True, details={"host": hostname}) from exc
            addresses = []
            for answer in answers:
                try:
                    addresses.append(ipaddress.ip_address(answer[4][0]))
                except (ValueError, IndexError):
                    continue
        if not addresses or any(not address.is_global for address in addresses):
            raise HarnessError("web_private_address_denied", "网页域名解析到非公网地址", details={"host": hostname})

    def read(self, url: str, *, max_bytes: int = MAX_RESPONSE_BYTES) -> tuple[str, bytes, str, int]:
        requested = self.validate_url(url)
        current = requested
        max_bytes = max(1024, min(int(max_bytes), MAX_RESPONSE_BYTES))
        try:
            with httpx.Client(
                timeout=httpx.Timeout(20.0, connect=8.0),
                follow_redirects=False,
                trust_env=False,
                transport=self.transport,
                headers={"User-Agent": "FetchCV/0.3 (+local career agent)", "Accept": "text/html,application/xhtml+xml,text/plain,application/json;q=0.8"},
            ) as client:
                for _ in range(4):
                    with client.stream("GET", current) as response:
                        if response.status_code in REDIRECT_STATUSES:
                            location = response.headers.get("location", "").strip()
                            if not location:
                                raise HarnessError("web_redirect_invalid", "网页返回了没有目标地址的重定向")
                            current = self.validate_url(urljoin(current, location))
                            continue
                        if response.status_code >= 400:
                            raise HarnessError("web_http_error", f"网页返回 HTTP {response.status_code}", retryable=response.status_code >= 500, details={"url": current, "status": response.status_code})
                        content_type = response.headers.get("content-type", "text/html").split(";", 1)[0].strip().lower()
                        if not any(content_type == allowed for allowed in ALLOWED_CONTENT_TYPES):
                            raise HarnessError("web_content_type_denied", "网页内容类型不受支持", details={"content_type": content_type})
                        raw_length = response.headers.get("content-length", "")
                        if raw_length.isdigit() and int(raw_length) > max_bytes:
                            raise HarnessError("web_response_too_large", "网页内容超过大小限制", details={"max_bytes": max_bytes})
                        chunks: list[bytes] = []
                        size = 0
                        for chunk in response.iter_bytes():
                            size += len(chunk)
                            if size > max_bytes:
                                raise HarnessError("web_response_too_large", "网页内容超过大小限制", details={"max_bytes": max_bytes})
                            chunks.append(chunk)
                        return current, b"".join(chunks), content_type, response.status_code
                raise HarnessError("web_redirect_limit", "网页重定向次数过多")
        except HarnessError:
            raise
        except httpx.TimeoutException as exc:
            raise HarnessError("web_timeout", "网页访问超时", retryable=True, details={"url": current}) from exc
        except httpx.HTTPError as exc:
            raise HarnessError("web_connection_error", "网页连接失败", retryable=True, details={"error_type": type(exc).__name__}) from exc

    def read_page(self, url: str, *, max_chars: int = 30000) -> WebPage:
        requested = self.validate_url(url)
        final_url, raw, content_type, status_code = self.read(requested)
        text = self._decode(raw, content_type)
        if content_type in {"text/html", "application/xhtml+xml"}:
            parser = _PageParser(final_url)
            parser.feed(text)
            visible = _clean_text("".join(parser.text_parts))
            title = _clean_text(" ".join(parser.title_parts))
            description = _clean_text(parser.description)
            headings = parser.headings[:20]
            links = parser.links[:80]
            json_ld = parser.json_ld[:20]
        else:
            visible = _clean_text(text)
            title = ""
            description = ""
            headings = []
            links = []
            json_ld = []
        limit = max(1000, min(int(max_chars), 50000))
        truncated = len(visible) > limit
        return WebPage(
            requested_url=self.redact_url(requested),
            final_url=self.redact_url(final_url),
            status_code=status_code,
            content_type=content_type,
            title=title[:500],
            description=description[:1000],
            text=visible[:limit],
            headings=headings,
            links=links,
            json_ld=json_ld,
            content_sha256=sha256(raw).hexdigest(),
            truncated=truncated,
        )

    def search(self, query: str, *, max_results: int = 5) -> list[WebSearchResult]:
        normalized = " ".join(str(query or "").split())
        if len(normalized) < 2:
            raise HarnessError("web_search_query_invalid", "搜索关键词至少需要 2 个字符")
        last_error: HarnessError | None = None
        for raw_endpoint in self.search_endpoints:
            try:
                endpoint = self.validate_url(raw_endpoint)
                separator = "&" if urlsplit(endpoint).query else "?"
                search_url = f"{endpoint}{separator}q={quote_plus(normalized)}"
                final_url, raw, content_type, _ = self.read(search_url)
                if content_type not in {"text/html", "application/xhtml+xml"}:
                    continue
                parser = _SearchParser(final_url)
                parser.feed(self._decode(raw, content_type))
                results = self._normalize_search_results(parser.results, endpoint=endpoint, final_url=final_url, max_results=max_results)
                if results:
                    return results
            except HarnessError as exc:
                last_error = exc
                continue
        if last_error:
            raise last_error
        return []

    def _normalize_search_results(self, links: list[dict[str, str]], *, endpoint: str, final_url: str, max_results: int) -> list[WebSearchResult]:
        results: list[WebSearchResult] = []
        seen: set[str] = set()
        search_hosts = {(urlsplit(endpoint).hostname or "").casefold(), (urlsplit(final_url).hostname or "").casefold()}
        for link in links:
            target = self._search_target(link["url"])
            host = (urlsplit(target).hostname or "").casefold()
            if not target or self._is_search_host(host, search_hosts):
                continue
            try:
                safe_target = self.validate_url(target)
            except HarnessError:
                continue
            safe_target = self.redact_url(safe_target)
            if safe_target in seen:
                continue
            seen.add(safe_target)
            results.append(WebSearchResult(title=link["title"], url=safe_target))
            if len(results) >= max(1, min(int(max_results), 8)):
                break
        return results

    @staticmethod
    def _is_search_host(host: str, search_hosts: set[str]) -> bool:
        if host in search_hosts:
            return True
        return any(host == suffix or host.endswith(f".{suffix}") for suffix in ("bing.com", "duckduckgo.com", "baidu.com"))

    @staticmethod
    def _search_target(url: str) -> str:
        parsed = urlsplit(url)
        query = parse_qs(parsed.query)
        for key in ("uddg", "url", "u"):
            if query.get(key):
                return query[key][0]
        return url

    @staticmethod
    def redact_url(url: str) -> str:
        parsed = urlsplit(url)
        filtered = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True) if key.casefold() not in SENSITIVE_QUERY_KEYS]
        fragment = WebClient._safe_fragment(parsed.fragment)
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urlencode(filtered, doseq=True), fragment))

    @staticmethod
    def _safe_fragment(fragment: str) -> str:
        """Keep SPA route fragments while dropping fragments that look like credentials."""
        value = str(fragment or "").strip()
        if not value or len(value) > 1024:
            return ""
        lowered = value.casefold()
        if any(marker in lowered for marker in ("access_token", "authorization", "password", "secret", "api_key", "apikey", "token=")):
            return ""
        return value

    @staticmethod
    def _decode(raw: bytes, content_type: str) -> str:
        if content_type == "application/json":
            return raw.decode("utf-8", errors="replace")
        head = raw[:2048].decode("ascii", errors="ignore").lower()
        charset = "utf-8"
        marker = "charset="
        if marker in head:
            candidate = head.split(marker, 1)[1].split('"', 1)[0].split("'", 1)[0].split(";", 1)[0].split(">", 1)[0].strip()
            if candidate:
                charset = candidate
        try:
            return raw.decode(charset, errors="replace")
        except LookupError:
            return raw.decode("utf-8", errors="replace")
