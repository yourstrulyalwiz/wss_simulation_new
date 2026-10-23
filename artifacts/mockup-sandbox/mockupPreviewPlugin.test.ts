import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { mockupPreviewPlugin } from './mockupPreviewPlugin';

test('discovery includes nested previews, excludes private helpers, and removes deleted previews', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mockup-discovery-'));
  try {
    for (const file of [
      'Visible.tsx', 'nested/Preview.tsx', '_Hidden.tsx',
      '_shared/Helper.tsx', 'nested/_private/Helper.tsx', 'notes.txt',
    ]) {
      const target = path.join(root, 'src/components/mockups', file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, 'export default function Component() { return null; }');
    }
    const plugin = mockupPreviewPlugin();
    // These hooks use only the resolved root, not a running Vite server.
    const configure = plugin.configResolved as (config: { root: string }) => void;
    const discover = plugin.buildStart as () => Promise<void>;
    configure({ root });
    await discover();
    const generated = path.join(root, 'src/.generated/mockup-components.ts');
    let source = await readFile(generated, 'utf8');
    assert.match(source, /mockups\/Visible\.tsx/);
    assert.match(source, /mockups\/nested\/Preview\.tsx/);
    assert.equal((source.match(/\(\) => import\(/g) || []).length, 2);
    assert.doesNotMatch(source, /Hidden|Helper|notes/);

    await rm(path.join(root, 'src/components/mockups/Visible.tsx'));
    await discover();
    source = await readFile(generated, 'utf8');
    assert.doesNotMatch(source, /Visible/);
    assert.match(source, /nested\/Preview\.tsx/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
