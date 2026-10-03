import { migrateInputCompatibility } from './inputCompatibility';

// A marginal pass enables a selection, not a replacement of each area's saved toggles.
export function enabledInAnyArea(areas: any[], key: string): boolean {
  return areas.some(area => !!migrateInputCompatibility(area)?.toggles?.[key]);
}

export function marginalPassInput(input: any, enabledMask: Record<string, boolean>, includeCustoms: boolean) {
  const migrated = migrateInputCompatibility(input);
  const original = migrated.toggles || {};
  const keys = new Set([...Object.keys(original), ...Object.keys(enabledMask)]);
  const toggles = Object.fromEntries([...keys].map(key => [key, !!original[key] && !!enabledMask[key]]));
  return { ...migrated, toggles, custom_interventions: includeCustoms ? (input.custom_interventions || []) : [] };
}