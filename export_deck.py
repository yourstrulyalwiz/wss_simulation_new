"""Fill the branded Castalia deck template from a live engine run.

The deck is authored in PowerPoint and shipped in `deck_templates/`; this module opens it, replaces the
`[bracketed]` tokens, repopulates the native charts and tables, clones the intervention-detail slide once
per enabled lever, drops the slides for scopes the user never entered, and renumbers the contents page.
Nothing is drawn from scratch, so the master, theme, fonts and branding survive exactly.

Template A ("urban_rural_national.pptx") is the Urban + Rural = National entry mode: six 6-slide blocks
(divider, coverage, service gap, investment gap, interventions, intervention detail) covering
urban/rural/national × water/sanitation.
"""

import io
import os
from typing import Dict, List, Optional, Tuple

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Emu

import deck_data as DD
from export_data import year_label_step          # one year-axis rule for the deck and the xlsx charts
from pptx_template import (chart_groups, clone_slide, delete_slide_obj, delete_table_columns,
                           delete_table_rows, clone_table_row, drop_prompt_shapes, find_shape,
                           fit_table, hide_zero_data_labels, index_of, iter_shapes, replace_tokens,
                           set_category_label_step, set_cell, set_chart, set_column_weights,
                           set_group_series_counts, set_text)

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'deck_templates')
TEMPLATE_A = os.path.join(TEMPLATE_DIR, 'urban_rural_national.pptx')

# (scope, sector, first slide index of the block). Offsets within a block:
#   +0 divider  +1 coverage  +2 service gap  +3 investment gap  +4 interventions  +5 detail
BLOCKS = [
    ('urban', 'water_supply', 7),
    ('rural', 'water_supply', 13),
    ('urban', 'sanitation', 19),
    ('rural', 'sanitation', 25),
    ('national', 'water_supply', 31),
    ('national', 'sanitation', 37),
]
BLOCK_LEN = 6
IDX_TITLE, IDX_CONTENTS, IDX_EXEC = 0, 1, 2
IDX_METHOD_DIV, IDX_OBJECTIVES, IDX_DEFS, IDX_HHFORECAST = 3, 4, 5, 6
IDX_APPENDIX_A, IDX_APPENDIX_B = 43, 44

SCOPE_TITLE = {'urban': 'Urban', 'rural': 'Rural', 'national': 'National'}
SECTOR_TITLE = {'water_supply': 'water', 'sanitation': 'sanitation'}

# The interventions chart is coloured from the tool's palette, because its bands ARE the tool's
# interventions and must read the same as the on-screen chart. The service-gap chart is not: it has
# two fixed series the template already styles, so it keeps the template's own colours (see
# _fill_service_gap).
BAU_FILL = 'BFDBFE'
TARGET_LINE = '16A34A'


# ── formatting ──────────────────────────────────────────────────────────────────────────────────

def pct(v) -> str:
    return f'{v * 100:.0f}%'


def num(v, dp=2) -> str:
    return f'{v:,.{dp}f}'


def bn(v_millions, dp=1) -> str:
    """Local-currency millions → a billions string (the deck talks in billions throughout)."""
    return f'{v_millions / 1000:,.{dp}f}'


def hh(v_millions, dp=0) -> str:
    """Households in THOUSANDS, which is what the tables are labelled ('000).

    The engine carries households in millions, but a lever that connects five thousand households
    reads as 0.005 there — all leading zeros and no significant digits. Thousands keeps every figure
    on the slide legible at one glance."""
    return f'{v_millions * 1000:,.{dp}f}'


def hh_full(v_millions) -> str:
    """Households as an actual count, for prose that says "… households"."""
    return f'{v_millions * 1_000_000:,.0f}'


def _rgb(hex6: str) -> RGBColor:
    return RGBColor(int(hex6[0:2], 16), int(hex6[2:4], 16), int(hex6[4:6], 16))


def _color_series(chart, colors: List[Optional[str]]) -> None:
    """Paint chart series to the tool's palette so the deck reads like the on-screen charts.

    Walks EVERY plot, not just the first: the interventions chart is an area+line combo, so its
    reference line lives in a second plot group and would otherwise keep the theme's default colour."""
    allser = [s for p in chart.plots for s in p.series]
    for s, c in zip(allser, colors):
        if not c:
            continue
        try:
            s.format.fill.solid()
            s.format.fill.fore_color.rgb = _rgb(c)
        except Exception:
            pass
        try:
            s.format.line.color.rgb = _rgb(c)
        except Exception:
            pass


def _chart_shape(slide, name: Optional[str] = None):
    for sh in iter_shapes(slide.shapes):
        if getattr(sh, 'has_chart', False) and sh.has_chart and (name is None or sh.name == name):
            return sh
    return None


def _table(slide, name: str):
    sh = find_shape(slide, name)
    return sh.table if sh is not None else None


def _table_shape(slide, name: str):
    return find_shape(slide, name)


def _room_below(slide, shape, floor_in: float = 7.1, gap_in: float = 0.10) -> float:
    """Vertical space a shape may grow into before it hits whatever sits under it.

    Measured against the real slide rather than hard-coded, so it stays correct if the template's
    layout is edited. Only shapes that actually overlap horizontally count as blockers — the chart
    beside the table is lower on the slide but in a different column, and must not constrain it."""
    if shape is None:
        return 0.0
    top = Emu(shape.top).inches
    left, right = Emu(shape.left).inches, Emu(shape.left).inches + Emu(shape.width).inches
    limit = floor_in
    for other in iter_shapes(slide.shapes):
        if other is shape or other.top is None:
            continue
        o_top = Emu(other.top).inches
        o_l, o_r = Emu(other.left).inches, Emu(other.left).inches + Emu(other.width).inches
        if o_top <= top + 0.05:
            continue                                  # level with or above — not a blocker
        if min(right, o_r) - max(left, o_l) <= 0.05:
            continue                                  # different column
        limit = min(limit, o_top)
    return max(0.5, limit - top - gap_in)


# ── per-block slide filling ─────────────────────────────────────────────────────────────────────

def _fill_coverage(slide, b, cur):
    replace_tokens(slide, {
        '[first data year]': str(b['first_data_year']),
        '[baseline year]': str(b['baseline_year']),
        '[first target year]': str(b['first_target_year']),
        '[last target year]': str(b['last_target_year']),
        '[first year]': str(b['first_data_year']),
        '[target year]': str(b['last_target_year']),
        # [X]/[Y]/[Z] in the talking points: households moved over the actuals window, then the
        # per-year rate the target implies against the per-year rate actually achieved.
        '[X]': hh_full(b['hh_moved']),
        '[Y]': hh_full(b['tgt_rate']),
        '[Z]': hh_full(b['hist_rate']),
    })
    t = _table(slide, 'Table 502')
    if t is None:
        return
    c = b['coverage']
    for j in range(4):
        set_cell(t, 1, j + 1, pct(c['sm'][j]))
        set_cell(t, 2, j + 1, pct(c['basic'][j]))
        set_cell(t, 3, j + 1, pct(c['less'][j]))
        set_cell(t, 4, j + 1, hh(c['total_hh'][j]))



def _fill_service_gap(slide, b):
    replace_tokens(slide, {
        '[baseline year]': str(b['baseline_year']),
        '[target year]': str(b['last_target_year']),
        '[X]': hh_full(b['unserved_baseline']),
        '[Y]': hh_full(b['gap_end']),
    })
    sh = _chart_shape(slide, 'Service gap chart')
    if sh is None:
        return
    g = b['service_gap']
    # Chart values must match the template's ('000) axis title — the engine's millions would plot as
    # 0.48 and render an axis of repeated 0s and 1s.
    set_chart(sh, [str(y) for y in g['years']],
              [('Covered under BAU', [v * 1000 for v in g['covered']]),
               ('Service gap to target', [v * 1000 for v in g['gap']])])
    # No recolouring here: the template ships this chart already styled — deep teal covered / pale
    # cyan gap, each with a label colour chosen to read on its own fill — and `set_chart` maps that
    # formatting onto the new data positionally. Restyle the chart in the template and the export
    # follows; painting the tool's palette over it, as this used to, would fight the design.
    # At the baseline year the target path starts from BAU, so the gap there is zero by construction
    # and its label is noise — drop any label that would read '0'.
    hide_zero_data_labels(sh.chart)


def _fill_investment(slide, b, cur):
    t = _table(slide, 'Table 501')
    periods = b['investment']['periods']
    if t is not None:
        # Drop the US$ columns (2, 4, 6) — the deck reports local currency only.
        delete_table_columns(t, [2, 4, 6])
        # Then trim any period column the target years don't produce (a single target year gives
        # one period plus the total, not two).
        want = 1 + len(periods)
        if len(t.columns) > want:
            delete_table_columns(t, list(range(want, len(t.columns))))
        for j, lbl in enumerate(periods):
            set_cell(t, 0, j + 1, f'{lbl}\n({cur} b)')
        while len(t.rows) < len(b['investment']['rows']) + 1:
            clone_table_row(t, 1, len(t.rows) - 1)
        for i, (label, vals) in enumerate(b['investment']['rows']):
            set_cell(t, i + 1, 0, label)
            for j, v in enumerate(vals[:len(periods)]):
                set_cell(t, i + 1, j + 1, bn(v))
        fit_table(t, _room_below(slide, _table_shape(slide, 'Table 501')))
    note = find_shape(slide, 'T503')
    if note is not None:
        _set_full_text(note, (
            f"Residual-ledger subtotal: {bn(b['total_need_m'])} billion {cur} to {b['last_target_year']}.\n"
            f"Remaining financing gap: {bn(b['financing_gap_m'])} billion {cur}.\n"
            "Gap = residual new-service cost + replacement requirement − replacement credit + cash deficit.\n"
            "Available capital has already financed modeled connections; no second credit applies.\n"
            "Replacement reserve uses coverage stock; reported obligations use target-needs stock.\n"
            "Connection purchases are pre-cap allocations, not actual delivery."))


def _fill_interventions(slide, b, cur):
    rows = b['interventions']['rows']
    ch = b['interventions']['chart']
    sh = _chart_shape(slide, 'Fan chart')
    if sh is not None and ch['years']:
        # The template's chart is a COMBO: a stacked-area group for the bands plus a line group for a
        # reference line — the same shape as the tool's on-screen chart, so the target goes on the line.
        k = lambda vs: [v * 1000 for v in vs]          # engine millions -> the chart's ('000) axis
        areas = [('BAU (safely managed)', k(ch['base']))] + [(lbl, k(vals)) for lbl, _, vals in ch['bands']]
        groups = chart_groups(sh.chart)
        lines = [('Target', k(ch['target']))] if len(groups) > 1 and ch.get('target') else []
        if len(groups) > 1:
            set_group_series_counts(sh.chart, [len(areas), len(lines)])
        set_chart(sh, [str(y) for y in ch['years']], areas + lines)
        _color_series(sh.chart, [BAU_FILL] + [c for _, c, _ in ch['bands']] + [TARGET_LINE] * len(lines))
        # Baseline-to-target is 15+ columns; label every fifth year rather than every one.
        set_category_label_step(sh.chart, year_label_step(ch['years']))

    t = _table(slide, 'Table 501')
    if t is not None:
        set_cell(t, 0, 1, f'Resources generated ({cur} b)')
        set_cell(t, 0, 2, "Added HHs ('000)")
        # The template ships 4 lever rows between the header and the Total row; grow or shrink to fit.
        TEMPLATE_LEVER_ROWS = 4
        n = len(rows)
        if n > TEMPLATE_LEVER_ROWS:
            for _ in range(n - TEMPLATE_LEVER_ROWS):
                clone_table_row(t, 1, TEMPLATE_LEVER_ROWS)
        elif n < TEMPLATE_LEVER_ROWS:
            delete_table_rows(t, list(range(1 + n, 1 + TEMPLATE_LEVER_ROWS)))
        for i, r in enumerate(rows):
            set_cell(t, i + 1, 0, r['label'])
            set_cell(t, i + 1, 1, 'n/a' if r['money_m'] is None else bn(r['money_m'], 2))
            set_cell(t, i + 1, 2, hh(r['added_hh'], 1))
        tot_money = sum((r['money_m'] or 0.0) for r in rows)
        set_cell(t, n + 1, 0, 'Total')
        set_cell(t, n + 1, 1, bn(tot_money, 2))
        set_cell(t, n + 1, 2, hh(sum(r['added_hh'] for r in rows), 1))
        # Give the intervention names the width they need so they stop wrapping, then size the type
        # to whatever vertical room is actually left above the talking-points card.
        set_column_weights(t, [2.1, 1.0, 0.9])
        fit_table(t, _room_below(slide, _table_shape(slide, 'Table 501')))
    replace_tokens(slide, {'[cur]': cur})


def _fill_detail(slide, b, row, inputs, sk, cur):
    """One intervention's detail slide. Only the tool-known figures are filled; the narrative
    placeholders stay as bracketed prompts for whoever presents the deck."""
    if isinstance(inputs, list):
        labelled = [(label, DD.lever_performance(fe, sk, row['key'])) for label, fe in inputs]
        perfs = [p for _, p in labelled]
        def combined(field):
            values = [p.get(field) for p in perfs]
            return values[0] if values and all(v == values[0] for v in values) else \
                '; '.join(f'{label}: {p.get(field, "n/a")}' for label, p in labelled)
        starts = [p.get('start_year') for p in perfs if p.get('start_year')]
        ends = [p.get('target_year') for p in perfs if p.get('target_year')]
        perf = {'current': combined('current'), 'target': combined('target'),
                'start_year': min(starts) if starts else None,
                'target_year': max(ends) if ends else None}
    else:
        perf = DD.lever_performance(inputs, sk, row['key'])
    title = find_shape(slide, 'Text 0')
    if title is not None:
        set_text(title, title.text_frame.text.replace('[intervention name]', row['label']))
    replace_tokens(slide, {
        '[X]': 'n/a' if row['money_m'] is None else bn(row['money_m'], 2),
        '[Y]': hh(row['added_hh'], 1),
        '[Z]': 'n/a',                      # the model carries no per-lever programme cost
        '[start year]': str(perf.get('start_year') or b['baseline_year'] + 1),
        '[end year]': str(perf.get('target_year') or b['end_year']),
        '[current value]': perf.get('current', 'n/a'),
        '[target value]': perf.get('target', 'n/a'),
        '[year]': str(perf.get('target_year') or b['end_year']),
    })


def _fill_exec(slide, d, cur, lt):
    """Executive summary: the 3-scope × 2-sector coverage table plus the two summary cards."""
    blocks = d['blocks']
    # Opening sentence quotes the FINAL target. Water and sanitation can differ, so say so when they do.
    fin = []
    for sk in DD.SECTORS:
        for sc in ('national', 'urban', 'rural'):
            if (sc, sk) in blocks:
                fin.append(blocks[(sc, sk)]['coverage']['sm'][-1])
                break
    same = len(set(round(f, 4) for f in fin)) == 1
    tgt_txt = pct(fin[0]) if same else ' / '.join(pct(f) for f in fin) + ' (water / sanitation)'
    # Scoped to the opening sentence: `[target]` also appears on the investment card below, where it
    # needs different wording, and a slide-wide pass here would consume it first.
    opener = find_shape(slide, 'TextBox 501')
    if opener is not None:
        replace_tokens(opener, {
            '[Country]': d['country'],
            # The sentence already carries a literal "%", so hand it the bare number when they agree.
            '[target]': (tgt_txt[:-1] if same else tgt_txt),
            '[target year]': str(lt), '[end year]': str(d['end_year']),
        })
    replace_tokens(_table_shape(slide, 'Table 503') or slide, {
        '[baseline year]': str(d['baseline_year']), '[last target year]': str(lt),
    })

    t = _table(slide, 'Table 503')
    if t is not None:
        order = [('urban', 'Urban areas'), ('rural', 'Rural areas'), ('national', 'National')]
        keep, ri = [], 1
        for sc, label in order:
            for sk in DD.SECTORS:
                if (sc, sk) not in blocks:
                    continue
                b = blocks[(sc, sk)]
                keep.append((ri, label if sk == 'water_supply' else '',
                             'Water' if sk == 'water_supply' else 'Sanitation',
                             b['cov_now'], b['cov_tgt_end'], b['cov_bau_end'], b['cov_scn_end']))
                ri += 1
        for r, c0, c1, now, tg, bau, scn in keep:
            set_cell(t, r, 0, c0)
            set_cell(t, r, 1, c1)
            set_cell(t, r, 2, pct(now))
            set_cell(t, r, 3, pct(tg))
            set_cell(t, r, 4, pct(bau))
            set_cell(t, r, 5, pct(scn))
        if len(keep) + 1 < len(t.rows):
            delete_table_rows(t, list(range(len(keep) + 1, len(t.rows))))

    # Card 1 — investment. Reported per sector at national level, per the agreed scope.
    inv = find_shape(slide, 'TextBox 505')
    if inv is not None:
        # Kept terse: this card is a fixed 5.6" × 1.1" box, and the template's own wording already
        # fills most of it, so the figures get no decimals and the shortest possible sector labels.
        parts, need_parts = [], []
        for sk in DD.SECTORS:
            b = _widest(blocks, sk)
            if not b:
                continue
            name = 'water' if sk == 'water_supply' else 'san.'
            parts.append(f"{bn(b['bau_investment_m'], 0)}b {name}")
            need_parts.append(f"{bn(b['total_need_m'], 0)}b {name}")
        gap_parts = []
        for sk in DD.SECTORS:
            b = _widest(blocks, sk)
            if b:
                gap_parts.append(f"{bn(b['financing_gap_m'], 0)}b {'water' if sk == 'water_supply' else 'san.'}")
        _set_full_text(inv, (
            f"Residual financing ({d['baseline_year'] + 1}–{lt})\n"
            f"Available capital: {cur} {' + '.join(parts)}.\n"
            f"Residual-ledger subtotal: {cur} {' + '.join(need_parts)}; "
            f"remaining gap: {cur} {' + '.join(gap_parts)}."))

    # Card 2 — the resources each reform mobilises, summed across the scopes shown.
    res = find_shape(slide, 'TextBox 507')
    if res is not None:
        # The card names seven levers. Sanitation's NRW-linked revenue has no slot of its own, so it
        # folds into the NRW line — same programme, and it keeps the itemised figures summing to the
        # headline total instead of quietly falling short of it.
        ALIAS = {'NRW-linked sanitation revenue': 'NRW reduction'}
        totals, order = {}, []
        for (sc, sk), b in blocks.items():
            if sc != _headline_scope(blocks):
                continue
            for r in b['interventions']['rows']:
                lbl = ALIAS.get(r['label'], r['label'])
                if lbl not in totals:
                    order.append(lbl)
                totals[lbl] = totals.get(lbl, 0.0) + (r['money_m'] or 0.0)
        grand = sum(totals.values())
        replace_tokens(res, {'[sum]': f'{cur} {bn(grand)}b'})
        # The template lists all seven levers with an [X]b slot; feed them in the order they appear.
        vals = [f'{bn(totals.get(lbl, 0.0), 2)}' for lbl in _template_lever_order(res, order)]
        replace_tokens(res, {'[X]': vals})


def _template_lever_order(shape, order):
    """The lever names the template's card lists, in its own order, so figures line up with labels."""
    text = shape.text_frame.text
    known = ['Increased collection efficiency', 'NRW reduction', 'Budget execution improvement',
             'Capex efficiency (unit cost)', 'Optimized technology selection',
             'Optimised technology selection', 'Tariff reform', 'Microfinance']
    found = sorted((text.index(k), k) for k in known if k in text)
    canon = {'Optimized technology selection': 'Optimised technology selection'}
    return [canon.get(k, k) for _, k in found]


def _headline_scope(blocks):
    for sc in ('national', 'urban', 'rural'):
        if any(k[0] == sc for k in blocks):
            return sc
    return None


def _widest(blocks, sk):
    for sc in ('national', 'urban', 'rural'):
        if (sc, sk) in blocks:
            return blocks[(sc, sk)]
    return None


def _set_full_text(shape, text):
    """Replace all paragraphs, not just the first, while retaining template styles."""
    lines = text.split('\n')
    for i, line in enumerate(lines):
        set_text(shape, line, para_idx=i)
    for para in list(shape.text_frame.paragraphs)[len(lines):]:
        para._p.getparent().remove(para._p)


def _strip_usd(shape):
    """Drop the template's parenthetical US$ figure — the deck reports local currency only."""
    import re
    for p in shape.text_frame.paragraphs:
        for r in p.runs:
            if 'US$' in r.text:
                r.text = re.sub(r'\s*\(US\$[^)]*\)', '', r.text)


def _fill_objectives(slide, d):
    """Slide 5 lists the reforms considered — narrow it to the ones actually switched on."""
    enabled = []
    for b in d['blocks'].values():
        for r in b['interventions']['rows']:
            if r['label'] not in enabled:
                enabled.append(r['label'])
    if not enabled:
        return
    for sh in iter_shapes(slide.shapes):
        if not sh.has_text_frame:
            continue
        paras = sh.text_frame.paragraphs
        lever_ps = [p for p in paras if p.level == 1 and "".join(r.text for r in p.runs).strip()]
        if len(lever_ps) < 3:
            continue
        for i, p in enumerate(lever_ps):
            if i < len(enabled):
                if p.runs:
                    p.runs[0].text = enabled[i]
                    for r in p.runs[1:]:
                        r._r.getparent().remove(r._r)
            else:
                p._p.getparent().remove(p._p)
        break


def _fill_hh_forecast(slide, d):
    """Household forecast: one column series per entered area, at the deck's four reference years."""
    res, years = d['results'], d['years']
    b = next(iter(d['blocks'].values()))
    cats = [b['first_data_year'], b['baseline_year'], b['first_target_year'], b['last_target_year']]
    idx = [years.index(y) if y in years else len(years) - 1 for y in cats]

    parts = [(sc, res[sc]) for sc in ('urban', 'rural') if sc in res] or \
            [(sc, res[sc]) for sc in ('national',) if sc in res]
    series = [(f'{SCOPE_TITLE[sc]} HHs', [r['total_hh'][i] * 1000 for i in idx]) for sc, r in parts]
    sh = _chart_shape(slide, 'HH forecast chart')
    if sh is not None and series:
        set_chart(sh, [str(y) for y in cats], series)

    tot0 = sum(s[1][0] for s in series) / 1000.0     # back to millions for the prose helpers
    tot1 = sum(s[1][-1] for s in series) / 1000.0
    span = max(1, cats[-1] - cats[0])
    cagr = ((tot1 / tot0) ** (1.0 / span) - 1.0) if tot0 > 0 else 0.0
    replace_tokens(slide, {
        '[X]': hh_full(tot0), '[Y]': hh_full(tot1),
        '[target year]': str(cats[-1]), '[Z]': f'{cagr * 100:.1f}',
    })


def _contents_entries(prs, d, present, lever_rows):
    """Rebuild the contents list with the sections that survived and their real slide numbers."""
    entries = [{'chip': '1', 'title': 'Methodology and definitions',
                'range': f'Slides {IDX_METHOD_DIV + 1}–{IDX_HHFORECAST + 1}'}]
    n = IDX_HHFORECAST + 1                       # 1-based number of the last methodology slide
    i = 2
    for sc, sk, _ in present:
        rows = lever_rows[(sc, sk)]
        # A block is 5 fixed slides (divider, coverage, service gap, investment gap, interventions)
        # plus one detail slide per lever. With no levers, the last two are dropped and only 4 remain.
        length = (BLOCK_LEN - 1) + len(rows) if rows else (BLOCK_LEN - 2)
        start, end = n + 1, n + length
        entries.append({'chip': str(i),
                        'title': f'{SCOPE_TITLE[sc]} {SECTOR_TITLE[sk]}',
                        'range': f'Slides {start}–{end}'})
        n, i = end, i + 1
    entries.append({'chip': '—', 'title': 'Appendices', 'range': f'Slides {n + 1}–{n + 2}'})
    return entries


# ── contents page ───────────────────────────────────────────────────────────────────────────────

CONTENTS_ROWS = [
    ('C604', 'Chip605', 'T606', 'T607'),
    ('C609', 'Chip610', 'T611', 'T612'),
    ('C614', 'Chip615', 'T616', 'T617'),
    ('C619', 'Chip620', 'T621', 'T622'),
    ('C624', 'Chip625', 'T626', 'T627'),
    ('C629', 'Chip630', 'T631', 'T632'),
    ('C701', 'Chip702', 'T703', 'T704'),
    ('C706', 'Chip707', 'T708', 'T709'),
]


def _rebuild_contents(slide, entries, exec_slide_no):
    """Rewrite the contents page for the sections that actually survived.

    The slide ranges are not bracketed in the template, but they would be wrong the moment a scope is
    dropped or an intervention slide is cloned, so they are recomputed. Surviving rows are re-flowed
    into the template's own 2-column grid and the extra rows deleted."""
    t603 = find_shape(slide, 'T603')
    if t603 is not None:
        set_text(t603, f'Slide {exec_slide_no}')

    rows = [[find_shape(slide, n) for n in names] for names in CONTENTS_ROWS]
    rows = [r for r in rows if all(s is not None for s in r)]
    slots = [(sh[0].left, sh[0].top) for sh in rows]        # the template's own grid positions

    for i, entry in enumerate(entries):
        if i >= len(rows):
            break
        card, chip, title, rng = rows[i]
        dx, dy = slots[i][0] - card.left, slots[i][1] - card.top
        for s in (card, chip, title, rng):
            s.left, s.top = s.left + dx, s.top + dy
        set_text(chip, entry['chip'])
        set_text(title, entry['title'])
        set_text(rng, entry['range'])
    for card, chip, title, rng in rows[len(entries):]:
        for s in (card, chip, title, rng):
            s._element.getparent().remove(s._element)


# ── main ────────────────────────────────────────────────────────────────────────────────────────

def _check_template(path: str) -> None:
    """Fail with an actionable message when the template is an unfetched Git LFS pointer.

    The .pptx is stored in LFS, so a clone or deploy on a machine without git-lfs leaves a ~130-byte
    text stub in its place. python-pptx then raises PackageNotFoundError, which reads like a missing
    file rather than an un-hydrated one and sends you looking in the wrong direction."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"Deck template missing: {path}")
    if os.path.getsize(path) < 1024:
        with open(path, 'rb') as f:
            head = f.read(64)
        if head.startswith(b'version https://git-lfs'):
            raise RuntimeError(
                f"Deck template at {path} is an unfetched Git LFS pointer, not the .pptx. "
                f"Install git-lfs and run `git lfs pull` (or `git lfs checkout`) in the repo."
            )


def build_deck(area_inputs: Dict[str, dict], template_path: str = TEMPLATE_A) -> io.BytesIO:
    _check_template(template_path)
    d = DD.build(area_inputs)
    cur = d['currency']
    prs = Presentation(template_path)

    present = [(sc, sk, i) for sc, sk, i in BLOCKS if (sc, sk) in d['blocks']]
    # A block with no enabled lever loses its interventions + detail slides.
    lever_rows = {(sc, sk): d['blocks'][(sc, sk)]['interventions']['rows'] for sc, sk, _ in present}

    # ── global slides ───────────────────────────────────────────────────────────────────────────
    first = d['blocks'][present[0][:2]] if present else None
    lt = first['last_target_year'] if first else d['end_year']
    replace_tokens(prs.slides[IDX_TITLE], {
        '[Country]': d['country'], '[Baseline year]': str(d['baseline_year']),
        '[End year]': str(d['end_year']),
    })
    _fill_exec(prs.slides[IDX_EXEC], d, cur, lt)
    replace_tokens(prs.slides[IDX_OBJECTIVES], {
        '[Country]': d['country'], '[Target years]': ', '.join(str(y) for y in d['target_years']),
    })
    _fill_objectives(prs.slides[IDX_OBJECTIVES], d)
    _fill_hh_forecast(prs.slides[IDX_HHFORECAST], d)
    replace_tokens(prs.slides[IDX_APPENDIX_A], {
        '[target year]': str(lt), '[x]': str(d['asset_life']),
    })

    # ── per-block content, and the clone plan ───────────────────────────────────────────────────
    # Fill in place first (template indices are still valid), then clone/delete from the BOTTOM up so
    # earlier indices never shift under us.
    for sc, sk, base in present:
        b = d['blocks'][(sc, sk)]
        _fill_coverage(prs.slides[base + 1], b, cur)
        _fill_service_gap(prs.slides[base + 2], b)
        _fill_investment(prs.slides[base + 3], b, cur)
        if lever_rows[(sc, sk)]:
            _fill_interventions(prs.slides[base + 4], b, cur)

    # Hold slide OBJECTS, not indices: the first clone or delete renumbers everything after it, so any
    # index captured up front is stale by the time it is used.
    snapshot = list(prs.slides)
    doomed = []
    for sc, sk, base in BLOCKS:
        if (sc, sk) not in d['blocks']:
            doomed.extend(snapshot[base:base + BLOCK_LEN])
        elif not lever_rows[(sc, sk)]:
            doomed.extend([snapshot[base + 4], snapshot[base + 5]])
    for s in doomed:
        delete_slide_obj(prs, s)

    for sc, sk, base in BLOCKS:
        if (sc, sk) not in d['blocks'] or not lever_rows[(sc, sk)]:
            continue
        b, rows = d['blocks'][(sc, sk)], lever_rows[(sc, sk)]
        detail = snapshot[base + 5]
        at = index_of(prs, detail)
        # One detail slide per enabled lever: fill the template's own, then clone it for the rest.
        clones = [detail] + [clone_slide(prs, at, insert_at=at + k) for k in range(1, len(rows))]
        if sc == 'national' and sc not in d['area_inputs']:
            scope_inputs = [(SCOPE_TITLE[s], d['area_inputs'][s])
                            for s in ('urban', 'rural') if s in d['area_inputs']]
        else:
            scope_inputs = d['area_inputs'].get(sc) or d['inputs']
        for slide, row in zip(clones, rows):
            _fill_detail(slide, b, row, scope_inputs, sk, cur)

    # ── contents + prompts ──────────────────────────────────────────────────────────────────────
    _rebuild_contents(prs.slides[IDX_CONTENTS], _contents_entries(prs, d, present, lever_rows),
                      IDX_EXEC + 1)
    for s in prs.slides:
        drop_prompt_shapes(s, canvas=(prs.slide_width, prs.slide_height))

    out = io.BytesIO()
    prs.save(out)
    out.seek(0)
    return out
