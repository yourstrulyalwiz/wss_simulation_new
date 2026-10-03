# Required validation

Run the full regression checks from the project root:

```sh
python -m unittest discover -p 'test_*.py'
cd frontend && npm test && npm run build
```

No running server is needed for these tests. Frontend integration tests invoke
the real Python model, so run them in the project's environment with its Python
and Node dependencies available.

| Requirement | Focused checks |
| --- | --- |
| Financing counted once | `test_finance_ledgers.py`: requirement 100, financing applied 40, annual/cumulative gap 60, explicitly not 20. |
| Target investment schedule | `test_finance_ledgers.py`: derive annual expansion from constant-price target transitions; expansion 4 each year, opening-stock replacement 10/10.4/10.8/11.2/11.6, closing target stock 120, requirement 74 and cumulative gap 24 with annual financing 10. An unfunded programme retains the same asset schedule. |
| Tariff and collection | `test_finance_ledgers.py`: collected-revenue uplift 280, attributed as collection 100 plus tariff 180. `test_intervention_reconciliation.py` verifies the joint product and reconciliation for all collection/tariff/NRW toggle combinations. |
| NRW conservation | `test_intervention_reconciliation.py`: physical service volume plus avoided-production volume equals recovered volume at service allocations 0%, 30% and 100%; production savings arise only from the production share. Commercial recovery produces no physical service volume. |
| Custom interventions | `test_intervention_reconciliation.py`: shared recurring revenue and implementation capex count once; assignments survive JSON save/load and migration; a sector/service selection matrix checks that only selected unit costs change. |
| Borrowing | `test_borrowing_module.py`: alpha-zero parity with reinvestment-only in both sectors; annual debt and reserve conservation under real/nominal rates, inflation and signed cash shortfalls; unchanged contractual service and schedules through maturity; drawdowns are capital, not operating revenue. Existing tests also cover prior obligations, fixed contracts, reserves, capacity and separate pools. |
| Integration | `test_validation_integration.py`: mixed-area deficits cannot be canceled by another area's excess coverage; aggregate arrays, report rows, PowerPoint summary/coverage data and actual template table cells reconcile. `frontend/tests/reportIntegration.test.mjs` compares production chart/table selectors and saved-scenario migration directly with real Python model/report outputs. `test_reporting_compatibility.py` checks CSV/Excel full-precision annual values, both PowerPoint paths and legacy migration/disclosures. |

The frontend integration checks exercise the data selectors used by charts and
tables. They are not browser-click tests of save/load controls or download buttons.