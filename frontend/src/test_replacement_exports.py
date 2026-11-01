"""Reporting-only tests; no saved inputs or databases are read or modified."""
import copy
import unittest

from demo_adapter import coerce_to_engine
from model.engine import calculate
from test_utility_revenue import example
from export_data import per_year_table, table_xlsx
from deck_data import block_data
from openpyxl import load_workbook


class ReplacementExportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = example()
        cls.result = calculate(coerce_to_engine(cls.inputs))

    def test_all_variants_export_explicit_settlement_without_current_credit_changes(self):
        result = copy.deepcopy(self.result)
        for sector in ('water_supply', 'sanitation'):
            sec = result[sector]
            count = len(result['years'])
            for prefix in ('', 'scenario_', 'scenario_without_utility_debt_'):
                for key, value in (
                    ('replacement_backlog_opening', 5.1256789),
                    ('replacement_current_paid', 10.),
                    ('replacement_backlog_paid', 5.1256789),
                    ('replacement_paid_total', 15.1256789),
                    ('replacement_backlog_closing', 0.),
                ):
                    sec[prefix + key] = [value] * count
                    sec[prefix + key + '_by_service'] = [[value * .7] * count, [value * .3] * count]
            headers, rows = per_year_table(result, self.inputs, sector)
            self.assertTrue(all(len(row) == len(headers) for row in rows))
            for variant in ('BAU', 'Scenario', 'Scenario without utility debt'):
                opening = next(i for i, h in enumerate(headers) if h.startswith(
                    variant + ': Opening replacement backlog — snapshot'))
                closing = next(i for i, h in enumerate(headers) if h.startswith(
                    variant + ': Closing replacement backlog — snapshot'))
                self.assertEqual(rows[-1][opening], 5.1256789)
                self.assertEqual(rows[-1][closing], 0.)
            workbook = load_workbook(table_xlsx([{
                'name': 'Settlement', 'headers': headers, 'rows': rows,
            }]))
            self.assertEqual(workbook['Settlement'].cell(len(rows) + 1, opening + 1).value, 5.1256789)

    def test_deck_sums_payments_but_uses_closing_snapshot(self):
        result = copy.deepcopy(self.result)
        years = result['years']
        sec = result['water_supply']
        sec['replacement_backlog_closing'] = [float(i * 3) for i in range(len(years))]
        sec['replacement_backlog_opening'] = [float(i * 2) for i in range(len(years))]
        sec['replacement_backlog_paid'] = [1.25] * len(years)
        block = block_data(result, self.inputs, 'water_supply', [result], [], False)
        rows = dict(block['investment']['rows'])
        end_year = block['last_target_year']
        end_index = min(range(len(years)), key=lambda i: abs(years[i] - end_year))
        closing = rows['Closing replacement backlog — end balance, not sum'][-1]
        self.assertEqual(closing, sec['replacement_backlog_closing'][end_index])
        payment = rows['Opening backlog paid — sum of flows'][-1]
        self.assertEqual(payment, 1.25 * sum(block['baseline_year'] < y <= end_year for y in years))


if __name__ == '__main__':
    unittest.main()
