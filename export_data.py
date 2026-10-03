"""Export helpers: enriched scenario data (per-year series + per-intervention breakdown) and generic
XLSX builders for the frontend's per-table and per-chart export buttons.

All money is exported in the engine's native MILLIONS (full precision) with clear column labels; households
in millions. The per-intervention breakdown mirrors the Results dashboard: cumulative engine passes over the
enabled built-in toggles isolate each lever's marginal safely-managed households, mobilised resources, and
financing-gap reduction. Customs are excluded from the itemisation (they still sit in the scenario totals)."""

import io
import csv
import copy
import math
import base64

from demo_adapter import coerce_to_engine, financial_toggles
from model.engine import calculate

# key → (label, resource cash stream or None), in the same cumulative order the dashboard uses.
WATER_INTV = [
    ('ws_financial_commitment_enabled', 'Increase in Financial Commitments', 'scenario_financial_commitment_cash'),
    ('ws_exogenous_injection_enabled', 'Exogenous Injection of Funds', 'scenario_exogenous_injection_cash'),
    ('ws_collection_efficiency_enabled', 'Increased collection efficiency', 'scenario_collection_cash'),
    ('ws_nrw_enabled', 'NRW reduction', 'scenario_nrw_net'),
    ('ws_capital_efficiency_enabled', 'Budget execution improvement', None),
    ('ws_costeff_enabled', 'Capex efficiency (unit cost)', None),
    ('ws_techmix_enabled', 'Optimised technology selection', None),
    ('ws_tariff_enabled', 'Tariff reform', 'scenario_tariff_cash'),
    ('ws_microfinance_enabled', 'Microfinance', 'scenario_mf_loan_volume'),
]
SAN_INTV = [
    ('san_financial_commitment_enabled', 'Increase in Financial Commitments', 'scenario_financial_commitment_cash'),
    ('san_exogenous_injection_enabled', 'Exogenous Injection of Funds', 'scenario_exogenous_injection_cash'),
    ('san_collection_efficiency_enabled', 'Increased collection efficiency', 'scenario_collection_cash'),
    ('san_capital_efficiency_enabled', 'Budget execution improvement', None),
    ('san_costeff_enabled', 'Capex efficiency (unit cost)', None),
    ('san_techmix_enabled', 'Optimised technology selection', None),
    ('san_nrw_link_enabled', 'NRW-linked sanitation revenue', 'scenario_nrw_link_cash'),
    ('san_tariff_enabled', 'Tariff reform', 'scenario_tariff_cash'),
    ('san_microfinance_enabled', 'Microfinance', 'scenario_mf_loan_volume'),
]


def _cur(inputs):
    return (inputs.get('country_config') or {}).get('currency') or 'LCU'


def _baseline_year(inputs, years):
    return (inputs.get('period') or {}).get('baseline_year', years[0])


# ── enriched per-year series (BAU / target / with-interventions / gaps) ──────────────────────────────
def per_year_table(result, inputs, sector_key):
    """Return (headers, rows) for one sector: everything a reader needs incl. both financing gaps."""
    cur = _cur(inputs)
    years = result['years']
    sec = result[sector_key]
    total = result['total_hh']

    def g(name, i, rung0=True):
        v = sec.get(name)
        if v is None:
            return 0.0
        if rung0 and isinstance(v, list) and v and isinstance(v[0], list):
            v = v[0]
        return (v[i] if i < len(v) else 0.0) or 0.0

    headers = [
        'Year', 'Total HH (M)',
        'BAU safely-managed (M HH)', 'Target safely-managed (M HH)', 'With-interventions safely-managed (M HH)',
        'Service gap (M HH)',
        f'Investment need ({cur} M)', f'BAU investment ({cur} M)',
        f'Financing gap — BAU sector-wide ({cur} M)',
        f'Financing gap — BAU safely-managed ({cur} M)',
        f'Financing gap — BAU basic ({cur} M)',
        f'Financing gap — with interventions ({cur} M)',
        'Target basic (M HH)',
        'Target new basic connections (M HH)',
        'Target new safely-managed connections (M HH)',
        'Target basic-to-safely-managed upgrades (M HH)',
        'Target safely-managed-to-basic transitions (M HH)',
        f'Target expansion — scenario costs ({cur} M)',
        f'Target replacement allowance — scenario costs, approximate ({cur} M)',
        f'Target asset stock — scenario costs ({cur} M)',
        f'Target asset transfer, basic to safely managed — scenario costs ({cur} M)',
        f'Simulated BAU asset stock ({cur} M)',
        f'Simulated intervention asset stock ({cur} M)',
    ]
    rows = []
    for i, y in enumerate(years):
        bau = g('bau_hh', i); scn = g('scenario_hh', i); tgt = g('target_hh', i)
        tot = (total[i] if i < len(total) else 0.0) or 0.0
        rows.append([
            y, round(tot, 6),
            round(min(tot, bau), 6), round(min(tot, tgt), 6), round(min(tot, scn), 6),
            round(g('household_gap', i, rung0=False), 6),
            round(g('total_investment_need', i, rung0=False), 4),
            round(g('bau_available', i, rung0=False), 4),
            round(g('financing_gap', i, rung0=False), 4),
            round(g('financing_gap_by_service', i), 4),
            round((sec.get('financing_gap_by_service') or [[], []])[1][i], 4) if sec.get('financing_gap_by_service') else 0.0,
            round(g('scenario_financing_gap', i, rung0=False), 4),
            round((sec.get('target_hh') or [[], []])[1][i], 6),
            round(g('target_new_basic_connections', i, rung0=False), 6),
            round(g('target_new_sm_connections', i, rung0=False), 6),
            round(g('target_sm_upgrades', i, rung0=False), 6),
            round(g('target_sm_downgrades', i, rung0=False), 6),
            round(g('scenario_new_capex_total', i, rung0=False), 4),
            round(g('scenario_replacement_capex', i, rung0=False), 4),
            round(g('scenario_target_asset_stock', i, rung0=False), 4),
            round(g('scenario_target_asset_transfer_to_sm', i, rung0=False), 4),
            round(g('bau_asset_stock', i, rung0=False), 4),
            round(g('scenario_bau_asset_stock', i, rung0=False), 4),
        ])
    return headers, rows


# ── per-intervention breakdown (cumulative passes) ──────────────────────────────────────────────────
def _run(inputs, toggles):
    f = copy.deepcopy(inputs)
    f['toggles'] = toggles
    f['custom_interventions'] = []
    return calculate(coerce_to_engine(f))


def intervention_breakdown(inputs, sector_key, defs):
    """[(label, added_hh_millions, resources_billions_or_None, gap_closed_billions), …] for enabled levers."""
    toggles = financial_toggles(inputs)
    enabled = [d for d in defs if toggles.get(d[0])]
    if not enabled:
        return []
    off = {k: False for k in toggles}
    # cumulative passes: BAU, then +each enabled lever
    passes = [_run(inputs, dict(off))]
    acc = dict(off)
    for key, _, _ in enabled:
        acc[key] = True
        passes.append(_run(inputs, dict(acc)))
    years = passes[0]['years']
    by = _baseline_year(inputs, years)
    e = len(years) - 1

    def sm_end(res):
        return (res[sector_key]['scenario_hh'][0][e] or 0.0)

    def cash_cum(res, field):
        arr = res[sector_key].get(field) or []
        return sum((arr[i] or 0.0) for i, y in enumerate(years) if y > by)

    def gap_cum(res):
        arr = res[sector_key].get('scenario_financing_gap') or []
        return sum((arr[i] or 0.0) for i, y in enumerate(years) if y > by)

    out = []
    for idx, (key, label, rkey) in enumerate(enabled):
        before, after = passes[idx], passes[idx + 1]
        add_hh = max(0.0, sm_end(after) - sm_end(before))                 # millions
        res = (cash_cum(after, rkey) - cash_cum(before, rkey)) / 1000.0 if rkey else None  # M → B
        gap_closed = max(0.0, gap_cum(before) - gap_cum(after)) / 1000.0  # M → B
        out.append((label, round(add_hh, 5), (round(res, 4) if res is not None else None), round(gap_closed, 4)))
    return out


def breakdown_table(inputs, sector_key, defs):
    cur = _cur(inputs)
    headers = ['Intervention', 'Added safely-managed (M HH)', f'Resources generated ({cur} B)', f'Financing gap closed ({cur} B)']
    rows = []
    for label, add_hh, res, gap in intervention_breakdown(inputs, sector_key, defs):
        rows.append([label, add_hh, ('n/a' if res is None else res), gap])
    return headers, rows


# ── whole-scenario CSV / XLSX (everything: per-year series + intervention breakdown, both sectors) ───
def scenario_csv(inputs):
    result = calculate(coerce_to_engine(inputs))
    out = io.StringIO()
    w = csv.writer(out)
    for sk, name in [('water_supply', 'WATER SUPPLY'), ('sanitation', 'SANITATION')]:
        headers, rows = per_year_table(result, inputs, sk)
        w.writerow([name + ' — forecast (per year)'])
        w.writerow(headers)
        w.writerows(rows)
        w.writerow([])
        bh, br = breakdown_table(inputs, sk, WATER_INTV if sk == 'water_supply' else SAN_INTV)
        w.writerow([name + ' — contribution by intervention (cumulative to endline)'])
        w.writerow(bh)
        w.writerows(br if br else [['(no interventions enabled)']])
        w.writerow([]); w.writerow([])
    out.seek(0)
    return '﻿' + out.getvalue()   # BOM so Excel reads the UTF-8 (em-dashes, currency) correctly


def scenario_xlsx(inputs):
    from openpyxl import Workbook
    result = calculate(coerce_to_engine(inputs))
    wb = Workbook()
    wb.remove(wb.active)
    for sk, name in [('water_supply', 'Water'), ('sanitation', 'Sanitation')]:
        h, r = per_year_table(result, inputs, sk)
        _write_sheet(wb, f'{name} — forecast', h, r)
        bh, br = breakdown_table(inputs, sk, WATER_INTV if sk == 'water_supply' else SAN_INTV)
        _write_sheet(wb, f'{name} — interventions', bh, br if br else [['(no interventions enabled)']])
    return _save(wb)


# ── generic builders used by the per-table and per-chart export buttons ──────────────────────────────
def _safe_title(s):
    """Excel forbids : \\ / ? * [ ] in sheet names and caps them at 31 chars."""
    import re
    return (re.sub(r'[:\\/?*\[\]]', ' ', str(s or 'Sheet')).strip() or 'Sheet')[:31]


def _col_width(header, cells):
    """Compact column width: size to the DATA, letting a long header WRAP over several lines rather than
    stretching the whole column to fit it on one row. Numeric / short columns stay narrow; only genuinely
    long text DATA widens a column. Fixes the previously 'fat' exports where a long header like
    'With reforms 2040 (%)' forced a column of short percentages out to ~23 units."""
    data_len = max([0] + [len(str(c)) for c in cells])
    words = str(header).split()
    longest_word = max([len(w) for w in words]) if words else 0   # header wraps → only its longest word must fit
    base = max(data_len, longest_word)
    return min(40, max(7, base + 1.5))


def _write_sheet(wb, title, headers, rows):
    from openpyxl.styles import Font, PatternFill, Alignment
    ws = wb.create_sheet(title=_safe_title(title))
    hdr_fill = PatternFill('solid', fgColor='0EA5E9')
    hdr_font = Font(bold=True, color='FFFFFF')
    hdr_align = Alignment(horizontal='center', vertical='center', wrap_text=True)   # wrap keeps columns narrow
    ws.append([str(h) for h in headers])
    for c in ws[1]:
        c.fill = hdr_fill; c.font = hdr_font; c.alignment = hdr_align
    for row in rows:
        ws.append(list(row))
    hdr_lines = 1
    for i, h in enumerate(headers, 1):
        cells = [row[i - 1] for row in rows if i - 1 < len(row)]   # rows may be ragged
        w = _col_width(h, cells)
        ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = w
        hdr_lines = max(hdr_lines, math.ceil(len(str(h)) / max(1.0, w - 1)))   # lines this header wraps into
    ws.row_dimensions[1].height = min(74, 15 * hdr_lines + 5)   # tall enough to show the wrapped header
    ws.freeze_panes = 'A2'
    return ws


def _save(wb):
    out = io.BytesIO(); wb.save(out); out.seek(0)
    return out


def table_xlsx(sheets):
    """sheets = [{name, headers, rows}] → a workbook, one sheet each."""
    from openpyxl import Workbook
    wb = Workbook(); wb.remove(wb.active)
    for s in sheets:
        _write_sheet(wb, s.get('name', 'Sheet'), s.get('headers', []), s.get('rows', []))
    if not wb.sheetnames:
        wb.create_sheet('Sheet')
    return _save(wb)


# ── native (data-linked) chart for the per-chart "⤓ Excel" export ─────────────────────────────────────
# Rather than pasting a static PNG, we write the chart's data table and add a REAL Excel chart bound to those
# cells: an AreaChart for the stacked bands + a LineChart for the reference lines, sharing ONE pair of axes.
# Edit a number in the data table and the chart redraws — the export is dynamic, not a picture.
_EMU_PT = 12700   # EMUs per point (openpyxl line widths are in EMUs)


def _hexcolor(c):
    """'#1a9ed6' / '1a9ed6' → 'RRGGBB' (6 hex), tolerant of missing/short input."""
    return (str(c or '').lstrip('#').upper() or '888888')[:6].ljust(6, '0')


# How far apart the labels on a year x-axis should sit. A 15-to-25-year run labelled every year is an
# unreadable smear, so label every fifth one counting from the first. Shared with the PowerPoint deck
# (export_deck) and mirrored on screen in the frontend, so all three surfaces agree.
YEAR_LABEL_EVERY = 5
YEAR_LABEL_MIN = 10       # below this many years they all fit; leave them alone


def year_label_step(categories, every=YEAR_LABEL_EVERY, minimum=YEAR_LABEL_MIN):
    """`every` for a long run of CONSECUTIVE years, else 1 (label them all).

    The consecutive test is what protects the charts whose categories are chosen reference years —
    2025/2030/2040 is already sparse and every label matters."""
    try:
        years = [int(c) for c in categories]
    except (TypeError, ValueError):
        return 1
    if len(years) < minimum or any(b - a != 1 for a, b in zip(years, years[1:])):
        return 1
    return every


def _no_overlay(title):
    """openpyxl writes <c:title> without <c:overlay>, and Excel treats a missing overlay as TRUE — the title is
    then painted ON TOP of the chart instead of reserving space, so axis titles land over their own tick labels
    (and the chart title over the plot). Say 'no' explicitly."""
    if title is not None:
        title.overlay = False
    return title


def _axis_title(axis, text, vertical=False):
    """Set an axis title, keep it off the plot, and fix its text rotation. Assigning `axis.title = 'x'` alone
    writes an empty <a:bodyPr/>, which Excel reads as rot=0 — the value-axis title would then run horizontally."""
    if not text:
        axis.title = None
        return
    axis.title = str(text)
    _no_overlay(axis.title)
    body = axis.title.tx.rich.bodyPr
    body.rot = -5400000 if vertical else 0   # 60000ths of a degree: -90° reads bottom-to-top
    body.vert = 'horz'                       # characters upright within that rotation


def _native_chart(ws, title, spec, headers, nrows):
    """Add a data-linked Area(+Line) chart to `ws`, whose series reference the columns of the table already
    written at A1. `spec` = {category, stacked, areas:[{name,color}], lines:[{name,color,dash}], x/yTitle}."""
    from openpyxl.chart import AreaChart, LineChart, Reference, Series
    from openpyxl.chart.marker import Marker
    from openpyxl.chart.shapes import GraphicalProperties
    from openpyxl.drawing.line import LineProperties
    from openpyxl.utils import get_column_letter

    def col_of(name):
        try:
            return headers.index(name) + 1
        except ValueError:
            return None

    cat_name = spec.get('category') or (headers[0] if headers else None)
    cat_col = col_of(cat_name) or 1
    cats = Reference(ws, min_col=cat_col, min_row=2, max_row=1 + nrows)

    def add_series(chart, name, style):
        col = col_of(name)
        if not col:
            return
        ref = Reference(ws, min_col=col, min_row=1, max_row=1 + nrows)   # incl. header row → title_from_data
        s = Series(ref, title_from_data=True)
        style(s)
        chart.series.append(s)

    areas = spec.get('areas') or []
    lines = spec.get('lines') or []

    area_chart = None
    if areas:
        area_chart = AreaChart()
        area_chart.grouping = 'stacked' if spec.get('stacked') else 'standard'
        for a in areas:
            def style(s, a=a):
                h = _hexcolor(a.get('color'))
                gp = GraphicalProperties(solidFill=h)
                gp.line = LineProperties(solidFill=h)
                s.graphicalProperties = gp
            add_series(area_chart, a.get('name'), style)
        area_chart.set_categories(cats)

    line_chart = None
    if lines:
        line_chart = LineChart()
        for l in lines:
            def style(s, l=l):
                h = _hexcolor(l.get('color'))
                lp = LineProperties(solidFill=h, w=int(2.25 * _EMU_PT))
                if l.get('dash'):
                    lp.prstDash = 'dash'
                gp = GraphicalProperties(); gp.line = lp
                s.graphicalProperties = gp
                s.marker = Marker(symbol='none')
                s.smooth = False
            add_series(line_chart, l.get('name'), style)
        line_chart.set_categories(cats)

    chart = area_chart or line_chart
    if chart is None:
        return
    if area_chart is not None and line_chart is not None:
        chart += line_chart   # area + line share one default axis pair (catAx 10 / valAx 100)
    chart.title = title or None
    _no_overlay(chart.title)
    # Axis titles sit outside the plot (see _no_overlay) and read the right way up (see _axis_title). openpyxl
    # also leaves the category axis at its inherited axPos='l'; pin it to the bottom.
    _axis_title(chart.y_axis, spec.get('yTitle'), vertical=True)
    _axis_title(chart.x_axis, spec.get('xTitle') or cat_name)
    for ax, pos in ((chart.x_axis, 'b'), (chart.y_axis, 'l')):
        ax.axPos = pos
        ax.delete = False
        ax.majorGridlines = None   # no gridlines (NumericAxis defaults to drawing them)
        ax.minorGridlines = None
    # Thin a dense year axis down to every fifth label (Excel's "interval between labels").
    step = year_label_step(ws.cell(row=r, column=cat_col).value for r in range(2, 2 + nrows))
    if step > 1:
        chart.x_axis.tickLblSkip = step
        chart.x_axis.tickMarkSkip = step
    chart.height = 10.5   # cm
    chart.width = 21
    if chart.legend is not None:
        chart.legend.position = 'b'
        chart.legend.overlay = False
    ws.add_chart(chart, get_column_letter(len(headers) + 2) + '1')   # anchor just right of the data


def chart_xlsx(title, sheets, chart_spec=None, image_data_url=None):
    """Workbook for the per-chart export. With `chart_spec` the first sheet holds the chart's data table AND a
    live Excel chart bound to those cells (dynamic). Falls back to embedding the PNG when only an image is
    supplied (legacy callers)."""
    from openpyxl import Workbook
    wb = Workbook(); wb.remove(wb.active)
    primary = sheets[0] if sheets else {'name': 'Chart data', 'headers': [], 'rows': []}
    headers = [str(h) for h in (primary.get('headers') or [])]
    rows = primary.get('rows') or []
    ws = _write_sheet(wb, primary.get('name') or 'Chart data', headers, rows)
    if chart_spec and headers and rows:
        try:
            _native_chart(ws, title, chart_spec, headers, len(rows))
        except Exception:
            pass   # never fail the download over a chart-drawing hiccup — the data sheet is still there
    elif image_data_url and ',' in image_data_url:
        from openpyxl.drawing.image import Image as XLImage
        from openpyxl.utils import get_column_letter
        raw = base64.b64decode(image_data_url.split(',', 1)[1])
        img = XLImage(io.BytesIO(raw))
        if img.width:
            scale = min(1.0, 900.0 / img.width)
            img.width = int(img.width * scale); img.height = int(img.height * scale)
        ws.add_image(img, get_column_letter(len(headers) + 2) + '1')
    for s in sheets[1:]:
        _write_sheet(wb, s.get('name', 'Data'), s.get('headers', []), s.get('rows', []))
    return _save(wb)
