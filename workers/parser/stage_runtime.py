"""Offline staging from hash-pinned, redistributable upstream archives.

Does not install into Python, modify PATH, or copy an Anaconda environment.
The CPython SPDX file accompanies the official embeddable distribution.
"""
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import zipfile

PYTHON_SHA256='d297e5ff019966817ad8502465176139f2d3d840fa4ed84b13bed399a6ab1f15'
PYPDF_SHA256='1782ee0766f0b77defc305f1eb2bafe738a2ef6313f3f3d2ee85b4542ba7e535'

def unpack(source,target,expected):
    source=Path(source)
    if hashlib.sha256(source.read_bytes()).hexdigest()!=expected:raise ValueError('parser_runtime_archive_hash_mismatch')
    with zipfile.ZipFile(source) as archive:
        entries=archive.infolist()
        if len(entries)>1000 or sum(item.file_size for item in entries)>100*1024*1024:raise ValueError('runtime_archive_limits')
        for item in entries:
            path=PurePosixPath(item.filename)
            if path.is_absolute() or '..' in path.parts or '\\' in item.filename or ':' in item.filename or (item.external_attr>>16)&0o170000==0o120000:raise ValueError('unsafe_runtime_archive_path')
            destination=target.joinpath(*path.parts)
            if item.is_dir():destination.mkdir(parents=True,exist_ok=True);continue
            destination.parent.mkdir(parents=True,exist_ok=True)
            with destination.open('xb') as output:output.write(archive.read(item))

def stage(target,python_archive,pypdf_wheel):
    target=Path(target);target.mkdir()
    unpack(python_archive,target,PYTHON_SHA256)
    unpack(pypdf_wheel,target,PYPDF_SHA256)
    # Keep the official isolated search path; no user site packages or pip needed.
    for name in ('entry.py','formats.py','windows_container.py','harden-profile.ps1','host_entry.py'):
        shutil.copyfile(Path(__file__).with_name(name),target/name)
    spdx=Path(str(python_archive)+'.spdx.json')
    if not spdx.is_file():raise ValueError('parser_python_sbom_required')
    shutil.copyfile(spdx,target/'python.spdx.json')
    files=[{'path':f.relative_to(target).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in sorted(target.rglob('*')) if f.is_file()]
    manifest={'schema':1,'python':'3.14.7','pypdf':'6.4.1','archives':{'python':PYTHON_SHA256,'pypdf':PYPDF_SHA256},'files':files,'bytes':sum(f['bytes'] for f in files)}
    with (target/'runtime-manifest.json').open('x',encoding='utf-8') as output:json.dump(manifest,output,indent=2)
    return {'files':len(files),'bytes':manifest['bytes'],'python':manifest['python'],'archives':manifest['archives']}
