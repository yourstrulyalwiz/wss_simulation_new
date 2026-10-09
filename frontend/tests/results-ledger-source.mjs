import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ledgerModule } from './ledger-module.mjs';

const { ledgerRows } = ledgerModule;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);
const years = [2030, 2031, 2032];
const measures = [
  'coverage','target','accessGap','funding','fundingApplied','fundingShared','fundingOperating','fundingRestricted',
  'fundingExternal','requirementsAnnual','requirementsCatchUp','requirementsResidual','gapAnnual','gapClosing',
  'plannedExpansion','replacement','replacementCredit','cashDeficit','outstanding','accumulatedShortfalls','repayments',
  'replacementPaid','expansionPaid','scheduledExpansion','prefundingHousehold','closingHousehold','prefundingAncillary',
  'closingAncillary','currentUnpaidReplacement','priorReplacementShortfall','accumulatedReplacementShortfall',
  'currentCashShortfall','priorCashShortfall','accumulatedCashShortfall','householdExpansionPaid','noncashDeliveryHH',
  'noncashDeliveryCredit','cancelledExpansionCost','outstandingRepricing','ancillaryPaid','sectorExpansionPaid',
  'externalExpansionPaid','openingExpansionCost','advanceDeliveryCredit','newAncillaryCommitment','sectorHouseholdPaid',
];
function snapshot(year, values) {
  const all = Object.fromEntries(measures.map(key => [key, [0, 0, 0]]));
  Object.assign(all, values);
  return { year, population: 10, values: all };
}
function areaValues({ prefund, close, replacement, cash = 0, coverage = [2, 3], target = [2, 3] }) {
  return years.map((year, i) => snapshot(year, {
    coverage: [coverage[0], coverage[1], coverage[0] + coverage[1]],
    target: [target[0], target[1], target[0] + target[1]],
    prefundingHousehold: [prefund[0], prefund[1], prefund[0] + prefund[1]],
    prefundingAncillary: [i === 1 ? 2 : 0, 0, i === 1 ? 2 : 0],
    replacement: [i === 1 ? 3 : 0, 0, i === 1 ? 3 : 0],
    currentCashShortfall: [i === 1 ? cash : 0, 0, i === 1 ? cash : 0],
    closingHousehold: [close[0], close[1], close[0] + close[1]],
    closingAncillary: [i === 1 ? 1 : 0, 0, i === 1 ? 1 : 0],
    currentUnpaidReplacement: [i === 1 ? 1 : 0, 0, i === 1 ? 1 : 0],
    priorReplacementShortfall: [i === 1 ? 3 : 0, 0, i === 1 ? 3 : 0],
    accumulatedReplacementShortfall: [i === 1 ? 4 : 0, 0, i === 1 ? 4 : 0],
    accumulatedCashShortfall: [i === 1 ? cash : 0, 0, i === 1 ? cash : 0],
    scheduledExpansion: [i === 1 ? 12 : 0, 0, i === 1 ? 12 : 0],
    householdExpansionPaid: [i === 1 ? 0.5 : 0, 0, i === 1 ? 0.5 : 0],
  }));
}
const urban = areaValues({ prefund: [0, 1], close: [0, 0.5], cash: 2, coverage: [2.1, 3] });
const rural = areaValues({ prefund: [1, 0], close: [0.5, 0], cash: 1, coverage: [1.8, 3] });
const sum = (snapshots, i) => {
  const a = snapshots[0][i].values, b = snapshots[1][i].values;
  return snapshot(years[i], Object.fromEntries(measures.map(k => [k, a[k].map((v, rung) =>
    v == null || b[k][rung] == null ? null : v + b[k][rung])])));
};
const combined = years.map((_, i) => sum([urban, rural], i));
const pass = (snapshots, reduction) => snapshots.map((s, i) => snapshot(s.year, {
  ...s.values,
  gapClosing: [18 - reduction[i], 0, 18 - reduction[i]],
}));
const base = years.map((_, i) => snapshot(years[i], { ...combined[i].values, gapClosing: [18, 0, 18] }));
const scenario = pass(combined, [0, 3, 6]);
const before = pass(combined, [0, 0, 0]);
const data = {
  years, baselineYear: 2030, base, scenario,
  areas: [
    { key: 'urban', label: 'Urban', base: urban, scenario: urban },
    { key: 'rural', label: 'Rural', base: rural, scenario: rural },
  ],
  contributions: [{ key: 'lever', label: 'Lever', category: 'other', before, after: scenario }],
  attributionComplete: true, includesDebt: false,
};
const options = { metric: 'requirements', service: 'total', basis: 'annual', years, isShare: false, moneyFactor: 1, currency: 'USD' };
const requirements = ledgerRows(data, options);
assert.equal(requirements[0].label, 'Requirements before this year’s funding — Combined scenario total');
assert.equal(requirements[0].unit, 'B USD');
assert.equal(requirements[0].values[1], 0.015); // M native currency displayed in billions: 15 M
assert.equal(requirements[0].children.length, 2);
assert.equal(requirements[0].children[0].children.length, 2);
assert.equal(requirements[0].children[0].children[0].children[0].timing, 'Reference — annual flow');
close(requirements[0].values[1], 0.015);
const scheduledOnlyChange = structuredClone(data);
scheduledOnlyChange.scenario[1].values.scheduledExpansion = [999, 999, 1998];
close(ledgerRows(scheduledOnlyChange, options)[0].values[1], requirements[0].values[1],
  'Reference expansion must not be added again to unpaid requirements');
const thresholds = requirements.find(row => row.key === 'coverage-thresholds-section').children;
close(thresholds.find(row => row.key === 'coverage-surplus-sm').values[1], -0.1);
close(thresholds.find(row => row.key === 'coverage-local-unmet-sm').values[1], 0.2);
close(thresholds.find(row => row.key === 'coverage-surplus-at-least-basic').values[1], -0.1);
close(thresholds.find(row => row.key === 'coverage-local-unmet-at-least-basic').values[1], 0.2);
const nationalOnly = ledgerRows({ ...data, areas: undefined }, options);
const nationalThresholds = nationalOnly.find(row => row.key === 'coverage-thresholds-section').children;
close(nationalThresholds.find(row => row.key === 'coverage-surplus-sm').values[1], -0.1);
assert.equal(nationalThresholds.find(row => row.key === 'coverage-local-unmet-sm').values[1], null,
  'National-only totals must not be relabelled as area-specific unmet households');
const ruralOnly = ledgerRows({ ...data, areas: [{ key: 'rural', label: 'Rural', scenario: rural }] }, options);
close(ruralOnly.find(row => row.key === 'coverage-thresholds-section').children
  .find(row => row.key === 'coverage-local-unmet-sm').values[1], 0.2);
const gap = ledgerRows(data, { ...options, metric: 'gap', basis: 'closing' });
const flatKeys = rows => rows.flatMap(row => [row.key, ...flatKeys(row.children ?? [])]);
assert.equal(new Set(flatKeys(gap)).size, flatKeys(gap).length,
  'All keys must be globally unique when need/paid/coverage trees share one flat table');
const paymentData = structuredClone(data);
for (const snap of paymentData.scenario) {
  snap.values.householdExpansionPaid = [3, 0, 3];
  snap.values.sectorHouseholdPaid = [2, 0, 2];
  snap.values.externalExpansionPaid = [1, 0, 1];
  snap.values.sectorExpansionPaid = [7, 0, 7]; // Includes ancillary: not household-only.
  snap.values.ancillaryPaid = [5, 0, 5];
}
const paymentTree = ledgerRows({ ...paymentData, areas: undefined }, { ...options, metric: 'gap' })
  .find(row => row.key === 'funding-applied-section').children[0];
const householdPayment = paymentTree.children.find(row => row.component === 'householdExpansionPaid');
close(householdPayment.values[1], householdPayment.children.reduce((sum, row) => sum + row.values[1], 0));
assert.equal(gap[0].unit, 'B USD');
close(gap[0].values[1], 0.014); // Household 1 + ancillary 2 + legacy replacement 8 + cash 3 = 14 M
// Source value and exact child amounts are derived from the same service-level fields.
const urbanArea = gap[0].children[0];
close(urbanArea.values[1], 0.0075);
const sm = urbanArea.children[0];
assert.ok(sm.children.some(row => row.label.includes('SM upgrades: Basic → safely managed')));
assert.ok(urbanArea.children[1].children.some(row =>
  row.label.includes('Basic access expansion: lower service → Basic')));
const replacement = sm.children.find(row => row.component === 'accumulatedReplacementShortfall');
assert.equal(replacement.label, 'Accumulated replacement shortfall — legacy measure');
assert.equal(replacement.children.length, 2);
close(replacement.values[1], replacement.children.reduce((sum, row) => sum + row.values[1], 0));
const effect = ledgerRows(data, { ...options, metric: 'gap', basis: 'closing', view: 'effects' });
close(effect.find(row => row.key === 'other').values[1], 0.003);
assert.equal(effect.find(row => row.key === 'other').unit, 'B USD');

const partial = structuredClone(data);
partial.scenario[1].values.prefundingAncillary[0] = null;
const unknown = ledgerRows(partial, options)[0];
assert.equal(unknown.values[1], null, 'Missing must stay unavailable instead of becoming zero');
const zeroData = structuredClone(data);
zeroData.scenario[1].values.prefundingAncillary[0] = 0;
const zeroRow = ledgerRows(zeroData, options)[0];
assert.notEqual(zeroRow.values[1], null, 'An observed zero remains a known amount');
assert.equal(ledgerRows({ ...data, areas: undefined }, options)[0].children[0].kind, 'service',
  'National-only view does not fabricate geography rows');
const physicalCase = structuredClone(data);
physicalCase.scenario[1].values.noncashDeliveryHH = [0.02, 0, 0.02];
const physicalRows = ledgerRows(physicalCase, { ...options, moneyFactor: 0.002 })
  .find(row => row.key === 'diagnostics-section').children[0].children;
const physical = physicalRows.find(row => row.component === 'noncashDeliveryHH');
assert.equal(physical.unit, 'M households');
close(physical.values[1], 0.02); // Counts must not undergo currency conversion.
console.log('Source ledger tests passed: recursive geography/service/components, pre-funding and closing balance identities, reference timing, signed intervention reductions, and null-versus-zero behavior.');
