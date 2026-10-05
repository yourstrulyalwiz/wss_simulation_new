import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(new URL('../src/costMix.ts', import.meta.url));
const compiled = require('typescript').transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: require('typescript').ModuleKind.CommonJS },
}).outputText;
const module = new Module(filename);
module.paths = Module._nodeModulePaths(path.dirname(filename));
module._compile(compiled, filename);
const { displayedCostMix, summarizeCostMix, formatRealUnitCost } = module.exports;
assert.equal(formatRealUnitCost(null, 1), '—');
assert.equal(formatRealUnitCost(undefined, 1), '—');
assert.equal(formatRealUnitCost(NaN, 1), '—');
assert.equal(formatRealUnitCost(0, 1), '0');
assert.equal(formatRealUnitCost(100, .8), '80');

const template = [{ name: 'Piped into dwelling', share: null, cost: null }];
const blank = displayedCostMix([], template);
assert.deepEqual(blank, template);
blank[0].name = 'Custom';
assert.equal(template[0].name, 'Piped into dwelling', 'Draft edits must not alter templates or other areas.');
assert.equal(summarizeCostMix(template).weighted, null);
assert.equal(summarizeCostMix(template).hasValues, false);
assert.equal(summarizeCostMix([{ name: 'A', share: 1, cost: null }]).weighted, null);
assert.equal(summarizeCostMix([{ name: 'A', share: .5, cost: 100 }]).weighted, null);
assert.equal(summarizeCostMix([{ name: 'A', share: 1, cost: 0 }]).weighted, 0, 'Explicit zero is not blank.');
assert.equal(summarizeCostMix([{ name: 'A', share: 1, cost: -1 }]).weighted, null);
assert.equal(summarizeCostMix([{ name: 'A', share: 1.1, cost: 100 },
  { name: 'B', share: -.1, cost: 50 }]).weighted, null);
assert.equal(summarizeCostMix([{ name: 'A', share: .4, cost: 100 },
  { name: 'B', share: .6, cost: 200 }, { name: 'Inactive', share: null, cost: null }]).weighted, 160);
const custom = [{ name: 'DRC custom technology', share: .4, cost: null }];
assert.strictEqual(displayedCostMix(custom, template)[0], custom[0]);
assert.deepEqual(displayedCostMix(custom, template), custom);
assert.deepEqual(displayedCostMix(undefined), [], 'The Add technology control remains available without templates.');
console.log('Cost mixes: blank rows, preserved drafts, valid weighted costs, missing/invalid entries and explicit zero.');