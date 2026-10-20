import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import time
import threading
sys.path.insert(0,str(Path(__file__).resolve().parents[2]))
from workers.parser.stage_runtime import stage
from workers.parser.windows_container import launch

root=Path(os.environ['M1_ALLOWED_DELETE_ROOT'])
runtime=root/'runtime';job=root/'parser-job';job.mkdir()
def audit(event,args):
    if event in ('os.remove','os.rmdir','os.rename'):raise RuntimeError('no deletion/move allowed in this fixture')
sys.addaudithook(audit)
project=Path(__file__).resolve().parents[2]
staged=stage(runtime,root.parent/'m5-runtime-download-02'/'python-3.14.7-embed-amd64.zip',project/'.m1-work/w3-python-20260911-192209/wheelhouse/pypdf-6.4.1-py3-none-any.whl')
outside=root/'outside';outside.mkdir();(outside/'read-canary').write_text('synthetic-only')
listener=socket.socket();listener.bind(('127.0.0.1',0));listener.listen()
try:
    with socket.create_connection(listener.getsockname(),timeout=2):
        connection,_=listener.accept();connection.close()
    data='SQL 中文😀'.encode();(job/'input.bin').write_bytes(data)
    canary={'read':str(outside/'read-canary'),'write':str(outside/'write-canary'),'port':listener.getsockname()[1],
        'jobWrite':str(job/'unexpected-file'),'runtimeWrite':str(runtime/'unexpected-file'),
        'profileWrite':str(Path(r'C:\Users\hesan\AppData\Local\Packages\fetchcv.parser.m5.20260922\AC')/('unexpected-'+root.name))}
    (job/'request.json').write_text(json.dumps({'format':'txt','inputHash':hashlib.sha256(data).hexdigest(),'canary':canary}),encoding='utf-8')
    launched=launch(runtime,job)
    (root/'launch-report.json').write_text(json.dumps({'staged':staged,**launched},indent=2),encoding='utf-8')
    assert launched['exitCode']==0,launched
    result=json.loads((job/'result.json').read_text(encoding='utf-8'))
    assert result['appcontainer'] and result['ok'],result
    assert all(isinstance(result['canary'][op],dict) and result['canary'][op].get('errorType')=='PermissionError' and result['canary'][op].get('errno')==13 for op in ('read','write','jobWrite','runtimeWrite','profileWrite')),result
    assert result['canary']['registryWrite'].get('blocked') and result['canary']['spawn'].get('blocked'),result
    assert result['lpac'] and result['capabilityCount']==1 and result['capabilities']==['registryRead'],result
    assert result['canary']['network'].get('connected') is False,result
    assert result['canary']['network']['errorType'] in ('PermissionError','TimeoutError'),result
    listener.setblocking(False)
    try:
        unexpected,_=listener.accept();unexpected.close();raise AssertionError('worker network connection reached listener')
    except BlockingIOError:pass
    listener.setblocking(True)
    with socket.create_connection(listener.getsockname(),timeout=2):
        connection,_=listener.accept();connection.close()
    result['canary']['hostConnectionsBeforeAndAfter']=True
    result['canary']['listenerReceivedWorkerConnection']=False
    def new_job(name):
        directory=root/name;directory.mkdir();(directory/'input.bin').write_bytes(data)
        (directory/'request.json').write_text(json.dumps({'format':'txt','inputHash':hashlib.sha256(data).hexdigest(),'canary':{**canary,'priorRead':str(job/'input.bin')}}),encoding='utf-8')
        return directory
    second=new_job('second-job');again=launch(runtime,second)
    assert again['exitCode']==0,again
    second_result=json.loads((second/'result.json').read_text(encoding='utf-8'))
    assert second_result['canary']['priorRead']['blocked'],second_result
    regular=new_job('regular-negative-control');regular_result=launch(runtime,regular,_test_regular_container=True)
    assert regular_result['exitCode']!=0 and b'lpac_negative_access_probe_failed' in (regular/'stderr.log').read_bytes(),regular_result
    controls={'oldJobDenied':True,'regularContainerRejectedBeforeParse':True}
    original_entry=(runtime/'entry.py').read_bytes()
    for name,script,options,expected in (
        ('timeout',b'import time;time.sleep(60)',{'timeout_ms':200},TimeoutError),
        ('cancel',b'import time;time.sleep(60)',{'cancelled':lambda:True},InterruptedError),
        ('output-limit',b'import sys;sys.stdout.buffer.write(b"x"*(70*1024*1024));sys.stdout.buffer.flush()',{},ValueError),
    ):
        (runtime/'entry.py').write_bytes(script)
        scenario=new_job(name);started=time.monotonic()
        try:launch(runtime,scenario,**options)
        except expected as error:controls[name]={'type':type(error).__name__,'message':str(error),'elapsedSeconds':time.monotonic()-started}
        else:raise AssertionError('expected '+name+' to reject')
        if name=='output-limit':assert (scenario/'stdout.log').stat().st_size==64*1024*1024
    (runtime/'entry.py').write_bytes(b'import json\ntry:\n x=bytearray(700*1024*1024)\nexcept MemoryError:\n print(json.dumps({"memoryDenied":True}))\nelse:\n raise SystemExit(17)\n')
    memory=new_job('memory-limit');limited=launch(runtime,memory)
    assert limited['exitCode']==0 and json.loads((memory/'result.json').read_bytes())['memoryDenied'],limited
    controls['memoryLimitDenied']=True
    (runtime/'entry.py').write_bytes(original_entry)
    final_job=new_job('after-limits');assert launch(runtime,final_job)['exitCode']==0
    controls['subsequentJobSucceeded']=True
    print(json.dumps({'staged':staged,'launch':launched,'result':result,'controls':controls},ensure_ascii=False))
finally:listener.close()
