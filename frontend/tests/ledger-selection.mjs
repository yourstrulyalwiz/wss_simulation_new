import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const source = [
  read('../src/chartColors.ts'),
  'const P = INTV_PALETTE;',
  read('../src/interventionRegistry.ts').replace(/^import .*$/gm, ''),
  read('../src/ledgerSelection.ts').replace(/^import .*$/gm, ''),
].join('\n');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { selectedLedgerSources } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
assert.deepEqual(selectedLedgerSources([{}], 'water'), []);
const urban = { toggles: { ws_tariff_enabled: true, san_collection_efficiency_enabled: true },
  connection_revenue: { water: { enabled: true } },
  custom_interventions: [{ enabled: false }, { enabled: true, sector: 'sanitation' }],
  utility_debt: { sanitation: { enabled: true, allocation_share: 1 } } };
const rural = { toggles: { ws_financial_commitment_enabled: true, ws_connections_enabled: false },
  connection_revenue: { water: { enabled: true } } };
assert.deepEqual(new Set(selectedLedgerSources([urban], 'water')), new Set(['tariff', 'connections']));
assert.deepEqual(selectedLedgerSources([rural], 'water'), ['financial']);
assert.deepEqual(new Set(selectedLedgerSources([urban, rural], 'water')), new Set(['tariff', 'connections', 'financial']));
assert.deepEqual(new Set(selectedLedgerSources([urban], 'sanitation')), new Set(['collection', 'custom', 'loan']));
urban.utility_debt.sanitation.enabled = false;
urban.toggles.ws_tariff_enabled = false;
assert.ok(!selectedLedgerSources([urban], 'sanitation').includes('loan'));
assert.ok(!selectedLedgerSources([urban], 'water').includes('tariff'));
assert.deepEqual(new Set(selectedLedgerSources([{ toggles: { ws_microfinance_enabled: true } }], 'water')),
  new Set(['microfinance', 'grant']));
console.log('Ledger selection: sector, area union, deselection, connection gating, custom and debt selection passed.');
