"""Offline checks for the release runtime builder; no upstream downloads occur."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tarfile

import pytest


ROOT = Path(__file__).resolve().parents[2]
BUILDER_PATH = ROOT / "scripts/prepare-resume-runtime.py"
LOCK = json.loads((ROOT / "scripts/resume-runtime.lock.json").read_text(encoding="utf-8"))
LOCK_HASH = "a" * 64


@pytest.fixture
def builder(monkeypatch):
    spec = importlib.util.spec_from_file_location("resume_runtime_builder_test", BUILDER_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def forbid_network(*args, **kwargs):
        raise AssertionError("Runtime builder tests must not access the network")

    monkeypatch.setattr(module.urllib.request, "urlopen", forbid_network)
    monkeypatch.setattr(module.time, "sleep", lambda *_: None)
    return module


def archive_spec(content=b"locked archive", name="package.r1.tar.xz", kind=""):
    return {"file": name, "kind": kind, "size": len(content), "sha512": hashlib.sha512(content).hexdigest()}


def write_tar(path, entries):
    with tarfile.open(path, "w:xz") as archive:
        for name, kind, payload in entries:
            entry = tarfile.TarInfo(name)
            entry.type = kind
            if kind == tarfile.REGTYPE:
                entry.size = len(payload)
                archive.addfile(entry, io.BytesIO(payload))
            else:
                entry.linkname = payload
                archive.addfile(entry)
    return path


def write_runtime(path, marker=b"runtime", lock_hash=LOCK_HASH):
    path.mkdir(parents=True, exist_ok=True)
    names = set(LOCK["binaries"] + LOCK["fontFiles"] + [
        "config/texmf.cnf", "config/fonts.conf", "texmf-var/web2c/xetex/xelatex.fmt",
        "texmf-var/fonts/map/pdftex/updmap/pdftex.map", "licenses/dependency-lock.json",
    ])
    files = []
    for name in sorted(names):
        target = path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(marker + name.encode())
        files.append({"path": name, "size": target.stat().st_size,
                      "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})
    manifest = {"schemaVersion": 1, "producer": "fetchcv-resume-runtime", "platform": "win32", "arch": "x64", "engine": "xelatex",
                "executable": "bin/windows/xelatex.exe", "runtimeId": lock_hash,
                "lockSha256": lock_hash, "files": files, "fonts": LOCK["fonts"],
                "sizeBytes": sum(entry["size"] for entry in files)}
    write_manifest(path, manifest)
    return manifest


def write_manifest(path, manifest):
    (path / "runtime-manifest.json").write_text(json.dumps(manifest), encoding="utf-8")


@pytest.mark.parametrize("name", ["../outside", "inside/../../outside", "/outside", "C:/outside",
                                       "C:\\outside", "\\\\server\\outside", "inside\\outside",
                                       "inside:stream", "", "."])
def test_within_rejects_unsafe_paths(builder, tmp_path, name):
    with pytest.raises(ValueError):
        builder.within(tmp_path, name)


def test_within_accepts_nested_relative_path(builder, tmp_path):
    assert builder.within(tmp_path, "texmf-dist/tex/test.tex") == tmp_path / "texmf-dist/tex/test.tex"


@pytest.mark.parametrize("name", ["../outside.txt", "texmf-dist/../../outside.txt", "/outside.txt",
                                       "texmf-dist\\..\\outside.txt", "texmf-dist/test.tex:alternate"])
def test_extraction_rejects_traversal(builder, tmp_path, name):
    runtime = tmp_path / "runtime"
    archive = write_tar(tmp_path / "test.tar.xz", [(name, tarfile.REGTYPE, b"untrusted")])
    with pytest.raises(ValueError):
        builder.extract_package(archive, runtime, {"kind": ""}, LOCK)
    assert not (tmp_path / "outside.txt").exists()
    assert not runtime.exists()


@pytest.mark.parametrize("entry_type", [tarfile.SYMTYPE, tarfile.LNKTYPE])
def test_extraction_rejects_links(builder, tmp_path, entry_type):
    runtime = tmp_path / "runtime"
    archive = write_tar(tmp_path / "test.tar.xz", [("texmf-dist/link", entry_type, "../../outside")])
    with pytest.raises(ValueError, match="Non-regular"):
        builder.extract_package(archive, runtime, {"kind": ""}, LOCK)
    assert not runtime.exists()


def test_extraction_obeys_binary_and_font_allowlists(builder, tmp_path):
    runtime = tmp_path / "runtime"
    regular_font = LOCK["fontFiles"][0]
    allowed = {"bin/windows/xelatex.exe": b"engine", regular_font: b"font",
               "RELOC/tex/latex/test.sty": b"macro"}
    blocked = {"bin/windows/unlocked.exe": b"unused", "texmf-dist/fonts/opentype/unlocked.otf": b"unused",
               "unrelated-file": b"unused"}
    archive = write_tar(tmp_path / "test.tar.xz", [(name, tarfile.REGTYPE, data)
                                                  for name, data in (allowed | blocked).items()])
    builder.extract_package(archive, runtime, {"kind": ""}, LOCK)
    for name, data in allowed.items():
        assert (runtime / name.replace("RELOC/", "texmf-dist/")).read_bytes() == data
    for name in blocked:
        assert not (runtime / name).exists()


def test_offline_cache_requires_exact_size_and_hash(builder, tmp_path):
    payload = b"verified archive"
    spec = archive_spec(payload)
    target = tmp_path / spec["file"]
    target.write_bytes(payload)
    assert builder.fetch_archive(spec, "https://unused.invalid", tmp_path, True) == target


@pytest.mark.parametrize("cached", [None, b"wrong size", b"locked archivE"])
def test_offline_missing_or_invalid_cache_fails_without_mutation(builder, tmp_path, cached):
    spec = archive_spec()
    target = tmp_path / spec["file"]
    if cached is not None:
        target.write_bytes(cached)
    with pytest.raises(RuntimeError, match="not cached"):
        builder.fetch_archive(spec, "https://unused.invalid", tmp_path, True)
    if cached is None:
        assert not target.exists()
    else:
        assert target.read_bytes() == cached
    assert not list(tmp_path.glob("*.part"))


@pytest.mark.parametrize("downloaded", [b"locked archivE", b"too short", b"locked archive plus unwanted data"])
def test_download_checksum_or_size_mismatch_preserves_previous_cache(builder, tmp_path, monkeypatch, downloaded):
    spec = archive_spec()
    target = tmp_path / spec["file"]
    target.write_bytes(b"previous cache")
    monkeypatch.setattr(builder.urllib.request, "urlopen", lambda *_args, **_kwargs: io.BytesIO(downloaded))
    with pytest.raises(ValueError, match="checksum mismatch|exceeds locked size"):
        builder.fetch_archive(spec, "https://unused.invalid", tmp_path, False)
    assert target.read_bytes() == b"previous cache"
    assert not list(tmp_path.glob("*.part"))


def test_valid_download_is_published_only_after_verification(builder, tmp_path, monkeypatch):
    payload = b"locked archive"
    spec = archive_spec(payload)
    target = tmp_path / spec["file"]
    target.write_bytes(b"old cache")
    monkeypatch.setattr(builder.urllib.request, "urlopen", lambda *_args, **_kwargs: io.BytesIO(payload))
    assert builder.fetch_archive(spec, "https://unused.invalid", tmp_path, False) == target
    assert target.read_bytes() == payload
    assert not list(tmp_path.glob("*.part"))


def test_download_does_not_follow_preexisting_partial_hardlink(builder, tmp_path, monkeypatch):
    cache = tmp_path / "cache"
    cache.mkdir()
    payload = b"locked archive"
    spec = archive_spec(payload)
    outside = tmp_path / "unrelated.txt"
    outside.write_bytes(b"do not overwrite")
    partial = cache / (spec["file"] + ".part")
    os.link(outside, partial)
    monkeypatch.setattr(builder.urllib.request, "urlopen", lambda *_args, **_kwargs: io.BytesIO(payload))
    try:
        builder.fetch_archive(spec, "https://unused.invalid", cache, False)
    except (OSError, ValueError):
        pass
    assert outside.read_bytes() == b"do not overwrite"


def test_verify_runtime_checks_all_file_contents_and_lock(builder, tmp_path):
    manifest = write_runtime(tmp_path)
    assert builder.verify_runtime(tmp_path, LOCK_HASH) == manifest
    with pytest.raises(ValueError, match="lock"):
        builder.verify_runtime(tmp_path, "b" * 64)
    executable = tmp_path / manifest["executable"]
    content = executable.read_bytes()
    executable.write_bytes(content[:-1] + b"?")
    with pytest.raises(ValueError, match="verification"):
        builder.verify_runtime(tmp_path, LOCK_HASH)


def test_verify_runtime_rejects_outside_manifest_paths(builder, tmp_path):
    runtime = tmp_path / "runtime"
    manifest = write_runtime(runtime)
    outside = tmp_path / "outside"
    outside.write_bytes(b"outside")
    manifest["files"].append({"path": "../outside", "size": 7,
                              "sha256": hashlib.sha256(b"outside").hexdigest()})
    write_manifest(runtime, manifest)
    with pytest.raises(ValueError):
        builder.verify_runtime(runtime, LOCK_HASH)


def test_verify_runtime_rejects_empty_receipt(builder, tmp_path):
    manifest = write_runtime(tmp_path)
    manifest["files"] = []
    manifest["sizeBytes"] = 0
    write_manifest(tmp_path, manifest)
    with pytest.raises(ValueError):
        builder.verify_runtime(tmp_path, LOCK_HASH)


def test_verify_runtime_rejects_unlisted_files(builder, tmp_path):
    write_runtime(tmp_path)
    extra = tmp_path / "personal-note.txt"
    extra.write_text("must not enter a release", encoding="utf-8")
    with pytest.raises(ValueError, match="Unlisted"):
        builder.verify_runtime(tmp_path, LOCK_HASH)
    assert extra.read_text(encoding="utf-8") == "must not enter a release"


@pytest.mark.parametrize("key,value", [("producer", "unrelated-tool"), ("runtimeId", "b" * 64),
                                      ("platform", "linux"), ("engine", "other")])
def test_verify_runtime_rejects_wrong_identity(builder, tmp_path, key, value):
    manifest = write_runtime(tmp_path)
    manifest[key] = value
    write_manifest(tmp_path, manifest)
    with pytest.raises(ValueError):
        builder.verify_runtime(tmp_path, LOCK_HASH)


def test_verify_runtime_rejects_duplicate_file_entries(builder, tmp_path):
    manifest = write_runtime(tmp_path)
    manifest["files"].append(dict(manifest["files"][0]))
    write_manifest(tmp_path, manifest)
    with pytest.raises(ValueError):
        builder.verify_runtime(tmp_path, LOCK_HASH)


def test_verify_runtime_rejects_missing_required_artifact(builder, tmp_path):
    manifest = write_runtime(tmp_path)
    manifest["files"] = [entry for entry in manifest["files"] if entry["path"] != "bin/windows/xdvipdfmx.exe"]
    manifest["sizeBytes"] = sum(entry["size"] for entry in manifest["files"])
    (tmp_path / "bin/windows/xdvipdfmx.exe").unlink()
    write_manifest(tmp_path, manifest)
    with pytest.raises(ValueError):
        builder.verify_runtime(tmp_path, LOCK_HASH)


def test_publish_refuses_unmanaged_directory(builder, tmp_path):
    target = tmp_path / "user-data"
    target.mkdir()
    sentinel = target / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")
    staging = tmp_path / ".staging"
    write_runtime(staging)
    with pytest.raises(ValueError, match="unmanaged"):
        builder.publish(staging, target)
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert staging.exists()


@pytest.mark.parametrize("fake_receipt", ["unrelated document", '{"schemaVersion": 1, "files": []}'])
def test_publish_refuses_unrelated_manifest_named_file(builder, tmp_path, fake_receipt):
    target = tmp_path / "user-data"
    target.mkdir()
    (target / "runtime-manifest.json").write_text(fake_receipt, encoding="utf-8")
    sentinel = target / "keep.txt"
    sentinel.write_text("keep", encoding="utf-8")
    staging = tmp_path / ".staging"
    write_runtime(staging)
    with pytest.raises(ValueError):
        builder.publish(staging, target)
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert staging.exists()


def test_publish_preserves_unowned_files_in_otherwise_managed_target(builder, tmp_path):
    target = tmp_path / "runtime"
    staging = tmp_path / ".staging"
    write_runtime(target, b"old")
    write_runtime(staging, b"new")
    sentinel = target / "personal-note.txt"
    sentinel.write_text("keep", encoding="utf-8")
    with pytest.raises(ValueError):
        builder.publish(staging, target)
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert staging.exists()


def test_publish_replaces_managed_runtime(builder, tmp_path):
    target = tmp_path / "runtime"
    staging = tmp_path / ".staging"
    write_runtime(target, b"old")
    expected = write_runtime(staging, b"new")
    builder.publish(staging, target)
    assert builder.verify_runtime(target, LOCK_HASH) == expected
    assert not staging.exists()
    assert not (tmp_path / ".staging-previous").exists()


def test_publish_failure_restores_previous_runtime(builder, tmp_path, monkeypatch):
    target = tmp_path / "runtime"
    staging = tmp_path / ".staging"
    original = write_runtime(target, b"old")
    write_runtime(staging, b"new")
    rename = Path.rename

    def fail_new_publish(path, destination):
        if path == staging:
            raise OSError("simulated failure publishing new runtime")
        return rename(path, destination)

    monkeypatch.setattr(Path, "rename", fail_new_publish)
    with pytest.raises(OSError, match="simulated failure"):
        builder.publish(staging, target)
    assert builder.verify_runtime(target, LOCK_HASH) == original
    assert staging.exists()
    assert not (tmp_path / ".staging-previous").exists()


def test_publish_rejects_staging_outside_target_parent(builder, tmp_path):
    target_parent = tmp_path / "output"
    target_parent.mkdir()
    staging = tmp_path / "unrelated-staging"
    write_runtime(staging)
    with pytest.raises(ValueError, match="Unsafe"):
        builder.publish(staging, target_parent / "runtime")
    assert staging.exists()
    assert not (target_parent / "runtime").exists()


def test_verify_only_reads_receipt_without_build_cache_or_network(builder, tmp_path, monkeypatch, capsys):
    lock_path = tmp_path / "lock.json"
    lock_path.write_text(json.dumps(LOCK), encoding="utf-8")
    output = tmp_path / "runtime"
    write_runtime(output, lock_hash=builder.digest(lock_path))
    cache = tmp_path / "cache-must-not-be-created"
    before = {path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()}
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    monkeypatch.setattr(builder.sys, "argv", [str(BUILDER_PATH), "--verify-only", "--output", str(output), "--cache", str(cache)])
    monkeypatch.setattr(builder.sys, "platform", "unsupported-build-platform")

    def forbid_build(*_args, **_kwargs):
        raise AssertionError("--verify-only must not build or download")

    monkeypatch.setattr(builder, "fetch_archive", forbid_build)
    monkeypatch.setattr(builder, "compile_format", forbid_build)
    builder.main()
    assert "Verified offline runtime" in capsys.readouterr().out
    assert not cache.exists()
    after = {path.relative_to(output): path.read_bytes() for path in output.rglob("*") if path.is_file()}
    assert after == before


@pytest.mark.parametrize("cached", [True, False])
@pytest.mark.parametrize("existing_runtime", [True, False])
def test_download_only_offline_uses_verified_cache(builder, tmp_path, monkeypatch, cached, existing_runtime):
    payload = b"locked archive"
    spec = archive_spec(payload)
    lock = dict(LOCK, packages=[{"archives": [spec]}], externalSources=[], archiveBase="https://unused.invalid")
    lock_path = tmp_path / "lock.json"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    cache = tmp_path / "cache"
    cache.mkdir()
    if cached:
        (cache / spec["file"]).write_bytes(payload)
    output = tmp_path / "runtime"
    if existing_runtime:
        write_runtime(output, lock_hash=builder.digest(lock_path))
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    monkeypatch.setattr(builder.sys, "argv", [str(BUILDER_PATH), "--offline", "--download-only", "--output", str(output), "--cache", str(cache)])
    monkeypatch.setattr(builder.sys, "platform", "win32")
    if cached:
        builder.main()
    else:
        with pytest.raises(RuntimeError, match="not cached"):
            builder.main()
    assert output.exists() == existing_runtime


def test_verify_only_rejects_invalid_runtime_without_repair(builder, tmp_path, monkeypatch):
    lock_path = tmp_path / "lock.json"
    lock_path.write_text(json.dumps(LOCK), encoding="utf-8")
    output = tmp_path / "runtime"
    write_runtime(output, lock_hash=builder.digest(lock_path))
    executable = output / "bin/windows/xelatex.exe"
    executable.write_bytes(b"corrupt")
    cache = tmp_path / "cache-must-not-be-created"
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    monkeypatch.setattr(builder.sys, "argv", [str(BUILDER_PATH), "--verify-only", "--output", str(output), "--cache", str(cache)])
    with pytest.raises(ValueError, match="verification"):
        builder.main()
    assert executable.read_bytes() == b"corrupt"
    assert not cache.exists()


@pytest.mark.parametrize("has_manifest", [False, True])
def test_source_companion_refuses_unowned_files(builder, tmp_path, has_manifest):
    target = tmp_path / "sources"
    target.mkdir()
    sentinel = target / "personal-note.txt"
    sentinel.write_text("keep", encoding="utf-8")
    if has_manifest:
        (target / "source-manifest.json").write_text(json.dumps({
            "producer": "fetchcv-resume-runtime-sources", "archives": [], "lockSha256": LOCK_HASH,
        }), encoding="utf-8")
    with pytest.raises(ValueError, match="unmanaged source companion"):
        builder.publish_sources(target, [], {}, LOCK_HASH)
    assert sentinel.read_text(encoding="utf-8") == "keep"
    assert not list(tmp_path.glob(".resume-sources-*"))


def test_source_companion_replaces_owned_archives(builder, tmp_path, monkeypatch):
    lock_path = tmp_path / "lock.json"
    lock_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    target = tmp_path / "sources"
    archive = tmp_path / "downloaded.tar.xz"
    archive.write_bytes(b"old archive")
    old_spec = archive_spec(b"old archive", "old.tar.xz")
    builder.publish_sources(target, [old_spec], {old_spec["file"]: archive}, LOCK_HASH)
    archive.write_bytes(b"new archive")
    new_spec = archive_spec(b"new archive", "new.tar.xz")
    builder.publish_sources(target, [new_spec], {new_spec["file"]: archive}, LOCK_HASH)
    assert (target / new_spec["file"]).read_bytes() == b"new archive"
    assert not (target / old_spec["file"]).exists()
    assert json.loads((target / "source-manifest.json").read_text())["archives"] == [new_spec]
    assert not list(tmp_path.glob(".resume-sources-*"))


def test_source_companion_failure_restores_previous_archive(builder, tmp_path, monkeypatch):
    lock_path = tmp_path / "lock.json"
    lock_path.write_text("{}", encoding="utf-8")
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    target = tmp_path / "sources"
    archive = tmp_path / "downloaded.tar.xz"
    archive.write_bytes(b"old archive")
    spec = archive_spec(b"old archive")
    builder.publish_sources(target, [spec], {spec["file"]: archive}, LOCK_HASH)
    original = (target / "source-manifest.json").read_bytes()
    archive.write_bytes(b"new archive")
    rename = Path.rename

    def fail_new_publish(source, destination):
        if source.name.startswith(".resume-sources-") and not source.name.endswith("-previous"):
            raise OSError("simulated source publication failure")
        return rename(source, destination)

    monkeypatch.setattr(Path, "rename", fail_new_publish)
    with pytest.raises(OSError, match="simulated source publication failure"):
        builder.publish_sources(target, [archive_spec(b"new archive")], {spec["file"]: archive}, LOCK_HASH)
    assert (target / spec["file"]).read_bytes() == b"old archive"
    assert (target / "source-manifest.json").read_bytes() == original
    assert not list(tmp_path.glob(".resume-sources-*"))


@pytest.mark.parametrize("damage", ["missing_dependency_lock", "unowned_file"])
def test_current_runtime_requires_complete_owned_source_companion(builder, tmp_path, monkeypatch, damage):
    payload = b"locked archive"
    spec = archive_spec(payload)
    lock = dict(LOCK, packages=[{"archives": [spec]}], externalSources=[], archiveBase="https://unused.invalid")
    lock_path = tmp_path / "lock.json"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    monkeypatch.setattr(builder, "LOCK_PATH", lock_path)
    lock_hash = builder.digest(lock_path)
    output = tmp_path / "runtime"
    write_runtime(output, lock_hash=lock_hash)
    downloaded = tmp_path / spec["file"]
    downloaded.write_bytes(payload)
    companion = tmp_path / "resume-runtime-sources"
    builder.publish_sources(companion, [spec], {spec["file"]: downloaded}, lock_hash)
    if damage == "missing_dependency_lock":
        (companion / "dependency-lock.json").unlink()
    else:
        (companion / "personal-note.txt").write_text("not a release artifact", encoding="utf-8")
    monkeypatch.setattr(builder.sys, "argv", [str(BUILDER_PATH), "--offline", "--output", str(output), "--cache", str(tmp_path / "cache")])
    monkeypatch.setattr(builder.sys, "platform", "win32")

    def stop_before_repair(*_args, **_kwargs):
        raise RuntimeError("Source companion repair required")

    monkeypatch.setattr(builder, "fetch_locked", stop_before_repair)
    with pytest.raises(RuntimeError, match="Source companion repair required"):
        builder.main()


def test_external_source_requires_every_locked_notice(builder, tmp_path):
    archive = write_tar(tmp_path / "source.tar.xz", [
        ("source/COPYING", tarfile.REGTYPE, b"upstream notice"),
        ("source/README", tarfile.REGTYPE, b"other documentation"),
    ])
    spec = {"file": archive.name, "notices": ["source/COPYING", "source/MISSING-LICENSE"]}
    with pytest.raises(ValueError, match="Missing upstream license notices"):
        builder.extract_source_notices(archive, tmp_path / "staging", spec)
