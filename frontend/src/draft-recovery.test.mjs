import assert from 'node:assert/strict';
import { build } from 'esbuild';
const output = await build({ entryPoints: ['frontend/src/draftRecovery.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { canonical, readRecoveries, removeMatching } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
class Storage {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i]; }
  getItem(k) { return this.values.get(k) || null; }
  setItem(k, v) { this.values.set(k, v); }
  removeItem(k) { this.values.delete(k); }
}
const storage = new Storage(), base = 'wss:recovery:owner:project';
const draft = { bundle: { inputs: { zero: 0, blank: null }, altInputs: { rural: { hidden: true } } },
  scenarios: [{ name: 'comparison' }], location: { activeTab: 2 }, scope: { sectors: ['water'] } };
const one = { ownerId: 'owner', projectId: 'project', editorId: 'one', revision: 3, saved_at: '2026-11-08T00:00:00Z', draft,
  setup: { name: 'not yet applied', scope: { sectors: ['sanitation'] } } };
storage.setItem(`${base}:tab:one`, JSON.stringify(one));
storage.setItem(`${base}:tab:two`, JSON.stringify({ ...one, editorId: 'two' }));
storage.setItem('wss:recovery:other:project', JSON.stringify(one));
const found = readRecoveries(storage, 'owner', 'project');
assert.equal(found.length, 2); assert.deepEqual(found[0].envelope, one);
removeMatching(storage, found[0]);
assert.ok(storage.getItem(`${base}:tab:two`));
storage.setItem(`${base}:tab:two`, JSON.stringify({ ...one, saved_at: '2026-11-08T00:01:00Z' }));
removeMatching(storage, found[1]); assert.ok(storage.getItem(`${base}:tab:two`));
assert.equal(canonical({ b: 2, a: 1 }), canonical({ a: 1, b: 2 }));
storage.setItem(base, JSON.stringify({ revision: 1, saved_at: one.saved_at, draft }));
assert.equal(readRecoveries(storage, 'owner', 'project').find(item => item.key === base).envelope.revision, 1);
console.log('Recovery round trip, original revision, unapplied setup, legacy keys, account partition and independent tab copies passed.');
