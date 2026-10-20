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
    replit = (os.environ.get('WSS_AUTH_PROVIDER') == 'replit' and
              request.headers.get('x-wss-provider') == 'replit' and
              bool(subject and subject.startswith('replit:') and len(subject) > 7))
    clerk = (os.environ.get('WSS_AUTH_PROVIDER', 'clerk') == 'clerk' and
             email.count('@') == 1 and email.split('@')[-1] == 'worldbankgroup.org')
    if not subject or not (replit or clerk):
        if required:
            raise HTTPException(401, 'Sign in with a verified World Bank account.')
        return None
    admins = {s.strip() for s in os.environ.get('WSS_ADMIN_SUBJECTS', '').split(',') if s.strip()}
    return {'id': subject, 'email': email, 'is_admin': subject in admins}
