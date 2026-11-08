import { recoveryKey, type Draft, type Simulation } from './projectApi';
export type PendingSetup = { name: string; scope: Simulation['scope'] };
export type RecoveryEnvelope = { ownerId: string; projectId: string; editorId: string; revision: number | null;
  saved_at: string; draft: Draft; setup?: PendingSetup };
export type RecoveryEntry = { key: string; envelope: RecoveryEnvelope };
export function canonical(value: any): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.keys(item).sort().reduce((out: any, key) => { out[key] = item[key]; return out; }, {}) : item);
}
export function draftOf(value: Simulation): Draft {
  return { bundle: value.bundle, scenarios: value.scenarios || [], location: value.location || {},
    scope: value.scope, name: value.name };
}
export function readRecoveries(storage: Storage, ownerId: string, projectId: string): RecoveryEntry[] {
  const base = recoveryKey(ownerId, projectId), entries: RecoveryEntry[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i)!;
    if (key !== base && !key.startsWith(`${base}:tab:`)) continue;
    try {
      const item = JSON.parse(storage.getItem(key) || 'null');
      if (!item?.draft || item.ownerId && item.ownerId !== ownerId || item.projectId && item.projectId !== projectId) continue;
      entries.push({ key, envelope: { ...item, ownerId, projectId, editorId: item.editorId || 'legacy' } });
    } catch { /* A corrupt copy is never deleted as a side effect of reading. */ }
  }
  return entries.sort((a, b) => b.envelope.saved_at.localeCompare(a.envelope.saved_at));
}
export function removeMatching(storage: Storage, entry: RecoveryEntry) {
  const current = storage.getItem(entry.key);
  if (!current) return;
  const stored = JSON.parse(current);
  if (stored.saved_at === entry.envelope.saved_at && canonical(stored.draft) === canonical(entry.envelope.draft) &&
      canonical(stored.setup) === canonical(entry.envelope.setup)) storage.removeItem(entry.key);
}
