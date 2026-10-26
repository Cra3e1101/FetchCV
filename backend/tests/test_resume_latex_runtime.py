from __future__ import annotations

from dataclasses import replace
import hashlib
import json
import os
import shutil
import stat
import subprocess
from pathlib import Path

import pytest

from integrations.resume import latex_runtime as runtime
from integrations.resume import latex_renderer as renderer
from pypdf import PdfReader
from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, NameObject, TextStringObject

REAL_RUNTIME = Path(os.environ.get("FETCHCV_TEST_LATEX_RUNTIME") or Path(__file__).resolve().parents[2] / "build/resume-runtime")
REAL_SYSTEM_FONTS = runtime._system_font_files()


@pytest.fixture(autouse=True)
def isolated_runtime(monkeypatch):
    for name in ("FETCHCV_LATEX_RUNTIME", "FETCHCV_REQUIRE_BUNDLED_LATEX", "FETCHCV_XELATEX", "FETCHCV_RESUME_FONTS"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(runtime, "_default_roots", lambda: ())
    monkeypatch.setattr(runtime, "_system_font_files", lambda: ())
    monkeypatch.setattr(runtime.sys, "platform", "win32")


@pytest.fixture
def bundle(tmp_path):
    root = tmp_path / "runtime relocated with spaces"
    files = []
    names = ("bin/windows/xelatex.exe", "bin/windows/xdvipdfmx.exe", "texmf-var/web2c/xetex/xelatex.fmt", "texmf-dist/web2c/texmf.cnf", runtime.GB1_UNICODE_MAP, *runtime.FONT_FILES, *runtime.BOOTSTRAP_FONT_FILES)
    for name in names:
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        content = ("test fixture: " + name).encode()
        path.write_bytes(content)
        files.append({"path": name, "size": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    manifest = {"schemaVersion": 1, "platform": "win32", "arch": "x64", "engine": "xelatex", "runtimeId": "test-runtime-1", "executable": "bin/windows/xelatex.exe", "files": files}
    (root / "runtime-manifest.json").write_text(json.dumps(manifest))
    return root


def test_supplied_bundle_precedes_system_tex_and_remains_relocatable(bundle, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    monkeypatch.setenv("FETCHCV_XELATEX", "C:/unrelated/xelatex.exe")
    monkeypatch.setenv("FETCHCV_REQUIRE_BUNDLED_LATEX", "1")
    monkeypatch.setattr(runtime.shutil, "which", lambda name: pytest.fail("Must not search system PATH"))
    first = runtime.resolve_runtime()
    assert first.executable == bundle / "bin/windows/xelatex.exe"
    assert first.font_mode == "bundled"
    first_fingerprint = first.fingerprint
    relocated = tmp_path / "different installation"
    shutil.copytree(bundle, relocated)
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(relocated))
    second = runtime.resolve_runtime()
    assert second.fingerprint == first_fingerprint
    assert second.executable == relocated / "bin/windows/xelatex.exe"


def test_required_bundle_never_falls_back_to_path_or_developer_override(monkeypatch):
    monkeypatch.setenv("FETCHCV_REQUIRE_BUNDLED_LATEX", "1")
    monkeypatch.setenv("FETCHCV_XELATEX", "C:/already-installed/xelatex.exe")
    monkeypatch.setattr(runtime.shutil, "which", lambda name: pytest.fail("Must not search system PATH"))
    with pytest.raises(runtime.XeLatexUnavailable, match="内置排版运行时"):
        runtime.resolve_runtime()


def test_frozen_backend_never_uses_system_tex_even_without_launcher_environment(monkeypatch):
    monkeypatch.setattr(runtime.sys, "frozen", True, raising=False)
    monkeypatch.setattr(runtime.shutil, "which", lambda name: pytest.fail("Packaged backend must not search system PATH"))
    with pytest.raises(runtime.XeLatexUnavailable, match="内置排版运行时"):
        runtime.resolve_runtime()


def test_runtime_hash_verification_detects_file_changes(bundle, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    assert runtime.resolve_runtime()
    (bundle / runtime.FONT_FILES[0]).write_bytes(b"modified font")
    with pytest.raises(runtime.XeLatexUnavailable, match="校验失败"):
        runtime.resolve_runtime()


@pytest.mark.parametrize("bad_path", ["../outside.txt", "C:/outside.txt", "bin\\windows\\xelatex.exe"])
def test_manifest_cannot_reach_outside_runtime(bundle, monkeypatch, bad_path):
    manifest_path = bundle / "runtime-manifest.json"
    data = json.loads(manifest_path.read_text())
    data["files"][0]["path"] = bad_path
    manifest_path.write_text(json.dumps(data))
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    with pytest.raises(runtime.XeLatexUnavailable):
        runtime.resolve_runtime()


def test_compile_environment_isolated_and_open_fonts_use_fixed_relative_paths(bundle, tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    monkeypatch.setenv("TEXINPUTS", "C:/injected-macros//")
    monkeypatch.setenv("OPENTYPEFONTS", "C:/injected-fonts//")
    monkeypatch.setenv("CMAPINPUTS", "C:/injected-maps//")
    monkeypatch.setenv("FONTCONFIG_FILE", "C:/unrelated-fonts.conf")
    monkeypatch.setenv("PATH", "C:/unrelated-tex/bin")
    selected = runtime.resolve_runtime()
    output = tmp_path / "render"
    output.mkdir()
    env = runtime.prepare_environment(selected, output)
    assert "TEXINPUTS" not in env
    assert "OPENTYPEFONTS" not in env and "CMAPINPUTS" not in env
    assert env["MKTEXFMT"] == "0" and env["MKTEXPK"] == "0"
    assert "unrelated-tex" not in env["PATH"]
    assert env["TEMP"] == env["TMP"] == env["TMPDIR"] == ("scratch" if os.name == "nt" else str(output / "scratch"))
    assert env["TEXMFROOT"] == ("runtime" if os.name == "nt" else bundle.as_posix())
    if os.name == "nt":
        assert (output / "runtime").is_junction()
        assert (output / "runtime").resolve() == bundle.resolve()
        assert env["TEXMFCNF"] == "runtime/config;runtime;runtime/texmf-dist/web2c"
    assert set(path.name for path in (output / "resume-fonts").iterdir()) == {Path(name).name for name in runtime.FONT_FILES}
    config_path = output / env["FONTCONFIG_PATH"] / env["FONTCONFIG_FILE"] if os.name == "nt" else Path(env["FONTCONFIG_FILE"])
    config = config_path.read_text()
    assert "C:/unrelated" not in config and "/Windows/Fonts" not in config
    source = renderer.build_tex({"profile": {"name": "测试"}, "sections": []}, font_mode="bundled")
    assert "resume-fonts/" in source and "IfFontExistsTF" not in source
    assert "Ligatures=TeX" in source
    assert "SimSun" not in source and "AutoFakeBold" not in source
    assert str(bundle) not in source


def test_runtime_and_font_modes_invalidate_document_cache(bundle, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    selected = runtime.resolve_runtime()
    snapshot = {"profile": {"name": "测试"}, "sections": []}
    monkeypatch.setattr(renderer, "resolve_runtime", lambda: selected)
    first = renderer.document_fingerprint(snapshot)
    monkeypatch.setattr(renderer, "resolve_runtime", lambda: replace(selected, runtime_id="new-version"))
    assert renderer.document_fingerprint(snapshot) != first
    monkeypatch.setattr(renderer, "resolve_runtime", lambda: replace(selected, font_mode="system"))
    assert renderer.document_fingerprint(snapshot) != first


def test_auto_retains_complete_system_fonts_but_force_bundled_is_deterministic(bundle, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    monkeypatch.setattr(runtime, "_system_font_files", lambda: (bundle / runtime.FONT_FILES[0],))
    assert runtime.resolve_runtime().font_mode == "system"
    monkeypatch.setenv("FETCHCV_RESUME_FONTS", "bundled")
    assert runtime.resolve_runtime().font_mode == "bundled"


@pytest.mark.skipif(os.name != "nt", reason="Windows uses the explicit Unicode driver launch")
@pytest.mark.parametrize("failure", ["timeout", "nonzero"])
def test_separate_pdf_driver_failures_preserve_existing_pdf_and_clean_junction(bundle, tmp_path, monkeypatch, failure):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(bundle))
    output = tmp_path / "output"
    output.mkdir()
    target = output / "existing.pdf"
    target.write_bytes(b"previous artifact")
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        assert kwargs["stdin"] == subprocess.DEVNULL and kwargs["timeout"] == 1
        if len(calls) < 3:
            assert "-no-pdf" in command and "-no-shell-escape" in command
            return subprocess.CompletedProcess(command, 0, b"", b"")
        assert command[1:] == ["-q", "-E", "-o", "resume.pdf", "resume.xdv"]
        if failure == "timeout":
            raise subprocess.TimeoutExpired(command, 1)
        return subprocess.CompletedProcess(command, 1, b"", b"driver failed")

    monkeypatch.setattr(renderer.subprocess, "run", run)
    with pytest.raises(renderer.XeLatexCompileError, match="超时" if failure == "timeout" else "排版失败"):
        renderer.compile_snapshot({"profile": {"name": "测试"}, "sections": []}, target, timeout=1)
    assert len(calls) == 3
    assert target.read_bytes() == b"previous artifact"
    assert list(output.iterdir()) == [target]
    assert (bundle / "bin/windows/xelatex.exe").is_file()


@pytest.mark.parametrize("font_name,existing_map", [("ABCDEF+FandolSong-Regular-Identity-H", True), ("ABCDEF+OtherFont", False)])
def test_unicode_fix_leaves_existing_maps_and_unrelated_fonts_byte_identical(tmp_path, font_name, existing_map):
    writer = PdfWriter()
    page = writer.add_blank_page(width=595, height=842)
    descendant = DictionaryObject({NameObject("/CIDSystemInfo"): DictionaryObject({NameObject("/Registry"): TextStringObject("Adobe"), NameObject("/Ordering"): TextStringObject("GB1")})})
    font = DictionaryObject({NameObject("/BaseFont"): NameObject("/" + font_name), NameObject("/DescendantFonts"): ArrayObject([descendant])})
    if existing_map:
        mapping = DecodedStreamObject()
        mapping.set_data(b"existing mapping must remain untouched")
        font[NameObject("/ToUnicode")] = writer._add_object(mapping)
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})})
    path = tmp_path / "existing.pdf"
    writer.write(path)
    before = path.read_bytes()
    renderer._embed_cjk_unicode_map(path, runtime.LatexRuntime(Path("unused.exe"), "test", font_mode="bundled", font_root=tmp_path / "absent"))
    assert path.read_bytes() == before


@pytest.mark.skipif(os.name != "nt" or not (REAL_RUNTIME / "runtime-manifest.json").is_file(), reason="Prepare the bundled Windows runtime before its offline integration test")
def test_real_bundle_compiles_with_no_system_tex_and_no_windows_fonts(tmp_path, monkeypatch):
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(REAL_RUNTIME.resolve()))
    monkeypatch.setenv("FETCHCV_REQUIRE_BUNDLED_LATEX", "1")
    monkeypatch.setenv("FETCHCV_RESUME_FONTS", "bundled")
    monkeypatch.setenv("FETCHCV_XELATEX", "C:/unavailable/xelatex.exe")
    monkeypatch.setenv("PATH", str(Path(os.environ.get("SYSTEMROOT", "C:/Windows")) / "System32"))
    monkeypatch.setenv("TEXINPUTS", "C:/unavailable-macro-tree//")
    data = {"profile": {"name": "离线排版测试"}, "sections": [{"id": "project", "title": "项目经历", "items": [{"fields": {"projectName": "合成测试项目", "role": "分析协作"}, "body": "<strong>项目概述：</strong>独立运行与中文字体验证。<br>仅参与数据整理，R^2 达到 0.92，保留<strong>原始限定词</strong>。<br><em>Independent validation</em>，中文正文末句完整保留。"}]}]}
    target = tmp_path / "offline.pdf"
    assert renderer.compile_snapshot(data, target) == 1
    reader = PdfReader(target)
    text = "".join("".join(page.extract_text().split()) for page in reader.pages)
    assert "仅参与数据整理" in text and "中文正文末句完整保留。" in text and "R2" in text
    fonts = {str(font.get_object().get("/BaseFont")) for page in reader.pages for font in page["/Resources"].get_object()["/Font"].get_object().values()}
    assert any("FandolSong" in name for name in fonts)
    assert any("TeXGyreTermes" in name for name in fonts)
    assert not any("SimSun" in name or "TimesNewRoman" in name for name in fonts)


@pytest.mark.skipif(os.name != "nt" or not (REAL_RUNTIME / "runtime-manifest.json").is_file(), reason="Prepare the bundled Windows runtime before its relocation test")
@pytest.mark.parametrize("font_mode", ["bundled", "system"])
def test_real_bundle_runs_from_readonly_chinese_installation_without_changing_it(tmp_path, monkeypatch, font_mode):
    if font_mode == "system":
        if not REAL_SYSTEM_FONTS:
            pytest.skip("The optional system font mode requires the existing Windows fonts")
        monkeypatch.setattr(runtime, "_system_font_files", lambda: REAL_SYSTEM_FONTS)
    root = tmp_path / "中文安装 runtime # 100%"
    shutil.copytree(REAL_RUNTIME, root)
    before = {path.relative_to(root).as_posix(): runtime.file_hash(path) for path in root.rglob("*") if path.is_file()}
    for path in root.rglob("*"):
        if path.is_file():
            path.chmod(stat.S_IREAD)
    monkeypatch.setenv("FETCHCV_LATEX_RUNTIME", str(root))
    monkeypatch.setenv("FETCHCV_REQUIRE_BUNDLED_LATEX", "1")
    monkeypatch.setenv("FETCHCV_RESUME_FONTS", font_mode)
    monkeypatch.setenv("PATH", str(Path(os.environ.get("SYSTEMROOT", "C:/Windows")) / "System32"))
    target = tmp_path / "中文用户数据 output" / "relocated.pdf"
    data = {"profile": {"name": "中文目录测试"}, "sections": [{"id": "project", "title": "项目经历", "items": [{"fields": {"projectName": "离线排版", "role": "分析协作"}, "body": "仅参与整理，公式 R^2 与<strong>原始限定词</strong>完整保留。"}]}]}
    assert renderer.compile_snapshot(data, target) == 1
    text = "".join("".join(page.extract_text().split()) for page in PdfReader(target).pages)
    assert "中文目录测试" in text and "仅参与整理" in text and "R2" in text and "原始限定词完整保留。" in text
    after = {path.relative_to(root).as_posix(): runtime.file_hash(path) for path in root.rglob("*") if path.is_file()}
    assert after == before
    assert list(target.parent.iterdir()) == [target]
