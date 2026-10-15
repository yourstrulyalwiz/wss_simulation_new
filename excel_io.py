"""
Excel round-trip for the year-by-year Data Inputs sections (2b service levels, 2c economic &
demographic, 2d budget). One workbook covers all three.

`build_template(fe, results)` writes a workbook that mirrors the InputPanel rows row-for-row:
service levels first, then Economic & demographic data, then Budget, with the same colour language
as the UI — cream = historical input, blue = forecast input (blank = auto-fill), grey = engine-
calculated. When an engine `results` dict is supplied, the grey "→ … used" rows and the locked
historical service-level cells are pre-filled with the values the model actually uses.
`parse_template(bytes, fe)` reads a filled workbook back and overlays ONLY the editable cells onto
the current frontend-shaped inputs, returning the merged dict + a count of cells updated.

Both share `_layout()` / `_editable()` so the writer and the parser can never disagree about which
cell is which, or which cells are inputs vs engine-derived. Values are stored in MODEL units
(fractions for %); percentage cells just carry an Excel number-format so the user sees "5.00%".

Editable windows (by year, matching InputPanel.tsx):
  * real GDP / population / households / budget overrides : ALL years — historical actuals are
    required, forecast cells are optional (blank = auto-fill from the yearly growth rate, or the
    new-service-cost-derived budget)
  * service-level shares : start year + baseline year (historical), plus any forecast year — a
    forecast column (all 5 rungs summing to 100%) makes that year a 🎯 target
Everything else in the table is an engine projection and is written grey.
"""
import io
import copy
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

EDIT_FILL = PatternFill('solid', fgColor='FFF9E6')   # cream  — historical input, fill me
FCST_FILL = PatternFill('solid', fgColor='EFF6FF')   # blue   — forecast input, blank = auto-fill
LOCK_FILL = PatternFill('solid', fgColor='F1F3F5')   # grey   — engine-calculated, leave alone
SECT_FILL = PatternFill('solid', fgColor='E0E7FF')   # indigo — section band (matches the UI)
HEAD_FILL = PatternFill('solid', fgColor='1E3A5F')   # header band
TGT_FILL = PatternFill('solid', fgColor='16A34A')    # green  — target-year column header
HEADER_ROW = 6
GREY_FONT = Font(color='94A3B8', size=9, italic=True)


def _layout(fe):
    """Ordered display rows mirroring the InputPanel 2b table exactly. Items are tuples:

      ('section', label)                                         — indigo band row
      ('input', key, label, section, field, kind, numfmt)        — editable series row
      ('calc', label, calckey, numfmt)                           — grey engine-computed row

    kinds: 'proj' = editable all years, blank = auto-fill from the yearly growth rate;
           'ovr'  = editable all years, blank = model-computed budget (override semantics);
           'svc_tgt' = start & baseline years + any forecast year (full column = target)."""
    cc = fe.get('country_config', {}) or {}
    ws_names = [cc.get(f'ws_serv{i+1}_name') or f'Level {i+1}' for i in range(5)]
    sn_names = [cc.get(f'san_serv{i+1}_name') or f'Level {i+1}' for i in range(5)]
    cur = cc.get('currency', 'LCU')
    scope = (cc.get('area') or '').strip().capitalize() or 'Area'
    items = [
        ('section', 'Service levels: Water supply (% HH). Fill a forecast column (all 5 rungs add up to 100%) to set a target year'),
    ]
    for i in range(5):
        items.append(('input', f'water_service.serv{i+1}_ts', f'% {ws_names[i]}',
                      'water_service', f'serv{i+1}_ts', 'svc_tgt', '0.00%'))
    items.append(('section', 'Service levels: Sanitation (% HH). Fill a forecast column (all 5 rungs add up to 100%) to set a target year'))
    for i in range(5):
        items.append(('input', f'sanitation_service.sserv{i+1}_ts', f'% {sn_names[i]}',
                      'sanitation_service', f'sserv{i+1}_ts', 'svc_tgt', '0.00%'))
    items += [
        ('section', 'Economic & demographic data'),
        ('input', 'macro.gdp_real_local', f'Real GDP ({cur} millions)', 'macro', 'gdp_real_local', 'proj', '#,##0'),
        ('calc', f'→ Real GDP used ({cur} millions)', 'gdp_used', '#,##0'),
        ('calc', 'GDP growth %', 'gdp_growth', '0.0%'),
        ('input', 'population.pop_ts', f'{scope} population (millions)', 'population', 'pop_ts', 'proj', '#,##0.000000'),
        ('calc', '→ Population used (millions)', 'pop_used', '#,##0.000'),
        ('calc', 'Pop growth %', 'pop_growth', '0.0%'),
        ('input', 'population.hh_ts', f'{scope} households (millions)', 'population', 'hh_ts', 'proj', '#,##0.000000'),
        ('calc', '→ Households used (millions)', 'hh_used', '#,##0.000'),
        ('calc', 'Avg HH size', 'hh_size', '0.00'),
        ('section', f'Budget ({cur} millions, real / baseline prices): executed budget = cost of new service; allocated budget = the budget on paper (normally larger). Fill any cell to override'),
        ('input', 'bau.ws_expend_ts', 'WS executed budget — override', 'bau', 'ws_expend_ts', 'ovr', '#,##0.00'),
        ('calc', '→ WS executed budget', 'ws_budget_used', '#,##0'),
        ('input', 'bau.ws_alloc_ts', 'WS allocated budget — override', 'bau', 'ws_alloc_ts', 'ovr', '#,##0.00'),
        ('calc', '→ WS allocated budget', 'ws_budget_alloc', '#,##0'),
        ('input', 'bau.san_expend_ts', 'SAN executed budget — override', 'bau', 'san_expend_ts', 'ovr', '#,##0.00'),
        ('calc', '→ SAN executed budget', 'san_budget_used', '#,##0'),
        ('input', 'bau.san_alloc_ts', 'SAN allocated budget — override', 'bau', 'san_alloc_ts', 'ovr', '#,##0.00'),
        ('calc', '→ SAN allocated budget', 'san_budget_alloc', '#,##0'),
    ]
    sectors = fe.get('calculation_scope', ['water', 'sanitation'])
    def selected(item):
        if item[0] == 'section':
            label = item[1].lower()
            return not (('water supply' in label and 'water' not in sectors) or ('sanitation' in label and 'sanitation' not in sectors))
        if item[0] != 'input':
            return True
        key = item[1]
        return not ((key.startswith('water_') or '.ws_' in key) and 'water' not in sectors or
                    (key.startswith('sanitation_') or '.san_' in key) and 'sanitation' not in sectors)
    return [item for item in items if selected(item)]


def _editable(kind, i, bi):
    """Is column index i (year offset from model start) an editable INPUT for this row kind?"""
    if kind in ('proj', 'ovr'):
        return True               # all years — historical actuals + forecast projections / overrides
    if kind == 'svc_tgt':
        return True  # test2: every historical year is editable now, plus forecast target columns
    return False


def _span(fe):
    per = fe.get('period', {}) or {}
    start = int(per.get('model_start_year', 2011))
    baseline = int(per.get('baseline_year', 2025))
    end = int(per.get('forecast_end_year', 2040))
    if end < start:
        end = start
    end = min(end, start + 119)   # 120-column cap, mirroring the UI table (a half-typed year can't explode the sheet)
    return start, baseline, end, baseline - start


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _calc_rows(results, n):
    """Grey display series: the values the model actually uses (from an engine run), matching the
    UI's '→ … used' / growth / avg-HH-size rows. Returns {} when no results are available."""
    if not results:
        return {}

    def arr(x):
        x = x or []
        return [_num(x[i]) if i < len(x) else None for i in range(n)]

    def growth(s):
        return [None] + [(s[i] / s[i - 1] - 1) if (s[i] and s[i - 1]) else None for i in range(1, n)]

    gdp = arr(results.get('gdp_real_local'))
    pop = arr(results.get('population'))
    hh = arr(results.get('total_hh'))
    return {
        'gdp_used': gdp, 'gdp_growth': growth(gdp),
        'pop_used': pop, 'pop_growth': growth(pop),
        'hh_used': hh,
        'hh_size': [(pop[i] / hh[i]) if (pop[i] and hh[i]) else None for i in range(n)],
        'ws_budget_used': arr((results.get('water_supply') or {}).get('budget_executed_input_basis')),
        'ws_budget_alloc': arr((results.get('water_supply') or {}).get('budget_allocated_input_basis')),
        'san_budget_used': arr((results.get('sanitation') or {}).get('budget_executed_input_basis')),
        'san_budget_alloc': arr((results.get('sanitation') or {}).get('budget_allocated_input_basis')),
    }


def build_template(fe: dict, results: dict = None) -> io.BytesIO:
    start, baseline, end, bi = _span(fe)
    years = list(range(start, end + 1))
    n = len(years)
    items = _layout(fe)
    cc = fe.get('country_config', {}) or {}
    calc = _calc_rows(results, n)

    # Historical service-level path from the engine (BAU household counts ÷ total households) — the
    # grey display values for the locked in-between years, same numbers the UI table shows.
    def svc_hist(section, field, i):
        if not results:
            return None
        seckey = 'water_supply' if section == 'water_service' else 'sanitation'
        rung = int(''.join(ch for ch in field if ch.isdigit()) or 1) - 1
        try:
            count = _num(results[seckey]['bau_hh_serv'][rung][i])
            total = _num(results['total_hh'][i])
            return count / total if count is not None and total else None
        except (KeyError, IndexError, TypeError):
            return None

    # A forecast column is a 🎯 target year when its 5 rung shares sum to ~100% (matches the UI).
    def col_is_target(i):
        for section, prefix in (('water_service', 'serv'), ('sanitation_service', 'sserv')):
            s = 0.0
            for k in range(1, 6):
                a = (fe.get(section, {}) or {}).get(f'{prefix}{k}_ts', []) or []
                v = _num(a[i]) if i < len(a) else None
                if v and v > 0:
                    s += v
            if abs(s - 1) < 0.02:
                return True
        return False

    wb = Workbook()
    ws = wb.active
    ws.title = 'WSS Inputs'

    ws['B1'] = 'WSS year-by-year data — input template'
    ws['B1'].font = Font(bold=True, size=14, color='1E3A5F')
    ws['B2'] = (f"{cc.get('country', '')} — {cc.get('area', '')}   |   currency: {cc.get('currency', 'LCU')}"
                f"   |   budget basis: WS {'total' if fe.get('macro', {}).get('ws_budget_is_total_spending') else 'capital'}; SAN {'total' if fe.get('macro', {}).get('san_budget_is_total_spending') else 'capital'}")
    ws['B2'].font = Font(color='475569')
    ws['B3'] = ('Fill the CREAM cells (historical) and, optionally, the BLUE cells (forecast). Leave a blue cell '
                'blank to fill it in from the yearly growth rate, or the model-computed budget. Grey cells are '
                'auto-calculated, so leave them alone. For service levels, fill a forecast column '
                '(all 5 rungs add up to 100%) to set a target year (green column header). Enter percentages as shown (e.g. 5.00%). '
                'Budget rows: blank means missing/calculated; zero is an entered observation. Budget forecasts use a three-year GDP-share seed, then two-year moving averages. Other rows retain their existing blank/zero conventions.')
    ws['B3'].font = Font(italic=True, color='B45309')
    # Hidden span stamp (col A is hidden): the parser refuses a file whose analysis period no longer
    # matches the inputs — the grey engine-path cells would otherwise land in the wrong years.
    ws['A2'] = f'span:{start}:{baseline}:{end}'
    # Colour legend swatches
    legend = [(3, EDIT_FILL, 'Historical input'), (7, FCST_FILL, 'Forecast (blank = auto-fill)'),
              (12, LOCK_FILL, 'Auto-calculated'), (16, TGT_FILL, '🎯 Target-year column')]
    for col, fill, label in legend:
        ws.cell(4, col).fill = fill
        lc = ws.cell(4, col + 1, label)
        lc.font = Font(size=9, color='475569')

    ws.cell(HEADER_ROW, 1, 'key')
    hb = ws.cell(HEADER_ROW, 2, 'Indicator')
    hb.font = Font(bold=True, color='FFFFFF'); hb.fill = HEAD_FILL
    for c, yr in enumerate(years):
        hc = ws.cell(HEADER_ROW, 3 + c, yr)   # value stays a pure int — the parser reads it back
        if c > bi and col_is_target(c):
            hc.fill = TGT_FILL; hc.font = Font(bold=True, color='FFFFFF')
        elif c > bi:
            hc.fill = HEAD_FILL; hc.font = Font(bold=True, color='FBBF24')   # amber = forecast year
        else:
            hc.fill = HEAD_FILL; hc.font = Font(bold=True, color='FFFFFF')
        hc.alignment = Alignment(horizontal='center')

    last_col = 2 + n
    r = HEADER_ROW + 1
    for item in items:
        if item[0] == 'section':
            for c in range(1, last_col + 1):
                ws.cell(r, c).fill = SECT_FILL
            sc = ws.cell(r, 2, item[1])
            sc.font = Font(bold=True, size=10, color='312E81')
            ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=last_col)
        elif item[0] == 'calc':
            _t, label, calckey, numfmt = item
            lc = ws.cell(r, 2, label)
            lc.font = GREY_FONT
            series = calc.get(calckey)
            for i in range(n):
                cell = ws.cell(r, 3 + i)
                cell.fill = LOCK_FILL
                v = series[i] if series else None
                if v is not None:
                    cell.value = v
                    cell.number_format = numfmt
                    cell.font = GREY_FONT
        else:
            _t, key, label, section, field, kind, numfmt = item
            ws.cell(r, 1, key)
            lc = ws.cell(r, 2, label)
            lc.font = Font(bold=True, color='1E3A5F')
            arr = (fe.get(section, {}) or {}).get(field, []) or []
            for i in range(n):
                cell = ws.cell(r, 3 + i)
                if _editable(kind, i, bi):
                    v = _num(arr[i]) if i < len(arr) else None
                    # Match the UI's blank-when-unset display: zeros mean "not entered" for the
                    # all-year rows and for forecast target cells; start/baseline svc cells show 0.
                    if v is not None and (v > 0 or kind == 'ovr' or (kind == 'svc_tgt' and i <= bi)):
                        cell.value = v
                    cell.fill = FCST_FILL if i > bi else EDIT_FILL
                    cell.number_format = numfmt
                else:
                    cell.fill = LOCK_FILL
                    v = svc_hist(section, field, i) if kind == 'svc_tgt' else None
                    if v is not None:
                        cell.value = v
                        cell.number_format = numfmt
                        cell.font = GREY_FONT
        r += 1

    ws.column_dimensions['A'].hidden = True     # machine key column, hidden from the user
    ws.column_dimensions['B'].width = 36
    for c in range(n):
        ws.column_dimensions[get_column_letter(3 + c)].width = 11
    ws.freeze_panes = f'C{HEADER_ROW + 1}'      # a plain coordinate — row 7 starts with a MergedCell

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return out


def parse_template(file_bytes: bytes, fe: dict):
    """Overlay the filled template's editable cells onto `fe`. Returns (merged_inputs, cells_updated).
    Rows are matched by the hidden key column, so section bands, grey calc rows and row order are
    all irrelevant to the parser — older templates with the same keys still import cleanly."""
    merged = copy.deepcopy(fe)
    start, baseline, end, bi = _span(merged)
    n = end - start + 1
    keymap = {it[1]: (it[3], it[4], it[5]) for it in _layout(merged) if it[0] == 'input'}

    wb = load_workbook(io.BytesIO(file_bytes), data_only=True)
    ws = wb['WSS Inputs'] if 'WSS Inputs' in wb.sheetnames else wb.active

    # Locate the header row (col B == 'Indicator'), then map each year to its column.
    header_row = None
    for rr in range(1, min(ws.max_row, 40) + 1):
        if str(ws.cell(rr, 2).value).strip().lower() == 'indicator':
            header_row = rr
            break
    if header_row is None:
        raise ValueError('Could not find the template header row (expected an "Indicator" column). '
                         'Please upload the file downloaded from this tool, unmodified in structure.')

    # Span stamp check: the editable windows (and the grey engine-path cells) are positioned by the
    # analysis period the file was BUILT with. If start/baseline moved since the download, importing
    # would misread grey display cells as inputs — refuse with a readable message instead. Older
    # templates carry no stamp; they are safe because their locked cells were written blank.
    for rr in range(1, header_row):
        sv = ws.cell(rr, 1).value
        if isinstance(sv, str) and sv.startswith('span:'):
            try:
                f_start, f_baseline, _f_end = (int(x) for x in sv.split(':')[1:4])
            except (ValueError, IndexError):
                break
            if f_start != start or f_baseline != baseline:
                raise ValueError(
                    f'This template was built for an analysis period starting {f_start} with baseline '
                    f'{f_baseline}, but the current inputs use start {start} / baseline {baseline}. '
                    'Download a fresh template for the new analysis period and refill it.')
            break

    year_col = {}
    for cc in range(3, ws.max_column + 1):
        v = ws.cell(header_row, cc).value
        try:
            year_col[int(v)] = cc
        except (TypeError, ValueError):
            continue

    changed = 0
    for rr in range(header_row + 1, ws.max_row + 1):
        key = ws.cell(rr, 1).value
        if key not in keymap:
            continue
        section, field, kind = keymap[key]
        arr = list((merged.get(section, {}) or {}).get(field, []) or [])
        for i in range(n):
            if not _editable(kind, i, bi):
                continue
            col = year_col.get(start + i)
            if not col:
                continue
            v = ws.cell(rr, col).value
            if v is None or v == '' or isinstance(v, bool):
                if kind == 'ovr':
                    while len(arr) <= i:
                        arr.append(None)
                    if arr[i] is not None:
                        changed += 1
                    arr[i] = None
                continue                       # blank = keep the existing value (auto-fill from the yearly growth rate)
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if fv < 0:
                continue                       # no negative shares / GDP / population / budgets
            if kind == 'svc_tgt' and fv > 1.5:
                if fv > 100:
                    continue                   # garbage — not a share in any unit
                fv /= 100                      # pasted-as-plain-number percent (85 meaning 85%)
            while len(arr) <= i:               # grow to reach forecast years the user filled in
                arr.append(None if kind == 'ovr' else 0)
            if abs(fv - (arr[i] or 0)) > 1e-12:
                changed += 1                   # count real changes only, not pre-filled echoes
            arr[i] = fv
        merged.setdefault(section, {})[field] = arr

    return merged, changed
