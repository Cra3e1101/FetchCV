"""Public Nowcoder SSR adapter. Parses JSON as data; never executes page scripts."""
from __future__ import annotations

from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
import json
import re
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit


def canonical_nowcoder_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return ""
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"nowcoder.com", "www.nowcoder.com", "m.nowcoder.com"}:
        return ""
    if parsed.username or parsed.password or port not in {None, 80, 443}:
        return ""
    if not re.fullmatch(r"/(?:discuss/\d+|feed/main/detail/[a-fA-F0-9]{32})/?", parsed.path):
        return ""
    return urlunsplit(("https", "www.nowcoder.com", parsed.path.rstrip("/"), "", ""))


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skipped = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skipped += 1
        if not self.skipped and tag in {"p", "div", "li", "br", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.skipped:
            self.skipped -= 1
        if not self.skipped and tag in {"p", "div", "li"}:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.skipped:
            self.parts.append(data)


def plain_text(value) -> str:
    parser = _Text()
    parser.feed(str(value or ""))
    return "\n".join(line.strip() for line in "".join(parser.parts).splitlines() if line.strip())


def published_at(value) -> str:
    try:
        timestamp = float(value)
        if timestamp > 100_000_000_000:
            timestamp /= 1000
        date = datetime.fromtimestamp(timestamp, timezone(timedelta(hours=8)))
        return date.isoformat() if 2000 <= date.year <= datetime.now(timezone.utc).year else ""
    except (ValueError, TypeError, OSError, OverflowError):
        return ""


def _initial_state(html: str) -> dict:
    match = re.search(r"window\.__INITIAL_STATE__\s*=\s*", html)
    if not match:
        return {}
    try:
        value, _ = json.JSONDecoder().raw_decode(html[match.end():])
        return value if isinstance(value, dict) else {}
    except (ValueError, RecursionError):
        return {}


def _object(value) -> dict:
    return value if isinstance(value, dict) else {}


def extract_nowcoder(html: str, final_url: str) -> dict:
    """Only use the current post or search records; exclude comments/hot lists."""
    parsed = urlsplit(final_url)
    if parsed.hostname not in {"nowcoder.com", "www.nowcoder.com", "m.nowcoder.com"}:
        return {}
    state = _initial_state(html)
    canonical = canonical_nowcoder_url(final_url)
    if canonical:
        for entry in _object(state.get("prefetchData")).values():
            if not isinstance(entry, dict):
                continue
            expected_id = canonical.rsplit("/", 1)[-1]
            if str(entry.get("contentId") or "") != expected_id:
                continue
            content = _object(entry.get("ssrCommonData")).get("contentData") or {}
            if not isinstance(content, dict):
                continue
            text = plain_text(content.get("content") or content.get("richText"))
            if not text:
                continue
            return {
                "kind": "post", "title": plain_text(content.get("title")), "text": text,
                "published_at": published_at(content.get("createTime") or content.get("createdAt")),
                "extraction": "nowcoder-public-ssr", "canonical_url": canonical,
            }
        # An unrecognized layout must not silently turn recommendations into evidence.
        return {"kind": "post", "extraction": "unrecognized", "text": ""}
    if parsed.path != "/search/all":
        return {}
    query = parse_qs(parsed.query).get("query", [""])[0]
    for entry in _object(state.get("app")).values():
        if not isinstance(entry, dict) or not isinstance(entry.get("records"), list):
            continue
        links = []
        seen = set()
        for record in entry["records"]:
            if not isinstance(record, dict):
                continue
            data = _object(record.get("data"))
            content = data.get("contentData") or data.get("momentData") or {}
            if not isinstance(content, dict):
                continue
            if data.get("contentData"):
                url = f"https://www.nowcoder.com/discuss/{content.get('id', '')}"
            else:
                url = f"https://www.nowcoder.com/feed/main/detail/{content.get('uuid', '')}"
            url = canonical_nowcoder_url(url)
            if not url or url in seen:
                continue
            seen.add(url)
            links.append({"url": url, "title": plain_text(content.get("title") or content.get("newTitle")),
                          "snippet": plain_text(content.get("desc") or content.get("content"))[:1500]})
        try:
            current, size, total = (int(entry.get(key) or 0) for key in ("current", "size", "total"))
        except (ValueError, TypeError):
            current = size = total = 0
        next_url = ""
        if query and links and current > 0 and size > 0 and current * size < total:
            params = {"query": query, "type": "all", "page": current + 1}
            next_url = "https://www.nowcoder.com/search/all?" + urlencode(params)
        return {"kind": "search", "links": links, "next_url": next_url,
                "page": current, "total": total, "extraction": "nowcoder-public-ssr"}
    return {"kind": "search", "extraction": "unrecognized"}
