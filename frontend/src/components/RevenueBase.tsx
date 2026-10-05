import React, { useEffect, useId, useState } from 'react';

export const REVENUE_ATTRIBUTION = 'Contributions are incremental in the displayed intervention order. The tariff contribution includes its interaction with collection improvement.';

export function restoreBlankRevenueBases(inputs: any, sectors = ['water', 'sanitation']) {
  const revenue_bases = { ...inputs.revenue_bases };
  let changed = false;
  for (const sector of sectors) {
    const base = revenue_bases[sector];
    if (base?.origin === 'user-entered' &&
      ['volume_mld', 'tariff', 'collection_ratio'].every(field => base[field] == null || base[field] === '')) {
      delete revenue_bases[sector];
      changed = true;
    }
  }
  // Discard only unfilled drafts, never custom values or other scenario inputs.
  // The normal resolver will rebuild these sectors from retained legacy inputs.
  return changed ? { ...inputs, revenue_bases } : inputs;
}

function readableError(error: string) {
  return error.replace(/\bvolume_mld\b/g, 'Billed volume')
    .replace(/\bcollection_ratio\b/g, 'Baseline collection ratio')
    .replace(/\breference_year\b/g, 'Volume reference year')
    .replace(/\bgrowth_rate\b/g, 'Annual volume growth');
}

function save(inputs: any, sector: string, base: any) {
  const next = { ...inputs, revenue_bases: { ...inputs.revenue_bases, [sector]: base } };
  // Materialize sanitation's legacy collection target once, independently of water thereafter.
  if (sector === 'sanitation' && next.sanitation_interventions?.ce_target_ratio == null &&
      next.water_interventions?.ce_target_ratio != null) {
    next.sanitation_interventions = { ...next.sanitation_interventions,
      ce_target_ratio: next.water_interventions.ce_target_ratio };
  }
  return next;
}

export function revenueBaseDraft(inputs: any, sector: string) {
  return inputs.revenue_bases?.[sector] ?? {
    version: 1, origin: 'user-entered', volume_mld: null, tariff: null, collection_ratio: null,
    reference_year: inputs.period?.baseline_year ?? null, growth_rate: null,
    legacy: { water_interventions: inputs.water_interventions, sanitation_interventions: inputs.sanitation_interventions },
  };
}

export function updateRevenueBaseField(inputs: any, sector: string, field: string, value: any) {
  return save(inputs, sector, { ...revenueBaseDraft(inputs, sector), [field]: value });
}

export function revenueBaseErrors(inputs: any, sector: string): Record<string, string> {
  const base = revenueBaseDraft(inputs, sector);
  const errors: Record<string, string> = {};
  for (const [field, label] of [
    ['volume_mld', 'Billed volume'], ['tariff', 'Baseline billed tariff'],
    ['collection_ratio', 'Baseline collection ratio'], ['reference_year', 'Volume reference year'],
  ]) {
    const value = base[field];
    if (value == null || value === '') errors[field] = `${label} is required.`;
    else if (!Number.isFinite(Number(value)) || Number(value) < 0) errors[field] = `${label} must be finite and nonnegative.`;
  }
  if (!errors.collection_ratio && Number(base.collection_ratio) > 1) {
    errors.collection_ratio = 'Baseline collection ratio must be between 0 and 1.';
  }
  if (!errors.reference_year) {
    const year = Number(base.reference_year);
    if (!Number.isInteger(year) || year < 1) errors.reference_year = 'Volume reference year must be a positive integer.';
    else if (base.growth_rate == null && (
      year < inputs.period?.model_start_year || year > inputs.period?.forecast_end_year)) {
      errors.reference_year = 'Volume reference year must be inside the model period when using population growth.';
    }
  }
  if (base.growth_rate != null && (
    !Number.isFinite(Number(base.growth_rate)) || Number(base.growth_rate) <= -1)) {
    errors.growth_rate = 'Annual volume growth must be finite and greater than -1 (−100%).';
  }
  return errors;
}

export function RevenueBaseEditor({ inputs, onChange, sector }: { inputs: any; onChange: (v: any) => void; sector: string }) {
  const id = useId();
  const base = revenueBaseDraft(inputs, sector);
  const errors = inputs.revenue_bases?.[sector] ? revenueBaseErrors(inputs, sector) : {};
  const set = (field: string, value: any) => onChange(updateRevenueBaseField(inputs, sector, field, value));
  return <fieldset data-revenue-sector={sector} style={{ gridColumn: '1 / -1', border: '1px solid #ccd5df', borderRadius: 6, padding: 12, minWidth: 0 }}>
    <legend>Shared billed-revenue base — {sector === 'water' ? 'Water supply' : 'Sanitation'}</legend>
    <p style={{ fontSize: 12 }}>These same values are used by collection and tariff reform. Billed volume excludes NRW already; it grows independently of new connections.</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      {[
        ['volume_mld', 'Billed volume (million litres/day)'],
        ['reference_year', 'Volume reference year'],
        ['tariff', `Baseline billed tariff (${inputs.country_config?.currency || 'LCU'}/m³, real)`],
        ['collection_ratio', 'Baseline collection ratio (0–1)'],
        ['growth_rate', 'Annual volume growth (fraction; blank = population)'],
      ].map(([field, label]) => <label key={field} htmlFor={`${id}-${field}`} style={{ display: 'grid', gap: 4, fontSize: 12, flex: '1 1 210px', minWidth: 0 }}>
        {label}<input id={`${id}-${field}`} data-revenue-field={field} type="number" step={field === 'reference_year' ? '1' : 'any'}
          min={field === 'growth_rate' ? '-0.9999' : field === 'reference_year' ? '1' : '0'} max={field === 'collection_ratio' ? 1 : undefined}
          required={field !== 'growth_rate'} aria-invalid={!!errors[field]}
          value={base[field] ?? ''} onChange={e => set(field, e.target.value === '' ? null : Number(e.target.value))}
          style={{ padding: 7, border: errors[field] ? '1px solid #c53030' : '1px solid #d9c884', background: '#fff9e6', borderRadius: 4, width: '100%', boxSizing: 'border-box' }} />
      </label>)}
    </div>
    <small>Origin: {base.origin}. Legacy values are retained with this base for traceability.</small>
  </fieldset>;
}

export function RevenueInputsSection({ inputs, onChange, sector, area }: {
  inputs: any; onChange: (v: any) => void; sector: 'water' | 'sanitation'; area: string;
}) {
  const errors = inputs.revenue_bases?.[sector] ? Object.values(revenueBaseErrors(inputs, sector)) : [];
  const restored = restoreBlankRevenueBases(inputs, [sector]);
  return <div style={{ gridColumn: '1 / -1', minWidth: 0 }} aria-label={`Revenue inputs — ${area} — ${sector}`}>
    <p style={{ fontSize: 12, marginTop: 0 }}>
      Enter the shared revenue inputs for <strong>{area} {sector === 'water' ? 'water supply' : 'sanitation'}</strong>.
      {' '}These values are also available in Intervention Design. Switching sector or area keeps each dataset separate.
    </p>
    <RevenueBaseEditor inputs={inputs} onChange={onChange} sector={sector} />
    {errors.length > 0 && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: '#9f1239' }}>
      <strong>Complete or correct this sector's revenue inputs:</strong>
      <ul style={{ margin: '6px 0', paddingLeft: 20 }}>{errors.map(error => <li key={error}>{error}</li>)}</ul>
    </div>}
    {restored !== inputs && <div style={{ marginTop: 10, fontSize: 12 }}>
      <button onClick={() => onChange(restored)}>Restore this blank base from existing inputs</button>
      <p>Only this entirely blank draft is removed. Other sector values and partially entered inputs are preserved.</p>
    </div>}
  </div>;
}

export default function RevenueReconciliation({ inputs, onChange, area, silent = false }: { inputs: any; onChange: (v: any) => void; area: string; silent?: boolean }) {
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
  }, [key, area]);
  // Results belong to the exact inputs checked, not a newly selected area or
  // edited profile. Automatic resolution has no visible loading panel.
  const current = status?.key === key ? status : null;
  return silent ? null : <RevenueInputErrors inputs={inputs} onChange={onChange} area={area}
    resolution={current?.resolution} error={current?.error || ''} />;
}

export function RevenueInputErrors({ inputs, onChange, area, resolution, error }: {
  inputs: any; onChange: (v: any) => void; area: string; resolution?: any; error: string;
}) {
  if (!inputs) return null;
  const pending = ['water', 'sanitation'].filter(s => !inputs.revenue_bases?.[s]);
  const needsCorrection = pending.filter(s => error || resolution?.[s]?.error);
  if (!error && !needsCorrection.length) return null;
  const restored = restoreBlankRevenueBases(inputs);
  return <section aria-label="Revenue input errors" style={{ margin: '8px 16px', padding: 12, background: '#fff8e6', border: '1px solid #dfc078', borderRadius: 6, fontSize: 12 }}>
    <details className="revenue-error-details" open>
    <summary className="revenue-error-toggle" title="Minimize or expand revenue error details">
      <h3 style={{ margin: 0, fontSize: 13 }}>Revenue inputs need attention — {area}</h3>
      <span className="revenue-error-minimize">Minimize</span>
      <span className="revenue-error-expand">Show details</span>
    </summary>
    <div className="revenue-error-content">
    <p>Revenue inputs could not be verified. Correct the values below to continue calculations and exports. Original values are retained.</p>
    {error && <p role="alert">{readableError(error)}</p>}
    {restored !== inputs && <div style={{ marginBottom: 12 }}>
      <p>The user-entered revenue bases are blank. Restore them from your existing revenue inputs, or complete the fields below.</p>
      <button onClick={() => onChange(restored)}>Restore blank bases from existing inputs</button>
      <p style={{ marginBottom: 0 }}>This replaces only entirely blank user-entered bases. Other scenario inputs and custom values are unchanged.</p>
    </div>}
    {needsCorrection.map(sector => <div key={sector} style={{ marginBottom: 12 }}>
      <h4>{sector === 'water' ? 'Water supply' : 'Sanitation'}</h4>
      {resolution?.[sector]?.error && <p role="alert">{readableError(resolution[sector].error)}</p>}
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
    </div>
    </details>
  </section>;
}