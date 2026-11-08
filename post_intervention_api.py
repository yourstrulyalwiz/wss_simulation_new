"""Bounded request work and full-input caching for the isolated analysis."""
import copy
import hashlib
import json
import threading
from collections import OrderedDict
from fastapi import HTTPException
from model.post_intervention import analyse, METHOD

_slots = threading.BoundedSemaphore(2)
_lock = threading.Lock()
_cache = OrderedDict()


def run_analysis(payload):
    try:
        raw = json.dumps(payload, sort_keys=True, separators=(',', ':'), allow_nan=False)
    except (ValueError, TypeError):
        raise HTTPException(422, {'code': 'invalid_inputs', 'message': 'Analysis inputs must be finite JSON values.'})
    if len(raw) > 2_000_000:
        raise HTTPException(413, 'Analysis request exceeds the size limit.')
    key = hashlib.sha256((METHOD+raw).encode()).hexdigest()
    with _lock:
        if key in _cache:
            _cache.move_to_end(key)
            return copy.deepcopy(_cache[key])
    if not _slots.acquire(blocking=False):
        raise HTTPException(503, 'Analysis capacity is busy. Please retry shortly.', headers={'Retry-After': '3'})
    try:
        try:
            result = analyse(payload)
        except (ValueError, TypeError, KeyError) as exc:
            raise HTTPException(422, {'code': 'invalid_inputs', 'message': str(exc)})
        # Runtime-limited results must remain retryable, not permanently cached.
        if result['combined']['complete']:
            with _lock:
                _cache[key] = copy.deepcopy(result)
                while len(_cache) > 12:
                    _cache.popitem(last=False)
        return result
    finally:
        _slots.release()
