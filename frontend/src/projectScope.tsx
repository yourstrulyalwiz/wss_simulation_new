import { createContext, useContext } from 'react';

export type Sector = 'water' | 'sanitation';
export type ProjectScope = { sectors: Sector[]; scopeMode: 'urban_rural' | 'national'; areaUrban: boolean; areaRural: boolean; [key: string]: unknown };
export function normalizeScope(scope: any = {}): ProjectScope {
  const sectors = (['water', 'sanitation'] as Sector[]).filter(sector => !Array.isArray(scope.sectors) || scope.sectors.includes(sector));
  return { ...scope, sectors: sectors.length ? sectors : ['water', 'sanitation'], scopeMode: scope.scopeMode === 'national' ? 'national' : 'urban_rural',
    areaUrban: scope.scopeMode === 'national' ? scope.areaUrban === true : scope.areaUrban !== false || scope.areaRural !== true, areaRural: scope.areaRural === true };
}
export function geography(scope: ProjectScope) {
  return scope.scopeMode === 'national' ? 'National' : scope.areaUrban && scope.areaRural ? 'Urban + Rural' : scope.areaRural ? 'Rural' : 'Urban';
}
export function scopeWithGeography(scope: ProjectScope, value: string): ProjectScope {
  return { ...scope, scopeMode: value === 'National' ? 'national' : 'urban_rural', areaUrban: value === 'Urban' || value === 'Urban + Rural', areaRural: value === 'Rural' || value === 'Urban + Rural' };
}
export function scopedArea(area: any, scope: ProjectScope) {
  return area ? { ...area, calculation_scope: scope.sectors } : area;
}
export function scopedBundle(bundle: any, scope: ProjectScope) {
  return { ...bundle, scope, inputs: scopedArea(bundle.inputs, scope),
    altInputs: Object.fromEntries(Object.entries(bundle.altInputs || {}).map(([key, area]) => [key, scopedArea(area, scope)])) };
}
/** Input/import edits cannot erase observations for a sector excluded from this project. */
export function preserveDormantInputs(previous: any, next: any, sectors: Sector[]) {
  if (!previous || sectors.length === 2) return next;
  const output = { ...next };
  const inactive = sectors.includes('water') ? 'sanitation' : 'water';
  const prefix = inactive === 'water' ? 'ws_' : 'san_';
  for (const key of Object.keys(previous)) if (key.startsWith(`${inactive}_`)) output[key] = previous[key];
  for (const key of ['toggles', 'technical', 'bau']) {
    if (!previous[key]) continue;
    output[key] = { ...output[key] };
    for (const field of new Set([...Object.keys(output[key] || {}), ...Object.keys(previous[key])])) {
      if (!field.startsWith(prefix)) continue;
      if (field in previous[key]) output[key][field] = previous[key][field];
      else delete output[key][field];
    }
  }
  for (const key of ['utility_debt', 'revenue_bases']) {
    if (previous[key]?.[inactive] !== undefined) output[key] = { ...output[key], [inactive]: previous[key][inactive] };
  }
  if (Array.isArray(previous.custom_interventions)) {
    output.custom_interventions = [
      ...(next.custom_interventions || []).filter((item: any) => item.sector !== inactive),
      ...previous.custom_interventions.filter((item: any) => item.sector === inactive),
    ];
  }
  return output;
}
export const ProjectScopeContext = createContext<{ sectors: Sector[]; readOnly: boolean; projectMode: boolean; projectId?: string }>({ sectors: ['water', 'sanitation'], readOnly: false, projectMode: false });
export const useProjectScope = () => useContext(ProjectScopeContext);
