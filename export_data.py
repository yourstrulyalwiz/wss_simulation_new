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
import re

from demo_adapter import coerce_to_engine, financial_toggles
from model.engine import calculate

# One backend registry for spreadsheet/deck labels, order and cash-source keys.
from deck_data import WATER_INTV as _WATER_INTV, SAN_INTV as _SAN_INTV
WATER_INTV = [definition[:3] for definition in _WATER_INTV]
SAN_INTV = [definition[:3] for definition in _SAN_INTV]


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
        f'Residual-ledger subtotal ({cur} M)', f'Total BAU available capital ({cur} M)',
        f'Financing gap — BAU sector-wide ({cur} M)',
        f'Financing gap — BAU safely-managed ({cur} M)',
        f'Financing gap — BAU basic ({cur} M)',
        f'Financing gap — with interventions ({cur} M)',
    ]
    ledger_fields = [
        ('Baseline collected revenue — annual flow', 'baseline_collected_revenue'),
        ('Scenario collected revenue — annual flow', 'collected_revenue'),
        ('Additional collected revenue — annual flow', 'additional_collected_revenue'),
        ('Reference collected revenue — annual flow', 'reference_collected_revenue'),
        ('Connection gross revenue difference — annual flow', 'connection_revenue_delta'),
        ('Connection net cash — annual flow', 'connection_net_cash'),
        ('Total additional net cash — annual flow', 'additional_net_cash'),
        ('Collection cash — annual flow', 'collection_cash'),
        ('Tariff cash incl. collection interaction — annual flow', 'tariff_cash'),
        ('Annual planned expansion cost — flow', 'annual_planned_expansion_cost'),
        ('Catch-up requirement before funding — snapshot', 'catch_up_requirement'),
        ('Closing outstanding expansion — balance', 'closing_outstanding_expansion'),
        ('Endline financing requirement — balance plus accumulated shortfalls', 'endline_financing_requirement'),
        ('Gross funded asset stock — balance', 'funded_asset_stock'),
        ('Sector-funded expansion — flow', 'sector_funded_expansion'),
        ('Externally funded expansion — flow', 'externally_funded_expansion'),
        ('Fixed ancillary outstanding — balance', 'ancillary_outstanding'),
        ('Fixed ancillary paid — flow', 'ancillary_paid'),
        ('Capital credited to due expansion — flow', 'capital_credited_to_due_expansion'),
        ('Closing outstanding expansion (legacy residual new-service cost)', 'new_capex_total'),
        ('Reported replacement requirement', 'replacement_capex'),
        ('Coverage-stock replacement basis', 'bau_replacement_capex'),
        ('Replacement funding reserved', 'replacement_reserved'),
        ('Replacement credit', 'replacement_credit'),
        ('Unfunded replacement', 'unfunded_replacement'),
        ('Cash deficit', 'cash_deficit'),
        ('Total available capital', 'available_total'),
        ('Expansion capital available', 'expansion_capital_available'),
        ('Actual funded connection purchases', 'connection_purchase_capital'),
        ('Unallocated positive expansion capital', 'unallocated_positive_capital'),
    ]
    headers += [f'{label} — {pass_label} ({cur} M)'
                for pass_label in ('BAU', 'scenario') for label, _ in ledger_fields]
    attributed_fields = [
        ('Residual new-service cost', 'new_capex_by_service'),
        ('Replacement requirement', 'replacement_by_service'),
        ('Replacement credit', 'replacement_credit_by_service'),
        ('Cash deficit', 'cash_deficit_by_service'),
        ('Remaining financing gap', 'financing_gap_by_service'),
    ]
    headers += [f'{label} — {pass_label} {service} ({cur} M)'
                for pass_label in ('BAU', 'scenario') for service in ('safely-managed', 'basic')
                for label, _ in attributed_fields]
    access_fields = [
        ('Original SM target', 'target_hh', 0),
        ('Original basic-only target', 'target_hh', 1),
        ('SM coverage', 'bau_hh', 0),
        ('Basic-only coverage', 'bau_hh', 1),
        ('SM overachievement', 'sm_overachievement', None),
        ('Effective basic-only target after SM credit', 'effective_basic_only_target', None),
        ('SM access gap', 'sm_access_gap', None),
        ('Basic-only target shortfall after SM credit — diagnostic', 'adjusted_basic_only_gap', None),
        ('At-least-basic target', 'at_least_basic_target', None),
        ('At-least-basic coverage', 'at_least_basic_coverage', None),
        ('At-least-basic access gap — basic-entry costing', 'at_least_basic_access_gap', None),
        ('Outstanding SM upgrades', 'closing_outstanding_hh', 0),
        ('Outstanding lower-to-basic entries', 'closing_outstanding_hh', 1),
    ]
    headers += [f'{label} — {pass_label} (M HH)'
                for pass_label in ('BAU', 'scenario') for label, _, _ in access_fields]
    from revenue_export import FIELDS
    detailed_revenue_fields = list(FIELDS)
    headers += [f'Revenue detail: {label} — {pass_label} ({unit.format(currency=cur)})'
                for pass_label in ('BAU', 'scenario') for label, _, unit in detailed_revenue_fields]
    headers += ['Revenue mode — BAU', 'Revenue configuration/provenance — source currency',
                'Revenue validation/limitations']
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
        ])
        rows[-1] += [round(g(prefix + key, i, rung0=False), 4)
                     for prefix in ('', 'scenario_') for _, key in ledger_fields]
        rows[-1] += [round(sec[prefix + key][rung][i], 4)
                     for prefix in ('', 'scenario_') for rung in (0, 1)
                     for _, key in attributed_fields]
        for prefix in ('', 'scenario_'):
            for _, key, rung in access_fields:
                name = 'scenario_hh' if prefix and key == 'bau_hh' else prefix + key
                values = sec[name]
                rows[-1].append(round(values[rung][i] if rung is not None else values[i], 6))
        for prefix in ('', 'scenario_'):
            # Excel stores ~15 significant digits; stabilize CSV/workbook round trips
            # without the old 4-decimal rounding of currency-million ledger summaries.
            rows[-1] += [float(f'{g(prefix + key, i, rung0=False):.15g}')
                         for _, key, _ in detailed_revenue_fields]
        status = sec.get('connection_revenue') or {}
        import json
        mode = 'Mixed' if status.get('mixed') else ('Aggregate coverage expansion' if status.get('effective') else 'Exogenous')
        rows[-1] += [mode, json.dumps(status.get('configuration') or status.get('area_configurations') or {},
                                    ensure_ascii=False) if y == inputs.get('period', {}).get('baseline_year') else None,
                     '; '.join((status.get('errors') or []) + (status.get('warnings') or [])) or None]
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
    sector = 'water' if sector_key == 'water_supply' else 'sanitation'
    debt_cfg = ((inputs.get('utility_debt') or {}).get(sector) or {})
    debt_active = bool(debt_cfg.get('enabled')) and float(debt_cfg.get('allocation_share') or 0) > 0
    if not enabled and not debt_active:
        return []
    # Same GLOBAL order as dashboard and branded deck, including intervening levers.
    from deck_data import cumulative_passes
    passes, global_enabled, _ = cumulative_passes([inputs])
    years = passes[0]['years']
    by = _baseline_year(inputs, years)
    e = len(years) - 1

    def sm_end(res):
        return (res[sector_key]['scenario_hh'][0][e] or 0.0)

    def cash_cum(res, field):
        arr = res[sector_key].get(field) or []
        return sum((arr[i] or 0.0) for i, y in enumerate(years) if y > by)

    def gap_cum(res):
        return res[sector_key]['scenario_endline_financing_requirement'][e]

    out = []
    for idx, (key, label, rkey) in enumerate(enabled):
        idx = next(i for i, d in enumerate(global_enabled) if d[0] == key)
        before, after = passes[idx], passes[idx + 1]
        add_hh = sm_end(after) - sm_end(before)                 # signed, millions
        res = (cash_cum(after, rkey) - cash_cum(before, rkey)) / 1000.0 if rkey else None  # M → B
        if rkey in ('scenario_connection_net_cash', 'scenario_collection_cash',
                    'scenario_tariff_cash', 'scenario_nrw_net', 'scenario_nrw_link_cash'):
            res = cash_cum(passes[-1], rkey) / 1000.0
        gap_closed = (gap_cum(before) - gap_cum(after)) / 1000.0  # signed change; M → B
        out.append((label, round(add_hh, 5), (round(res, 4) if res is not None else None), round(gap_closed, 4)))
    if debt_active:
        final_with_debt = calculate(coerce_to_engine(inputs))
        no_debt = passes[-1]
        debt_summary = final_with_debt[sector_key].get('scenario_utility_debt') or {}
        add_hh = sm_end(final_with_debt) - sm_end(no_debt)
        principal = float(debt_summary.get('accepted_principal') or 0.0) / 1000.0
        gap_closed = (gap_cum(no_debt) - gap_cum(final_with_debt)) / 1000.0
        out.append(('Utility debt financing', round(add_hh, 5), round(principal, 4), round(gap_closed, 4)))
    return out


def breakdown_table(inputs, sector_key, defs):
    cur = _cur(inputs)
    headers = ['Intervention', 'Added safely-managed (M HH)', f'Resources / financing ({cur} B)', f'Financing gap closed ({cur} B)']
    rows = []
    for label, add_hh, res, gap in intervention_breakdown(inputs, sector_key, defs):
        rows.append([label, add_hh, ('n/a' if res is None else res), gap])
    return headers, rows


def _currency_table(headers, rows, currency_display, *, selected_currency=None):
    """Translate only table columns whose headers explicitly carry the source money unit."""
    if not currency_display or currency_display.get('mode') != 'usd':
        return list(headers), [list(row) for row in rows], []
    source = currency_display['source_currency']
    factor = currency_display['factor']
    indexes = []
    output_headers = []
    for index, header in enumerate(headers):
        text = str(header)
        is_money = bool(re.search(rf'\({re.escape(source)}(?: [MB]\)|/(?:HH/year|m³), real\))', text, re.IGNORECASE))
        if is_money:
            indexes.append(index)
            text = re.sub(rf'\({re.escape(source)} ([MB])\)', r'(US$ \1)', text, flags=re.IGNORECASE)
            text = re.sub(rf'\({re.escape(source)}/', '(US$/', text, flags=re.IGNORECASE)
        output_headers.append(text)
    output_rows = []
    for row in rows:
        converted = list(row)
        for index in indexes:
            if index < len(converted) and isinstance(converted[index], (int, float)) and not isinstance(converted[index], bool):
                converted[index] = converted[index] * factor
        output_rows.append(converted)
    return output_headers, output_rows, indexes


def _currency_metadata(wb, currency_display, contribution_view):
    ws = wb.create_sheet('Export metadata', 0)
    ws.append(['Setting', 'Value'])
    ws.append(['Selected display currency', currency_display.get('display_currency', currency_display.get('source_currency', 'LCU'))])
    ws.append(['Source currency', currency_display.get('source_currency', 'LCU')])
    ws.append(['Contribution view', contribution_view])
    converted_usd = currency_display.get('mode') == 'usd' and currency_display.get('source_currency') != 'USD'
    ws.append(['Rate direction', 'Local currency units per US$1' if converted_usd else 'Not applied'])
    ws.append(['Rate', currency_display.get('rate') or ''])
    ws.append(['Rate reference year', currency_display.get('reference_year') or ''])
    ws.append(['Source / note', currency_display.get('source_note') or ''])
    ws.append(['Rate note', currency_display.get('rate_note', '')])
    ws.append(['Price-basis note', currency_display.get('price_basis_note', 'Model constant-price basis.')])
    ws.append(['Conversion', 'USD = local amount ÷ localPerUsd; model inputs and calculations are unchanged.' if converted_usd else 'No currency conversion applied; model inputs and calculations are unchanged.'])
    return ws


def _utility_debt_tables(sec, currency):
    from loan_reporting import loan_tables
    return loan_tables(sec.get('scenario_utility_debt') or {}, currency)


def _legacy_utility_debt_tables(sec, currency):
    debt = sec.get('scenario_utility_debt') or {}
    summary_headers = ['Assumption or balance', 'Value', f'Amount ({currency} M)']
    summary_rows = [
        ['Status', debt.get('status', 'disabled'), ''],
        ['Enabled', bool(debt.get('enabled')), ''],
        ['Verified feasible', bool(debt.get('verified_feasible')), ''],
        ['Eligible-revenue allocation share', debt.get('allocation_share', 0.0), ''],
        ['Selected revenue sources', ', '.join(debt.get('revenue_sources', ['collection', 'tariff', 'nrw'])) or 'None', ''],
        ['Net revenue assumption', debt.get('net_revenue_assumption', ''), ''],
        ['Sizing assumption', debt.get('sizing_assumption', ''), ''],
        ['Binding constraint', debt.get('binding_constraint', ''), ''],
        ['Tightest repayment year', debt.get('limiting_repayment_year'), ''],
        ['Start-year eligible revenue', '', debt.get('start_year_revenue', 0.0)],
        ['Start-year protected revenue', '', debt.get('start_year_protected_revenue', 0.0)],
        ['Start-year annual service capacity', '', debt.get('start_year_capacity', 0.0)],
        ['Start-year principal bound', '', debt.get('start_year_principal_bound', 0.0)],
        ['Annual real interest rate', debt.get('annual_real_interest_rate'), ''],
        ['Repayment structure', debt.get('repayment_structure'), ''],
        ['Disbursement year', debt.get('disbursement_year'), ''],
        ['Principal grace years', debt.get('principal_grace_years'), ''],
        ['First principal-payment year', debt.get('first_principal_year'), ''],
        ['Final principal-payment year', debt.get('maturity_year'), ''],
        ['Optional loan ceiling', '', debt.get('loan_ceiling')],
        ['Requested maximum principal', '', debt.get('requested_max_principal', 0.0)],
        ['Accepted principal', '', debt.get('accepted_principal', 0.0)],
        ['Total interest', '', debt.get('total_interest', 0.0)],
        ['Total principal repaid', '', debt.get('total_principal_repaid', 0.0)],
        ['Closing restricted loan cash', '', debt.get('closing_restricted_cash', 0.0)],
        ['Post-target capacity assumption', debt.get('tail_capacity_assumption', ''), ''],
    ]
    fields = [
        ('opening_principal', f'Opening principal ({currency} M)'),
        ('disbursement', f'Disbursement ({currency} M)'),
        ('principal_payment', f'Principal payment ({currency} M)'),
        ('interest_payment', f'Interest payment ({currency} M)'),
        ('total_debt_service', f'Total debt service ({currency} M)'),
        ('eligible_additional_revenue', f'Eligible additional revenue ({currency} M)'),
        ('total_additional_net_revenue', f'Total additional modeled net revenue ({currency} M)'),
        ('baseline_collected_revenue', f'Current-volume baseline-rate collections ({currency} M)'),
        ('funding_reference_collected_revenue', f'Funding-reference collections ({currency} M)'),
        ('reference_collected_revenue', f'Without-debt gross collections ({currency} M)'),
        ('collected_revenue', f'Scenario gross collections ({currency} M)'),
        ('billed_volume_million_m3', 'Billed volume (M m3)'),
        ('connection_billed_households', 'Billed household equivalents (HH)'),
        ('connection_gross_revenue', f'Connection gross revenue difference ({currency} M)'),
        ('connection_variable_cost_difference', f'Connection variable-cost difference ({currency} M)'),
        ('connection_net_cash', f'Connection net cash — excluded from debt eligibility ({currency} M)'),
        ('collection_net_cash', f'Collection incremental cash ({currency} M)'),
        ('tariff_net_cash', f'Tariff incremental cash ({currency} M)'),
        ('nrw_net_cash', f'NRW net cash ({currency} M)'),
        ('nrw_sales_cash', f'NRW sales cash ({currency} M)'),
        ('nrw_implementation_cost', f'NRW implementation costs ({currency} M)'),
        ('protected_eligible_revenue', f'Protected eligible net revenue ({currency} M)'),
        ('pre_debt_available_capital', f'Pre-debt available capital ({currency} M)'),
        ('replacement_requirement', f'Replacement requirement ({currency} M)'),
        ('annual_service_capacity', f'Annual service capacity ({currency} M)'),
        ('reference_eligible_additional_revenue', f'Without-debt eligible revenue ({currency} M)'),
        ('reference_protected_eligible_revenue', f'Without-debt protected revenue ({currency} M)'),
        ('reference_annual_service_capacity', f'Without-debt annual service capacity ({currency} M)'),
        ('repayment_headroom', f'Repayment headroom ({currency} M)'),
        ('payment_shortfall', f'Payment shortfall ({currency} M)'),
        ('closing_principal', f'Closing principal ({currency} M)'),
        ('opening_restricted_cash', f'Opening restricted cash ({currency} M)'),
        ('investment_from_loan_proceeds', f'Loan-funded investment ({currency} M)'),
        ('closing_restricted_cash', f'Closing restricted cash ({currency} M)'),
    ]
    schedule_headers = ['Year', *[label for _, label in fields]]
    schedule_rows = [
        [row.get('year'), *[row.get(key, 0.0) for key, _ in fields]]
        for row in [
            {**row, **next((s for s in debt.get('schedule', []) if s['year'] == row['year']), {})}
            for row in debt.get('annual_revenue', debt.get('schedule') or [])
        ]
    ]
    return (summary_headers, summary_rows), (schedule_headers, schedule_rows)


# ── whole-scenario CSV / XLSX (everything: per-year series + intervention breakdown, both sectors) ───
def scenario_csv(inputs, currency_display=None, contribution_view='individual'):
    result = calculate(coerce_to_engine(inputs))
    out = io.StringIO()
    w = csv.writer(out)
    display = currency_display or {'mode': 'local', 'source_currency': _cur(inputs), 'display_currency': _cur(inputs), 'rate_note': 'Local-currency results; no conversion applied.', 'price_basis_note': 'Model constant-price basis.'}
    converted_usd = display.get('mode') == 'usd' and display.get('source_currency') != 'USD'
    w.writerow(['Selected display currency', display.get('display_currency', display.get('source_currency'))])
    w.writerow(['Source currency', display.get('source_currency')])
    w.writerow(['Contribution view', contribution_view])
    w.writerow(['Rate direction', 'Local currency units per US$1' if converted_usd else 'Not applied'])
    w.writerow(['Rate', display.get('rate')])
    w.writerow(['Rate reference year', display.get('reference_year')])
    w.writerow(['Source / note', display.get('source_note')])
    w.writerow(['Rate note', display.get('rate_note')])
    w.writerow(['Price basis', display.get('price_basis_note')])
    w.writerow(['Conversion', 'USD = local amount ÷ localPerUsd; model inputs and calculations are unchanged.' if converted_usd else 'No currency conversion applied; model inputs and calculations are unchanged.'])
    w.writerow([])
    for sk, name in [('water_supply', 'WATER SUPPLY'), ('sanitation', 'SANITATION')]:
        headers, rows = per_year_table(result, inputs, sk)
        local_headers, local_rows = headers, rows
        headers, rows, money_indexes = _currency_table(headers, rows, display)
        w.writerow([name + ' — forecast (per year)'])
        w.writerow(headers)
        w.writerows(rows)
        if converted_usd:
            w.writerow([name + ' — source-currency monetary detail'])
            w.writerow(['Year', *[local_headers[i] for i in money_indexes]])
            w.writerows([[row[0], *[row[i] for i in money_indexes]] for row in local_rows])
        debt_summary, debt_schedule = _utility_debt_tables(result[sk], _cur(inputs))
        for label, table in [('indicative loan assumptions and balances', debt_summary),
                             ('indicative loan proceeds use', debt_schedule)]:
            dh, dr = table
            source_h, source_r = dh, dr
            dh, dr, debt_money_indexes = _currency_table(dh, dr, display)
            w.writerow([name + ' — ' + label])
            w.writerow(dh)
            w.writerows(dr)
            if converted_usd:
                w.writerow([name + ' — ' + label + ' (source currency)'])
                w.writerow(source_h)
                w.writerows(source_r)
        w.writerow([])
        defs = WATER_INTV if sk == 'water_supply' else SAN_INTV
        if contribution_view == 'category':
            category_rows, local_category_rows = _category_contributions(inputs, sk, defs, display.get('factor', 1.0))
            w.writerow([name + ' — contribution by category'])
            w.writerow(['Category', 'Added safely-managed (M HH)',
                        f'Gap closed (B {display.get("display_currency", _cur(inputs))})', 'Resources'])
            w.writerows(category_rows if category_rows else [['(no contributing interventions)']])
            if converted_usd:
                w.writerow([name + ' — source-currency category detail'])
                w.writerow(['Category', 'Added safely-managed (M HH)', f'Gap closed (B {_cur(inputs)})', 'Resources'])
                w.writerows(local_category_rows if local_category_rows else [['(no contributing interventions)']])
        else:
            bh, br = breakdown_table(inputs, sk, defs)
            w.writerow([name + ' — contribution by intervention (cumulative to endline)'])
            w.writerow(['Contributions are incremental in the displayed intervention order. The tariff contribution includes its interaction with collection improvement.'])
            local_bh, local_br = bh, br
            bh, br, breakdown_indexes = _currency_table(bh, br, display)
            w.writerow(bh)
            w.writerows(br if br else [['(no interventions enabled)']])
            if converted_usd:
                w.writerow([name + ' — source-currency contribution detail'])
                w.writerow(['Intervention', *[local_bh[i] for i in breakdown_indexes]])
                w.writerows([[row[0], *[row[i] for i in breakdown_indexes]] for row in local_br])
        w.writerow([]); w.writerow([])
    out.seek(0)
    return '﻿' + out.getvalue()   # BOM so Excel reads the UTF-8 (em-dashes, currency) correctly


CONTRIBUTION_CATEGORIES = [
    ('funding', 'Funding Mobilization', ('financial_commitment_enabled', 'exogenous_injection_enabled')),
    ('operations', 'Operational Efficiency Improvements', ('collection_efficiency_enabled', 'ws_nrw_enabled', 'san_nrw_link_enabled')),
    ('investment', 'Investment Planning and Delivery Improvements', ('capital_efficiency_enabled', 'costeff_enabled', 'techmix_enabled')),
    ('tariff', 'Tariff Reform', ('tariff_enabled',)),
    ('household', 'Household Financing and Affordability', ('microfinance_enabled',)),
]


def _category_contributions(inputs, sector_key, defs, factor=1.0):
    raw = intervention_breakdown(inputs, sector_key, defs)
    toggles = financial_toggles(inputs)
    category_keys = {
        'funding': {'ws_connections_enabled', 'san_connections_enabled', 'ws_financial_commitment_enabled', 'ws_exogenous_injection_enabled', 'san_financial_commitment_enabled', 'san_exogenous_injection_enabled'},
        'operations': {'ws_collection_efficiency_enabled', 'ws_nrw_enabled', 'san_collection_efficiency_enabled', 'san_nrw_link_enabled'},
        'investment': {'ws_capital_efficiency_enabled', 'ws_costeff_enabled', 'ws_techmix_enabled', 'san_capital_efficiency_enabled', 'san_costeff_enabled', 'san_techmix_enabled'},
        'tariff': {'ws_tariff_enabled', 'san_tariff_enabled'},
        'household': {'ws_microfinance_enabled', 'san_microfinance_enabled'},
    }
    output, local = [], []
    for category_id, label, _ in CONTRIBUTION_CATEGORIES:
        members = [(definition, row) for definition, row in
                   zip((definition for definition in defs if toggles.get(definition[0])), raw)
                   if definition[0] in category_keys[category_id]]
        if category_id == 'funding':
            debt_rows = [row for row in raw if row[0] == 'Utility debt financing']
            members.extend([(('utility_debt_financing', 'Utility debt financing'), row) for row in debt_rows])
        if members:
            households = sum(row[1] for _, row in members)
            gap_closed = sum(row[3] for _, row in members)
            output.append([label, households, gap_closed * factor, 'Not aggregated (unlike resource metrics)'])
            local.append([label, households, gap_closed, 'Not aggregated (unlike resource metrics)'])
    return output, local


def scenario_xlsx(inputs, contribution_view='individual', currency_display=None):
    from openpyxl import Workbook
    result = calculate(coerce_to_engine(inputs))
    wb = Workbook()
    wb.remove(wb.active)
    display = currency_display or {'mode': 'local', 'source_currency': _cur(inputs), 'display_currency': _cur(inputs), 'rate_note': 'Local-currency results; no conversion applied.', 'price_basis_note': 'Model constant-price basis.'}
    _currency_metadata(wb, display, contribution_view)
    from revenue_export import revenue_table
    assumptions = wb.create_sheet('Revenue assumptions')
    assumptions.append(['Sector', 'Requested mode', 'Effective mode', 'Configuration and provenance', 'Validation errors', 'Model limitations'])
    for sk, name in [('water_supply', 'Water'), ('sanitation', 'Sanitation')]:
        import json
        status = result[sk].get('connection_revenue') or {}
        assumptions.append([name, 'Connection-based' if status.get('requested') else 'Exogenous',
                            'Connection-based' if status.get('effective') else 'Exogenous',
                            json.dumps(status.get('configuration') or {}, ensure_ascii=False),
                            '; '.join(status.get('errors') or []), '; '.join(status.get('warnings') or [])])
        rh, rr = revenue_table(result, sk, _cur(inputs))
        rh, rr, _ = _currency_table(rh, rr, display)
        _write_sheet(wb, f'{name} — revenue details', rh, rr)
        h, r = per_year_table(result, inputs, sk)
        source_h, source_r = h, r
        h, r, money_indexes = _currency_table(h, r, display)
        suffix = ' (USD)' if display.get('mode') == 'usd' else ''
        converted_usd = display.get('mode') == 'usd' and display.get('source_currency') != 'USD'
        _write_sheet(wb, f'{name} — forecast{suffix}', h, r)
        if converted_usd:
            local_h = ['Year', *[source_h[i] for i in money_indexes]]
            local_r = [[row[0], *[row[i] for i in money_indexes]] for row in source_r]
            _write_sheet(wb, f'{name} — local detail', local_h, local_r)
        debt_summary, debt_schedule = _utility_debt_tables(result[sk], _cur(inputs))
        debt_suffix = ' (USD)' if converted_usd else ''
        for label, table in [('loan assumptions', debt_summary), ('loan proceeds use', debt_schedule)]:
            dh, dr = table
            source_h, source_r = dh, dr
            dh, dr, debt_money_indexes = _currency_table(dh, dr, display)
            _write_sheet(wb, f'{name} — {label}{debt_suffix}', dh, dr or [['(no loan schedule)']])
            if converted_usd:
                _write_sheet(wb, f'{name} — local {label}', source_h, source_r or [['(no loan schedule)']])
        bh, br = breakdown_table(inputs, sk, WATER_INTV if sk == 'water_supply' else SAN_INTV)
        source_bh, source_br = bh, br
        bh, br, breakdown_indexes = _currency_table(bh, br, display)
        _write_sheet(wb, f'{name} — interventions{suffix}', bh, br if br else [['(no interventions enabled)']])
        if converted_usd:
            local_headers = ['Intervention', *[source_bh[i] for i in breakdown_indexes]]
            local_rows = [[row[0], *[row[i] for i in breakdown_indexes]] for row in source_br]
            _write_sheet(wb, f'{name} — local contributions', local_headers, local_rows or [['(no interventions enabled)']])
        if contribution_view == 'category':
            defs = WATER_INTV if sk == 'water_supply' else SAN_INTV
            category_rows, category_local_rows = _category_contributions(
                inputs, sk, defs, display.get('factor', 1.0))
            _write_sheet(wb, f'{name} — categories{suffix}',
                         ['Category (contributions sum existing individual values)', 'Added safely-managed (M HH)', f'Gap closed (B {display.get("display_currency", _cur(inputs))})', 'Resources'],
                         category_rows or [['(no contributing interventions)']])
            if converted_usd:
                _write_sheet(wb, f'{name} — local categories',
                             ['Category', 'Added safely-managed (M HH)', f'Gap closed (B {_cur(inputs)})', 'Resources'],
                             category_local_rows or [['(no contributing interventions)']])
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


def table_xlsx(sheets, currency_display=None):
    """sheets = [{name, headers, rows}] → a workbook, one sheet each."""
    from openpyxl import Workbook
    wb = Workbook(); wb.remove(wb.active)
    if currency_display:
        _currency_metadata(wb, currency_display, 'table')
    notes = wb.create_sheet('Revenue assumptions')
    notes.append(['Contributions are incremental in the model calculation order; category grouping can change their display order. Step labels in year-column ledgers identify the calculation order. The tariff contribution includes its interaction with collection improvement.'])
    notes.append(['Revenue mode follows the saved sector/area configuration. Reference collected revenue is not added to capital; connection net cash is credited once when enabled.'])
    for s in sheets:
        ws = _write_sheet(wb, s.get('name', 'Sheet'), s.get('headers', []), s.get('rows', []))
        freeze_columns = s.get('freeze_columns', 0)
        if not isinstance(freeze_columns, int) or not 0 <= freeze_columns <= len(s.get('headers', [])):
            raise ValueError('Frozen column count must be within the exported table.')
        from openpyxl.utils import get_column_letter
        ws.freeze_panes = f'{get_column_letter(freeze_columns + 1)}2'
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


def chart_xlsx(title, sheets, chart_spec=None, image_data_url=None, currency_display=None):
    """Workbook for the per-chart export. With `chart_spec` the first sheet holds the chart's data table AND a
    live Excel chart bound to those cells (dynamic). Falls back to embedding the PNG when only an image is
    supplied (legacy callers)."""
    from openpyxl import Workbook
    wb = Workbook(); wb.remove(wb.active)
    if currency_display:
        _currency_metadata(wb, currency_display, 'chart')
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
