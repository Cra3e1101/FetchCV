"""Run the existing independent T1 regression under an explicit offline boundary."""
import ipaddress
import os
from pathlib import Path
import socket
import sys

root = Path(os.environ["FETCHCV_T2_REGRESSION_ROOT"]).resolve()
for name in ["APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "FETCHCV_SETTINGS_FILE", "FETCHCV_ARTIFACT_ROOT", "FETCHCV_WORKSPACE_ROOT"]:
    Path(os.environ[name]).resolve().relative_to(root)
assert os.environ["FETCHCV_DATABASE_URL"].startswith("sqlite:///")
Path(os.environ["FETCHCV_DATABASE_URL"][10:]).resolve().relative_to(root)
original_connect = socket.socket.connect
def local_connect(sock, address):
    if isinstance(address, tuple):
        try:
            allowed = ipaddress.ip_address(address[0]).is_loopback
        except ValueError:
            allowed = address[0] == "localhost"
        if not allowed:
            raise RuntimeError("T2 regression blocked external network")
    return original_connect(sock, address)
socket.socket.connect = local_connect

import pytest
raise SystemExit(pytest.main(sys.argv[1:]))
