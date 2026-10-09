"""Source origins of actual exclusive Basic/SM stocks; million households."""
from .source_funding import SOURCE_KEYS


class CoverageAttribution:
    def __init__(self, n):
        self.data = dict(version=1, method='actual_source_funding', units='million households',
                         source_keys=list(SOURCE_KEYS))
        for f in ('annual_basic_entries', 'annual_sm_upgrades', 'basic_stock', 'sm_stock'):
            self.data[f] = {s: [0.]*n for s in SOURCE_KEYS}

    def history(self, t, sm, basic):
        self.data['sm_stock']['baseline'][t] = float(sm)
        self.data['basic_stock']['baseline'][t] = float(basic)

    def step(self, t, row, basic_entries, sm_upgrades, physical, microfinance, grants,
             actual_sm, actual_basic):
        d = self.data
        for rung, count in [('basic', basic_entries), ('sm', sm_upgrades)]:
            capital = row[rung+'_capital_spent']
            total = sum(capital.values())
            field = 'annual_basic_entries' if rung == 'basic' else 'annual_sm_upgrades'
            for s in SOURCE_KEYS:
                d[field][s][t] = count*capital.get(s, 0.)/total if total else 0.
            if total == 0 and count > 0:
                d[field]['zero_cost'][t] = count
        d['annual_sm_upgrades']['nrw'][t] += physical
        d['annual_sm_upgrades']['microfinance'][t] += microfinance
        d['annual_sm_upgrades']['grant'][t] += grants
        removals = sum(d['annual_sm_upgrades'][s][t] for s in SOURCE_KEYS)
        opening = sum(d['basic_stock'][s][t-1] for s in SOURCE_KEYS)
        for s in SOURCE_KEYS:
            old = d['basic_stock'][s][t-1]
            d['basic_stock'][s][t] = old*(1-min(1., removals/opening) if opening else 0.) + d['annual_basic_entries'][s][t]
            d['sm_stock'][s][t] = d['sm_stock'][s][t-1] + d['annual_sm_upgrades'][s][t]
        # The delivery engine can retain/reduce stocks or add population residual.
        # Reductions remove origins proportionally; demographic additions are baseline.
        for rung, actual in [('sm', actual_sm), ('basic', actual_basic)]:
            stock = d[rung+'_stock']
            predicted = sum(stock[s][t] for s in SOURCE_KEYS)
            if predicted > actual and predicted > 0:
                for s in SOURCE_KEYS:
                    stock[s][t] *= max(0., actual)/predicted
            else:
                stock['baseline'][t] += actual-predicted

    def finish(self, actual):
        d = self.data
        d['combined_stock'] = {r: list(map(float, actual[i])) for i, r in enumerate(('sm', 'basic'))}
        d['opening_baseline_stock'] = {r: d[r+'_stock']['baseline'][:] for r in ('sm', 'basic')}
        d['reconciliation_error'] = {
            r: [sum(d[r+'_stock'][s][t] for s in SOURCE_KEYS)-v for t, v in enumerate(d['combined_stock'][r])]
            for r in ('sm', 'basic')}
        return d
