import io
import csv
import os
from fastapi import FastAPI, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
import json
from model.inputs import ModelInputs, CountryConfig
from model.engine import calculate
from demo_adapter import frontend_defaults, to_engine, coerce_to_engine

app = FastAPI(title="WSS Scenarios Model API")
from model.utility_revenue import RevenueInputError, resolve_bases
from model.engine import build_context
from pydantic import ValidationError


@app.exception_handler(ValidationError)
async def invalid_model_inputs(request, exc):
    return JSONResponse(status_code=422, content={'detail': 'Invalid model inputs: ' + str(exc)})


@app.exception_handler(RevenueInputError)
async def revenue_input_error(request, exc):
    return JSONResponse(status_code=422, content={'detail': str(exc)})


@app.post("/api/revenue-bases")
def revenue_bases(inputs: dict = Body(...)):
    model = coerce_to_engine(inputs)
    return resolve_bases(model, build_context(model))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/countries")
def get_countries():
    from countries import COUNTRIES
    return COUNTRIES


@app.get("/api/defaults")
def get_defaults():
    # Frontend-shaped defaults (validated Kathmandu-Valley values). The demo UI reads this shape;
    # /api/calculate translates it to the engine via demo_adapter.to_engine.
    return frontend_defaults()


@app.get("/api/defaults/blank")
def get_blank():
    """Blank template (frontend-shaped): zero the numeric data but keep structure and labels."""
    import copy
    blank = copy.deepcopy(frontend_defaults())
    blank['country_config'].update(country='', area='', currency='USD')
    for section in ['macro', 'population', 'water_service', 'sanitation_service',
                    'water_costs', 'sanitation_costs', 'water_targets', 'sanitation_targets', 'technical']:
        for key, val in list(blank.get(section, {}).items()):
            if isinstance(val, (int, float)):
                blank[section][key] = 0
            elif isinstance(val, list):
                blank[section][key] = [0] * len(val)
    blank['bau'] = {'ws_budget_ts': [], 'san_budget_ts': [], 'ws_expend_ts': [], 'san_expend_ts': [],
                    'period_mode': 'automatic', 'period_unit_years': 5, 'investment_periods': []}
    blank['custom_interventions'] = []
    return blank


@app.get("/api/profiles")
def list_profiles():
    """List saved country profiles."""
    profiles_dir = os.path.join(os.path.dirname(__file__), "profiles")
    if not os.path.exists(profiles_dir):
        return []
    return [f.replace('.json', '') for f in os.listdir(profiles_dir) if f.endswith('.json')]


@app.get("/api/profiles/{name}")
def get_profile(name: str):
    """Load a saved country profile."""
    filepath = os.path.join(os.path.dirname(__file__), "profiles", f"{name}.json")
    if not os.path.exists(filepath):
        return {"error": "Profile not found"}
    with open(filepath) as f:
        return json.load(f)


@app.post("/api/profiles/{name}")
def save_profile(name: str, inputs: dict = Body(...)):
    """Save current (frontend-shaped) inputs as a country profile."""
    profiles_dir = os.path.join(os.path.dirname(__file__), "profiles")
    os.makedirs(profiles_dir, exist_ok=True)
    filepath = os.path.join(profiles_dir, f"{name}.json")
    with open(filepath, 'w') as f:
        json.dump(inputs, f, indent=2)
    return {"status": "saved", "name": name}


@app.delete("/api/profiles/{name}")
def delete_profile(name: str):
    """Delete a saved country profile."""
    filepath = os.path.join(os.path.dirname(__file__), "profiles", f"{name}.json")
    if os.path.exists(filepath):
        os.remove(filepath)
        return {"status": "deleted", "name": name}
    return {"error": "Profile not found"}


@app.post("/api/calculate")
def run_calculation(inputs: dict = Body(...)):
    return calculate(coerce_to_engine(inputs))


@app.post("/api/export/csv")
def export_csv(inputs: dict = Body(...)):
    # Enriched: per-year forecast for both sectors (BAU / target / with-interventions coverage, service gap,
    # investment need, and BOTH financing gaps) + the per-intervention contribution breakdown.
    from export_data import scenario_csv
    inputs.pop('_export_options', None)
    text = scenario_csv(inputs)
    return StreamingResponse(
        iter([text]),
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename="wss_results.csv"'},
    )


@app.post("/api/export/pptx")
def export_pptx(inputs: dict = Body(...)):
    from export_pptx import create_pptx
    # The Results deck export sends the on-screen chart PNGs under `_charts` (the backend can't render
    # recharts). Pull them out before running the engine so they don't reach the input coercion.
    charts = inputs.pop('_charts', None) if isinstance(inputs, dict) else None
    export_options = inputs.pop('_export_options', {}) if isinstance(inputs, dict) else {}
    contribution_view = export_options.get('contribution_view', 'individual')
    result = calculate(coerce_to_engine(inputs))
    output = create_pptx(result, inputs, charts, contribution_view=contribution_view)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.presentationml.presentation',
        headers={'Content-Disposition': 'attachment; filename="wss_scenarios.pptx"'},
    )


@app.post("/api/export/deck")
def export_deck_api(payload: dict = Body(...)):
    """Branded PowerPoint deck, built by filling the shipped .pptx template.

    Body: {"areas": {"urban": <inputs>, "rural": <inputs>, "national": <inputs>}}. Only the areas the
    user actually entered should be present — the deck drops the slides for any scope that is absent,
    and derives National by summing Urban + Rural when both are given. `inputs` alone is accepted as a
    single-area fallback so older callers keep working."""
    from export_deck import build_deck
    contribution_view = payload.pop('contribution_view', 'individual')
    if 'areas' in payload:
        # An explicit but empty `areas` is a caller bug, not a request for a default deck — falling
        # through to the single-area path here would quietly export a deck built from stock defaults.
        areas = {k: v for k, v in (payload.get('areas') or {}).items() if v}
    else:
        single = payload.get('inputs') or payload
        single.pop('_charts', None)
        single.pop('_export_options', None)
        areas = {'national': single} if single else {}
    if not areas:
        return {"error": "no area inputs supplied"}
    # One line recording which scopes the deck was built from. A deck missing a scope is almost always
    # a payload that never carried it, and that is otherwise invisible from the output alone.
    print(f"[export/deck] areas={list(areas)}", flush=True)
    out = build_deck(areas, contribution_view=contribution_view)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.presentationml.presentation',
        headers={'Content-Disposition': 'attachment; filename="wss_scenarios.pptx"'},
    )


@app.post("/api/export/xlsx")
def export_xlsx(inputs: dict = Body(...)):
    # Enriched multi-sheet workbook: per-sector forecast (incl. both financing gaps) + per-intervention breakdown.
    from export_data import scenario_xlsx
    options = inputs.pop('_export_options', {})
    out = scenario_xlsx(inputs, contribution_view=options.get('contribution_view', 'individual'))
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="wss_results.xlsx"'},
    )


@app.post("/api/export/table")
def export_table(payload: dict = Body(...)):
    """Generic table → xlsx for the per-table export buttons. Body: {filename?, sheets:[{name,headers,rows}]}."""
    from export_data import table_xlsx
    sheets = payload.get('sheets') or []
    fname = (payload.get('filename') or 'table') + '.xlsx'
    out = table_xlsx(sheets)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


@app.post("/api/export/chart")
def export_chart(payload: dict = Body(...)):
    """Generic chart → xlsx with a NATIVE, data-linked Excel chart (edit the data → the chart redraws).
    Body: {filename?, title?, sheets:[{name,headers,rows}], chartSpec:{category,stacked,areas,lines,x/yTitle}}.
    `image` is still accepted as a legacy fallback (embeds the PNG when no chartSpec is given)."""
    from export_data import chart_xlsx
    fname = (payload.get('filename') or 'chart') + '.xlsx'
    out = chart_xlsx(payload.get('title') or '', payload.get('sheets') or [],
                     payload.get('chartSpec'), payload.get('image'))
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': f'attachment; filename="{fname}"'},
    )


@app.post("/api/template/xlsx")
def template_xlsx(inputs: dict = Body(...)):
    """Download a pre-filled, colour-coded Excel template of the year-by-year input table."""
    from excel_io import build_template
    results = None
    try:
        results = calculate(coerce_to_engine(inputs))
    except Exception:
        pass  # incomplete inputs — the template still downloads, grey engine rows just stay blank
    out = build_template(inputs, results)
    return StreamingResponse(
        iter([out.getvalue()]),
        media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        headers={'Content-Disposition': 'attachment; filename="wss_input_template.xlsx"'},
    )


@app.post("/api/import/xlsx")
def import_xlsx(payload: dict = Body(...)):
    """Parse a filled template (base64-encoded xlsx) and overlay its editable cells onto the
    posted inputs. Body: { "file_b64": <str>, "inputs": <frontend-shaped dict> }.
    Returns { "inputs": <merged dict>, "cellsUpdated": <int> } or { "error": <str> }."""
    import base64
    from excel_io import parse_template
    try:
        raw = base64.b64decode(payload.get('file_b64', ''))
        merged, changed = parse_template(raw, payload.get('inputs') or {})
        return {"inputs": merged, "cellsUpdated": changed}
    except Exception as e:  # surface a readable message to the UI rather than a 500
        return {"error": str(e)}


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/bau-test")
def bau_test():
    """Minimal input-column → BAU-output test harness for the calculation engine.
    Served with no-cache headers so every refresh loads the fresh file with default inputs
    (the harness keeps no localStorage, so a reload always resets to the built-in defaults)."""
    path = os.path.join(os.path.dirname(__file__), "bau_test.html")
    return FileResponse(path, media_type="text/html", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    })


# Serve frontend static files
static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if full_path and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))
