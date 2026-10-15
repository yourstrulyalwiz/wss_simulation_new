import type { ProjectScope } from './projectScope';

export type Identity = { id: string; email: string; is_admin: boolean };
export type Simulation = {
  id: string; name: string; country_code: string; country_name: string; area_label?: string;
  scope: ProjectScope; visibility: 'private' | 'public'; status: 'draft' | 'calculated';
  updated_at: string; revision: number | null; is_seed: boolean; is_owner: boolean; read_only: boolean;
  archived_at?: string | null; period?: any; notice?: string; country_metadata?: any;
  bundle: any; scenarios: any[]; location?: any; published_version_id?: string | null;
};
export type SimulationCard = Omit<Simulation, 'bundle' | 'scenarios' | 'location'>;
export type Draft = { bundle: any; scenarios: any[]; location: any; scope: ProjectScope; name?: string };
export type SavedVersion = { id: string; label: string; created_at: string; input_hash?: string; model_version?: string; has_results?: boolean };
export type Country = { id: string; name: string; iso2Code: string; region: { id: string; value: string }; incomeLevel: { id: string; value: string }; lendingType: { id: string; value: string } };
export type CountryMetadata = { countries: Country[]; retrieved_at: string | null; stale: boolean; error?: string };
export class ProjectError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
export async function projectRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, credentials: 'include', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProjectError(typeof data.detail === 'string' ? data.detail : typeof data.detail?.message === 'string' ? data.detail.message : typeof data.error === 'string' ? data.error : response.status === 409 ? 'This simulation changed in another session. Your work has been kept for recovery.' : response.status === 403 ? 'Access is limited to verified World Bank accounts with permission to view this simulation.' : response.status === 401 ? 'Please sign in to continue.' : 'The request could not be completed. Please try again.', response.status);
  return data as T;
}
export const projectMutation = <T,>(path: string, body: unknown, method = 'POST') => projectRequest<T>(path, { method, body: JSON.stringify(body) });
export const recoveryKey = (userId: string, projectId: string) => `wss:recovery:${userId}:${projectId}`;
export function downloadRecovery(value: unknown, name = 'wss-recovery') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
