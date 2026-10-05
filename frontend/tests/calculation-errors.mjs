import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('../src/api.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = new Module(filename);
module.paths = Module._nodeModulePaths(path.dirname(filename));
module._compile(compiled, filename);
const { runCalculation, runEconomicProjections } = module.exports;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => ({ ok: false, json: async () => ({
    detail: 'Invalid model inputs: as_is_forecast_length must be a valid integer.',
  }) });
  await assert.rejects(runCalculation({}), /as_is_forecast_length must be a valid integer/);
  const results = { years: [2025, 2026], population: [10, 11], water_supply: {} };
  globalThis.fetch = async () => ({ ok: true, json: async () => results });
  assert.deepEqual(await runCalculation({}), results);
  const projections = { years: [2025, 2026], gdp_real_local: [100, 110], total_hh: [10, 11] };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/api/projections');
    assert.equal(options.method, 'POST');
    return { ok: true, json: async () => projections };
  };
  assert.deepEqual(await runEconomicProjections({}), projections);
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ detail: 'GDP observations must be numeric.' }) });
  await assert.rejects(runEconomicProjections({}), /GDP observations must be numeric/);
} finally { globalThis.fetch = originalFetch; }
const chart = readFileSync(new URL('../src/components/LiveBAUChart.tsx', import.meta.url), 'utf8');
assert.match(chart, /runCalculation\(inp\)/, 'BAU charts must use detailed API errors.');
assert.doesNotMatch(chart, /calc failed/);
assert.match(chart, /setData\(\[\]\)/, 'A failed request must clear previous plotted results.');
console.log('Calculation errors: API details retained, chart uses shared client, stale data cleared on failure.');