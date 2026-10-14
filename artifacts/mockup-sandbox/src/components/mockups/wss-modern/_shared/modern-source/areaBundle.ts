// The area bundle — the one place that knows how the tool's several area datasets are packed for
// persistence and unpacked for export.
//
// `inputs` only ever holds the PRIMARY dataset (urban, or the sole dataset in a single-scope mode);
// Rural and National live in `altInputs`, and the entry mode lives in three separate flags. Anything
// that saves or exports has to carry all of that or it silently keeps only the first area — which is
// exactly what profiles, scenarios and page reloads used to do.

export const BUNDLE_KEY = '__wss_bundle';

export type AreaScope = {
  scopeMode?: 'urban_rural' | 'national';
  areaUrban?: boolean;
  areaRural?: boolean;
};

export type AreaBundle = {
  [BUNDLE_KEY]?: number;
  inputs: any;
  altInputs?: Record<string, any>;
  scope?: AreaScope;
};

export function isBundle(obj: any): boolean {
  return !!(obj && typeof obj === 'object' && obj[BUNDLE_KEY]);
}

/** The areas a bundle should export as a deck, following the ENTRY mode it was saved in. */
export function areasOf(b: any): Record<string, any> {
  if (!b) return {};
  // A legacy scenario (or any bare inputs object) is a single unlabelled dataset — treat it as the
  // whole picture rather than guessing it was urban, so its deck carries one complete scope.
  if (!isBundle(b)) return { national: b };
  const alt = b.altInputs || {};
  const sc: AreaScope = b.scope || {};
  if (sc.scopeMode === 'national') return { national: alt.national ?? b.inputs };
  if (sc.areaUrban && sc.areaRural) {
    return alt.rural ? { urban: b.inputs, rural: alt.rural } : { urban: b.inputs };
  }
  if (sc.areaRural && !sc.areaUrban) return { rural: alt.rural ?? b.inputs };
  return { urban: b.inputs };
}

/** Areas for the LIVE export, from the dashboard's own props (nothing has been packed yet). */
export function liveAreas(geoScope: string, inputs: any, altInputs?: Record<string, any>): Record<string, any> {
  if (geoScope === 'urban_rural') {
    return altInputs?.['rural'] ? { urban: inputs, rural: altInputs['rural'] } : { urban: inputs };
  }
  if (geoScope === 'rural') return { rural: altInputs?.['rural'] ?? inputs };
  if (geoScope === 'national') return { national: altInputs?.['national'] ?? inputs };
  return { urban: inputs };
}
