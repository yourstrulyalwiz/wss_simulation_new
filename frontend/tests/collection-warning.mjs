import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/collectionWarning.ts', import.meta.url), 'utf8');
const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
const { collectionBelowBaselineWarning: warning } =
  await import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);

assert.match(warning('Rural', 'water', 0.70, 0.009), /Rural water: the target collection rate is 0.9%, below the baseline of 70%/);
assert.match(warning('Urban', 'sanitation', 0.9, 0.009), /0.9%, below the baseline of 90%/);
assert.match(warning('Rural', 'water', 0.70, 0.009), /If you intend 90%, enter 90/);
assert.equal(warning('Urban', 'water', 0.70, 0.70), null, 'equality stays neutral');
assert.equal(warning('Urban', 'water', 0.70, 0.90), null, 'an improvement does not warn');
for (const [baseline, target] of [[null, .009], [.70, null], [.70, 1.2], [NaN, .009], [.7, Infinity]])
  assert.equal(warning('Rural', 'water', baseline, target), null, 'missing/invalid fractions do not become warnings');
assert.equal(warning('Rural', 'water', 90, .009), null, 'percentage entries are never reinterpreted as fractions');

const panel = readFileSync(new URL('../src/components/InterventionPanel.tsx', import.meta.url), 'utf8');
const revenueBase = readFileSync(new URL('../src/components/RevenueBase.tsx', import.meta.url), 'utf8');
assert.match(panel, /revenue_bases\?\.water\?\.collection_ratio/);
assert.match(panel, /revenue_bases\?\.sanitation\?\.collection_ratio/);
assert.match(panel, /Enter 90 for 90%/);
assert.match(revenueBase, /0\.70 means 70%/);
console.log('Collection warning: scope/sector-specific fractions, neutral equality, validation and entry convention passed.');
