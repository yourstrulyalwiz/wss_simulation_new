"""Shared source/coverage export interpretation, without sequential household effects."""
SOURCE_FOR_SUFFIX = {
    'connections': ('connections',), 'financial_commitment': ('financial',),
    'exogenous_injection': ('injection',), 'collection_efficiency': ('collection',),
    'capital_efficiency': ('budget_execution',), 'tariff': ('tariff',),
    'nrw': ('nrw',), 'nrw_link': ('nrw_link',),
    'microfinance': ('microfinance', 'grant'), 'costeff': (), 'techmix': (),
}


def source_band(sec, key, n):
    data = sec['scenario_coverage_attribution']
    if key == '__custom':
        sources = ('custom',)
    elif key == 'utility_debt_financing':
        sources = ('loan',)
    else:
        suffix = key.split('_', 1)[1].removesuffix('_enabled')
        sources = SOURCE_FOR_SUFFIX[suffix]
    return [sum(data['sm_stock'][s][i] for s in sources) for i in range(n)]


def source_export_columns(sec, n):
    """Annual detailed fields appended to existing spreadsheets, not a new report."""
    from model.source_funding import MAP_FIELDS, TOTAL_FIELDS
    columns = []
    source_labels = {'financial': 'Increase in Public Spending',
                     'injection': 'External Funding (Private Sector, Donor, Foreign Direct Investment)'}
    for prefix, view in [('scenario_', 'Scenario'), ('scenario_without_utility_debt_', 'Scenario without loan')]:
        ledger = sec.get(prefix+'source_funding')
        coverage = sec.get(prefix+'coverage_attribution')
        if not ledger or not coverage:
            continue
        for field in MAP_FIELDS:
            for source in ledger['source_keys']:
                columns.append((f'{view}: {source_labels.get(source, source)} {field}', 'money', ledger[field][source]))
        for field in TOTAL_FIELDS:
            columns.append((f'{view}: {field}', 'money', ledger[field]))
        for field in ('sm_stock', 'basic_stock', 'annual_sm_upgrades', 'annual_basic_entries'):
            for source in coverage['source_keys']:
                columns.append((f'{view}: {source_labels.get(source, source)} {field}', 'households', coverage[field][source]))
        for field in ('pure_bau_stock', 'baseline_difference_from_bau', 'reconciliation_error'):
            for rung in ('sm', 'basic'):
                columns.append((f'{view}: {rung} {field}', 'households', coverage[field][rung]))
    return columns
