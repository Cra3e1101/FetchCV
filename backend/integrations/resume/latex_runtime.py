"""Resolve a verified, relocatable XeLaTeX runtime without installing TeX."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
import hashlib
from html import escape
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys


class XeLatexUnavailable(RuntimeError):
    pass


FONT_FILES = (
    "texmf-dist/fonts/opentype/public/fandol/FandolSong-Regular.otf",
    "texmf-dist/fonts/opentype/public/fandol/FandolSong-Bold.otf",
    "texmf-dist/fonts/opentype/public/tex-gyre/texgyretermes-regular.otf",
    "texmf-dist/fonts/opentype/public/tex-gyre/texgyretermes-bold.otf",
    "texmf-dist/fonts/opentype/public/tex-gyre/texgyretermes-italic.otf",
    "texmf-dist/fonts/opentype/public/tex-gyre/texgyretermes-bolditalic.otf",
)
GB1_UNICODE_MAP = "texmf-dist/fonts/cmap/adobemapping/mapping-resources-pdf/pdf2unicode/Adobe-GB1-UCS2"
BOOTSTRAP_FONT_FILES = tuple("texmf-dist/fonts/opentype/public/lm/lmroman10-" + face + ".otf" for face in ("regular", "bold", "italic", "bolditalic"))
_SEARCH_ENV = {"BIBINPUTS", "BSTINPUTS", "CMAPINPUTS", "DVIPDFMXINPUTS", "ENCFONTS", "GFFONTS", "MFBASES", "MFINPUTS", "MFTINPUTS", "MPINPUTS", "MPTEXPRE", "OPENTYPEFONTS", "OSFONTDIR", "PKFONTS", "SFDFONTS", "T1FONTS", "TFMFONTS", "TRFONTS", "TTFONTS", "TTF2TFMINPUTS", "VFFONTS", "AFMFONTS"}


@lru_cache(maxsize=4096)
def _file_hash(path: str, size: int, modified: int) -> str:
    # The stat values are part of the key, so replacing a runtime invalidates it.
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def file_hash(path: Path) -> str:
    stat = path.stat()
    return _file_hash(str(path), stat.st_size, stat.st_mtime_ns)


def _within(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or "\\" in relative:
        raise XeLatexUnavailable("排版运行时清单路径无效。")
    part = PurePosixPath(relative)
    if part.is_absolute() or not part.parts or any(p in {".", ".."} or ":" in p for p in part.parts):
        raise XeLatexUnavailable("排版运行时清单路径无效。")
    path = root.joinpath(*part.parts).resolve()
    if not path.is_relative_to(root):
        raise XeLatexUnavailable("排版运行时清单超出安装目录。")
    return path


def _system_font_files() -> tuple[Path, ...]:
    if os.name != "nt":
        return ()
    fonts = Path(os.environ.get("WINDIR") or os.environ.get("SYSTEMROOT") or "C:/Windows") / "Fonts"
    paths = tuple(fonts / name for name in ("simsun.ttc", "times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"))
    return paths if all(path.is_file() for path in paths) else ()


def _font_mode() -> str:
    choice = os.environ.get("FETCHCV_RESUME_FONTS", "auto").strip().lower()
    if choice not in {"auto", "bundled", "system"}:
        raise XeLatexUnavailable("FETCHCV_RESUME_FONTS 仅支持 auto、bundled 或 system。")
    installed = bool(_system_font_files())
    if choice == "system" and not installed:
        raise XeLatexUnavailable("系统未提供完整的宋体和 Times New Roman，请使用内置字体。")
    return "system" if installed and choice != "bundled" else "bundled"


@dataclass(frozen=True)
class LatexRuntime:
    executable: Path
    runtime_id: str
    root: Path | None = None
    font_mode: str = "system"
    font_root: Path | None = None

    @property
    def fingerprint(self) -> str:
        paths = _system_font_files() if self.font_mode == "system" else tuple((self.font_root / name) for name in FONT_FILES) if self.font_root else ()
        fonts = [file_hash(path) for path in paths if path.is_file()]
        return hashlib.sha256(json.dumps([self.runtime_id, self.font_mode, fonts], separators=(",", ":")).encode()).hexdigest()


def _read_bundle(root: Path) -> LatexRuntime:
    try:
        manifest = json.loads((root / "runtime-manifest.json").read_text(encoding="utf-8"))
        if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1 or manifest.get("engine") != "xelatex" or manifest.get("platform") != "win32" or manifest.get("arch") != "x64":
            raise ValueError("unsupported manifest")
        if sys.platform != "win32":
            raise XeLatexUnavailable("当前排版运行时仅适用于 Windows x64。")
        runtime_id = manifest.get("runtimeId")
        if not isinstance(runtime_id, str) or not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", runtime_id):
            raise ValueError("invalid runtime id")
        if manifest.get("executable") != "bin/windows/xelatex.exe":
            raise ValueError("unexpected engine executable")
        executable = _within(root, manifest["executable"])
        entries = manifest.get("files")
        if not isinstance(entries, list) or not entries:
            raise ValueError("empty manifest")
        listed = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError("invalid file entry")
            path = _within(root, entry.get("path", ""))
            if path in listed or not path.is_file() or path.stat().st_size != entry.get("size") or file_hash(path) != entry.get("sha256"):
                raise ValueError("missing or changed runtime file")
            listed.add(path)
        required = (executable, root / "bin/windows/xdvipdfmx.exe", root / "texmf-var/web2c/xetex/xelatex.fmt", root / "texmf-dist/web2c/texmf.cnf", root / GB1_UNICODE_MAP, *(root / name for name in (*FONT_FILES, *BOOTSTRAP_FONT_FILES)))
        if any(path not in listed for path in required):
            raise ValueError("required runtime file not listed")
        return LatexRuntime(executable, runtime_id, root, _font_mode(), root)
    except XeLatexUnavailable:
        raise
    except (OSError, ValueError, TypeError, KeyError) as exc:
        raise XeLatexUnavailable("内置排版运行时缺失或校验失败，请重新准备运行时或重新安装应用。") from exc


def _default_roots() -> tuple[Path, ...]:
    repository = Path(__file__).resolve().parents[3]
    roots = [repository / "build/resume-runtime"]
    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).resolve()
        roots = [executable.parent / "resume-runtime", executable.parent.parent / "resume-runtime", *roots]
    return tuple(roots)


def resolve_runtime() -> LatexRuntime | None:
    supplied = os.environ.get("FETCHCV_LATEX_RUNTIME", "").strip()
    if supplied:
        path = Path(supplied).expanduser()
        if not path.is_absolute():
            raise XeLatexUnavailable("FETCHCV_LATEX_RUNTIME 必须是运行时的绝对目录。")
        return _read_bundle(path.resolve())
    for root in _default_roots():
        if (root / "runtime-manifest.json").is_file():
            return _read_bundle(root.resolve())
    if os.environ.get("FETCHCV_REQUIRE_BUNDLED_LATEX") == "1" or getattr(sys, "frozen", False):
        raise XeLatexUnavailable("应用内置排版运行时未就绪，请重新安装完整应用。")
    override = os.environ.get("FETCHCV_XELATEX", "").strip()
    executable = Path(override).expanduser() if override else Path(found) if (found := shutil.which("xelatex")) else None
    if executable is None:
        return None
    if not executable.is_absolute() or not executable.is_file():
        raise XeLatexUnavailable("FETCHCV_XELATEX 未指向有效编译器。")
    executable = executable.resolve()
    font_root = executable.parents[2] if len(executable.parents) > 2 else None
    mode = _font_mode()
    if mode == "bundled" and (font_root is None or not all((font_root / name).is_file() for name in FONT_FILES)):
        raise XeLatexUnavailable("当前开发编译器缺少内置字体，请先准备应用排版运行时。")
    identity = [file_hash(executable)]
    for path in (executable.with_name("xetex.dll"), executable.with_name("dvipdfmx.dll"), font_root / "texmf-var/web2c/xetex/xelatex.fmt" if font_root else executable):
        if path.is_file():
            identity.append(file_hash(path))
    return LatexRuntime(executable, "system-" + hashlib.sha256("".join(identity).encode()).hexdigest(), font_mode=mode, font_root=font_root)


def prepare_environment(runtime: LatexRuntime, workdir: Path) -> dict[str, str]:
    env = dict(os.environ)
    scratch = workdir / "scratch"
    cache = scratch / "fonts/cache"
    cache.mkdir(parents=True, exist_ok=True)
    # xdvipdfmx's Windows CRT can abort when inherited temp paths are unusable.
    # Each compilation owns all temporary output and does not write to its bundle.
    env.update({"TEMP": str(scratch), "TMP": str(scratch), "TMPDIR": str(scratch), "openout_any": "p", "shell_escape": "0"})
    if runtime.root is not None:
        env = {key: value for key, value in env.items() if not key.upper().startswith(("TEX", "KPSE", "FONTCONFIG", "MIKTEX")) and key.upper() not in _SEARCH_ENV}
        root = runtime.root
        if os.name == "nt":
            # kpathsea and its PDF driver disagree on non-ASCII absolute paths.
            # A private junction keeps every TeX search path ASCII and relative;
            # it neither copies nor writes into the verified installation tree.
            import _winapi
            try:
                _winapi.CreateJunction(str(root), str(workdir / "runtime"))
            except OSError as exc:
                raise XeLatexUnavailable("无法创建临时排版目录，请检查应用数据目录权限。") from exc
            root = Path("runtime")
        value = lambda path: path.as_posix()
        env.update({
            "TEXMFROOT": value(root), "TEXMFDIST": value(root / "texmf-dist"),
            "TEXMFSYSVAR": value(root / "texmf-var"), "TEXMFSYSCONFIG": value(root / "config"),
            "TEXMF": "{" + value(root / "texmf-var") + "," + value(root / "texmf-dist") + "}",
            "TEXMFCNF": os.pathsep.join(value(path) for path in (root / "config", root, root / "texmf-dist/web2c")),
            "TEXMFVAR": value(scratch), "TEXMFHOME": value(scratch / "home"), "TEXMFCONFIG": value(scratch / "config"),
            "TEXMFOUTPUT": value(workdir),
            "MKTEXFMT": "0", "MKTEXTFM": "0", "MKTEXPK": "0", "MKTEXMF": "0",
        })
        if os.name == "nt":
            env.update({"TEMP": "scratch", "TMP": "scratch", "TMPDIR": "scratch", "TEXMFVAR": "scratch", "TEXMFHOME": "scratch/home", "TEXMFCONFIG": "scratch/config", "TEXMFOUTPUT": "."})
        windows = Path(os.environ.get("SYSTEMROOT") or "C:/Windows")
        engine_dir = root / "bin/windows"
        env["PATH"] = os.pathsep.join(str(path) for path in (engine_dir, windows / "System32", windows))
    if runtime.font_root is not None and (runtime.root is not None or runtime.font_mode == "bundled"):
        font_dirs = [runtime.font_root / "texmf-dist/fonts/opentype", runtime.font_root / "texmf-dist/fonts/truetype"]
        if runtime.font_mode == "system":
            font_dirs.extend(dict.fromkeys(path.parent for path in _system_font_files()))
        config = scratch / "fonts.conf"
        config.write_text("<fontconfig>" + "".join("<dir>" + escape(path.as_posix()) + "</dir>" for path in font_dirs if path.is_dir()) + "<cachedir>" + escape(cache.as_posix()) + "</cachedir></fontconfig>", encoding="utf-8")
        env["FONTCONFIG_FILE"] = str(config)
        env["FONTCONFIG_PATH"] = str(scratch)
        if runtime.root is not None and os.name == "nt":
            env["FONTCONFIG_FILE"] = "fonts.conf"
            env["FONTCONFIG_PATH"] = "scratch"
    destination = workdir / "resume-fonts"
    destination.mkdir()
    sources = tuple(runtime.font_root / relative for relative in FONT_FILES) if runtime.font_mode == "bundled" else _system_font_files()
    if not sources:
        raise XeLatexUnavailable("排版所需字体不可用，请检查应用安装是否完整。")
    for source in sources:
        shutil.copyfile(source, destination / source.name)
    return env


BUNDLED_FONT_PREAMBLE = r"""\setmainfont[Path={resume-fonts/},Ligatures=TeX,UprightFont=texgyretermes-regular.otf,BoldFont=texgyretermes-bold.otf,ItalicFont=texgyretermes-italic.otf,BoldItalicFont=texgyretermes-bolditalic.otf]{texgyretermes-regular.otf}
\setCJKmainfont[Path={resume-fonts/},BoldFont=FandolSong-Bold.otf,ItalicFont=FandolSong-Regular.otf,ItalicFeatures={FakeSlant=0.2},BoldItalicFont=FandolSong-Bold.otf,BoldItalicFeatures={FakeSlant=0.2}]{FandolSong-Regular.otf}
\setCJKfamilyfont{song}[Path={resume-fonts/},BoldFont=FandolSong-Bold.otf,ItalicFont=FandolSong-Regular.otf,ItalicFeatures={FakeSlant=0.2},BoldItalicFont=FandolSong-Bold.otf,BoldItalicFeatures={FakeSlant=0.2}]{FandolSong-Regular.otf}
"""

# These are existing Windows fonts copied only to the private render directory.
# They are never part of the distributable open-font runtime.
SYSTEM_FONT_PREAMBLE = r"""\setmainfont[Path={resume-fonts/},Ligatures=TeX,UprightFont=times.ttf,BoldFont=timesbd.ttf,ItalicFont=timesi.ttf,BoldItalicFont=timesbi.ttf]{times.ttf}
\setCJKmainfont[Path={resume-fonts/},AutoFakeBold=2.2,FontIndex=0]{simsun.ttc}
\setCJKfamilyfont{song}[Path={resume-fonts/},AutoFakeBold=2.2,FontIndex=0]{simsun.ttc}
"""
