"""Short-lived, operation-bound approval issued by the authenticated desktop host."""
import base64
import hashlib
import hmac
import json
import os
import time

from applyos_harness.errors import HarnessError


def verify_host_approval(token, *, message_id, tool_name, call_id, arguments):
    try:
        key = os.environ.get("FETCHCV_APPROVAL_KEY", "")
        if not key or not token or len(token) > 65536:
            raise ValueError("missing")
        encoded, signature = token.split(".")
        expected = hmac.new(key.encode(), ("fetchcv-web-approval-v1:" + encoded).encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError("signature")
        claim = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        if not time.time() < claim["expires_at"] <= time.time() + 310:
            raise ValueError("expired")
        if (claim["message_id"], claim["tool"], claim["call_id"], claim["arguments"]) != (
            message_id, tool_name, call_id, arguments
        ):
            raise ValueError("scope")
    except (ValueError, TypeError, KeyError):
        raise HarnessError("web_approval_required", "本次联网需要用户批准") from None
