"""Trusted host: orchestrates the LPAC only; never imports document parsers."""
import json
import sys
import threading
import os
from pathlib import Path
from windows_container import launch

def main():
    if len(sys.argv)!=2:raise ValueError('parser_host_arguments')
    job=Path(sys.argv[1]).resolve(strict=True)
    runtime=Path(__file__).resolve().parent
    cancelled=threading.Event()
    def parent_control():
        # Parent death closes stdin too. The worker is then terminated and its
        # ACLs revoked; the kill-on-close job is the final host-crash boundary.
        try:os.read(0,1)
        finally:cancelled.set()
    threading.Thread(target=parent_control,daemon=True).start()
    receipt=None
    try:
        receipt=launch(runtime,job,cancelled=cancelled.is_set)
        if receipt['exitCode']!=0:raise RuntimeError('parser_process_failed')
        result=json.loads((job/'result.json').read_text(encoding='utf-8'))
        if result.get('ok') is not True or result.get('lpac') is not True:raise RuntimeError('invalid_parser_response')
        response={'ok':True,'ir':result['ir'],'receipt':receipt}
    except Exception as error:
        code='cancelled' if isinstance(error,InterruptedError) else 'parser_timeout' if isinstance(error,TimeoutError) else 'parser_output_limit' if str(error)=='parser_output_limit' else 'parser_infrastructure_failed' if receipt is None else 'parser_failed'
        response={'ok':False,'code':code,'diagnostic':type(error).__name__}
    sys.stdout.buffer.write(json.dumps(response,ensure_ascii=False).encode('utf-8'));sys.stdout.buffer.flush()
    return 0 if response['ok'] else 2

if __name__=='__main__':raise SystemExit(main())
