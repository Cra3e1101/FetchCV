import httpx

from applyos_harness.errors import HarnessError
from integrations.web import FirecrawlClient, WebClient


PUBLIC_IP = "93.184.216.34"


def resolver(host, port, **_):
    return [(2, 1, 6, "", (PUBLIC_IP, port))]


def test_firecrawl_adapter_reads_markdown_without_bundling_server():
    def handler(request):
        assert request.url.path == "/v2/scrape"
        assert request.headers["authorization"] == "Bearer test-key"
        return httpx.Response(200, json={
            "success": True,
            "data": {
                "markdown": "# 数据分析实习生\n\n岗位职责：负责指标分析。\n\n任职要求：熟练 SQL。",
                "metadata": {"title": "数据分析实习生", "sourceURL": "https://jobs.example.com/42"},
            },
        }, request=request)

    client = FirecrawlClient(
        base_url="https://firecrawl.example.com",
        api_key="test-key",
        transport=httpx.MockTransport(handler),
        web_client=WebClient(resolver=resolver),
    )
    result = client.scrape("https://jobs.example.com/42")
    assert result.title == "数据分析实习生"
    assert "岗位职责" in result.text
    assert result.source_url == "https://jobs.example.com/42"


def test_firecrawl_adapter_rejects_non_local_plain_http():
    client = FirecrawlClient(base_url="http://firecrawl.example.com")
    try:
        client._endpoint()
    except HarnessError as error:
        assert error.code == "firecrawl_url_invalid"
    else:
        raise AssertionError("plain HTTP Firecrawl endpoint must be rejected")


def test_firecrawl_adapter_can_call_a_local_no_auth_server():
    def handler(request):
        assert "authorization" not in request.headers
        return httpx.Response(200, json={
            "success": True,
            "data": {"markdown": "岗位职责：负责数据分析。"},
        }, request=request)

    client = FirecrawlClient(
        base_url="http://127.0.0.1:3002",
        api_key="",
        transport=httpx.MockTransport(handler),
        web_client=WebClient(resolver=resolver),
    )
    assert "岗位职责" in client.scrape("https://jobs.example.com/42").text
