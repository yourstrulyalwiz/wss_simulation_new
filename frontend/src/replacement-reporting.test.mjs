import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { ledgerModule } from '../tests/ledger-module.mjs';

const { ledgerSnapshots, ledgerRows, aggregateSourceFunding } = ledgerModule;
const source = readFileSync(new URL('./replacementWaterfall.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { replacementWaterfallRows, REPLACEMENT_WATERFALL_FIELDS } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

// Controlled reporting input: engine already made all payments. UI must not repay or credit twice.
const make = scale => {
  const sec = {};
  const scalar = (name, values) => { sec[name] = values.map(v => v * scale); };
  const pair = (name, values) => { sec[name] = [values.map(v => v * scale), values.map(() => 0)]; };
  for (const prefix of ['', 'scenario_', 'scenario_without_utility_debt_']) {
    for (const [key, series] of Object.entries({
      replacement_backlog_opening: [0, 0, 5], replacement_current_paid: [0, 5, 10],
      replacement_backlog_paid: [0, 0, 5], replacement_paid_total: [0, 5, 15],
      replacement_backlog_closing: [0, 5, 0],
    })) { scalar(prefix + key, series); pair(prefix + key + '_by_service', series); }
    for (const [key, values] of Object.entries({
      annual_planned_expansion_cost_by_service: [0, 20, 20],
      prefunding_expansion_cost_by_service: [0, 20, 20],
      prefunding_household_expansion_by_service: [0, 20, 20],
      prefunding_ancillary_by_service: [0, 0, 0], closing_household_expansion_by_service: [0, 20, 10],
      closing_ancillary_by_service: [0, 0, 0], replacement_by_service: [0, 10, 10],
      new_capex_by_service: [0, 20, 10], cash_deficit_by_service: [0, 2, 3],
      current_cash_shortfall_by_service: [0, 2, 3], accumulated_cash_shortfall_by_service: [0, 2, 5],
      sector_funded_expansion_by_service: [0, 0, 10], externally_funded_expansion_by_service: [0, 0, 0],
      financing_gap_by_service: [0, 27, 13], endline_financing_requirement_by_service: [0, 27, 15],
    })) pair(prefix + key, values);
    scalar(prefix + 'eligible_capital_after_losses_debt', [0, 5, 25]);
    scalar(prefix + 'ordinary_expansion_available', [0, 0, 10]);
    scalar(prefix + 'utility_debt_cash_available', [0, 0, 0]);
    scalar(prefix + 'sm_access_gap', [0, 0, 0]); scalar(prefix + 'at_least_basic_access_gap', [0, 0, 0]);
  }
  pair('bau_hh', [1, 1, 1]); pair('scenario_hh', [1, 1, 1]); pair('target_hh', [1, 1, 1]);
  return { years: [2025, 2026, 2027], total_hh: [3, 3, 3], water_supply: sec, sanitation: sec };
};
const fixture = make(1);
for (const sector of ['water_supply', 'sanitation']) {
  for (const scenario of [false, true]) {
    const snaps = ledgerSnapshots([fixture], sector, 2025, scenario);
    close(snaps[2].values.fundingApplied[2], 25); // 10 current + 5 backlog + 10 expansion, once.
    close(snaps[2].values.fundingShared[2], 0);
    close(snaps[2].values.requirementsCatchUp[2], 38); // 20 expansion + 10 current + 5 opening + 3 current cash.
    close(snaps[2].values.gapAnnual[2], 13);
    close(snaps[2].values.gapClosing[2], 15); // Historical cash, not historical replacement, differs.
    const data = { years: fixture.years, baselineYear: 2025, base: snaps, scenario: snaps,
      contributions: [], attributionComplete: false, includesDebt: false };
    const options = { metric: 'requirements', service: 'total', basis: 'annual',
      years: [2027], isShare: false, moneyFactor: 1, currency: 'LCU' };
    close(ledgerRows(data, options)[0].values[0], .038);
    close(ledgerRows(data, { ...options, metric: 'gap' })[0].values[0], .015);
  }
  for (const prefix of ['', 'scenario_', 'scenario_without_utility_debt_']) {
    const rows = replacementWaterfallRows([fixture, make(2)], sector, 2025, prefix);
    const fieldIndex = key => REPLACEMENT_WATERFALL_FIELDS.findIndex(([field]) => field === key);
    close(rows[1].values[fieldIndex('replacement_backlog_opening')], 15);
    close(rows[1].values[fieldIndex('replacement_paid_total')], 45);
    close(rows[1].values[fieldIndex('ordinary_expansion_available')], 30);
    assert.equal(rows[1].values[fieldIndex('unallocated_positive_capital')], null);
  }
}
const sourceFunding = {
  version: 2, method: 'actual_source_funding', source_keys: ['baseline'],
  replacement_current_charge: { baseline: [0, 5, 10] },
  replacement_backlog_charge: { baseline: [0, 0, 5] },
  replacement_charge: { baseline: [0, 5, 15] }, replacement_paid: [0, 5, 10],
  replacement_paid_total: [0, 5, 15], replacement_backlog_closing: [0, 5, 0],
};
fixture.water_supply.scenario_source_funding = sourceFunding;
const funding = aggregateSourceFunding([fixture, fixture], 'water_supply');
assert.equal(funding.version, 2);
close(funding.replacement_paid[2], 20);
close(funding.replacement_paid_total[2], 30);
close(funding.replacement_current_charge.baseline[2], 20);
close(funding.replacement_backlog_charge.baseline[2], 10);
assert.equal(funding.eligible_capital_after_losses_debt[2], null);
assert.equal(aggregateSourceFunding([fixture, { ...fixture, water_supply: {
  scenario_source_funding: { ...sourceFunding, version: 1 },
} }], 'water_supply'), undefined);
console.log('Replacement reporting: payment totals, backlog snapshots, v2 sources, area sums, both sectors / all variants passed.');
