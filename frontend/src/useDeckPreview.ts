import { useEffect, useRef, useState } from 'react';
import { calculationPayload } from './api';
import { simulationHeaders } from './simulationTransport';
import { resultsInputs } from './resultsDebtMode';
import type { ContributionView } from './contributionView';
import type { CurrencyDisplaySettings } from './currencyDisplay';

export type DeckSlide = { number: number; title: string; image: string; width: number; height: number };
type Preview = { filename: string; pptx_base64: string; slides: DeckSlide[]; rendered_with: 'LibreOffice'; omitted_sections?: string[] };
type Artifact = Omit<Preview, 'pptx_base64'> & { url: string; key: string };
type Failure = { message: string; issues: string[] };

/** The same entered geography and borrowing snapshot is used by Results export and Slide Deck.
 * Missing areas remain missing: never replace a national/rural dataset with urban data. */
export function deckExportAreas(geoScope: string, inputs: any, altInputs: Record<string, any> | undefined, sectors: string[], includeDebt: boolean) {
  const keys = geoScope === 'urban_rural' ? ['urban', 'rural'] : [geoScope];
  return Object.fromEntries(keys.map(key => {
    const raw = key === 'urban' ? inputs : altInputs?.[key];
    if (!raw) return [key, null];
    const area = { ...raw, calculation_scope: sectors,
      ...(key === 'rural' ? { country_config: inputs?.country_config, period: inputs?.period } : {}) };
    return [key, resultsInputs(area, includeDebt)];
  }));
}

export function useDeckPreview(areas: Record<string, any>, contributionView: ContributionView, currencyDisplay: CurrencyDisplaySettings, projectId?: string) {
  const body = JSON.stringify({ areas: Object.fromEntries(Object.entries(areas).map(([area, data]) => [area, data ? calculationPayload(data) : null])),
    contribution_view: contributionView, currency_display: currencyDisplay });
  const key = JSON.stringify([projectId, body]);
  const currentKey = useRef(key); currentKey.current = key;
  const artifactRef = useRef<Artifact | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [failure, setFailure] = useState<(Failure & { key: string }) | null>(null);
  const [stale, setStale] = useState(false);
  const clearArtifact = () => {
    if (artifactRef.current) URL.revokeObjectURL(artifactRef.current.url);
    artifactRef.current = null;
    setArtifact(null);
  };
  useEffect(() => {
    generation.current++;
    if (request.current) setStale(true);
    request.current?.abort();
    if (artifactRef.current) { URL.revokeObjectURL(artifactRef.current.url); artifactRef.current = null; setStale(true); }
    setArtifact(null); setBusyKey(null); setFailure(null);
    return () => { generation.current++; request.current?.abort(); };
  }, [key]);
  useEffect(() => () => {
    if (artifactRef.current) URL.revokeObjectURL(artifactRef.current.url);
  }, []);
  const generate = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    const attempt = ++generation.current;
    clearArtifact(); setFailure(null); setBusyKey(key);
    const timeout = setTimeout(() => controller.abort(), 195000);
    try {
      const response = await fetch('/api/export/deck/preview', { method: 'POST', credentials: 'include', cache: 'no-store',
        headers: simulationHeaders({ areas }, projectId), body, signal: controller.signal });
      let data: any;
      try {
        data = await response.json();
      } catch {
        throw new Error(response.ok
          ? 'The slide preview download was interrupted or incomplete. Please retry; your saved simulation has not changed.'
          : response.status === 413
          ? 'The slide preview transfer was rejected as too large. Please retry after updating the published app.'
          : `The preview service returned an unreadable response (${response.status}). Please retry.`);
      }
      if (!response.ok) {
        const messages = Array.isArray(data.intervention_issues) ? data.intervention_issues.map((issue: any) =>
          [issue.area, issue.sector, issue.intervention, issue.message].filter(Boolean).join(': ')) : [];
        const detail = typeof data.detail === 'string' ? data.detail : Array.isArray(data.detail)
          ? data.detail.map((item: any) => item.msg || item.message || 'Invalid input').join(' ') : '';
        throw { message: detail || (response.status === 429 ? 'The renderer is busy. Please wait a moment and retry.'
          : response.status === 503 ? 'Slide rendering is unavailable. Please retry later; no substitute preview has been generated.'
          : `Preview could not be generated (${response.status}). Complete the selected areas and enabled sectors, then retry.`), issues: messages };
      }
      if (attempt !== generation.current || currentKey.current !== key) return;
      const preview = data as Preview;
      if (preview.rendered_with !== 'LibreOffice' || !preview.pptx_base64 || !preview.filename || !Array.isArray(preview.slides) || !preview.slides.length ||
        preview.slides.some(slide => !Number.isInteger(slide.number) || slide.number < 1 || typeof slide.title !== 'string' ||
          !slide.image?.startsWith('data:image/png;base64,') || !(slide.width > 0) || !(slide.height > 0))) {
        throw new Error('The renderer returned an incomplete preview. Please retry.');
      }
      const binary = atob(preview.pptx_base64);
      // Array.from(string, mapper) creates a very large intermediate collection
      // for real 20+ MB decks. Copy directly into the final byte buffer instead.
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      const next = { filename: preview.filename, slides: preview.slides, rendered_with: preview.rendered_with,
        omitted_sections: preview.omitted_sections || [], url, key };
      artifactRef.current = next; setArtifact(next); setStale(false);
    } catch (error) {
      if (attempt !== generation.current || currentKey.current !== key) return;
      const value = error as Partial<Failure>;
      setFailure({ key, message: controller.signal.aborted ? 'Preview generation timed out. Please retry.' : value.message || 'Preview generation failed. Check your connection and retry.',
        issues: value.issues || [] });
    } finally {
      clearTimeout(timeout);
      if (attempt === generation.current) setBusyKey(null);
    }
  };
  const current = artifact?.key === key ? artifact : null;
  const download = () => {
    // Check synchronously as well as in the invalidation effect.
    if (!current || currentKey.current !== current.key) return;
    const anchor = document.createElement('a');
    anchor.href = current.url; anchor.download = current.filename;
    document.body.appendChild(anchor); anchor.click(); anchor.remove();
  };
  return { artifact: current, busy: busyKey === key, failure: failure?.key === key ? failure : null,
    stale: stale || !!artifact && !current, generate, download };
}
