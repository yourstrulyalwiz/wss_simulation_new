import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/contributionView.tsx', import.meta.url), 'utf8')
  .split('export function ContributionViewToggle')[0]
  .replace("import React from 'react';", '')
  .replace('import.meta.env.DEV', 'false');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { aggregateContributionRows } = await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const bands = [
  { key:'financial', label:'Financial commitments', interventionKey:'ws_financial_commitment_enabled' },
  { key:'injection', label:'Injection', interventionKey:'ws_exogenous_injection_enabled' },
  { key:'operations', label:'Collection', interventionKey:'ws_collection_efficiency_enabled' },
  { key:'investment', label:'Capex', interventionKey:'san_costeff_enabled' },
  { key:'tariff', label:'Tariff', interventionKey:'san_tariff_enabled' },
  { key:'household', label:'Microfinance', interventionKey:'ws_microfinance_enabled' },
  { key:'custom', label:'Community fund', custom:true },
  { key:'future', label:'Future intervention', interventionKey:'future_enabled' },
];
const rows = [{ year:2026, base:3, total:8, financial:1, injection:2, operations:-.4,
  investment:.3, tariff:.2, household:.1, custom:.5, future:.6 }];
const before = JSON.stringify({rows,bands});
const grouped = aggregateContributionRows(rows, bands);
assert.equal(grouped.rows[0]['category:funding'], 3);
for (const band of grouped.bands) {
  assert.equal(typeof grouped.rows[0][band.key], 'number', `${band.label} must use its data key`);
  if (band.members) assert.equal(grouped.rows[0][band.key],
    band.members.reduce((sum, member) => sum + rows[0][member.key], 0));
}
assert.ok(Math.abs(grouped.bands.reduce((sum,b) => sum + grouped.rows[0][b.key],0)
  - bands.reduce((sum,b) => sum + rows[0][b.key],0)) < 1e-12);
assert.equal(JSON.stringify({rows,bands}), before, 'Grouping is presentation-only');
const coverage = aggregateContributionRows([{financial:0,injection:0}],bands.slice(0,2));
const gap = aggregateContributionRows([{financial:10,injection:5}],bands.slice(0,2));
assert.equal(coverage.bands.length,0);
assert.equal(gap.bands[0].key,'category:funding', 'Gap-only categories must retain their own bands');
assert.equal(gap.rows[0]['category:funding'],15);
assert.equal(aggregateContributionRows([{financial:0}],bands.slice(0,1)).bands.length,0);
console.log('Contribution grouping passed: all categories, multiple members, signed totals, custom/unmapped contributions, gap-only impact and unchanged source data.');