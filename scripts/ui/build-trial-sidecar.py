"""Build only into the new approved run root; record successful Python deletions."""
import os,sys,json,runpy
from pathlib import Path
root=Path(os.environ['M1_ALLOWED_DELETE_ROOT']).resolve()
if not root.is_dir() or root.parent!=Path(r'D:\hesan\Desktop\VSCODES\FetchCV_M1_work\20260910-235136'):raise RuntimeError('Unexpected run root')
log=root/'python-delete.jsonl'
def record(data):
    with log.open('a',encoding='utf-8') as stream:stream.write(json.dumps(data)+'\n')
def wrap(name):
    original=getattr(os,name)
    def guarded(target,*args,**kwargs):
        candidate=Path(os.fsdecode(target)).resolve()
        if kwargs.get('dir_fd') is not None or not candidate.is_relative_to(root) or candidate==root:
            record({'event':'blocked','operation':name,'path':str(candidate)});raise RuntimeError('Deletion outside approved run root')
        result=original(target,*args,**kwargs)
        record({'event':'deleted','operation':name,'path':str(candidate)})
        return result
    setattr(os,name,guarded)
for name in ['unlink','remove','rmdir']:wrap(name)
backend=Path.cwd()/'backend'
sys.argv=['pyinstaller','--noconfirm','--clean','--onedir','--name','fetchcv-api','--paths',str(backend),'--collect-data','applyos_agent','--collect-submodules','mcp.client','--collect-submodules','mcp.shared','--hidden-import','mcp.types','--collect-all','reportlab','--collect-submodules','uvicorn','--exclude-module','camoufox','--exclude-module','playwright','--exclude-module','numpy','--exclude-module','scipy','--distpath',str(root/'sidecar-dist'),'--workpath',str(root/'pyinstaller-work'),'--specpath',str(root),str(backend/'sidecar_entry.py')]
runpy.run_module('PyInstaller',run_name='__main__')
