"""Capture same-input accounting/borrowing comparisons without changing branches.

Run from the project root:
    python tools/capture_financing_references.py

Historical model source is extracted into temporary directories only. The output
contains synthetic diagnostic inputs, not saved user profiles or credentials.
"""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from demo_adapter import frontend_defaults, coerce_to_engine
from model.engine import calculate

ORIGINAL_REF = '1cd5013'
REINVESTMENT_REF = '3a0ac45'

EXTRACT = """
def extract(result, inputs):
    baseline = inputs['period']['baseline_year']
    forecast = [i for i, year in enumerate(result['years']) if year > baseline]
    first = forecast[0]
    output = {}
    for sector in ('water_supply', 'sanitation'):
        sec = result[sector]
        flow = lambda key: sum(sec[key][i] for i in forecast)
        output[sector] = {
            'programme_requirement_million': flow('scenario_total_investment_need'),
            'annual_shortfalls_sum_million': flow('scenario_financing_gap'),
            'terminal_sm_households_million': sec['scenario_hh'][0][-1],
            'first_forecast_collected_revenue_uplift_million':
                sec['scenario_collection_cash'][first] + sec['scenario_tariff_cash'][first],
            'loan_principal_million': sec.get('scenario_loan_principal'),
            'projection_end_debt_million': (sec['scenario_loan_closing_debt'][-1]
                                          if 'scenario_loan_closing_debt' in sec else None),
            'loan_maturity_year': sec.get('scenario_loan_end_year'),
            'investment_requirement_annual_million': [sec['scenario_total_investment_need'][i] for i in forecast],
            'financing_shortfall_annual_million': [sec['scenario_financing_gap'][i] for i in forecast],
        }
    return {'forecast_years': [result['years'][i] for i in forecast], 'sectors': output}
"""
exec(EXTRACT)


def diagnostic_inputs():
    inputs = frontend_defaults()
    per = inputs['period']
    n = per['forecast_end_year'] - per['model_start_year'] + 1
    # Fix population, household counts, price conversion and public budget.
    # Consequently the historical comparison does not mix borrowing effects
    # with population or exogenous-volume-growth changes.
    inputs['population'].update(pop_ts=[1]*n, hh_ts=[.25]*n,
                                 total_pop_start=1, total_hh_start=.25,
                                 total_pop_baseline=1, total_hh_baseline=.25)
    inputs['macro'].update(ws_budget_pct_gdp=0, san_budget_pct_gdp=0,
                           budget_input_mode='pct_gdp', budget_source='pct_gdp',
                           inflation_nepal=[0]*n, inflation_us=[0]*n,
                           inflation_local_ongoing=0, inflation_us_ongoing=0,
                           exchange_rate=[100]*n)
    inputs['toggles'] = {key: False for key in inputs['toggles']}
    inputs['toggles'].update(ws_collection_efficiency_enabled=True, ws_tariff_enabled=True,
                             san_collection_efficiency_enabled=True, san_tariff_enabled=True)
    start = per['baseline_year'] + 1
    for section in ('water_interventions', 'sanitation_interventions'):
        inputs[section].update(ce_start_year=start, ce_target_year=start,
                               tariff_start_year=start, tariff_target_year=start,
                               tariff_volume_mld=100/.365, tariff_current=10, tariff_target=12,
                               cash_allocation_alpha=0, borrow_drawdown_year=start,
                               borrow_interest_rate=.08, borrow_term_years=25, borrow_min_dscr=1.2,
                               borrow_rate_basis='nominal', existing_debt_service=0,
                               baseline_obligations_known=True, borrow_contract_principal=0)
    inputs['water_interventions'].update(ce_current_ratio=.8, ce_target_ratio=.9,
                                         ce_water_sold_mld=100/.365, ce_current_tariff=10)
    inputs['sanitation_interventions']['ce_sewer_tariff_pct_water'] = 1
    return inputs


def historical_run(ref, inputs):
    archived = subprocess.check_output(
        ['git', 'archive', ref, '--', 'model', 'demo_adapter.py', 'countries.py'], cwd=ROOT)
    with tempfile.TemporaryDirectory(prefix='wss-reference-') as directory:
        with tarfile.open(fileobj=io.BytesIO(archived)) as archive:
            archive.extractall(directory, filter='data')
        source = ('import json,sys\nfrom demo_adapter import coerce_to_engine\n'
                  'from model.engine import calculate\n' + EXTRACT +
                  '\ninputs=json.load(sys.stdin)\n'
                  'print(json.dumps(extract(calculate(coerce_to_engine(inputs)), inputs)))')
        completed = subprocess.run([sys.executable, '-c', source], cwd=directory,
                                   input=json.dumps(inputs), text=True, capture_output=True, check=True)
        return json.loads(completed.stdout)


def main():
    inputs = diagnostic_inputs()
    source_refs = {
        'original_branch': subprocess.check_output(['git', 'rev-parse', ORIGINAL_REF], cwd=ROOT, text=True).strip(),
        'corrected_pre_borrowing': subprocess.check_output(['git', 'rev-parse', REINVESTMENT_REF], cwd=ROOT, text=True).strip(),
        'current_capture': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
    }
    cases = {
        'original_branch': {'inputs': inputs, 'metrics': historical_run(ORIGINAL_REF, inputs)},
        'corrected_pre_borrowing': {'inputs': inputs, 'metrics': historical_run(REINVESTMENT_REF, inputs)},
        'current_reinvestment_only': {'inputs': inputs, 'metrics': extract(calculate(coerce_to_engine(inputs)), inputs)},
    }
    for alpha in (0, .5, 1):
        borrowing = copy.deepcopy(inputs)
        borrowing['toggles'].update(ws_borrowing_enabled=True, san_borrowing_enabled=True)
        for section in ('water_interventions', 'sanitation_interventions'):
            borrowing[section]['cash_allocation_alpha'] = alpha
        cases[f'borrowing_alpha_{alpha:g}'] = {
            'inputs': borrowing, 'metrics': extract(calculate(coerce_to_engine(borrowing)), borrowing)}
    capture = {
        'purpose': 'Synthetic same-input diagnostics, not a country investment forecast.',
        'money_units': 'Millions of real local currency (NPR); households in millions.',
        'source_refs': source_refs,
        'interpretation': {
            'original_to_corrected': 'Investment and shared-revenue accounting; no borrowing in either case.',
            'pre_borrowing_to_current': 'Reinvestment-only benchmark preservation, with frozen volume/population/price assumptions.',
            'current_to_alpha_positive': 'Cash timing and borrowing effects; operating revenue and target requirements unchanged.',
            'sum_annual_shortfalls': 'Sum of independently reconciled annual gaps, not debt or a rescheduled backlog.',
        },
        'cases': cases,
    }
    out = ROOT / 'validation' / 'financing_reference_scenarios.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(capture, indent=2) + '\n')
    for name, case in cases.items():
        print(name)
        for sector, metrics in case['metrics']['sectors'].items():
            print(sector, {key: value for key, value in metrics.items() if not isinstance(value, list)})
    print('Saved:', out.relative_to(ROOT))


if __name__ == '__main__':
    main()