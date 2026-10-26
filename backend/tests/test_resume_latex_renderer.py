from __future__ import annotations

import subprocess

import pytest
from pypdf import PdfReader

from integrations.resume import latex_renderer as renderer
from integrations.resume.latex_runtime import LatexRuntime
from pathlib import Path
from integrations.resume.template import didi_settings
from integrations.resume_pdf.importer import _editor_snapshot


def snapshot(body="使用 <strong>Python</strong> 分析数据，R^2 达到 0.92。"):
    return {
        "profile": {"name": "测试同学", "email": "test@example.com"},
        "settings": didi_settings(),
        "sections": [{"id": "project", "title": "项目经历", "visible": True, "items": [{
            "fields": {"projectName": "数据分析与自动化工具项目", "role": "数据分析", "timeRange": {"start": "2025-06", "end": "2025-10"}},
            "body": body,
        }]}],
    }


def test_untrusted_text_cannot_introduce_tex_commands_or_external_resources():
    data = snapshot(r"\input{secret.txt} 50% & $HOME # _ ~ ^" + '<script>discard()</script><img src="file:///secret">')
    data["profile"]["name"] = r"\write18{touch injected}"
    source = renderer.build_tex(data)
    assert r"\input{secret.txt}" not in source
    assert r"\write18{touch injected}" not in source
    assert r"\textbackslash{}input\{secret.txt\}" in source
    assert r"50\% \& \$HOME \# \_ \textasciitilde{} \textasciicircum{}" in source
    assert "discard()" not in source and "file:///secret" not in source
    with pytest.raises(ValueError, match="头像"):
        renderer.build_tex(data, photo_filename="../../secret.pdf")


def test_rich_metadata_preserves_local_normal_weight_and_rejects_stale_text():
    data = snapshot()
    item = data["sections"][0]["items"][0]
    item["fields"]["projectName"] = "示例大学（211）"
    item["metaRich"] = {"title": '<strong>示例大学</strong><span style="font-weight:400">（211）</span>', "role": "数据分析", "roleLeadingPhantomEm": 1}
    source = renderer.build_tex(data)
    assert r"\textbf{示例大学}{\mdseries （211）}" in source
    assert r"\hspace{1.000000em}数据分析" in source
    item["fields"]["projectName"] = "编辑后的项目名称"
    source = renderer.build_tex(data)
    assert "编辑后的项目名称" in source and "示例大学" not in source


def test_fingerprint_ignores_bookkeeping_but_catches_visible_changes():
    data = snapshot()
    original = renderer.document_fingerprint(data)
    data["activeTab"] = "profile"
    data["schema_version"] = 7
    data["previewZoom"] = 0.9
    data["sections"][0]["items"][0]["id"] = "migrated-id"
    assert renderer.document_fingerprint(data) == original
    data["sections"][0]["items"][0]["body"] += "参与而非主导。"
    assert renderer.document_fingerprint(data) != original


def test_legacy_layout_is_reset_and_v2_controls_affect_native_output():
    legacy = snapshot()
    legacy["settings"] = {"templatePreset": "didi-v1", "fontSize": 24, "lineHeight": 220, "margin": 90}
    source = renderer.build_tex(legacy)
    assert "left=1.27cm,right=1.27cm" in source
    assert r"\fontsize{10.2pt}" in source
    adjusted = snapshot()
    adjusted["settings"]["fontSize"] = 16
    adjusted["settings"]["lineHeight"] = 160
    adjusted["settings"]["margin"] = 60
    adjusted["sections"][0]["lineHeight"] = 170
    changed = renderer.build_tex(adjusted)
    assert "left=15.875000mm,right=15.875000mm" in changed
    assert r"\fontsize{12.045000pt}{20.476500pt}\selectfont" in changed


def test_skill_module_line_height_changes_table_spacing_without_changing_default():
    data = snapshot("数据分析：Python | SQL\n统计建模：回归分析 | 假设检验")
    section = data["sections"][0]
    section.update({"id": "skills", "title": "工作技能"})
    original = renderer.build_tex(data)
    assert "\\contentSpacing\n\\vspace{0.6mm}\n\\begin{tabularx}" in original
    section["lineHeight"] = 190
    custom = renderer.build_tex(data)
    assert "\\fontsize{10.200000pt}{19.380000pt}\\selectfont\n\\vspace{0.6mm}\n\\begin{tabularx}" in custom
    section.pop("lineHeight")
    assert renderer.build_tex(data) == original


def test_import_preserves_only_text_equivalent_local_formatting():
    record = {"kind": "experience", "section": "实习经历", "start_date": "2025-06", "end_date": "2025-10", "title": "示例公司", "organization": "示例公司", "role": "分析师", "summary": "研究生国家奖学金两次。", "details": {"rich_body": "<strong>研究生国家奖学金</strong>两次。", "meta_rich": {"title": "<strong>示例公司</strong>", "role": "分析师"}}}
    result = _editor_snapshot({"name": "测试"}, [record], bold_phrases=["国家奖学金"])
    item = result["sections"][0]["items"][0]
    assert item["body"] == "<strong>研究生国家奖学金</strong>两次。"
    assert item["metaRich"]["title"] == "<strong>示例公司</strong>"
    record["details"]["rich_body"] = "<strong>编造的奖项</strong>"
    result = _editor_snapshot({"name": "测试"}, [record])
    assert "编造" not in result["sections"][0]["items"][0]["body"]


def test_missing_engine_and_timeout_are_explicit_and_do_not_replace_existing_pdf(tmp_path, monkeypatch):
    target = tmp_path / "resume.pdf"
    target.write_bytes(b"existing document")
    monkeypatch.setattr(renderer, "resolve_runtime", lambda: None)
    with pytest.raises(renderer.XeLatexUnavailable):
        renderer.compile_snapshot(snapshot(), target)
    monkeypatch.setattr(renderer, "resolve_runtime", lambda: LatexRuntime(Path("/trusted/xelatex"), "test-runtime"))
    def timeout(*args, **kwargs):
        assert "-no-shell-escape" in args[0]
        assert kwargs["stdin"] == subprocess.DEVNULL
        raise subprocess.TimeoutExpired(args[0], 1)
    monkeypatch.setattr(renderer.subprocess, "run", timeout)
    with pytest.raises(renderer.XeLatexCompileError, match="超时"):
        renderer.compile_snapshot(snapshot(), target, timeout=1)
    assert target.read_bytes() == b"existing document"


@pytest.mark.skipif(not renderer.xelatex_available(), reason="XeLaTeX is required for native PDF validation")
def test_native_pdf_preserves_chinese_math_and_does_not_clip_long_content(tmp_path):
    data = snapshot("<div><strong>项目概述：</strong>验证原生中文排版与公式 R^2。</div>" + "".join(f"<div>第 {n} 项：仅参与数据整理，保留限定词与独立段落，不夸大为主导。</div>" for n in range(85)))
    target = tmp_path / "native.pdf"
    pages = renderer.compile_snapshot(data, target)
    reader = PdfReader(target)
    assert pages == len(reader.pages) and pages > 1
    text = "".join(page.extract_text() for page in reader.pages)
    compact = "".join(text.split())
    assert "测试同学" in compact and "R2" in compact
    assert "第84项：仅参与数据整理，保留限定词与独立段落，不夸大为主导。" in compact
    assert "第0项" in compact
