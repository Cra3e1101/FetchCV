"""Build FetchCV's offline Windows TeX runtime from checksum-locked archives.

Uses only the Python standard library. A local TeX installation is never read.
Original archives are retained as the release's separate source companion.
"""
from __future__ import annotations

import argparse
import ast
from concurrent.futures import ThreadPoolExecutor, as_completed
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "scripts" / "resume-runtime.lock.json"
NOTICE_NAMES = {"copying", "copyright", "license", "licence", "readme", "manifest", "gfl", "lppl", "ofl"}


def digest(path: Path, algorithm="sha256") -> str:
    value = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def within(root: Path, name: str) -> Path:
    relative = PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or "\\" in name or ":" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    target = root.joinpath(*relative.parts).resolve()
    if not target.is_relative_to(root.resolve()) or target == root.resolve():
        raise ValueError(f"Archive path outside runtime: {name}")
    return target


def fetch_archive(spec: dict, base: str, cache: Path, offline: bool) -> Path:
    target = within(cache, spec["file"])
    if target.is_file() and target.stat().st_size == spec["size"] and digest(target, "sha512") == spec["sha512"]:
        return target
    if offline:
        raise RuntimeError(f"Verified archive is not cached: {spec['file']}")
    target.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(3):
        handle, temporary_name = tempfile.mkstemp(prefix=".download-", suffix=".part", dir=cache)
        os.close(handle)
        temporary = Path(temporary_name)
        try:
            request = urllib.request.Request(spec.get("url") or base.rstrip("/") + "/" + spec.get("urlFile", spec["file"]), headers={"User-Agent": "FetchCV-runtime-builder/1"})
            with urllib.request.urlopen(request, timeout=60) as source, temporary.open("wb") as output:
                count = 0
                while block := source.read(1024 * 1024):
                    count += len(block)
                    if count > spec["size"]:
                        raise ValueError(f"Archive exceeds locked size: {spec['file']}")
                    output.write(block)
            if temporary.stat().st_size != spec["size"] or digest(temporary, "sha512") != spec["sha512"]:
                raise ValueError(f"Archive checksum mismatch: {spec['file']}")
            temporary.replace(target)
            return target
        except (OSError, urllib.error.URLError):
            temporary.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
        except Exception:
            temporary.unlink(missing_ok=True)
            raise
    raise RuntimeError("Archive download failed")


def fetch_locked(spec: dict, lock: dict, cache: Path, offline: bool) -> Path:
    bases = [""] if spec.get("url") else [*lock.get("archiveMirrors", []), lock["archiveBase"]]
    failure = None
    for base in dict.fromkeys(bases):
        try:
            return fetch_archive(spec, base, cache, offline)
        except (OSError, ValueError, RuntimeError) as error:
            if offline:
                raise
            failure = error
    raise RuntimeError(f"No mirror supplied the locked archive {spec['file']}: {failure}") from failure


def extract_package(archive: Path, runtime: Path, spec: dict, lock: dict) -> None:
    binaries = set(lock["binaries"])
    opentype = set(lock["fontFiles"])
    with tarfile.open(archive, "r:xz") as package:
        for entry in package:
            name = entry.name.removeprefix("./")
            within(runtime, name)
            if name.startswith("RELOC/"):
                name = "texmf-dist/" + name[len("RELOC/"):]
            elif spec.get("relocated") and not name.startswith("tlpkg/"):
                name = "texmf-dist/" + name
            if entry.isdir():
                continue
            if not entry.isfile():
                raise ValueError(f"Non-regular package entry: {name}")
            target = within(runtime, name)
            if spec["kind"] == "":
                if name.startswith("bin/") and name not in binaries:
                    continue
                if name.startswith("texmf-dist/fonts/opentype/") and name not in opentype and not any(
                    name.startswith(prefix) for prefix in lock.get("fontRuntimePrefixes", [])
                ):
                    continue
                if name.startswith("texmf-dist/fonts/") and not any(
                    name.startswith(prefix) for prefix in lock.get("fontRuntimePrefixes", ["texmf-dist/fonts/"])
                ) and name not in opentype and name not in lock.get("fontRuntimeFiles", []):
                    continue
                if not name.startswith(("texmf-dist/", "bin/windows/", "tlpkg/tlpobj/")):
                    continue
            else:
                # Keep readable legal/attribution notices in the runtime. The
                # complete unmodified package archives remain in the companion.
                leaf = PurePosixPath(name).name.lower()
                if not any(leaf.startswith(value) for value in NOTICE_NAMES) or entry.size > 2 * 1024 * 1024:
                    continue
                target = within(runtime, "licenses/packages/" + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            content = package.extractfile(entry)
            if content is None:
                raise ValueError(f"Unreadable archive entry: {name}")
            with content, target.open("wb") as output:
                shutil.copyfileobj(content, output)


def extract_source_notices(archive: Path, runtime: Path, spec: dict) -> None:
    wanted = set(spec.get("notices", []))
    remaining = set(wanted)
    with tarfile.open(archive, "r|xz") as source:
        for entry in source:
            if entry.name not in wanted:
                continue
            if not entry.isfile() or entry.size > 2 * 1024 * 1024:
                raise ValueError(f"Unexpected source notice: {entry.name}")
            target = within(runtime, "licenses/sources/" + entry.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(entry) as content, target.open("wb") as output:
                shutil.copyfileobj(content, output)
            remaining.remove(entry.name)
    if remaining:
        raise ValueError(f"Missing upstream license notices in {spec['file']}: {sorted(remaining)}")


def make_configuration(runtime: Path) -> None:
    configuration = runtime / "config"
    configuration.mkdir(parents=True, exist_ok=True)
    # Kpathsea locates TEXMFROOT relative to this runtime's own executable.
    (configuration / "texmf.cnf").write_text(
        "TEXMFROOT = $SELFAUTOPARENT\nTEXMFDIST = $TEXMFROOT/texmf-dist\n"
        "TEXMFSYSVAR = $TEXMFROOT/texmf-var\nTEXMFSYSCONFIG = $TEXMFROOT/config\n"
        "TEXMFLOCAL = $TEXMFROOT/empty\nTEXMFHOME = $TEXMFROOT/empty\n"
        "TEXMF = {$TEXMFSYSVAR,$TEXMFDIST}\nTEXMFDBS = $TEXMF\n"
        "shell_escape = f\nopenout_any = p\n", encoding="utf-8")
    # English hyphenation is sufficient for the supported Chinese/Latin resume
    # template; do not pull every language format from an author's installation.
    language = runtime / "texmf-var/tex/generic/config/language.dat"
    language.parent.mkdir(parents=True, exist_ok=True)
    language.write_text("english hyphen.tex\n=usenglish\nnohyphenation zerohyph.tex\n", encoding="ascii")
    (configuration / "fonts.conf").write_text(
        '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig>'
        '<dir prefix="relative">../texmf-dist/fonts/opentype</dir>'
        '<cachedir prefix="xdg">fetchcv-fontconfig</cachedir></fontconfig>', encoding="utf-8")
    # The application uses Unicode OpenType fonts plus Computer Modern maths.
    maps = sorted((runtime / "texmf-dist/fonts/map").rglob("cm.map"))
    if not maps:
        raise RuntimeError("Locked packages did not provide Computer Modern's map")
    mapping = runtime / "texmf-var/fonts/map/pdftex/updmap/pdftex.map"
    mapping.parent.mkdir(parents=True, exist_ok=True)
    mapping.write_bytes(maps[0].read_bytes())
    (mapping.parent / "kanjix.map").write_text("% FetchCV uses embedded Unicode fonts, not legacy Japanese maps.\n", encoding="ascii")


def compile_format(runtime: Path, lock: dict) -> None:
    binary = runtime / "bin/windows"
    target = runtime / "texmf-var/web2c/xetex"
    target.mkdir(parents=True, exist_ok=True)
    scratch = target / "scratch"
    scratch.mkdir(exist_ok=True)
    searches = {"BIBINPUTS", "BSTINPUTS", "CMAPINPUTS", "DVIPDFMXINPUTS", "ENCFONTS", "GFFONTS", "MFINPUTS", "MPINPUTS", "OPENTYPEFONTS", "OSFONTDIR", "PKFONTS", "SFDFONTS", "T1FONTS", "TFMFONTS", "TTFONTS", "VFFONTS", "AFMFONTS"}
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith(("TEX", "KPSE", "MIKTEX", "FONTCONFIG")) and key.upper() not in searches}
    environment.update({
        "PATH": str(binary) + os.pathsep + str(Path(os.environ.get("SystemRoot", "C:/Windows")) / "System32"),
        "TEXMFCNF": str(runtime / "config") + os.pathsep + str(runtime / "texmf-dist/web2c"),
        "TEXMFROOT": str(runtime), "TEXMFVAR": str(target / "cache"),
        "TEXMFCONFIG": str(runtime / "config"), "FONTCONFIG_FILE": str(runtime / "config/fonts.conf"),
        "SOURCE_DATE_EPOCH": str(lock["sourceDateEpoch"]), "FORCE_SOURCE_DATE": "1",
        "TEMP": str(scratch), "TMP": str(scratch), "TMPDIR": str(scratch),
        "openout_any": "p", "shell_escape": "0",
        "MKTEXFMT": "0", "MKTEXTFM": "0", "MKTEXPK": "0", "MKTEXMF": "0",
    })
    command = [str(binary / "xetex.exe"), "-ini", "-etex", "-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "-jobname=xelatex", "xelatex.ini"]
    result = subprocess.run(command, cwd=target, env=environment, stdin=subprocess.DEVNULL, capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode or not (target / "xelatex.fmt").is_file():
        raise RuntimeError("Portable format generation failed:\n" + (result.stdout + result.stderr).decode("utf-8", errors="replace")[-4500:])
    # Format generation alone never loads ctex's optical font sizes or the
    # application's packages. Compile the trusted template before publishing.
    compile_template_smoke(runtime, scratch, environment, lock)
    for extra in target.glob("*.log"):
        extra.unlink()
    for directory in (scratch, target / "cache"):
        if directory.exists() and directory.resolve().is_relative_to(target.resolve()):
            shutil.rmtree(directory)


def compile_template_smoke(runtime: Path, work: Path, environment: dict, lock: dict) -> None:
    def literal(module: str, name: str) -> str:
        tree = ast.parse((ROOT / "backend/integrations/resume" / module).read_text(encoding="utf-8"))
        for statement in tree.body:
            if isinstance(statement, ast.Assign) and any(isinstance(node, ast.Name) and node.id == name for node in statement.targets):
                return ast.literal_eval(statement.value)
        raise ValueError(f"Missing trusted template constant: {name}")

    preamble = literal("latex_template.py", "PREAMBLE")
    start = preamble.index(r"\IfFontExistsTF{Times New Roman}")
    finish = preamble.index(r"\newcommand{\songti}", start)
    preamble = preamble[:start] + literal("latex_runtime.py", "BUNDLED_FONT_PREAMBLE") + preamble[finish:]
    fonts = work / "resume-fonts"
    fonts.mkdir()
    for relative in lock["fonts"].values():
        shutil.copyfile(runtime / relative, fonts / Path(relative).name)
    source = preamble + r"""
\begin{document}
\resumeSection{排版验证}
\tripleEntry{测试大学}{人工智能}{2024--2026}
\begin{resumeItems}
\item 中文简历，\textbf{粗体 Bold}，\textit{斜体 Italic}，指标\textsuperscript{2}。
\item 数学公式 $x^2 + y^2 = 1$；\href{https://example.com}{链接}。
\end{resumeItems}
\begin{tikzpicture}\draw (0,0) -- (1,0);\end{tikzpicture}
\end{document}
"""
    (work / "smoke.tex").write_text(source, encoding="utf-8")
    command = [str(runtime / "bin/windows/xelatex.exe"), "-no-shell-escape", "-halt-on-error", "-interaction=nonstopmode", "smoke.tex"]
    result = subprocess.run(command, cwd=work, env=environment, stdin=subprocess.DEVNULL, capture_output=True, timeout=120,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    if result.returncode or not (work / "smoke.pdf").is_file():
        raise RuntimeError("Portable template smoke failed:\n" + (result.stdout + result.stderr).decode("utf-8", errors="replace")[-4500:])


def is_link(path: Path) -> bool:
    return path.is_symlink() or (hasattr(path, "is_junction") and path.is_junction())


def verify_owned_paths(root: Path, owned: set[str]) -> None:
    if is_link(root):
        raise ValueError("Linked runtime directory")
    for path in root.rglob("*"):
        if is_link(path) or (path.is_file() and path.relative_to(root).as_posix() not in owned):
            raise ValueError("Unlisted file or linked path in runtime directory")


def runtime_manifest(runtime: Path, expected_lock: str | None = None) -> dict:
    manifest = json.loads((runtime / "runtime-manifest.json").read_text(encoding="utf-8"))
    if (manifest.get("producer") != "fetchcv-resume-runtime" or manifest.get("schemaVersion") != 1
            or manifest.get("platform") != "win32" or manifest.get("arch") != "x64" or manifest.get("engine") != "xelatex"
            or manifest.get("executable") != "bin/windows/xelatex.exe"
            or not re.fullmatch(r"[a-f0-9]{64}", str(manifest.get("lockSha256", "")))
            or manifest.get("runtimeId") != manifest.get("lockSha256")
            or (expected_lock and manifest.get("lockSha256") != expected_lock)):
        raise ValueError("Runtime manifest does not match the dependency lock")
    entries = manifest.get("files")
    fonts = manifest.get("fonts")
    keys = {"cjkRegular", "cjkBold", "serifRegular", "serifBold", "serifItalic", "serifBoldItalic"}
    if not isinstance(entries, list) or not entries or not isinstance(fonts, dict) or not keys.issubset(fonts):
        raise ValueError("Runtime manifest is incomplete")
    names = set()
    for entry in entries:
        if (not isinstance(entry, dict) or not isinstance(entry.get("path"), str) or entry["path"] in names
                or not isinstance(entry.get("size"), int) or entry["size"] < 0
                or not re.fullmatch(r"[a-f0-9]{64}", str(entry.get("sha256", "")))):
            raise ValueError("Invalid runtime file record")
        within(runtime, entry["path"])
        names.add(entry["path"])
    required = {"bin/windows/xelatex.exe", "bin/windows/xdvipdfmx.exe", "config/texmf.cnf", "texmf-var/web2c/xetex/xelatex.fmt"}
    if not all(isinstance(fonts[key], str) for key in keys) or not (required | {fonts[key] for key in keys}).issubset(names):
        raise ValueError("Runtime manifest omits a required engine, format or font")
    return manifest


def verify_runtime(runtime: Path, expected_lock: str | None = None) -> dict:
    manifest = runtime_manifest(runtime, expected_lock)
    for entry in manifest["files"]:
        path = within(runtime, entry["path"])
        if not path.is_file() or path.stat().st_size != entry["size"] or digest(path) != entry["sha256"]:
            raise ValueError(f"Runtime file failed verification: {entry['path']}")
    owned = {entry["path"] for entry in manifest["files"]} | {"runtime-manifest.json"}
    verify_owned_paths(runtime, owned)
    return manifest


def publish_sources(target: Path, specs: list[dict], downloaded: dict, lock_hash: str) -> None:
    manifest_name = "source-manifest.json"
    if target.exists():
        try:
            old = json.loads((target / manifest_name).read_text(encoding="utf-8"))
            owned = {item["file"] for item in old["archives"]} | {manifest_name, "dependency-lock.json"}
            if old.get("producer") != "fetchcv-resume-runtime-sources" or any(
                is_link(path) or path.name not in owned or not path.is_file() for path in target.iterdir()
            ):
                raise ValueError("Unmanaged source companion")
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise ValueError(f"Refusing to replace unmanaged source companion: {target}") from error
    staging = Path(tempfile.mkdtemp(prefix=".resume-sources-", dir=target.parent))
    backup = None
    try:
        for spec in specs:
            shutil.copyfile(downloaded[spec["file"]], within(staging, spec["file"]))
        shutil.copyfile(LOCK_PATH, staging / "dependency-lock.json")
        (staging / manifest_name).write_text(json.dumps({"producer": "fetchcv-resume-runtime-sources", "lockSha256": lock_hash, "archives": specs}, indent=2) + "\n", encoding="utf-8")
        if target.exists():
            backup = target.with_name(staging.name + "-previous")
            target.rename(backup)
        try:
            staging.rename(target)
        except Exception:
            if backup:
                backup.rename(target)
            raise
        if backup and backup.resolve().is_relative_to(target.parent.resolve()):
            shutil.rmtree(backup)
    finally:
        if staging.exists() and staging.resolve().is_relative_to(target.parent.resolve()):
            shutil.rmtree(staging)


def publish(staging: Path, target: Path) -> None:
    # Only replace this explicit build target after all new files validate. No
    # recursive delete crosses the target's parent or acts on a user directory.
    parent = target.parent.resolve()
    if not staging.resolve().is_relative_to(parent) or target.resolve() == parent:
        raise ValueError("Unsafe runtime staging directory")
    backup = None
    if target.exists():
        try:
            previous = runtime_manifest(target)
            owned = {entry["path"] for entry in previous["files"]} | {"runtime-manifest.json"}
            verify_owned_paths(target, owned)
        except (OSError, ValueError, KeyError) as error:
            raise ValueError(f"Refusing to replace an unmanaged directory: {target}") from error
        backup = parent / (staging.name + "-previous")
        target.rename(backup)
    try:
        staging.rename(target)
    except Exception:
        if backup:
            backup.rename(target)
        raise
    if backup and backup.resolve().is_relative_to(parent) and backup != parent:
        shutil.rmtree(backup)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "build/resume-runtime")
    parser.add_argument("--cache", type=Path, default=ROOT / ".tmp/resume-runtime-downloads")
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--download-only", action="store_true")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    lock_hash = digest(LOCK_PATH)
    package_specs = [archive for package in lock["packages"] for archive in package["archives"]]
    specs = [*package_specs, *lock.get("externalSources", [])]
    if args.verify_only:
        receipt = verify_runtime(args.output.resolve(), lock_hash)
        print(f"Verified offline runtime: {receipt['sizeBytes'] / 1048576:.1f} MiB")
        return
    if sys.platform != "win32":
        raise RuntimeError("The locked runtime targets Windows x64; build it on Windows")
    if args.output.is_dir() and not args.download_only:
        try:
            receipt = verify_runtime(args.output.resolve(), lock_hash)
            companion = args.output.resolve().parent / "resume-runtime-sources"
            source_manifest = json.loads((companion / "source-manifest.json").read_text(encoding="utf-8"))
            verify_owned_paths(companion, {spec["file"] for spec in specs} | {"source-manifest.json", "dependency-lock.json"})
            if source_manifest.get("producer") == "fetchcv-resume-runtime-sources" and source_manifest.get("lockSha256") == lock_hash and source_manifest.get("archives") == specs and digest(companion / "dependency-lock.json") == lock_hash and all(
                within(companion, spec["file"]).is_file() and within(companion, spec["file"]).stat().st_size == spec["size"] and digest(within(companion, spec["file"]), "sha512") == spec["sha512"]
                for spec in source_manifest["archives"]
            ) and source_manifest["archives"]:
                print(f"Offline runtime is current: {receipt['sizeBytes'] / 1048576:.1f} MiB")
                return
        except (OSError, ValueError, KeyError):
            pass
    args.cache.mkdir(parents=True, exist_ok=True)
    downloaded = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = {pool.submit(fetch_locked, spec, lock, args.cache.resolve(), args.offline): spec for spec in specs}
        for index, future in enumerate(as_completed(jobs), 1):
            spec = jobs[future]
            downloaded[spec["file"]] = future.result()
            if index % 20 == 0 or index == len(specs):
                print(f"Verified archives {index}/{len(specs)}", flush=True)
    if args.download_only:
        return
    target = args.output.resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".resume-runtime-", dir=target.parent))
    try:
        print("Assembling the offline runtime", flush=True)
        for spec in package_specs:
            extract_package(downloaded[spec["file"]], staging, spec, lock)
        for spec in lock.get("externalSources", []):
            extract_source_notices(downloaded[spec["file"]], staging, spec)
        make_configuration(staging)
        print("Generating the portable XeLaTeX format", flush=True)
        compile_format(staging, lock)
        notices = staging / "licenses"
        notices.mkdir(exist_ok=True)
        shutil.copyfile(LOCK_PATH, notices / "dependency-lock.json")
        (notices / "README.txt").write_text(
            "FetchCV ships unmodified TeX Live binaries, macros and fonts under their respective licenses.\n"
            "See packages/ and dependency-lock.json for notices, versions and immutable upstream archive checksums.\n"
            "The release source companion contains the complete original package archives.\n"
            "This software is based in part on the work of the FreeType Team (https://freetype.org).\n"
            "The full TECkit license texts referred to by the Windows source COPYING file are retained in\n"
            "sources/texlive-20260301-source/libs/teckit/TECkit-src/license/.\n"
            "FetchCV's configuration and generated format files are application-owned additions.\n", encoding="utf-8")
        files = [{"path": path.relative_to(staging).as_posix(), "size": path.stat().st_size, "sha256": digest(path)}
                 for path in sorted(staging.rglob("*")) if path.is_file()]
        receipt = {"producer": "fetchcv-resume-runtime", "schemaVersion": 1, "platform": "win32", "arch": "x64", "engine": "xelatex",
                   "executable": "bin/windows/xelatex.exe", "runtimeId": lock_hash, "lockSha256": lock_hash,
                   "files": files, "sizeBytes": sum(item["size"] for item in files), "fonts": lock["fonts"]}
        (staging / "runtime-manifest.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        verify_runtime(staging, lock_hash)
        companion = target.parent / "resume-runtime-sources"
        publish_sources(companion, specs, downloaded, lock_hash)
        publish(staging, target)
        print(f"Offline runtime ready: {target} ({receipt['sizeBytes'] / 1048576:.1f} MiB)")
        print(f"Release source companion: {companion}")
    finally:
        if staging.exists() and staging.resolve().is_relative_to(target.parent.resolve()) and staging != target.parent:
            shutil.rmtree(staging)


if __name__ == "__main__":
    main()
