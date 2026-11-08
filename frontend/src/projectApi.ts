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
  constructor(message: string, status: number, public code = '', public retryAfterMs = 0) { super(message); this.status = status; }
  get retryable() { return this.status === 0 || this.status === 429 || this.status >= 500; }
}
export async function projectRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, options.method && options.method !== 'GET' ? 25_000 : 15_000);
  try {
    const response = await fetch(`/api${path}`, { ...options, signal: controller.signal, credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...options.headers } });
    if (response.status === 204) return undefined as T;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const retry = response.headers.get('Retry-After');
      const delay = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now())) : 0;
      if (response.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('wss-auth-required'));
      throw new ProjectError(typeof data?.detail === 'string' ? data.detail : typeof data?.detail?.message === 'string' ? data.detail.message : typeof data?.error === 'string' ? data.error : response.status === 409 ? 'This simulation changed in another session. Your draft has been retained.' : response.status === 403 ? 'Your permission to save this simulation has changed.' : response.status === 401 ? 'Session expired. Sign in again to save your changes.' : 'The request could not be completed. Please try again.',
        response.status, data?.code || '', Number.isFinite(delay) ? delay : 0);
    }
    if (data === null) throw new ProjectError('The server response could not be verified. Your draft has been retained.', 0, 'UNVERIFIED_RESPONSE');
    return data as T;
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError(controller.signal.aborted ? 'The save connection timed out. Your draft has been retained.' : 'Connection interrupted. Your draft has been retained.',
      0, controller.signal.aborted ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer); options.signal?.removeEventListener('abort', abort);
  }
}
export const projectMutation = <T,>(path: string, body: unknown, method = 'POST') => projectRequest<T>(path, { method, body: JSON.stringify(body) });
export const recoveryKey = (userId: string, projectId: string) => `wss:recovery:${userId}:${projectId}`;
export function downloadRecovery(value: unknown, name = 'wss-recovery') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `${name}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
