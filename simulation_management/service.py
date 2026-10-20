import copy
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from uuid import UUID
from fastapi import HTTPException
from psycopg.types.json import Jsonb
from simulation_scope import normalize_scope, active_areas, public_bundle
from .blank import blank_inputs
from .access import public_read_only


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


@lru_cache(maxsize=1)
def model_version():
    root = Path(__file__).resolve().parents[1]
    hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
              for p in sorted((root/'model').glob('*.py'))}
    hashes['demo_adapter.py'] = hashlib.sha256((root/'demo_adapter.py').read_bytes()).hexdigest()
    return digest(hashes)


def uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(404, 'Simulation or version not found.')


def get_record(db, sid, user, write=False, lock=False):
    row = db.execute('SELECT * FROM wss_simulations WHERE id=%s' + (' FOR UPDATE' if lock else ''), (uuid(sid),)).fetchone()
    owner = bool(row and user and row['owner_id'] == user['id'])
    admin = bool(user and user['is_admin'])
    published = bool(row and row['visibility'] == 'public' and row['published_version_id'] and not row['archived_at'])
    can_read = row and (owner or admin or
                       (row['is_seed'] and not row['archived_at'] and row['published_version_id']) or
                       ((user or public_read_only()) and published))
    if not can_read:
        raise HTTPException(404, 'Simulation not found.')
    if write and (not owner or row['is_seed']):
        raise HTTPException(403, 'Only the owner can edit this simulation.')
    return row


def check_revision(row, payload):
    if type(payload.get('revision')) is not int or payload['revision'] != row['revision']:
        raise HTTPException(409, {'message': 'This simulation changed in another session. Your draft has not overwritten it.',
                                  'current_revision': row['revision']})


def view_record(db, row, user, detail=True):
    owner = bool(user and row['owner_id'] == user['id'])
    admin = bool(user and user['is_admin'])
    bundle, scenarios, location = row['bundle'], row['scenarios'], row['location']
    name, updated, metadata = row['name'], row['updated_at'], row['country_metadata']
    if not owner and not admin:
        version = db.execute('SELECT * FROM wss_versions WHERE id=%s AND simulation_id=%s',
                             (row['published_version_id'], row['id'])).fetchone()
        if not version:
            raise HTTPException(404, 'No published version is available.')
        bundle, scenarios, location = public_bundle(version['bundle']), [], {}
        metadata, updated = version['country_metadata'], version['created_at']
        name = metadata.get('_simulation_name', row['name'])
    config = bundle['inputs'].get('country_config', {})
    result = {k: row[k] for k in ('id','visibility','status','revision','is_seed','archived_at','published_version_id')}
    result.update(name=name, country_code=metadata.get('_country_code', row['country_code']),
                  country_name=config.get('country', row['country_name']), area_label=config.get('area',''),
                  scope=bundle['scope'], country_metadata=metadata, updated_at=updated,
                  is_owner=owner, read_only=not owner or row['is_seed'],
                  period=bundle['inputs'].get('period', {}),
                  notice=bundle['inputs'].get('profile_metadata', {}).get('notice') or
                    ('Illustrative mock simulation — not validated DRC costing or utility data.' if config.get('currency') == 'CDF' and
                     bundle['inputs'].get('profile_metadata',{}).get('status') == 'mock_simulation' else ''))
    if not owner and not admin:
        result['status'] = 'calculated' if version['results'] else 'draft'
        result['revision'] = None
    if detail:
        result.update(bundle=bundle, scenarios=scenarios, location=location)
    return result


def prepare_bundle(bundle, scope=None):
    if not isinstance(bundle, dict) or not isinstance(bundle.get('inputs'), dict):
        raise HTTPException(422, 'A complete area bundle is required.')
    bundle = copy.deepcopy(bundle)
    prior_scope = normalize_scope(bundle.get('scope'))
    try:
        bundle['scope'] = normalize_scope(scope if scope is not None else bundle.get('scope'))
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    bundle['__wss_bundle'] = 1
    alt = bundle.setdefault('altInputs', {})
    for area in ('rural', 'national'):
        if area not in alt and (bundle['scope']['areaRural'] if area == 'rural' else bundle['scope']['scopeMode'] == 'national'):
            was_primary = (area == 'rural' and prior_scope['scopeMode'] == 'urban_rural'
                           and prior_scope['areaRural'] and not prior_scope['areaUrban']) or (
                           area == 'national' and prior_scope['scopeMode'] == 'national')
            alt[area] = copy.deepcopy(bundle['inputs']) if was_primary else blank_inputs(shared=bundle['inputs'])
    # Dispatch metadata is derived from authoritative scope, not client area flags.
    for value in [bundle['inputs'], *alt.values()]:
        value['calculation_scope'] = bundle['scope']['sectors']
    digest(bundle)  # Reject non-JSON/nonfinite values, but allow incomplete nulls.
    return bundle


def save_user(db, user):
    db.execute("""INSERT INTO wss_users(id,email) VALUES(%s,%s)
      ON CONFLICT(id) DO UPDATE SET email=excluded.email,last_seen=now()""", (user['id'],user['email']))
