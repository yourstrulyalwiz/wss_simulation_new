import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const filename = fileURLToPath(new URL('../src/developmentPreview.ts', import.meta.url));
const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const module = new Module(filename);
module.paths = Module._nodeModulePaths(path.dirname(filename));
module._compile(compiled, filename);
const { chooseDevelopmentPreview } = module.exports;
const previous = { __wss_bundle: 1, inputs: { edited: true },
  altInputs: { rural: { edited: true } }, scope: { areaRural: true }, presentation: { mode: 'saved' } };
const draft = { __wss_bundle: 1, inputs: { profile_metadata: { status: 'data_preview' } },
  altInputs: { rural: { imported: true } } };
const preview = { revision: 'workbook-preview', bundle: draft };
const saved = [{ name: 'Earlier simulation', inputs: { older: true } }];
const first = chooseDevelopmentPreview(previous, saved, preview, null);
assert.equal(first.session, draft);
assert.equal(first.scenarios.length, 2);
assert.equal(first.scenarios[1].inputs, previous, 'Back up the whole bundle, including rural and presentation.');
assert.equal(saved.length, 1, 'Do not mutate saved scenarios.');
const edited = { ...draft, inputs: { editedAfterImport: true } };
assert.equal(chooseDevelopmentPreview(edited, first.scenarios, preview, preview.revision).session, edited,
  'Reloads must preserve subsequent edits rather than force the preview again.');
assert.equal(chooseDevelopmentPreview(previous, saved, { profile: null }, null).session, previous,
  'Production must retain existing work.');
assert.equal(chooseDevelopmentPreview(null, [], preview, null).scenarios.length, 0);
const duplicate = chooseDevelopmentPreview(previous, first.scenarios, preview, null);
assert.match(duplicate.scenarios[2].name, /\(2\)$/);
console.log('Development preview: one-time startup, prior-session backup, reload preservation and production isolation passed.');