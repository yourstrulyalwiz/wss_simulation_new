// Request-local metadata only. Never put the active project in a module-global variable.
export const SIMULATION_ID_FIELD = '__wss_simulation_id';
export function stripSimulationId(area: any) {
  if (!area || typeof area !== 'object') return area;
  const { [SIMULATION_ID_FIELD]: _transportId, ...stored } = area;
  return stored;
}
export function withSimulationId(area: any, id?: string) {
  const clean = stripSimulationId(area);
  return clean && id ? { ...clean, [SIMULATION_ID_FIELD]: id } : clean;
}
export function simulationHeaders(source?: any, projectId?: string): Record<string, string> {
  const candidate = projectId || source?.[SIMULATION_ID_FIELD] || source?.inputs?.[SIMULATION_ID_FIELD] ||
    Object.values(source?.areas || {}).map((area: any) => area?.[SIMULATION_ID_FIELD]).find(Boolean);
  return { 'Content-Type': 'application/json',
    ...(typeof candidate === 'string' && candidate.trim() ? { 'x-simulation-id': candidate } : {}) };
}
