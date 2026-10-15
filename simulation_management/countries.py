import json
import logging
from datetime import datetime, timezone, timedelta
from urllib.request import urlopen
from psycopg.types.json import Jsonb
from .store import connect


def country_metadata(force=False):
    with connect() as db:
        cached = db.execute('SELECT countries, retrieved_at FROM wss_country_cache WHERE id=1').fetchone()
    now = datetime.now(timezone.utc)
    if cached and not force and now - cached['retrieved_at'] < timedelta(days=7):
        return {**cached, 'stale': False}
    try:
        page, pages, records = 1, 1, []
        while page <= pages:
            url = f'https://api.worldbank.org/v2/country?format=json&per_page=400&page={page}'
            with urlopen(url, timeout=12) as response:
                meta, data = json.load(response)
            pages = int(meta['pages'])
            if pages > 100 or not isinstance(data, list):
                raise ValueError('Unexpected country API pagination.')
            for row in data:
                if row.get('region', {}).get('id') == 'NA' or row.get('region', {}).get('value', '').strip() == 'Aggregates':
                    continue
                records.append({key: ({'id': row[key].get('id', ''), 'value': row[key].get('value', '').strip()}
                               if key in ('region', 'incomeLevel', 'lendingType') else row.get(key))
                               for key in ('id', 'name', 'iso2Code', 'region', 'incomeLevel', 'lendingType')})
            page += 1
        records.sort(key=lambda c: c['name'])
        with connect() as db:
            db.execute("""INSERT INTO wss_country_cache(id,countries,retrieved_at) VALUES(1,%s,%s)
                ON CONFLICT(id) DO UPDATE SET countries=excluded.countries,retrieved_at=excluded.retrieved_at""",
                       (Jsonb(records), now))
        return {'countries': records, 'retrieved_at': now, 'stale': False}
    except Exception:
        logging.exception('Country metadata refresh failed')
        if cached:
            return {**cached, 'stale': True, 'error': 'World Bank metadata is temporarily unavailable; showing the last successful retrieval.'}
        return {'countries': [], 'retrieved_at': None, 'stale': True,
                'error': 'Country metadata is temporarily unavailable. Saved simulations are unaffected.'}
