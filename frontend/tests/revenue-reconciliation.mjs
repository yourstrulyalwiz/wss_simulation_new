// No additional dependencies: compile the TSX and check its rendered states.
// Run: node frontend/tests/revenue-reconciliation.mjs
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const compileTs = (module, filename) => {
  const jsx = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  module._compile(jsx, filename);
};
require.extensions['.tsx'] = compileTs;
require.extensions['.ts'] = compileTs;
const sourcePath = fileURLToPath(new URL('../src/components/RevenueBase.tsx', import.meta.url));
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
}).outputText;
const componentModule = new Module(sourcePath);
componentModule.filename = sourcePath;
componentModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
componentModule._compile(compiled, sourcePath);
const { default: RevenueReconciliation, RevenueInputErrors, RevenueInputsSection,
  RevenueBaseEditor, restoreBlankRevenueBases, updateRevenueBaseField, revenueBaseErrors } = componentModule.exports;
const { default: ConnectionRevenue, connectionRevenueErrors, revenueBasesRequestBody } = require('../src/components/ConnectionRevenue.tsx');
const { aggregateWeightedRevenueRate, connectionRevenueAreaModes, connectionRevenueModeText } = require('../src/connectionRevenueMode.ts');
const props = {
  inputs: { country_config: { currency: 'LCU' }, period: { baseline_year: 2025 },
    water_interventions: {}, sanitation_interventions: {} },
  onChange() {}, area: 'urban', error: '',
};
const render = extra => renderToStaticMarkup(React.createElement(RevenueInputErrors, { ...props, ...extra }));

assert.equal(renderToStaticMarkup(React.createElement(RevenueReconciliation, props)), '',
  'Initial automatic check must not show a panel.');
assert.equal(render({}), '', 'Pending inputs without an error must stay hidden.');
assert.equal(render({ resolution: { water: { base: {}, error: null }, sanitation: { base: {}, error: null } } }), '',
  'Successful automatic resolution must stay hidden before bases are saved.');
assert.equal(render({ inputs: { ...props.inputs, revenue_bases: { water: {}, sanitation: {} } } }), '',
  'Resolved inputs must not show an error.');

const missing = render({ resolution: { water: { error: 'Legacy volume must be numeric.' }, sanitation: { error: null } } });
assert.match(missing, /Legacy volume must be numeric/);
assert.match(missing, /role="alert"/);
assert.match(missing, /Enter shared revenue inputs/);
assert.doesNotMatch(missing, /<h4>Sanitation/);
assert.doesNotMatch(missing, /Checking existing revenue bases|Reconcile billed revenue/);

const invalid = render({ inputs: { ...props.inputs, revenue_bases: { water: { volume_mld: -1, origin: 'user-entered' } } },
  error: 'Billed volume must be nonnegative.' });
assert.match(invalid, /Billed volume must be nonnegative/);
assert.match(invalid, /Shared billed-revenue base/);
assert.match(invalid, /value="-1"/);
assert.match(invalid, /Enter shared revenue inputs/);
assert.match(invalid, /<details[^>]*open/);
assert.match(invalid, /<summary/);
assert.match(invalid, /Minimize/);
assert.match(invalid, /Show details/);
assert.equal(render({ inputs: null, error: 'Ignored without inputs.' }), '');

const blank = { version: 1, origin: 'user-entered', volume_mld: null, tariff: null,
  collection_ratio: null, reference_year: 2025, growth_rate: null, legacy: { retained: true } };
const draftInputs = { ...props.inputs, revenue_bases: { water: { ...blank }, sanitation: { ...blank } },
  revenue_legacy: { retained: true }, extraScenarioData: { retained: true } };
const snapshot = JSON.stringify(draftInputs);
let corrected;
const recoveryTree = RevenueInputErrors({ ...props, inputs: draftInputs,
  error: 'volume_mld is required.', onChange(value) { corrected = value; } });
function findButton(element) {
  if (!React.isValidElement(element)) return null;
  if (element.type === 'button' && element.props.children === 'Restore blank bases from existing inputs') return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const found = findButton(child);
    if (found) return found;
  }
  return null;
}
const recoveryButton = findButton(recoveryTree);
assert.ok(recoveryButton, 'Blank saved drafts must offer a recovery action.');
recoveryButton.props.onClick();
assert.deepEqual(corrected.revenue_bases, {}, 'The action must discard both blank drafts for automatic resolution.');
assert.equal(JSON.stringify(draftInputs), snapshot, 'Recovery must not mutate original inputs.');
for (const field of ['water_interventions', 'sanitation_interventions', 'revenue_legacy', 'extraScenarioData']) {
  assert.equal(corrected[field], draftInputs[field], `Recovery must retain ${field}.`);
}
assert.match(render({ inputs: draftInputs, error: 'volume_mld is required.' }), /Billed volume is required/);
const custom = { ...blank, volume_mld: 0, tariff: 0, collection_ratio: 0 };
const mixed = { ...draftInputs, revenue_bases: { water: custom, sanitation: blank } };
assert.equal(restoreBlankRevenueBases(mixed).revenue_bases.water, custom, 'Explicit zeros are custom values, not blanks.');
assert.ok(!restoreBlankRevenueBases(mixed).revenue_bases.sanitation);
const partial = { ...draftInputs, revenue_bases: { water: { ...blank, tariff: 10 } } };
assert.equal(restoreBlankRevenueBases(partial), partial, 'Partially entered values must never be reset.');
const legacyOrigin = { ...draftInputs, revenue_bases: { water: { ...blank, origin: 'collection' } } };
assert.equal(restoreBlankRevenueBases(legacyOrigin), legacyOrigin, 'Only user-entered empty drafts can be reset.');
const section = extra => renderToStaticMarkup(React.createElement(RevenueInputsSection,
  { ...props, sector: 'water', ...extra }));
const fresh = section({});
assert.match(fresh, /data-revenue-sector="water"/);
assert.match(fresh, /data-revenue-field="volume_mld"/);
assert.match(fresh, /Volume reference year/);
assert.match(fresh, /value="2025"/);
assert.doesNotMatch(fresh, /Resolve the shared billed-revenue base above|Revenue inputs need attention/);
assert.match(section({ sector: 'sanitation', area: 'rural' }), /rural sanitation/);
assert.doesNotMatch(section({ sector: 'sanitation' }), /data-revenue-sector="water"/);
const provenance = Object.fromEntries([
  'billed_share_sm', 'billed_share_basic', 'household_volume_share', 'marginal_cost',
].map(key => [key, { source_type: 'assumed', reference_year: 2025, note: `fixture ${key}` }]));
const connectionConfig = {
  version: 1, enabled: true, billed_share_sm: 1, billed_share_basic: 1, household_volume_share: 0.7,
  marginal_cost: 0.2, zero_cost_confirmed: false, alignment: 'estimate', baseline_volume_mld: null,
  funding_reference: 'fixed', reference_confirmed: true, funding_includes_reforms: false,
  reference_series: {}, nonhousehold_growth_rate: null, lower_service_billing_acknowledged: false, provenance,
};
const connectionInputs = {
  period: { baseline_year: 2025, forecast_end_year: 2027 },
  revenue_bases: { water: { reference_year: 2020 } },
};
assert.deepEqual(JSON.parse(revenueBasesRequestBody(connectionInputs)), connectionInputs,
  'Revenue-base status requests must post the raw inputs object, not a component wrapper.');
assert.deepEqual(connectionRevenueErrors(connectionConfig, connectionInputs, 'water'), [],
  'An explicitly authorized estimate uses the canonical path; it must not require another baseline-volume estimate or provenance.');
const observedWithoutValue = { ...connectionConfig, alignment: 'observation' };
assert.ok(connectionRevenueErrors(observedWithoutValue, connectionInputs, 'water')
  .some(message => /baseline-year observed billed volume is required/.test(message)),
'Observation alignment requires an explicit baseline-year volume.');
const observedWithValue = {
  ...observedWithoutValue, baseline_volume_mld: 0,
  provenance: { ...provenance, baseline_volume_mld: { source_type: 'observed', reference_year: 2025, note: 'Measured at baseline' } },
};
assert.deepEqual(connectionRevenueErrors(observedWithValue, connectionInputs, 'water'), [],
  'A measured zero is valid when explicitly sourced and documented.');
const connectionMarkup = renderToStaticMarkup(React.createElement(ConnectionRevenue, {
  inputs: { ...connectionInputs, revenue_bases: { water: { reference_year: 2020 } }, connection_revenue: { water: connectionConfig } },
  onChange() {}, sector: 'water', area: 'urban',
}));
assert.match(connectionMarkup, /Authorize estimate from the canonical volume path/);
assert.doesNotMatch(connectionMarkup, /Observed baseline-year billed volume/);
assert.equal(aggregateWeightedRevenueRate([
  { rate: 2, volume: 10, tariff: 2 },
  { rate: 4, volume: 30, tariff: 4 },
], 'volume'), 3.5, 'National applicable tariff must be billed-volume weighted.');
assert.ok(Math.abs(aggregateWeightedRevenueRate([
  { rate: 0.5, volume: 10, tariff: 2 },
  { rate: 0.75, volume: 30, tariff: 4 },
], 'tariff-volume') - (5 / 7)) < 1e-12, 'National collection ratio must be tariff-volume weighted.');
const nationalModes = connectionRevenueAreaModes([
  { water_supply: { connection_revenue: { requested: true, effective: true } } },
  { water_supply: { connection_revenue: { requested: false, effective: false } } },
], [
  { country_config: { area: 'Urban' }, connection_revenue: { water: { enabled: true } } },
  { country_config: { area: 'Rural' }, connection_revenue: { water: { enabled: false } } },
], 'water_supply', 'water');
assert.match(connectionRevenueModeText(nationalModes).text, /Mixed across areas/);
assert.match(connectionRevenueModeText(nationalModes).text, /Urban: connection-based/);
assert.match(connectionRevenueModeText(nationalModes).text, /Rural: exogenous/);
assert.equal(renderToStaticMarkup(React.createElement(RevenueReconciliation, { ...props, silent: true })), '',
  'The application must retain background resolution without a top revenue panel.');
const before = { ...props.inputs, revenue_bases: { sanitation: { ...custom, volume_mld: 9 } } };
const entered = updateRevenueBaseField(before, 'water', 'volume_mld', 21);
assert.equal(before.revenue_bases.water, undefined, 'Typing must not mutate source inputs.');
assert.equal(entered.revenue_bases.water.reference_year, 2025);
assert.equal(entered.revenue_bases.water.volume_mld, 21);
assert.equal(entered.revenue_bases.sanitation, before.revenue_bases.sanitation, 'Preserve the other sector.');
let complete = updateRevenueBaseField(entered, 'water', 'tariff', 0);
complete = updateRevenueBaseField(complete, 'water', 'collection_ratio', 0);
assert.deepEqual(revenueBaseErrors(complete, 'water'), {}, 'Explicit zero inputs are valid.');
assert.equal(complete.revenue_bases.water.growth_rate, null, 'Blank growth must retain population-based projection.');
assert.match(section({ inputs: updateRevenueBaseField(complete, 'water', 'collection_ratio', 1.2) }), /between 0 and 1/);
assert.equal(updateRevenueBaseField(complete, 'water', 'tariff', null).revenue_bases.water.tariff, null,
  'Clearing must keep the custom draft, not replace it with legacy values.');
assert.equal(restoreBlankRevenueBases(draftInputs, ['water']).revenue_bases.sanitation, draftInputs.revenue_bases.sanitation,
  'First-page recovery must affect only the selected sector.');
assert.match(renderToStaticMarkup(React.createElement(RevenueBaseEditor, { ...props, sector: 'water' })), /data-revenue-field="tariff"/,
  'Intervention editors must use the same always-available shared-base form.');
// Optional real-browser fixture made from the actual rendered component/CSS.
// Chromium executes the native toggle checks without adding dependencies.
if (process.env.REVENUE_TOGGLE_HTML) {
  const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');
  writeFileSync(process.env.REVENUE_TOGGLE_HTML, `<!doctype html><html><head><style>${css}</style></head>
    <body><div class="wb-app">${render({ inputs: draftInputs, error: 'volume_mld is required.' })}</div>
    <pre id="result"></pre><script>
    try {
      const details = document.querySelector('details');
      const summary = details.querySelector('summary');
      const content = details.querySelector('.revenue-error-content');
      const inputs = Array.from(content.querySelectorAll('input'));
      const values = JSON.stringify(inputs.map(input => input.value));
      const expandedHeight = details.getBoundingClientRect().height;
      if (!details.open) throw new Error('Notice should initially be expanded.');
      summary.click();
      if (details.open) throw new Error('Minimize did not collapse the notice.');
      if (details.getBoundingClientRect().height >= expandedHeight) throw new Error('Minimizing did not free space.');
      if (getComputedStyle(details.querySelector('.revenue-error-expand')).display === 'none') throw new Error('Show details must remain visible.');
      if (!summary.textContent.includes('Revenue inputs need attention')) throw new Error('Warning must remain visible.');
      summary.click();
      if (!details.open || content.getBoundingClientRect().height === 0) throw new Error('Expanding did not restore controls.');
      if (JSON.stringify(inputs.map(input => input.value)) !== values) throw new Error('Toggle changed input values.');
      document.querySelector('#result').textContent = 'PASS: minimize, expand, compact warning, preserved inputs';
    } catch (error) { document.querySelector('#result').textContent = 'FAIL: ' + error.message; }
    </script></body></html>`);
}
console.log('Revenue reconciliation: automatic checks hidden; validation errors and correction controls preserved.');