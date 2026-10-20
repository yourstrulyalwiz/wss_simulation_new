import copy
from uuid import uuid4
import os
from fastapi import APIRouter, Request, Body, HTTPException
from psycopg.types.json import Jsonb
from .identity import identity
from .access import public_read_only
from .store import connect
from .countries import country_metadata
from .blank import blank_inputs
from .legacy import migrate_legacy
from .service import get_record, view_record, check_revision, prepare_bundle, save_user, digest, model_version, uuid
from simulation_scope import normalize_scope, active_areas, public_bundle

router = APIRouter()

@router.get('/api/access-mode')
def access_mode():
    return {'public_read_only': public_read_only(),
            'auth_provider': 'public' if public_read_only() else os.environ.get('WSS_AUTH_PROVIDER', 'clerk')}


@router.get('/api/session')
def session_identity(request: Request):
    user = identity(request, required=False)
    if user:
        with connect() as db:
            save_user(db, user)
    return {'user': user}


@router.get('/api/me')
def me(request: Request):
    user = identity(request)
    with connect() as db:
        save_user(db, user)
    return user


@router.get('/api/country-metadata')
def countries():
    return country_metadata()


@router.get('/api/simulations')
def list_simulations(request: Request, collection: str = 'examples', q: str = '', country: str = '',
                     region: str = '', income: str = '', lending: str = '', sector: str = '',
                     geography: str = '', visibility: str = '', status: str = '', page: int = 1):
    user = identity(request, required=not (collection == 'examples' or
                                         (public_read_only() and collection == 'public')))
    if collection not in ('examples','mine','public','archived','all'):
        raise HTTPException(422, 'Unknown simulation collection.')
    if collection == 'all' and not user['is_admin']:
        raise HTTPException(403, 'Administrator access required.')
    subject = user['id'] if user else ''
    admin = bool(user and user['is_admin'])
    latest_metadata = {c['id']: c for c in country_metadata()['countries']}
    with connect() as db:
        # Permissions precede searching, filtering, counts and pagination.
        rows = db.execute("""SELECT * FROM wss_simulations WHERE
          (is_seed AND published_version_id IS NOT NULL AND archived_at IS NULL) OR owner_id=%s OR %s OR
          (%s AND visibility='public' AND published_version_id IS NOT NULL AND archived_at IS NULL)
          ORDER BY updated_at DESC""", (subject,admin,bool(user) or public_read_only())).fetchall()
        cards = []
        for row in rows:
            if collection == 'examples' and not row['is_seed']:
                continue
            if collection == 'mine' and (row['owner_id'] != subject or row['archived_at']):
                continue
            if collection == 'archived' and (not row['archived_at'] or not (admin or row['owner_id'] == subject)):
                continue
            if collection == 'public' and (row['visibility'] != 'public' or row['archived_at']):
                continue
            card = view_record(db, row, user, detail=False)
            card['country_metadata'] = latest_metadata.get(card['country_code'], card['country_metadata'])
            meta, scope = card['country_metadata'], card['scope']
            searchable = ' '.join(str(card.get(k,'')) for k in ('name','country_name','country_code','area_label')).casefold()
            geo = 'national' if scope['scopeMode'] == 'national' else 'both' if scope['areaUrban'] and scope['areaRural'] else 'urban' if scope['areaUrban'] else 'rural'
            if q.casefold() not in searchable or (country and country != card['country_code']):
                continue
            if any(value and value not in (meta.get(key,{}).get('id'), meta.get(key,{}).get('value'))
                   for value, key in [(region,'region'),(income,'incomeLevel'),(lending,'lendingType')]):
                continue
            if sector and sector not in scope['sectors'] or geography and geography != geo:
                continue
            if visibility and visibility != card['visibility'] or status and status != card['status']:
                continue
            cards.append(card)
        cards.sort(key=lambda c: c['updated_at'], reverse=True)
        page = max(1,page)
        return {'items':cards[(page-1)*24:page*24], 'total':len(cards), 'page':page}


def insert_project(db, user, name, code, metadata, bundle, scenarios=None):
    name = str(name).strip()
    if not name or len(name) > 200:
        raise HTTPException(422, 'Enter a simulation name of 1–200 characters.')
    save_user(db, user)
    sid = uuid4()
    config = bundle['inputs'].get('country_config', {})
    db.execute("""INSERT INTO wss_simulations(id,owner_id,name,country_code,country_name,area_label,
      bundle,scope,country_metadata,scenarios) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
      (sid,user['id'],name,code,config.get('country',''),config.get('area',''),Jsonb(bundle),Jsonb(bundle['scope']),
       Jsonb(metadata),Jsonb(scenarios or [])))
    return view_record(db,get_record(db,sid,user),user)


@router.post('/api/simulations')
def create_simulation(request: Request, payload: dict = Body(...)):
    user = identity(request)
    metadata = next((c for c in country_metadata()['countries'] if c['id'] == payload.get('country_code')), None)
    if metadata is None:
        raise HTTPException(422, 'Select an available World Bank country.')
    bundle = prepare_bundle({'inputs':blank_inputs(metadata,str(payload.get('area_label',''))),
                             'scope':payload.get('scope',{}), 'altInputs':{}})
    with connect() as db:
        return insert_project(db,user,payload.get('name',''),metadata['id'],metadata,bundle)


@router.post('/api/simulations/import')
def import_simulation(request: Request, payload: dict = Body(...)):
    user = identity(request)
    bundle = prepare_bundle(migrate_legacy(payload.get('bundle') or {}))
    country = bundle['inputs'].get('country_config',{}).get('country','')
    metadata = next((c for c in country_metadata()['countries'] if c['name'] == country), {})
    with connect() as db:
        return insert_project(db,user,payload.get('name','Recovered simulation'),metadata.get('id',''),metadata,
                              bundle,payload.get('scenarios',[]))


@router.get('/api/simulations/{sid}')
def get_simulation(sid: str, request: Request):
    user = identity(request, required=False)
    with connect() as db:
        return view_record(db,get_record(db,sid,user),user)


@router.patch('/api/simulations/{sid}')
def update_simulation(sid: str, request: Request, payload: dict = Body(...)):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user,write=True,lock=True)
        check_revision(row,payload)
        bundle = prepare_bundle(payload.get('bundle',row['bundle']),payload.get('scope'))
        old_config = row['bundle']['inputs'].get('country_config', {})
        for area in [bundle['inputs'], *bundle.get('altInputs',{}).values()]:
            if area.get('country_config',{}).get('country') != old_config.get('country'):
                raise HTTPException(422, 'Create a new simulation to change the country; existing observations cannot be relabeled.')
        name = str(payload.get('name',row['name'])).strip()
        if not name or len(name) > 200:
            raise HTTPException(422,'Enter a simulation name of 1–200 characters.')
        if 'archived' in payload and type(payload['archived']) is not bool:
            raise HTTPException(422,'Archived must be a boolean.')
        db.execute("""UPDATE wss_simulations SET bundle=%s,scope=%s,name=%s,area_label=%s,scenarios=%s,location=%s,
          revision=revision+1,updated_at=now(),status=CASE WHEN bundle=%s THEN status ELSE 'draft' END,
          archived_at=CASE WHEN %s THEN COALESCE(archived_at,now()) ELSE NULL END WHERE id=%s""",
          (Jsonb(bundle),Jsonb(bundle['scope']),name,bundle['inputs'].get('country_config',{}).get('area',''),
           Jsonb(payload.get('scenarios',row['scenarios'])),Jsonb(payload.get('location',row['location'])),
           Jsonb(bundle),payload.get('archived',bool(row['archived_at'])),row['id']))
        return view_record(db,get_record(db,sid,user),user)


@router.post('/api/simulations/{sid}/duplicate')
def duplicate(sid: str, request: Request, payload: dict = Body(default={})):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user)
        visible = view_record(db,row,user)
        return insert_project(db,user,payload.get('name') or visible['name']+' — copy',visible['country_code'],
                              visible['country_metadata'],prepare_bundle(visible['bundle']),visible['scenarios'])


def history_row(db, sid, user, lock=False):
    row = get_record(db,sid,user,lock=lock)
    if row['owner_id'] != user['id'] and not user['is_admin']:
        raise HTTPException(403,'Only owners and administrators can view unpublished history.')
    return row


@router.get('/api/simulations/{sid}/versions')
def versions(sid: str, request: Request):
    user = identity(request)
    with connect() as db:
        history_row(db,sid,user)
        return db.execute("""SELECT id,label,created_at,input_hash,model_version,(results IS NOT NULL) AS has_results
           FROM wss_versions WHERE simulation_id=%s ORDER BY created_at DESC""",(uuid(sid),)).fetchall()


@router.get('/api/simulations/{sid}/versions/{vid}')
def version_detail(sid: str, vid: str, request: Request):
    user = identity(request)
    with connect() as db:
        history_row(db,sid,user)
        version = db.execute('SELECT * FROM wss_versions WHERE id=%s AND simulation_id=%s',(uuid(vid),uuid(sid))).fetchone()
        if not version:
            raise HTTPException(404,'Version not found.')
        return version


def calculate_bundle(bundle):
    from demo_adapter import coerce_to_engine
    from model.engine import calculate
    return {area:calculate(coerce_to_engine({**inputs,'calculation_scope':bundle['scope']['sectors']}),allow_partial=True)
            for area,inputs in active_areas(bundle).items()}


@router.post('/api/simulations/{sid}/versions')
def save_version(sid: str, request: Request, payload: dict = Body(...)):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user,write=True,lock=True)
        check_revision(row,payload)
        results = None
        try:
            candidate = calculate_bundle(row['bundle'])
            if all(not r.get('sector_errors') for r in candidate.values()):
                results = candidate
        except (ValueError, TypeError):
            pass  # Checkpointing incomplete drafts never requires successful calculations.
        vid = uuid4()
        metadata = {**row['country_metadata'],'_simulation_name':row['name'],'_country_code':row['country_code']}
        result = db.execute("""INSERT INTO wss_versions(id,simulation_id,label,bundle,scope,scenarios,country_metadata,
            input_hash,model_version,results) VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            RETURNING id,label,created_at,input_hash,model_version""",
            (vid,row['id'],str(payload.get('label','Saved version'))[:200],Jsonb(row['bundle']),Jsonb(row['scope']),
             Jsonb(row['scenarios']),Jsonb(metadata),digest(row['bundle']),model_version(),Jsonb(results) if results else None)).fetchone()
        if results:
            db.execute("UPDATE wss_simulations SET status='calculated' WHERE id=%s",(row['id'],))
        return result


@router.post('/api/simulations/{sid}/restore')
def restore(sid: str, request: Request, payload: dict = Body(...)):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user,write=True,lock=True)
        check_revision(row,payload)
        version = db.execute('SELECT * FROM wss_versions WHERE id=%s AND simulation_id=%s',
                             (uuid(payload.get('version_id')),row['id'])).fetchone()
        if not version:
            raise HTTPException(404,'Version not found.')
        db.execute("""UPDATE wss_simulations SET bundle=%s,scope=%s,scenarios=%s,revision=revision+1,
          updated_at=now(),status='draft',location='{}' WHERE id=%s""",
          (Jsonb(version['bundle']),Jsonb(version['scope']),Jsonb(version['scenarios']),row['id']))
        return view_record(db,get_record(db,sid,user),user)


@router.post('/api/simulations/{sid}/publish')
def publish(sid: str, request: Request, payload: dict = Body(...)):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user,write=True,lock=True)
        check_revision(row,payload)
        version = db.execute('SELECT id FROM wss_versions WHERE id=%s AND simulation_id=%s',
                             (uuid(payload.get('version_id')),row['id'])).fetchone()
        if not version:
            raise HTTPException(404,'Select a saved version belonging to this simulation.')
        db.execute("""UPDATE wss_simulations SET visibility='public',published_version_id=%s,
             revision=revision+1,updated_at=now() WHERE id=%s""",(version['id'],row['id']))
        return view_record(db,get_record(db,sid,user),user)


@router.post('/api/simulations/{sid}/unpublish')
def unpublish(sid: str, request: Request, payload: dict = Body(...)):
    user = identity(request)
    with connect() as db:
        row = get_record(db,sid,user,write=True,lock=True)
        check_revision(row,payload)
        db.execute("""UPDATE wss_simulations SET visibility='private',published_version_id=NULL,
            revision=revision+1,updated_at=now() WHERE id=%s""",(row['id'],))
        return view_record(db,get_record(db,sid,user),user)


@router.post('/api/simulations/{sid}/calculate')
def project_calculation(sid: str, request: Request):
    user = identity(request,required=False)
    with connect() as db:
        visible = view_record(db,get_record(db,sid,user),user)
    return {'results':calculate_bundle(visible['bundle']),'input_hash':digest(visible['bundle']),
            'model_version':model_version(), 'notice':'Calculated with the current engine.'}


@router.get('/api/simulations/{sid}/export')
def project_export(sid: str, request: Request):
    user = identity(request,required=False)
    with connect() as db:
        visible = view_record(db,get_record(db,sid,user),user)
    return {'schema_version':1,'name':visible['name'],'bundle':visible['bundle'],'scenarios':visible['scenarios']}
