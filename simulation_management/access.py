"""Explicit, reversible public-viewing mode; never grants a user identity."""
import os


def public_read_only():
    return os.environ.get('WSS_PUBLIC_READ_ONLY', '').lower() == 'true'
