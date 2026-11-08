import { useEffect, useState } from 'react';
import type { PostInterventionSettings, PostResponse } from '../postIntervention';
import { simulationHeaders } from '../simulationTransport';

/** Presentation controls never enter this request key. Each edit invalidates stale output immediately. */
export function usePostIntervention(bundle: any, settings: PostInterventionSettings | undefined, includeDebt: boolean, projectId: string | undefined, validationError: string) {
  const key = JSON.stringify({ bundle, ...(settings ? { settings } : {}), includeDebt });
  const [snapshot, setSnapshot] = useState<{ key: string; data?: PostResponse; error?: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (validationError) return;
    let current = true;
    const controller = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      deadline = setTimeout(() => {
        if (current) {
          controller.abort();
          setSnapshot({ key, error: 'Analysis took too long. Your settings are unchanged; please retry.' });
        }
      }, 30000);
      try {
        const response = await fetch('/api/post-intervention', {
          method: 'POST', credentials: 'same-origin', headers: simulationHeaders(bundle, projectId),
          signal: controller.signal, body: key,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message = typeof payload?.detail === 'string' ? payload.detail
            : typeof payload?.detail?.message === 'string' ? payload.detail.message
            : typeof payload?.error === 'string' ? payload.error : `Analysis unavailable (${response.status}). Check the active inputs and retry.`;
          const retryAfter = response.headers.get('Retry-After');
          throw new Error(`${message}${response.status === 503 && retryAfter ? ` Retry after ${retryAfter} seconds.` : ''}`);
        }
        if (!payload || !Array.isArray(payload.years) || !payload.per_area_sector || !payload.combined)
          throw new Error('The analysis response is incomplete. Please retry.');
        if (current && !controller.signal.aborted) setSnapshot({ key, data: payload });
      } catch (error) {
        if (current && !controller.signal.aborted)
          setSnapshot({ key, error: error instanceof Error ? error.message : 'Analysis unavailable. Please retry.' });
      } finally {
        clearTimeout(deadline);
      }
    }, 400);
    return () => { current = false; clearTimeout(timer); clearTimeout(deadline); controller.abort(); };
  }, [key, attempt, projectId, validationError]);
  const matching = !validationError && snapshot?.key === key ? snapshot : null;
  return {
    data: matching?.data ?? null,
    error: validationError || matching?.error || '',
    loading: !validationError && !matching,
    retry: () => { setSnapshot(null); setAttempt(value => value + 1); },
  };
}
