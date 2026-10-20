"""Single-job container entry: host-owned input/result files, no DB or secrets."""
import ctypes
from ctypes import wintypes
import hashlib
import json
from pathlib import Path
import sys
import socket
from formats import parse_bytes
from windows_container import RegistryReadCapability, SIDATTR, equal_sid

root=Path(sys.argv[1])
# Verify the real token; launcher configuration alone is not proof of isolation.
advapi=ctypes.WinDLL('advapi32',use_last_error=True)
kernel=ctypes.WinDLL('kernel32',use_last_error=True)
kernel.GetCurrentProcess.restype=wintypes.HANDLE
advapi.OpenProcessToken.argtypes=[wintypes.HANDLE,wintypes.DWORD,ctypes.POINTER(wintypes.HANDLE)]
advapi.GetTokenInformation.argtypes=[wintypes.HANDLE,ctypes.c_int,ctypes.c_void_p,wintypes.DWORD,ctypes.POINTER(wintypes.DWORD)]
token=wintypes.HANDLE();size=wintypes.DWORD();value=wintypes.DWORD()
if not advapi.OpenProcessToken(kernel.GetCurrentProcess(),8,ctypes.byref(token)):raise OSError('token_open_failed')
try:
    if not advapi.GetTokenInformation(token,29,ctypes.byref(value),4,ctypes.byref(size)) or value.value!=1:raise OSError('appcontainer_required')
    queried=advapi.GetTokenInformation(token,46,ctypes.byref(value),4,ctypes.byref(size))
    token_query_error=ctypes.get_last_error() if not queried else None
    if queried and not value.value or not queried and token_query_error not in (50,87):raise OSError('lpac_token_required')
    # Old Windows 10 returns ERROR_INVALID_PARAMETER for class 46. Never just
    # accept that: require the real ALL_APPLICATION_PACKAGES access denial too.
    kernel.CreateFileW.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    kernel.CreateFileW.restype=wintypes.HANDLE
    probe=kernel.CreateFileW(str(root/'lpac-probe'),0x80000000,1,None,3,0,None)
    if probe!=ctypes.c_void_p(-1).value:
        kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle(probe)
        raise OSError('lpac_negative_access_probe_failed')
    if ctypes.get_last_error()!=5:raise OSError('lpac_probe_expected_access_denied')
    advapi.GetTokenInformation(token,30,None,0,ctypes.byref(size))
    capabilities=ctypes.create_string_buffer(size.value)
    if not advapi.GetTokenInformation(token,30,capabilities,size.value,ctypes.byref(size)):raise OSError('capabilities_query_failed')
    capability_count=wintypes.DWORD.from_buffer(capabilities).value
    if capability_count!=1:raise OSError('single_registry_read_capability_required')
    class GROUPS(ctypes.Structure):_fields_=[('count',wintypes.DWORD),('groups',SIDATTR*1)]
    actual=GROUPS.from_buffer(capabilities).groups[0]
    expected=RegistryReadCapability()
    try:
        if not equal_sid(actual.sid,expected.sid):raise OSError('unexpected_token_capability')
    finally:expected.close()
finally:
    kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle(token)
try:
    request=json.loads((root/'request.json').read_text(encoding='utf-8'))
    data=(root/'input.bin').read_bytes()
    if hashlib.sha256(data).hexdigest()!=request['inputHash']:raise ValueError('input_hash_mismatch')
    result={'ok':True,'ir':parse_bytes(data,request['format']),'appcontainer':True,'lpac':True,'lpacVerification':'token-and-acl-probe' if queried else 'acl-probe-token-query-unsupported','tokenQueryError':token_query_error,'capabilityCount':capability_count,'capabilities':['registryRead']}
    if request.get('canary'):
        canary=request['canary'];observed={}
        for op in ('read','write','jobWrite','runtimeWrite','profileWrite','priorRead'):
            if op not in canary:continue
            try:
                target=Path(canary[op])
                if op in ('read','priorRead'):target.read_bytes()
                else:
                    with target.open('xb') as output:output.write(b'unexpected')
                observed[op]='ALLOWED'
            except OSError as error:observed[op]={'blocked':True,'winerror':error.winerror,'errno':error.errno,'errorType':type(error).__name__,'message':str(error)}
        import winreg
        try:
            key=winreg.CreateKeyEx(winreg.HKEY_CURRENT_USER,r'Software\Classes\Local Settings\Software\Microsoft\Windows\CurrentVersion\AppContainer\Storage\fetchcv.parser.m5.20260922\parser-canary',0,winreg.KEY_SET_VALUE)
            winreg.CloseKey(key);observed['registryWrite']='ALLOWED'
        except OSError as error:observed['registryWrite']={'blocked':True,'winerror':error.winerror,'errorType':type(error).__name__}
        import subprocess
        try:
            child=subprocess.run([sys.executable,'-I','-B','-c','pass'],capture_output=True,timeout=2)
            observed['spawn']={'ALLOWED':True,'exitCode':child.returncode}
        except OSError as error:observed['spawn']={'blocked':True,'winerror':error.winerror,'errorType':type(error).__name__}
        try:
            with socket.create_connection(('127.0.0.1',canary['port']),timeout=2):pass
            observed['network']='ALLOWED'
        except OSError as error:observed['network']={'connected':False,'permissionDenied':isinstance(error,PermissionError),'winerror':error.winerror,'errno':error.errno,'errorType':type(error).__name__,'message':str(error)}
        result['canary']=observed
except Exception as error:
    result={'ok':False,'code':type(error).__name__,'message':str(error)[:300],'appcontainer':True}
sys.stdout.buffer.write(json.dumps(result,ensure_ascii=False).encode('utf-8'))
sys.stdout.buffer.flush()
raise SystemExit(0 if result['ok'] else 2)
