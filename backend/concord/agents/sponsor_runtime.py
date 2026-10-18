"""Explicit authorization and redacted failure boundary for optional provider work."""
import hmac
import os
from fastapi import HTTPException


def require_operator(token: str | None, switch: str):
    expected = os.environ.get('CONCORD_SPONSOR_OPERATOR_TOKEN')
    if not expected or os.environ.get(switch) != '1':
        raise HTTPException(503, {'code': 'LIVE_EXECUTION_DISABLED', 'required': ['CONCORD_SPONSOR_OPERATOR_TOKEN', f'{switch}=1']})
    if not token or not hmac.compare_digest(token.encode(), expected.encode()):
        raise HTTPException(401, {'code': 'OPERATOR_AUTH_REQUIRED'})
