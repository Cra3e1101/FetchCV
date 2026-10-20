"""Windows AppContainer launcher with a bounded kill-on-close job.

Only the newly staged runtime/job directories receive package-SID ACL grants.
The user authorized creation/use of this dedicated profile on 2026-09-22.
Never inspects another profile or edits system firewall policy.
Reference: Microsoft Learn / implementing-an-appcontainer, Job Objects.
"""
import ctypes as C
from ctypes import wintypes as W
import os
import json
import msvcrt
from pathlib import Path
import subprocess
import time
import threading
import uuid
import hashlib

P=C.c_void_p
SIZE=C.c_size_t
kernel=C.WinDLL('kernel32',use_last_error=True)
userenv=C.WinDLL('userenv',use_last_error=True)
advapi=C.WinDLL('advapi32',use_last_error=True)

class STARTUP(C.Structure):
    _fields_=[('cb',W.DWORD),('reserved',W.LPWSTR),('desktop',W.LPWSTR),('title',W.LPWSTR),
        *[(k,W.DWORD) for k in ('x','y','xs','ys','xc','yc','fill','flags')],('show',W.WORD),('cb2',W.WORD),('res2',P),('stdin',P),('stdout',P),('stderr',P)]
class STARTUPEX(C.Structure): _fields_=[('startup',STARTUP),('attributes',P)]
class PROCESS(C.Structure): _fields_=[('process',P),('thread',P),('pid',W.DWORD),('tid',W.DWORD)]
class CAPS(C.Structure): _fields_=[('sid',P),('capabilities',P),('count',W.DWORD),('reserved',W.DWORD)]
class SIDATTR(C.Structure): _fields_=[('sid',P),('attributes',W.DWORD)]
class BASIC(C.Structure):
    _fields_=[('processTime',C.c_int64),('jobTime',C.c_int64),('flags',W.DWORD),('minWs',SIZE),('maxWs',SIZE),('processes',W.DWORD),('affinity',SIZE),('priority',W.DWORD),('scheduling',W.DWORD)]
class IO(C.Structure): _fields_=[(k,C.c_uint64) for k in ('ro','wo','oo','rt','wt','ot')]
class LIMITS(C.Structure):
    _fields_=[('basic',BASIC),('io',IO),('processMemory',SIZE),('jobMemory',SIZE),('peakProcess',SIZE),('peakJob',SIZE)]

def api(dll,name,args,result=W.BOOL):
    f=getattr(dll,name);f.argtypes=args;f.restype=result;return f
derive=api(userenv,'DeriveAppContainerSidFromAppContainerName',[W.LPCWSTR,C.POINTER(P)],C.c_long)
create_profile=api(userenv,'CreateAppContainerProfile',[W.LPCWSTR,W.LPCWSTR,W.LPCWSTR,P,W.DWORD,C.POINTER(P)],C.c_long)
profile_path=api(userenv,'GetAppContainerFolderPath',[W.LPCWSTR,C.POINTER(P)],C.c_long)
task_free=api(C.WinDLL('ole32'),'CoTaskMemFree',[P],None)
free_sid=api(advapi,'FreeSid',[P],P)
sid_string=api(advapi,'ConvertSidToStringSidW',[P,C.POINTER(P)])
init_attr=api(kernel,'InitializeProcThreadAttributeList',[P,W.DWORD,W.DWORD,C.POINTER(SIZE)])
update_attr=api(kernel,'UpdateProcThreadAttribute',[P,W.DWORD,SIZE,P,SIZE,P,P])
delete_attr=api(kernel,'DeleteProcThreadAttributeList',[P],None)
create=api(kernel,'CreateProcessW',[W.LPCWSTR,W.LPWSTR,P,P,W.BOOL,W.DWORD,P,W.LPCWSTR,C.POINTER(STARTUPEX),C.POINTER(PROCESS)])
create_job=api(kernel,'CreateJobObjectW',[P,W.LPCWSTR],P)
set_job=api(kernel,'SetInformationJobObject',[P,C.c_int,P,W.DWORD])
assign=api(kernel,'AssignProcessToJobObject',[P,P])
in_job=api(kernel,'IsProcessInJob',[P,P,C.POINTER(W.BOOL)])
resume=api(kernel,'ResumeThread',[P],W.DWORD)
wait=api(kernel,'WaitForSingleObject',[P,W.DWORD],W.DWORD)
exit_code=api(kernel,'GetExitCodeProcess',[P,C.POINTER(W.DWORD)])
close=api(kernel,'CloseHandle',[P])
terminate=api(kernel,'TerminateProcess',[P,W.UINT])
local_free=api(kernel,'LocalFree',[P],P)
create_mutex=api(kernel,'CreateMutexW',[P,W.BOOL,W.LPCWSTR],P)
release_mutex=api(kernel,'ReleaseMutex',[P])
derive_cap=api(C.WinDLL('kernelbase',use_last_error=True),'DeriveCapabilitySidsFromName',[W.LPCWSTR,C.POINTER(P),C.POINTER(W.DWORD),C.POINTER(P),C.POINTER(W.DWORD)])
equal_sid=api(advapi,'EqualSid',[P,P])

def checked(result,step):
    if not result: raise OSError(C.get_last_error(),step)
    return result

PROFILE='FetchCV.Parser.M5.20260922'
OUTPUT_LIMIT=64*1024*1024

class RegistryReadCapability:
    def __init__(self):
        self.groups=P();self.caps=P();self.group_count=W.DWORD();self.cap_count=W.DWORD()
        checked(derive_cap('registryRead',C.byref(self.groups),C.byref(self.group_count),C.byref(self.caps),C.byref(self.cap_count)),'derive_registry_read_capability')
        if self.cap_count.value!=1:self.close();raise OSError('unexpected_registry_capability_count')
        self.sid=C.cast(self.caps,C.POINTER(P))[0]
        self.attribute=SIDATTR(self.sid,4)
    def close(self):
        for pointer,count in ((self.groups,self.group_count),(self.caps,self.cap_count)):
            if pointer:
                for i in range(count.value):local_free(C.cast(pointer,C.POINTER(P))[i])
                local_free(pointer)
        self.groups=P();self.caps=P()

def acl(directory,operation,sid,rights=None):
    value=f'*{sid}'+(f':(OI)(CI){rights}' if rights else '')
    result=subprocess.run([os.path.join(os.environ['SystemRoot'],'System32','icacls.exe'),str(directory),operation,value,'/T','/Q'],capture_output=True,creationflags=0x08000000,timeout=20)
    if result.returncode:raise OSError(f'parser_acl_failed: {operation} {directory} ({result.returncode})')

def record(path,event):
    with path.open('a',encoding='utf-8') as output:
        output.write(json.dumps(event)+'\n');output.flush();os.fsync(output.fileno())

def recover_leases(state,sid):
    recovered=[]
    for lease in state.glob('*.jsonl'):
        rows=[json.loads(line) for line in lease.read_text(encoding='utf-8').splitlines()]
        if not rows or rows[-1].get('state')=='closed':continue
        if rows[0].get('state')!='open' or rows[0].get('sid')!=sid:raise RuntimeError('invalid_parser_host_lease')
        for value in rows[0]['directories']:
            directory=Path(value)
            if directory.exists():
                if str(directory.resolve(strict=True))!=value:raise RuntimeError('parser_lease_path_changed')
                acl(directory,'/remove:g',sid)
        record(lease,{'state':'closed','recovered':True});recovered.append(lease.name)
    return recovered

class BoundedPipe:
    """Only this anonymous pipe write handle is inherited; never a disk handle."""
    def __init__(self,limit):
        self.read_fd,self.write_fd=os.pipe();self.limit=limit;self.data=bytearray();self.failed=None;self.overflow=threading.Event()
        os.set_inheritable(self.read_fd,False);os.set_inheritable(self.write_fd,True)
        self.handle=msvcrt.get_osfhandle(self.write_fd)
        self.thread=threading.Thread(target=self.read,daemon=True)
        self.thread.start()
    def read(self):
        try:
            while True:
                chunk=os.read(self.read_fd,8192)
                if not chunk:break
                remaining=self.limit-len(self.data)
                self.data.extend(chunk[:remaining])
                if len(chunk)>remaining:self.overflow.set();break
        except OSError as error:self.failed=error
        finally:os.close(self.read_fd)
    def close_writer(self):
        if self.write_fd is not None:os.close(self.write_fd);self.write_fd=None

def launch(runtime,job,timeout_ms=45000,cancelled=lambda:False,*,_test_regular_container=False):
    runtime,job=Path(runtime).resolve(strict=True),Path(job).resolve(strict=True)
    if runtime==job or runtime in job.parents or job in runtime.parents:raise ValueError('parser_directories_must_be_disjoint')
    if not (job/'request.json').is_file():raise ValueError('invalid_job_layout')
    sid=P();text=P();job_handle=None;pi=PROCESS();attrs=None;streams=[];grants=[];mutex=None;locked=False;lease=None;primary=None;result=None;registry_cap=None
    hr=create_profile(PROFILE,'FetchCV document parser','Isolated local parsing with persistence disabled',None,0,C.byref(sid))
    created=hr==0
    if hr==-2147024713:hr=derive(PROFILE,C.byref(sid))
    if hr!=0:raise OSError(f'create_parser_profile HRESULT={hr:#x}')
    try:
        checked(sid_string(sid,C.byref(text)),'sid_to_string');sid_value=C.wstring_at(text)
        folder=P()
        if profile_path(sid_value,C.byref(folder))!=0:raise OSError('parser_profile_path_failed')
        try:profile_directory=C.wstring_at(folder)
        finally:task_free(folder)
        mutex_name='Global\\'+PROFILE+'.'+hashlib.sha256(profile_directory.casefold().encode()).hexdigest()[:16]
        mutex=checked(create_mutex(None,False,mutex_name),'create_parser_mutex')
        if wait(mutex,0) not in (0,128):raise RuntimeError('parser_profile_busy')
        locked=True
        # The approved profile is host-managed, but inaccessible to its worker SID.
        hardened=subprocess.run([os.path.join(os.environ['SystemRoot'],'System32','WindowsPowerShell','v1.0','powershell.exe'),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',str(Path(__file__).with_name('harden-profile.ps1')),'-ProfileDirectory',profile_directory,'-Sid',sid_value],capture_output=True,creationflags=0x08000000,timeout=30)
        if hardened.returncode or b'PROFILE_PERSISTENCE_DENIED' not in hardened.stdout:raise OSError('parser_profile_hardening_failed: '+hardened.stderr.decode(errors='replace')[:500])
        state=Path(profile_directory).parent/'host-leases';state.mkdir(exist_ok=True)
        recovered=recover_leases(state,sid_value)
        lease=state/(uuid.uuid4().hex+'.jsonl')
        record(lease,{'state':'open','sid':sid_value,'directories':[str(runtime),str(job)]})
        for directory in (runtime,job):
            grants.append(directory);acl(directory,'/grant',sid_value,'RX')
        # Windows 10 does not implement token information class 46. This ACL is
        # readable by a regular AC but not an LPAC, and is checked before parsing.
        probe=job/'lpac-probe';probe.write_bytes(b'lpac-negative-access-probe')
        for arguments in (['/inheritance:r'],['/remove:g',f'*{sid_value}'],['/grant:r','*S-1-5-11:R','*S-1-15-2-1:R']):
            configured=subprocess.run([os.path.join(os.environ['SystemRoot'],'System32','icacls.exe'),str(probe),*arguments,'/Q'],capture_output=True,creationflags=0x08000000,timeout=10)
            if configured.returncode:raise OSError('lpac_probe_acl_failed')
        if probe.read_bytes()!=b'lpac-negative-access-probe':raise OSError('lpac_probe_host_control_failed')
        # No writable directory and no low-integrity label: all output is bounded IPC.
        size=SIZE();init_attr(None,4,0,C.byref(size));attrs=C.create_string_buffer(size.value)
        checked(init_attr(attrs,4,0,C.byref(size)),'initialize_attributes')
        registry_cap=RegistryReadCapability()
        capabilities=CAPS(sid,C.cast(C.byref(registry_cap.attribute),P),1,0)
        checked(update_attr(attrs,0,0x20009,C.byref(capabilities),C.sizeof(capabilities),None,None),'set_security_capabilities')
        lpac=W.DWORD(0 if _test_regular_container else 1)
        checked(update_attr(attrs,0,0x2000f,C.byref(lpac),C.sizeof(lpac),None,None),'disable_all_application_packages_access')
        startup=STARTUPEX();startup.startup.cb=C.sizeof(startup);startup.attributes=C.cast(attrs,P)
        streams=[BoundedPipe(OUTPUT_LIMIT),BoundedPipe(65536)]
        handles=(P*2)(*(stream.handle for stream in streams))
        checked(update_attr(attrs,0,0x20002,handles,C.sizeof(handles),None,None),'set_output_handle_allowlist')
        startup.startup.flags=0x100;startup.startup.stdout=handles[0];startup.startup.stderr=handles[1]
        limits=LIMITS();limits.basic.flags=0x2000|0x100|0x8;limits.basic.processes=1;limits.processMemory=512*1024*1024
        job_handle=checked(create_job(None,None),'create_job');checked(set_job(job_handle,9,C.byref(limits),C.sizeof(limits)),'set_job_limits')
        jobs=(P*1)(job_handle)
        checked(update_attr(attrs,0,0x2000d,jobs,C.sizeof(jobs),None,None),'assign_job_at_process_creation')
        environment={'SystemRoot':os.environ['SystemRoot'],'WINDIR':os.environ['SystemRoot'],'PATH':str(runtime),'TEMP':str(job),'TMP':str(job),'TMPDIR':str(job),'APPDATA':str(job),'LOCALAPPDATA':str(job),'USERPROFILE':str(job),'PYTHONUTF8':'1','PYTHONDONTWRITEBYTECODE':'1','PYTHONIOENCODING':'utf-8'}
        env=C.create_unicode_buffer('\0'.join(k+'='+v for k,v in sorted(environment.items()))+'\0\0')
        command=C.create_unicode_buffer(subprocess.list2cmdline([str(runtime/'python.exe'),'-I','-B',str(runtime/'entry.py'),str(job)]))
        checked(create(str(runtime/'python.exe'),command,None,None,True,0x08000000|0x80000|4|0x400,env,str(job),C.byref(startup),C.byref(pi)),'create_appcontainer_process')
        for stream in streams:stream.close_writer()
        contained=W.BOOL();checked(in_job(pi.process,job_handle,C.byref(contained)),'query_resource_job')
        if not contained.value:raise OSError('parser_resource_job_required')
        if resume(pi.thread)==0xffffffff:checked(False,'resume_worker')
        deadline=time.monotonic()+timeout_ms/1000
        while True:
            if cancelled():raise InterruptedError('parser_cancelled')
            if any(s.overflow.is_set() for s in streams):raise ValueError('parser_output_limit')
            status=wait(pi.process,50)
            if status==0:break
            if status!=258:raise OSError('parser_wait_failed')
            if time.monotonic()>=deadline:raise TimeoutError('parser_wall_time_limit')
        code=W.DWORD();checked(exit_code(pi.process,C.byref(code)),'worker_exit')
        result={'exitCode':code.value,'isolation':'windows-lpac-registry-read-only','capabilities':['registryRead'],'sid':sid_value,'memoryLimitBytes':limits.processMemory,'processLimit':1,'timeoutMs':timeout_ms,'profileCreated':created,'profile':PROFILE,'profileDirectory':profile_directory,'recoveredLeases':recovered,'outputLimitBytes':OUTPUT_LIMIT,'profilePersistence':'denied'}
    except BaseException as error:primary=error
    finally:
        failures=[]
        try:
            if pi.process and wait(pi.process,0)!=0:
                if not terminate(pi.process,86):failures.append('terminate_failed')
                if wait(pi.process,5000)!=0:failures.append('termination_not_confirmed')
            for stream in streams:
                stream.close_writer();stream.thread.join(timeout=5)
                if stream.thread.is_alive() or stream.failed:failures.append('pipe_drain_failed')
                if stream.overflow.is_set() and primary is None:primary=ValueError('parser_output_limit')
            for directory in grants:
                try:acl(directory,'/remove:g',sid_value)
                except Exception as error:failures.append(str(error))
            if lease and not failures:record(lease,{'state':'closed','recovered':False})
        except BaseException as error:failures.append(str(error))
        finally:
            if pi.thread:close(pi.thread)
            if pi.process:close(pi.process)
            if job_handle:close(job_handle)
            if attrs is not None:delete_attr(attrs)
            if registry_cap:registry_cap.close()
            if text:local_free(text)
            if sid:free_sid(sid)
            if locked:release_mutex(mutex)
            if mutex:close(mutex)
        if failures:
            cleanup=RuntimeError('parser_cleanup_failed: '+';'.join(failures))
            if primary:raise cleanup from primary
            raise cleanup
    # Host-owned evidence is written only after the worker exited and grants expired.
    for stream,name in zip(streams,('stdout.log','stderr.log')):
        with (job/name).open('xb') as output:output.write(stream.data)
    if primary:raise primary
    result['stdoutBytes']=len(streams[0].data);result['stderrBytes']=len(streams[1].data)
    with (job/'profile-receipt.json').open('x',encoding='utf-8') as output:json.dump(result,output,indent=2)
    if result['exitCode']==0:
        parsed=json.loads(streams[0].data.decode('utf-8'))
        with (job/'result.json').open('x',encoding='utf-8') as output:json.dump(parsed,output,ensure_ascii=False)
    return result
