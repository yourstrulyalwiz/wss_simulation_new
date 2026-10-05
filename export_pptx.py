"""Results PowerPoint deck — a pre-populated, Castalia-style presentation built from the live engine run.

Structure: title → executive summary (coverage table + headline text) → per sector two slides (a
safely-managed coverage slide with the stacked chart + written summary, and a financing-gap slide with the
gap chart + the per-intervention contribution table). Charts are captured on the client (recharts SVG →
canvas) and passed in as data-URL PNGs; if absent the slides still render the tables and text.
"""

import io
import base64
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

from export_data import intervention_breakdown, WATER_INTV, SAN_INTV, _cur
from service_gap_export import append_service_access_slides

# ── World Bank Water Data palette ───────────────────────────────────────────────────────────────────
NAVY = RGBColor(0x01, 0x49, 0x72)
NAVY2 = NAVY
TEAL = RGBColor(0x00, 0x9C, 0xA7)
SLATE = RGBColor(0x4C, 0x80, 0x9C)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x29, 0x34, 0x3B)
GREY = RGBColor(0x61, 0x70, 0x78)
MUTED = RGBColor(0x9A, 0xA6, 0xAC)
PAGE = RGBColor(0xF4, 0xF7, 0xF9)
ROW = RGBColor(0xED, 0xF1, 0xF3)
TEAL_TINT = RGBColor(0xE5, 0xF4, 0xF5)
BAU_C = NAVY
TGT_C = TEAL
SCN_C = SLATE
FONT = 'Noto Sans'


def _pct(f):
    return f"{f * 100:.1f}%"


def _b(v_millions):
    return f"{v_millions / 1000:,.1f}"


def _sector_summary(result, inputs, sk):
    years = result['years']
    per = inputs.get('period', {})
    by = per.get('baseline_year', years[0])
    e = len(years) - 1
    bi = max(0, years.index(by)) if by in years else 0
    sec = result[sk]
    total = result['total_hh']

    def cov(arr, i):
        t = total[i] or 0
        return (min(t, (arr[i] or 0)) / t) if t else 0.0
    bau, scn, tgt = sec['bau_hh'][0], sec['scenario_hh'][0], sec['target_hh'][0]
    cum = lambda a: sum((a[i] or 0) for i, y in enumerate(years) if y > by)
    return {
        'end': years[e], 'curCov': cov(bau, bi), 'bauCov': cov(bau, e), 'scnCov': cov(scn, e), 'tgtCov': cov(tgt, e),
        'addHH': min(total[e], scn[e]) - min(total[e], bau[e]),
        'gapBau': sec['endline_financing_requirement'][e],
        'gapScn': sec['scenario_endline_financing_requirement'][e],
    }


def create_pptx(result: dict, inputs: dict, charts: dict | None = None, contribution_view: str = 'individual',
                currency_display: dict | None = None) -> io.BytesIO:
    charts = charts or {}
    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    cc = inputs.get('country_config', {})
    period = inputs.get('period', {})
    country = cc.get('country', 'Country')
    area = cc.get('area', 'Area')
    cur = _cur(inputs)
    currency_display = currency_display or {'mode': 'local', 'source_currency': cur, 'display_currency': cur, 'factor': 1.0,
                                             'rate_note': 'Local-currency results; no conversion applied.',
                                             'price_basis_note': 'Model constant-price basis.'}
    money_factor = currency_display.get('factor', 1.0)
    cur = currency_display.get('display_currency', cur)
    baseline = period.get('baseline_year', 2025)
    end = result['years'][-1]

    def textbox(slide, l, t, w, h, anchor=None):
        tb = slide.shapes.add_textbox(Inches(l), Inches(t), Inches(w), Inches(h))
        tf = tb.text_frame
        tf.word_wrap = True
        if anchor is not None:
            tf.vertical_anchor = anchor
        return tf

    def set_p(p, text, size, color, bold=False, bullet=False):
        p.text = ('• ' + text) if bullet else text
        p.font.size = Pt(size)
        p.font.color.rgb = color
        p.font.bold = bold
        p.font.name = FONT

    def band(slide, color, top, height):
        from pptx.enum.shapes import MSO_SHAPE
        shp = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0), Inches(top), prs.slide_width, Inches(height))
        shp.fill.solid(); shp.fill.fore_color.rgb = color; shp.line.fill.background()
        shp.shadow.inherit = False
        return shp

    def slide_title(slide, title, subtitle=None):
        slide.background.fill.solid()
        slide.background.fill.fore_color.rgb = PAGE
        band(slide, WHITE, 0, 1.0)
        band(slide, TEAL, 0, 0.07)
        tf = textbox(slide, 0.5, 0.12, 12.3, 0.8, MSO_ANCHOR.MIDDLE)
        p = tf.paragraphs[0]
        if '—' in title:
            first, rest = title.split('—', 1)
        else:
            words = title.split(maxsplit=1)
            first, rest = (words[0], words[1]) if len(words) > 1 else (title, '')
        run = p.add_run(); run.text = first.strip().upper() + (' ' if rest else '')
        run.font.name = FONT; run.font.size = Pt(22); run.font.bold = True; run.font.color.rgb = NAVY
        if rest:
            run = p.add_run(); run.text = rest.strip().upper()
            run.font.name = FONT; run.font.size = Pt(22); run.font.bold = False; run.font.color.rgb = MUTED
        if subtitle:
            p = tf.add_paragraph(); set_p(p, subtitle, 11, GREY)

    def add_table(slide, left, top, width, headers, rows, col0_left=True, fontsize=11, header_fill=NAVY, total_last=False):
        n_rows, n_cols = len(rows) + 1, len(headers)
        tbl = slide.shapes.add_table(n_rows, n_cols, Inches(left), Inches(top), Inches(width), Inches(0.34 * n_rows)).table
        for j, h in enumerate(headers):
            c = tbl.cell(0, j); c.text = str(h).upper()
            c.fill.solid(); c.fill.fore_color.rgb = header_fill
            for p in c.text_frame.paragraphs:
                p.font.size = Pt(fontsize); p.font.bold = True; p.font.color.rgb = WHITE; p.font.name = FONT
                p.alignment = PP_ALIGN.LEFT if (j == 0 and col0_left) else PP_ALIGN.RIGHT
        for i, row in enumerate(rows):
            is_total = total_last and i == len(rows) - 1
            for j, val in enumerate(row):
                c = tbl.cell(i + 1, j); c.text = str(val)
                c.fill.solid(); c.fill.fore_color.rgb = (TEAL_TINT if is_total else (ROW if i % 2 else WHITE))
                for p in c.text_frame.paragraphs:
                    p.font.size = Pt(fontsize - 0.5); p.font.bold = is_total
                    p.font.color.rgb = NAVY if is_total else INK
                    p.font.name = FONT
                    p.alignment = PP_ALIGN.LEFT if (j == 0 and col0_left) else PP_ALIGN.RIGHT
        return tbl

    def add_chart(slide, key, left, top, width):
        data_url = charts.get(key)
        if not data_url or ',' not in data_url:
            tf = textbox(slide, left, top + 1.6, width, 0.6, MSO_ANCHOR.MIDDLE)
            set_p(tf.paragraphs[0], '(chart unavailable)', 11, GREY)
            return
        raw = base64.b64decode(data_url.split(',', 1)[1])
        slide.shapes.add_picture(io.BytesIO(raw), Inches(left), Inches(top), width=Inches(width))

    # === 1. TITLE ===
    s = prs.slides.add_slide(blank)
    bg = s.background.fill; bg.solid(); bg.fore_color.rgb = WHITE
    band(s, TEAL, 0, 0.12)
    tf = textbox(s, 1.0, 2.2, 11.3, 2.4)
    p = tf.paragraphs[0]
    run = p.add_run(); run.text = 'WATER & SANITATION '; run.font.name = FONT; run.font.size = Pt(34); run.font.bold = True; run.font.color.rgb = NAVY
    run = p.add_run(); run.text = 'STRATEGIC SCENARIOS'; run.font.name = FONT; run.font.size = Pt(34); run.font.bold = False; run.font.color.rgb = MUTED
    p = tf.add_paragraph(); set_p(p, f'{country} · {area}', 19, TEAL, bold=True)
    p = tf.add_paragraph(); set_p(p, f'Baseline {baseline} · forecast to {end}', 13, GREY)
    p = tf.add_paragraph(); set_p(p, currency_display.get('rate_note', ''), 11, GREY)
    p = tf.add_paragraph(); set_p(p, currency_display.get('price_basis_note', 'Model constant-price basis.'), 11, GREY)
    band(s, TEAL, 7.30, 0.20)

    # === 2. EXECUTIVE SUMMARY ===
    s = prs.slides.add_slide(blank)
    slide_title(s, 'Executive summary', f'Safely-managed coverage and financing gap · {country} {area}')
    ws, sn = _sector_summary(result, inputs, 'water_supply'), _sector_summary(result, inputs, 'sanitation')
    headers = ['Sector', 'Current', f'BAU {end}', f'Target {end}', f'With reforms {end}']
    rows = [
        ['Water Supply', _pct(ws['curCov']), _pct(ws['bauCov']), _pct(ws['tgtCov']), _pct(ws['scnCov'])],
        ['Sanitation', _pct(sn['curCov']), _pct(sn['bauCov']), _pct(sn['tgtCov']), _pct(sn['scnCov'])],
    ]
    add_table(s, 0.6, 1.4, 8.0, headers, rows)
    tf = textbox(s, 0.6, 3.2, 12.1, 3.6)
    set_p(tf.paragraphs[0], 'KEY TAKEAWAYS', 15, INK, bold=True)
    for label, d in [('Water supply', ws), ('Sanitation', sn)]:
        red = (1 - d['gapScn'] / d['gapBau']) * 100 if d['gapBau'] else 0
        txt = (f"{label}: safely-managed coverage reaches {_pct(d['scnCov'])} with the current interventions by "
               f"{d['end']} (vs {_pct(d['bauCov'])} business-as-usual and a {_pct(d['tgtCov'])} target) — "
               f"{d['addHH']:.2f} M more households. Endline financing requirement changes from {_b(d['gapBau'] * money_factor)} to "
               f"{_b(d['gapScn'] * money_factor)} B {cur} ({red:.0f}% lower).")
        p = tf.add_paragraph(); set_p(p, txt, 12.5, RGBColor(0x33, 0x41, 0x55), bullet=True)

    # === 3. PER-SECTOR SLIDES ===
    for sk, name, defs, cov_key, gap_key in [
        ('water_supply', 'Water Supply', WATER_INTV, 'water_coverage', 'water_gap'),
        ('sanitation', 'Sanitation', SAN_INTV, 'san_coverage', 'san_gap'),
    ]:
        d = _sector_summary(result, inputs, sk)
        ledger_slide = prs.slides.add_slide(blank)
        slide_title(ledger_slide, f'{name} — funding flows and balances',
                    'Flows sum since baseline; end balances include opening work and are not additive.')
        sec = result[sk]
        ledger_rows = []
        for label, field, balance in (
            ('Planned expansion — annual flows', 'annual_planned_expansion_cost', False),
            ('Replacement — annual flows', 'replacement_capex', False),
            ('Catch-up before funding — final-year snapshot', 'catch_up_requirement', True),
            ('Outstanding expansion — closing balance', 'closing_outstanding_expansion', True),
            ('Unpaid replacement — annual flows', 'unfunded_replacement', False),
            ('Negative cash — annual flows', 'cash_deficit', False),
            ('Endline requirement — balance + all shortfalls', 'endline_financing_requirement', True),
            ('Gross funded assets — closing stock', 'funded_asset_stock', True),
        ):
            vals = []
            for prefix in ('', 'scenario_'):
                series = sec[prefix + field]
                value = series[-1] if balance else sum(series)
                vals.append(_b(value * money_factor))
            ledger_rows.append([label, *vals])
        add_table(ledger_slide, .6, 1.5, 12, ['Accounting item', f'BAU ({cur} B)', f'Scenario ({cur} B)'], ledger_rows)

        # 3a. coverage chart + written summary
        s = prs.slides.add_slide(blank)
        slide_title(s, f'{name} — safely-managed coverage',
                    'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.'
                    if contribution_view == 'category' else 'BAU baseline plus each intervention’s contribution')
        add_chart(s, cov_key, 0.5, 1.35, 7.6)
        tf = textbox(s, 8.4, 1.5, 4.5, 5.4)
        set_p(tf.paragraphs[0], f'BY {d["end"]}', 15, INK, bold=True)
        bullets = [
            f'BAU coverage: {_pct(d["bauCov"])}',
            f'With interventions: {_pct(d["scnCov"])}',
            f'Target: {_pct(d["tgtCov"])}',
            f'Extra safely-managed: {d["addHH"]:.2f} M households',
        ]
        for bt in bullets:
            p = tf.add_paragraph(); set_p(p, bt, 13, RGBColor(0x33, 0x41, 0x55), bullet=True)

        # 3b. financing-gap chart + per-intervention contribution table
        s = prs.slides.add_slide(blank)
        slide_title(s, f'{name} — financing gap & interventions (safely managed + basic)',
                    'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.'
                    if contribution_view == 'category' else 'Grey = gap remaining · colours = closed by each lever')
        add_chart(s, gap_key, 0.5, 1.35, 7.6)
        bd = intervention_breakdown(inputs, sk, defs)
        headers = ['Intervention — individual detail' if contribution_view == 'category' else 'Intervention',
                   f'Added HH (M)', f'Resources / financing ({cur} B)', f'Gap closed ({cur} B)']
        if bd:
            rows = [[lbl, f'{hh:.3f}', ('—' if res is None else f'{res * money_factor:,.4f}'), f'{gap * money_factor:,.4f}'] for (lbl, hh, res, gap) in bd]
            rows.append(['Total', f'{sum(x[1] for x in bd):.3f}', f'{sum((x[2] or 0) for x in bd) * money_factor:,.4f}', f'{sum(x[3] for x in bd) * money_factor:,.4f}'])
            add_table(s, 8.3, 1.5, 4.7, headers, rows, fontsize=10, total_last=True)
        else:
            tf = textbox(s, 8.3, 2.6, 4.7, 1.0)
            set_p(tf.paragraphs[0], 'No interventions enabled for this sector.', 12, GREY)
        tf = textbox(s, 8.3, 6.2, 4.7, 1.0)
        red = (1 - d['gapScn'] / d['gapBau']) * 100 if d['gapBau'] else 0
        set_p(tf.paragraphs[0], f'Endline requirement: {_b(d["gapBau"] * money_factor)} → {_b(d["gapScn"] * money_factor)} B {cur} ({red:.0f}% lower). Closing expansion plus shortfalls since baseline; balances are not additive. {currency_display.get("rate_note", "")} {currency_display.get("price_basis_note", "")}', 11.5, INK, bold=True)

    # Utility loans are annual debt schedules, not household microfinance. Keep assumptions,
    # annual service capacity, actual loan-funded investment, and restricted proceeds explicit.
    for sk, name in [('water_supply', 'Water Supply'), ('sanitation', 'Sanitation')]:
        debt = result[sk].get('scenario_utility_debt') or {}
        if not debt.get('enabled'):
            continue
        summary_slide = prs.slides.add_slide(blank)
        slide_title(summary_slide, f'{name} — utility debt assumptions and balances',
                    'Borrowing is by the utility; loan proceeds are restricted to infrastructure and are not debt-service capacity.')
        assumption_rows = [
            ['Status', debt.get('status', '—')],
            ['Allocation of eligible additional revenue', f"{float(debt.get('allocation_share') or 0) * 100:.1f}%"],
            ['Annual real rate / repayment', f"{float(debt.get('annual_real_interest_rate') or 0) * 100:.2f}% / {debt.get('repayment_structure') or '—'}"],
            ['Disbursement / grace / maturity', f"{debt.get('disbursement_year') or '—'} / {debt.get('principal_grace_years') or 0} years / {debt.get('maturity_year') or '—'}"],
            ['Accepted principal', f"{_b(float(debt.get('accepted_principal') or 0) * money_factor)} B {cur}"],
            ['Total interest / principal repaid', f"{_b(float(debt.get('total_interest') or 0) * money_factor)} / {_b(float(debt.get('total_principal_repaid') or 0) * money_factor)} B {cur}"],
            ['Closing restricted proceeds', f"{_b(float(debt.get('closing_restricted_cash') or 0) * money_factor)} B {cur}"],
            ['Sizing assumption', debt.get('tail_capacity_assumption') or 'Annual capacity verified against the scenario.'],
        ]
        add_table(summary_slide, .6, 1.35, 12, ['Assumption or balance', 'Value'], assumption_rows, fontsize=10)

        schedule = debt.get('schedule') or []
        headers = ['Year', f'Opening principal ({cur} B)', f'Disbursement ({cur} B)',
                   f'Principal paid ({cur} B)', f'Interest ({cur} B)', f'Debt service ({cur} B)',
                   f'Capacity ({cur} B)', f'Shortfall ({cur} B)',
                   f'Loan investment ({cur} B)', f'Closing restricted cash ({cur} B)']
        for start in range(0, len(schedule), 10):
            page = schedule[start:start + 10]
            slide = prs.slides.add_slide(blank)
            slide_title(slide, f'{name} — utility debt annual schedule',
                        f"Years {page[0]['year']}–{page[-1]['year']} · amounts in billions of {cur}")
            rows = [[
                row.get('year'),
                *[f"{_b(float(row.get(field) or 0) * money_factor)}" for field in (
                    'opening_principal', 'disbursement', 'principal_payment', 'interest_payment',
                    'total_debt_service', 'annual_service_capacity', 'payment_shortfall',
                    'investment_from_loan_proceeds', 'closing_restricted_cash')],
            ] for row in page]
            add_table(slide, .45, 1.45, 12.4, headers, rows, fontsize=7.5)

    append_service_access_slides(prs, {area: result})
    from revenue_export import append_revenue_slides
    append_revenue_slides(prs, {area: result}, _cur(inputs), money_factor, cur)
    output = io.BytesIO()
    prs.save(output)
    output.seek(0)
    return output
