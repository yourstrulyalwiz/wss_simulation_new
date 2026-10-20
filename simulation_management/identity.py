import hmac
import os
from fastapi import HTTPException
from .access import public_read_only


def identity(request, required=True):
    if public_read_only():
        if required:
            raise HTTPException(401, 'Saving and account access are disabled in public read-only mode.')
        return None
    secret = os.environ.get('SESSION_SECRET', '')
    trusted = bool(secret) and hmac.compare_digest(request.headers.get('x-wss-gateway', ''), secret)
    subject = request.headers.get('x-wss-user') if trusted else None
    email = request.headers.get('x-wss-email', '').strip().lower() if trusted else ''
    if not subject or email.count('@') != 1 or email.split('@')[-1] != 'worldbankgroup.org':
        if required:
            raise HTTPException(401, 'Sign in with a verified World Bank account.')
        return None
    admins = {s.strip() for s in os.environ.get('WSS_ADMIN_SUBJECTS', '').split(',') if s.strip()}
    return {'id': subject, 'email': email, 'is_admin': subject in admins}
