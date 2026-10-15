import { withSpendingDrafts } from './publicSpendingSchedule';
import { simulationHeaders, stripSimulationId } from './simulationTransport';
const BASE_URL = '/api';

export function calculationPayload(inputs: any) {
  const sectors: string[] = Array.isArray(inputs?.calculation_scope) ? inputs.calculation_scope : ['water', 'sanitation'];
  return { ...stripSimulationId(inputs), calculation_scope: sectors,
    ...(!sectors.includes('water') ? { toggles: { ...inputs?.toggles, san_nrw_link_enabled: false } } : {}) };
}
export async function resolveRevenueBases(inputs: any, signal?: AbortSignal) {
  const response = await fetch(`${BASE_URL}/revenue-bases`, { method: 'POST', credentials: 'include',
    cache: 'no-store', headers: simulationHeaders(inputs), body: JSON.stringify(calculationPayload(inputs)), signal });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Revenue inputs could not be verified.');
  return data;
}

export async function fetchDefaults() {
  const res = await fetch(`${BASE_URL}/defaults`);
  return res.json();
}

export async function fetchCostMixTemplates() {
  const res = await fetch(`${BASE_URL}/cost-mix/templates`);
  if (!res.ok) throw new Error('The original technology catalogue could not be loaded.');
  return res.json();
}

export async function runCalculation(inputs: any, required: 'water' | 'sanitation' | 'partial' | 'both' = 'both') {
  // A recalculation must never reuse cached pre-v4/v3 attribution. Migrated configurations
  // also change every input-keyed chart/result request; saved legacy results retain their metadata.
  const res = await fetch(`${BASE_URL}/calculate`, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: simulationHeaders(inputs),
    body: JSON.stringify(calculationPayload(withSpendingDrafts(inputs))),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Calculation inputs are invalid.');
  }
  const result = await res.json();
  const errors = result.sector_errors || {};
  const allowed = calculationPayload(inputs).calculation_scope.map((sector: string) => sector === 'water' ? 'water_supply' : sector);
  const keys = (required === 'partial' ? [] : required === 'water' ? ['water_supply'] :
    required === 'sanitation' ? ['sanitation'] : ['water_supply', 'sanitation']).filter(key => allowed.includes(key));
  const missing = keys.filter(key => errors[key] || !result[key]);
  if (missing.length) throw new Error(missing.map(key => errors[key] || `${key}: results unavailable`).join(' '));
  return result;
}

// Cost-independent calculated rows use the same engine's population/GDP formulas.
export async function runEconomicProjections(inputs: any) {
  const res = await fetch(`${BASE_URL}/projections`, {
    method: 'POST',
    credentials: 'include',
    headers: simulationHeaders(inputs),
    body: JSON.stringify(calculationPayload(inputs)),
  });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(typeof body.detail === 'string' ? body.detail : 'Projection inputs are invalid.');
  }
  return res.json();
}

// Download a pre-filled Excel template of the year-by-year input table for the given dataset.
export async function downloadTemplate(inputs: any) {
  const res = await fetch(`${BASE_URL}/template/xlsx`, {
    method: 'POST',
    credentials: 'include',
    headers: simulationHeaders(inputs),
    body: JSON.stringify(calculationPayload(inputs)),
  });
  if (!res.ok) throw new Error('Template download failed (' + res.status + ')');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'wss_input_template.xlsx'; a.click();
  URL.revokeObjectURL(url);
}

// Upload a filled template (base64-encoded in JSON, so no multipart dependency) and get back the
// current inputs with the sheet's editable cells overlaid.
export async function importTemplate(file: File, inputs: any): Promise<{ inputs: any; cellsUpdated: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;                                    // chunk to avoid call-stack limits
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  const res = await fetch(`${BASE_URL}/import/xlsx`, {
    method: 'POST',
    credentials: 'include',
    headers: simulationHeaders(inputs),
    body: JSON.stringify({ file_b64: btoa(binary), inputs: stripSimulationId(inputs) }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'The input template could not be imported.');
  if (data.error) throw new Error(data.error);
  return data;
}
