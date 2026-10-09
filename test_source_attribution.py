import copy
import json
import random
import unittest
import numpy as np
from model.source_funding import allocate_sources, allocate_purchases
from model.coverage_attribution import CoverageAttribution
from demo_adapter import coerce_to_engine
from model.engine import calculate
from deck_aggregate import aggregate


class SourceAttributionTests(unittest.TestCase):
    def test_replacement_and_selected_debt(self):
        for r, replacement, debt, selected, paid, unpaid, expansion in [
            ({'baseline':20,'tariff':80},60,0,(),60,0,40),
            ({'baseline':20,'tariff':80},120,0,(),100,0,0),
            ({'baseline':0,'tariff':150},120,0,(),120,0,30),
            ({'tariff':100,'connections':100},0,80,('tariff',),0,0,120),
            ({'tariff':10,'baseline':100},60,30,('tariff',),60,20,40),
            ({'baseline':10,'nrw':-30},60,30,('nrw',),0,30,0),
            ({'baseline':0},0,0,(),0,0,0),
        ]:
            a=allocate_sources(r,replacement,debt,selected)
            self.assertAlmostEqual(a['replacement_paid'],paid)
            self.assertAlmostEqual(a['debt_service_unfunded'],unpaid)
            self.assertAlmostEqual(sum(a['expansion_available'].values()),expansion)
            if a['replacement_unfunded']>0:self.assertAlmostEqual(expansion,0)
        a=allocate_sources({'baseline':20,'tariff':80},60)
        self.assertEqual(a['replacement_charge'],{'baseline':12,'tariff':48})

    def test_worked_example_and_stocks(self):
        a=allocate_sources({'baseline':100,'tariff':60,'connections':40,'nrw':-20},60,30,('tariff',))
        for field, expected in [('loss_charge',[10,6,4,0]),('debt_charge',[0,30,0,0]),
                                ('replacement_charge',[36,9.6,14.4,0]),
                                ('expansion_available',[54,14.4,21.6,0])]:
            np.testing.assert_allclose(list(a[field].values()),expected)
        allocate_purchases(a,36,54,0)
        c=CoverageAttribution(3);c.history(0,1,10)
        c.step(1,a,18,9,0,0,0,10,19)
        for s,b,sm in [('baseline',10.8,5.4),('tariff',2.88,1.44),('connections',4.32,2.16)]:
            self.assertAlmostEqual(c.data['annual_basic_entries'][s][1],b)
            self.assertAlmostEqual(c.data['annual_sm_upgrades'][s][1],sm)
        a=allocate_sources({'connections':20});allocate_purchases(a,0,20,0)
        c.step(2,a,0,10,0,0,0,20,9)
        self.assertAlmostEqual(sum(v[2] for v in c.data['basic_stock'].values()),9)
        self.assertLess(c.data['basic_stock']['tariff'][2],c.data['basic_stock']['tariff'][1])

    def test_random_conservation_and_loan_priority(self):
        rng=random.Random(8)
        for _ in range(1000):
            r={s:rng.uniform(-100,200) for s in ['baseline','tariff','nrw','connections']}
            a=allocate_sources(r,rng.uniform(0,200),rng.uniform(0,100),('tariff','nrw'))
            O=sum(a['expansion_available'].values());loan=20
            spend=rng.random()*(O+loan)
            allocate_purchases(a,spend*.3,spend*.5,spend*.2,loan)
            for s,v in r.items():
                used=sum(a[f][s] for f in ['loss_charge','debt_charge','replacement_charge',
                                         'basic_capital_spent','sm_capital_spent','ancillary_spent','unused'])
                self.assertAlmostEqual(max(v,0),used)
            self.assertEqual(a['debt_charge']['baseline'],0)
            self.assertAlmostEqual(sum(a[f]['loan'] for f in ['basic_capital_spent','sm_capital_spent','ancillary_spent']),
                                   max(0,spend-O))

    def test_profile_stock_cash_exports_and_selected_repayment(self):
        with open('profiles/DRC OCT 8.json') as handle:
            p=json.load(handle)
        results=[calculate(coerce_to_engine(q)) for q in [p['inputs'],p['altInputs']['rural']]]
        for r in results+[aggregate(results)]:
            for sector in ['water_supply','sanitation']:
                sec=r[sector]
                for prefix in ['scenario_','scenario_without_utility_debt_']:
                    c=sec[prefix+'coverage_attribution'];f=sec[prefix+'source_funding']
                    for rung in ['sm','basic']:
                        np.testing.assert_allclose(np.sum(list(c[rung+'_stock'].values()),axis=0),
                                                   c['combined_stock'][rung],atol=1e-8)
                    for i,y in enumerate(r['years']):
                        if y<=2025:continue
                        self.assertAlmostEqual(sum(v[i] for v in f['signed_contribution'].values()),
                                               sec[prefix+'available_total'][i],places=6)
                        self.assertAlmostEqual(f['debt_service_paid'][i]+f['debt_service_unfunded'][i],
                                               f['debt_service_due'][i],places=6)
                from export_data import per_year_table
                headers,rows=per_year_table(r,p['inputs'],sector)
                self.assertTrue(all(len(row)==len(headers) for row in rows))
        rural=results[1]['water_supply']
        self.assertGreater(sum(rural['scenario_debt_service_unfunded']),0)
        urban=results[0]['water_supply']
        self.assertGreater(urban['scenario_coverage_attribution']['sm_stock']['connections'][-1],0)
        self.assertEqual(sum(urban['scenario_debt_service_unfunded']),0)


if __name__=='__main__':unittest.main()
