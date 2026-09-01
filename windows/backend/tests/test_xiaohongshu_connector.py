from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_runtime_has_no_account_bound_xiaohongshu_endpoints():
    api_source = (ROOT / "backend" / "applyos_api" / "main.py").read_text(encoding="utf-8")
    client_source = (ROOT / "src" / "lib" / "api.js").read_text(encoding="utf-8")

    assert "/api/xiaohongshu/login" not in api_source
    assert "import-browser-session" not in api_source
    assert "startXiaohongshuLogin" not in client_source
    assert "importXiaohongshuBrowserSession" not in client_source


def test_interview_pipeline_declares_anonymous_public_mode():
    source = (ROOT / "backend" / "applyos_agent" / "interview_tools.py").read_text(encoding="utf-8")

    assert '"anonymous_public_mode": True' in source
    assert '"account_session_used": False' in source
    assert "xiaohongshu-signed-read" not in source
    assert "xiaohongshu-signed-search" not in source
