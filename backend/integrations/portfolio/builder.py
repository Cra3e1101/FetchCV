from __future__ import annotations

import json
from html import escape
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, Field


class PortfolioBuildResult(BaseModel):
    status: str
    artifact_path: str
    preview_path: str | None = None
    request_path: str | None = None
    warnings: list[str] = Field(default_factory=list)


class PortfolioBuilder(Protocol):
    def build(self, *, version_id: str, page_schema: dict, output_dir: Path) -> PortfolioBuildResult: ...


class MockPortfolioBuilder:
    def build(self, *, version_id: str, page_schema: dict, output_dir: Path) -> PortfolioBuildResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        claims = page_schema.get("claims", [])
        cards = "".join(
            f'<article><span>{index:02d}</span><p>{escape(str(item.get("text") or ""))}</p></article>'
            for index, item in enumerate(claims, start=1)
        ) or "<p class='empty'>尚无已批准内容</p>"
        title = escape(str(page_schema.get("title") or "岗位作品集"))
        subtitle = escape(str(page_schema.get("subtitle") or "由已确认事实生成"))
        html = f"""<!doctype html><html lang='zh-CN'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{title}</title><style>
        :root{{--canvas:#faf9f5;--ink:#141413;--body:#3d3d3a;--coral:#cc785c;--line:#e6dfd8;--card:#efe9de}}*{{box-sizing:border-box}}body{{margin:0;background:var(--canvas);color:var(--ink);font-family:'Segoe UI','Microsoft YaHei',sans-serif}}main{{max-width:980px;margin:auto;padding:72px 42px}}header{{max-width:680px;margin-bottom:56px}}small{{color:var(--coral);letter-spacing:.12em}}h1{{font-family:Georgia,'Songti SC',serif;font-weight:400;font-size:52px;letter-spacing:-.03em;margin:14px 0}}header p{{color:var(--body);font-size:17px;line-height:1.7}}section{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}article{{min-height:150px;background:var(--card);border-radius:14px;padding:24px}}article span{{color:var(--coral);font:12px monospace}}article p{{font-family:Georgia,'Songti SC',serif;font-size:19px;line-height:1.55;margin:20px 0 0}}.empty{{color:#6c6a64}}@media(max-width:700px){{main{{padding:40px 22px}}h1{{font-size:38px}}section{{grid-template-columns:1fr}}}}</style></head><body><main><header><small>FETCHCV · VERIFIED WORK</small><h1>{title}</h1><p>{subtitle}</p></header><section>{cards}</section></main></body></html>"""
        index_path = output_dir / "index.html"
        index_path.write_text(html, encoding="utf-8")
        (output_dir / "page-schema.json").write_text(json.dumps(page_schema, ensure_ascii=False, indent=2), encoding="utf-8")
        return PortfolioBuildResult(status="built", artifact_path=str(output_dir), preview_path=str(index_path))


class FileProtocolPortfolioBuilder:
    """Stable handoff contract for a future external Vibe Coding builder."""

    def build(self, *, version_id: str, page_schema: dict, output_dir: Path) -> PortfolioBuildResult:
        output_dir.mkdir(parents=True, exist_ok=True)
        request_path = output_dir / "build-request.json"
        request_path.write_text(
            json.dumps({"protocol": "fetchcv.portfolio-builder/v1", "version_id": version_id, "page_schema": page_schema, "output_dir": str(output_dir)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        result_path = output_dir / "build-result.json"
        if result_path.exists():
            result = json.loads(result_path.read_text(encoding="utf-8"))
            return PortfolioBuildResult.model_validate(result)
        return PortfolioBuildResult(status="awaiting_external_builder", artifact_path=str(output_dir), request_path=str(request_path), warnings=["外部网页制作器尚未回写 build-result.json"])
