"""Idempotent source preservation; inserts only, never overwrites user work."""
import hashlib
import json
from pathlib import Path
from uuid import uuid5, NAMESPACE_URL
from psycopg.types.json import Jsonb
from .legacy import migrate_legacy
from .store import connect

ROOT = Path(__file__).resolve().parents[1]
FEATURED = {'Oct 12.json': ('DRC — Oct 12', 'COD'), 'Oct 13.json': ('DRC — Oct 13', 'COD'),
            'nepal_kv.json': ('Nepal — Kathmandu Valley', 'NPL')}


def import_seeds():
    from demo_adapter import frontend_defaults
    from .service import digest, model_version
    files = [(p.name, p.read_bytes()) for p in sorted((ROOT/'profiles').glob('*.json'))]
    files.append(('legacy-frontend-defaults', json.dumps(frontend_defaults(), sort_keys=True).encode()))
    with connect() as db:
        for filename, content in files:
            raw = json.loads(content)
            source_id = 'legacy-profile:' + filename
            source_hash = hashlib.sha256(content).hexdigest()
            # Source identity + hash makes changed source files separately recoverable.
            key = source_id + ':' + source_hash
            db.execute('INSERT INTO wss_sources(source_id,sha256,raw_payload) VALUES(%s,%s,%s) ON CONFLICT DO NOTHING',
                       (key, source_hash, Jsonb(raw)))
            if filename not in FEATURED:
                continue
            name, code = FEATURED[filename]
            sid = uuid5(NAMESPACE_URL, 'wss-seed:' + filename)
            if db.execute('SELECT id FROM wss_simulations WHERE id=%s', (sid,)).fetchone():
                continue
            bundle = migrate_legacy(raw)
            vid = uuid5(NAMESPACE_URL, 'wss-seed-version:' + filename)
            country = bundle['inputs']['country_config']
            db.execute("""INSERT INTO wss_simulations(id,name,country_code,country_name,area_label,
              bundle,scope,is_seed,source_id,visibility,published_version_id)
              VALUES(%s,%s,%s,%s,%s,%s,%s,true,%s,'public',%s) ON CONFLICT DO NOTHING""",
              (sid, name, code, country['country'], country.get('area',''), Jsonb(bundle), Jsonb(bundle['scope']), key, vid))
            db.execute("""INSERT INTO wss_versions(id,simulation_id,label,bundle,scope,input_hash,model_version,country_metadata)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING""",
              (vid,sid,'Preserved legacy source',Jsonb(bundle),Jsonb(bundle['scope']),digest(bundle),model_version(),
               Jsonb({'_simulation_name':name, '_country_code':code})))
