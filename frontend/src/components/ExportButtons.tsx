import React, { useState } from 'react';
import type { ContributionView } from '../contributionView';

// Download the current scenario (`inputs`) as Excel / PowerPoint / CSV (PowerPoint only where `pptx`
// is left on — the Results Dashboard). All three endpoints run the
// live engine on the posted inputs, so the export always matches what's on screen. When `pptxCharts` is
// supplied (the Results tab), the PowerPoint export first captures the on-screen charts and ships them so
// the deck is pre-populated with the actual charts (the backend can't render recharts itself).
const FORMATS = [
  { label: 'Excel', ext: 'xlsx', endpoint: '/api/export/xlsx', icon: '📗' },
  { label: 'PowerPoint', ext: 'pptx', endpoint: '/api/export/pptx', icon: '📊' },
  { label: 'CSV', ext: 'csv', endpoint: '/api/export/csv', icon: '📄' },
];

export default function ExportButtons({ inputs, label = 'Export', pptxCharts, areas, pptx = true, contributionView = 'individual' }: {
  inputs: any; label?: string | null; pptxCharts?: () => Promise<Record<string, string>>;
  // Every area the user actually entered, e.g. { urban, rural } or { national }. When supplied, the
  // PowerPoint export fills the branded template and covers all three scopes in one deck; the engine
  // is per-area, so National is summed server-side from whichever areas are present.
  areas?: Record<string, any>;
  // The deck reports the finished scenario, so it is offered on the Results Dashboard only.
  pptx?: boolean;
  contributionView?: ContributionView;
}) {
  const formats = pptx ? FORMATS : FORMATS.filter(f => f.ext !== 'pptx');
  const [busy, setBusy] = useState<string | null>(null);
  const download = async (fmt: typeof FORMATS[number]) => {
    setBusy(fmt.ext);
    try {
      let body: any = { ...(inputs || {}), _export_options: { contribution_view: contributionView } };
      let endpoint = fmt.endpoint;
      if (fmt.ext === 'pptx') {
        const entered = Object.entries(areas || {}).filter(([, v]) => v);
        if (entered.length) {
          endpoint = '/api/export/deck';
          body = { areas: Object.fromEntries(entered), contribution_view: contributionView };
        } else if (pptxCharts) {
          try { body = { ...body, _charts: await pptxCharts() }; } catch { /* chart-less deck */ }
        }
      }
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(String(r.status));
      const b = await r.blob();
      const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `wss_scenario_${contributionView === 'category' ? 'categories' : 'individual'}.${fmt.ext}`; a.click(); URL.revokeObjectURL(u);
    } catch { alert(`Export failed (${fmt.label}). Please try again.`); }
    finally { setBusy(null); }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      {label && <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>{label}:</span>}
      {formats.map(f => (
        <button key={f.ext} onClick={() => download(f)} disabled={busy !== null} title={`Download the current scenario as ${f.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 10px', fontSize: 11.5,
            border: '1px solid #cbd5e1', borderRadius: 6, background: busy === f.ext ? '#eef2ff' : '#fff',
            color: '#334155', cursor: busy ? 'wait' : 'pointer', fontWeight: 500 }}>
          <span>{f.icon}</span>{busy === f.ext ? 'Preparing…' : f.label}
        </button>
      ))}
    </div>
  );
}
