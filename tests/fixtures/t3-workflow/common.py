"""Independent T3 offline fixtures. No production code is replaced except IO clients."""
from __future__ import annotations
from types import SimpleNamespace
from hashlib import sha256
import ipaddress
import socket

URL = "https://synthetic.invalid/job/42"
BODY = ("职能：数据分析\n子方向：风控分析\n招聘类型：正式校招\n部门：风险策略部\n发布日期：2026-10-24\n"
        "岗位职责：整理合成订单数据，使用 SQL 分析异常并核对数据质量。\n"
        "任职要求：理解统计方法，能与产品团队解释指标的变化。\n") * 4
SHORT = "岗位职责：" + "用 SQL 核对合成订单数据并解释异常。" * 13
LONG = "岗位职责：" + "用 SQL 核对合成订单数据并解释异常。" * 110
CASES = ("static", "spa", "firecrawl-browser", "timeout", "login", "insufficient")

def block_external_connections():
    original = socket.socket.connect
    def connect(sock, address):
        if isinstance(address, tuple):
            try:
                allowed = ipaddress.ip_address(address[0]).is_loopback
            except ValueError:
                allowed = address[0] == "localhost"
            if not allowed:
                raise RuntimeError("T3 independent fixture blocked external network")
        return original(sock, address)
    socket.socket.connect = connect

def clients(case):
    from integrations.web import WebClient
    from integrations.web.client import WebPage
    from applyos_harness.errors import HarnessError
    calls = []
    class Static:
        redact_url = staticmethod(WebClient.redact_url)
        def read_page(self, url, **_):
            calls.append("static")
            if case == "timeout":
                raise HarnessError("web_timeout", "offline synthetic timeout")
            text = BODY if case == "static" else "请启用 JavaScript" if case in {"spa", "firecrawl-browser", "login"} else "职位描述：短"
            return WebPage(url, URL, 200, "text/html", "合成数据分析岗位", "", text,
                content_sha256=sha256(b"synthetic HTML hash must not become body hash").hexdigest())
    class Firecrawl:
        configured = case in {"firecrawl-browser", "timeout"}
        def scrape(self, url):
            calls.append("firecrawl")
            if case == "timeout":
                raise HarnessError("web_timeout", "offline synthetic timeout")
            return SimpleNamespace(text=SHORT, source_url=URL, title="合成短正文", metadata={})
    class Browser:
        configured = case in {"spa", "firecrawl-browser", "timeout", "login"}
        def open(self, url):
            calls.append("browser")
            if case == "timeout":
                raise HarnessError("browser_timeout", "offline synthetic timeout")
            return {"url": URL, "title": "合成浏览器正文", "text": "" if case in {"spa", "login"} else LONG,
                    "login_required": case == "login"}
    if case == "timeout":
        import httpx
        def timed_out(request):
            calls.append("static")
            raise httpx.ReadTimeout("offline synthetic ReadTimeout", request=request)
        web = WebClient(transport=httpx.MockTransport(timed_out), resolver=lambda host,port,**_: [(2,1,6,"",("93.184.216.34",port))])
    else:
        web = Static()
    return web, Firecrawl(), Browser(), calls

def importer(session, case):
    from integrations.web import JobPostingImporter
    web, firecrawl, browser, calls = clients(case)
    return JobPostingImporter(session, web_client=web, firecrawl_client=firecrawl, browser_client=browser), calls
