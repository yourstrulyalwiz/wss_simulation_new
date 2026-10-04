import React, { useEffect, useState } from 'react';

export const REVENUE_ATTRIBUTION = 'Contributions are incremental in the displayed intervention order. The tariff contribution includes its interaction with collection improvement.';

function save(inputs: any, sector: string, base: any) {
  const next = { ...inputs, revenue_bases: { ...inputs.revenue_bases, [sector]: base } };
  // Materialize sanitation's legacy collection target once, independently of water thereafter.
  if (sector === 'sanitation' && next.sanitation_interventions.ce_target_ratio == null) {
    next.sanitation_interventions = { ...next.sanitation_interventions,
      ce_target_ratio: next.water_interventions.ce_target_ratio };
  }
  return next;
}

export function RevenueBaseEditor({ inputs, onChange, sector }: { inputs: any; onChange: (v: any) => void; sector: string }) {
  const base = inputs.revenue_bases?.[sector];
  if (!base) return <p role="alert">Resolve the shared billed-revenue base above before calculating.</p>;
  const set = (field: string, value: any) => onChange(save(inputs, sector, { ...base, [field]: value }));
  return <fieldset style={{ gridColumn: '1 / -1', border: '1px solid #ccd5df', borderRadius: 6, padding: 12 }}>
    <legend>Shared billed-revenue base — {sector}</legend>
    <p style={{ fontSize: 12 }}>These same values are used by collection and tariff reform. Billed volume excludes NRW already; it grows independently of new connections.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {[
        ['volume_mld', 'Billed volume (million litres/day)'],
        ['reference_year', 'Volume reference year'],
        ['tariff', `Baseline billed tariff (${inputs.country_config?.currency || 'LCU'}/m³, real)`],
        ['collection_ratio', 'Baseline collection ratio (0–1)'],
        ['growth_rate', 'Annual volume growth (fraction; blank = population)'],
      ].map(([field, label]) => <label key={field} style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        {label}<input type="number" step={field === 'reference_year' ? '1' : 'any'}
          min={field === 'growth_rate' ? '-0.9999' : '0'} max={field === 'collection_ratio' ? 1 : undefined}
          value={base[field] ?? ''} onChange={e => set(field, e.target.value === '' ? null : Number(e.target.value))}
          style={{ padding: 7, border: '1px solid #d9c884', background: '#fff9e6', borderRadius: 4 }} />
      </label>)}
    </div>
    <small>Origin: {base.origin}. Legacy values are retained with this base for traceability.</small>
  </fieldset>;
}

export default function RevenueReconciliation({ inputs, onChange, area }: { inputs: any; onChange: (v: any) => void; area: string }) {
  const [status, setStatus] = useState<{ key: string; resolution: any; error: string } | null>(null);
  const key = JSON.stringify(inputs);
  useEffect(() => {
    if (!inputs) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch('/api/revenue-bases', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: key, signal: controller.signal });
        const data = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Invalid revenue inputs.');
        let next = inputs;
        for (const sector of ['water', 'sanitation']) {
          if (!inputs.revenue_bases?.[sector] && data[sector].base) next = save(next, sector, data[sector].base);
        }
        setStatus({ key, resolution: data, error: '' });
        if (next !== inputs) onChange(next);
      } catch (e: any) {
        if (!controller.signal.aborted) setStatus({ key, resolution: null, error: String(e.message) });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key]);
  // Results belong to the exact inputs checked, not a newly selected area or
  // edited profile. Automatic resolution has no visible loading panel.
  const current = status?.key === key ? status : null;
  return <RevenueInputErrors inputs={inputs} onChange={onChange} area={area}
    resolution={current?.resolution} error={current?.error || ''} />;
}

export function RevenueInputErrors({ inputs, onChange, area, resolution, error }: {
  inputs: any; onChange: (v: any) => void; area: string; resolution?: any; error: string;
}) {
  if (!inputs) return null;
  const pending = ['water', 'sanitation'].filter(s => !inputs.revenue_bases?.[s]);
  const needsCorrection = pending.filter(s => error || resolution?.[s]?.error);
  if (!error && !needsCorrection.length) return null;
  return <section aria-label="Revenue input errors" style={{ margin: '8px 16px', padding: 12, background: '#fff8e6', border: '1px solid #dfc078', borderRadius: 6, fontSize: 12 }}>
    <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>Revenue inputs need attention — {area}</h3>
    <p>Revenue inputs could not be verified. Correct the values below to continue calculations and exports. Original values are retained.</p>
    {error && <p role="alert">{error}</p>}
    {needsCorrection.map(sector => <div key={sector} style={{ marginBottom: 12 }}>
      <h4>{sector === 'water' ? 'Water supply' : 'Sanitation'}</h4>
      {resolution?.[sector]?.error && <p role="alert">{resolution[sector].error}</p>}
      {resolution?.[sector]?.alternatives?.map((alt: any, i: number) => {
        const b = alt.base;
        return <button key={i} onClick={() => onChange(save(inputs, sector, b))} style={{ padding: 10, margin: 4 }}>
          Use {b.origin}: {b.volume_mld.toLocaleString()} million litres/day in {b.reference_year},
          tariff {b.tariff} {inputs.country_config?.currency || 'LCU'}/m³,
          collection {(b.collection_ratio * 100).toFixed(1)}%;
          growth {b.growth_rate == null ? 'population' : `${b.growth_rate * 100}%/year`}
        </button>;
      })}
      <button onClick={() => onChange(save(inputs, sector, {
        version: 1, origin: 'user-entered', volume_mld: null, tariff: null, collection_ratio: null,
        reference_year: inputs.period.baseline_year, growth_rate: null,
        legacy: { water_interventions: inputs.water_interventions, sanitation_interventions: inputs.sanitation_interventions },
      }))}>Enter shared revenue inputs</button>
    </div>)}
    {error && ['water', 'sanitation'].filter(s => inputs.revenue_bases?.[s]).map(sector =>
      <RevenueBaseEditor key={sector} inputs={inputs} onChange={onChange} sector={sector} />)}
  </section>;
}