import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, Module } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const filename = fileURLToPath(new URL('../src/components/BudgetBaselineCards.tsx', import.meta.url));
const loaded = new Module(filename);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText, filename);
const render = (results, sectors = ['water', 'sanitation']) => renderToStaticMarkup(
  React.createElement(loaded.exports.default, { results, sectors, baselineYear: 2025 }));
const html = render({
  years: [2024, 2025], gdp_real_local: [1000, 2000],
  water_supply: {
    budget_execution_baseline: [0.5, 0.75],
    budget_executed_input_basis: [20, 40],
    budget_forecast_metadata: {
      executed: { initialization_years: [2023, 2024, 2025] },
      allocated: { initialization_years: [2023, 2025] },
    },
  },
  sanitation: { budget_execution_baseline: [0.5, 0], budget_executed_input_basis: [20, 0] },
});
for (const value of ['75.00%', '2.000%', '0.00%', '0.000%', '2023, 2024, 2025', '2 of 3 years available']) assert.ok(html.includes(value), value);
assert.ok(render(null).includes('Unavailable'));
assert.ok(!render(null, ['water']).includes('Sanitation'));
console.log('Budget baseline card checks passed.');
