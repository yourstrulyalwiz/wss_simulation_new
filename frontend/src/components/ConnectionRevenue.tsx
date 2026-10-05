import React, { useEffect, useId, useMemo, useState } from 'react';

type Config = {
  version: 1;
  enabled: boolean;
  billed_share_sm: number | null;
  billed_share_basic: number | null;
  household_volume_share: number | null;
  marginal_cost: number | null;
  zero_cost_confirmed: boolean;
  alignment: 'estimate' | 'observation' | null;
  baseline_volume_mld: number | null;
  funding_reference: 'exogenous' | 'fixed' | 'series' | null;
  reference_confirmed: boolean;
  funding_includes_reforms: boolean;
  reference_series: Record<string, number | null>;
  nonhousehold_growth_rate: number | null;
  consumption_m3?: number | null;
  observed_billed_households?: number | null;
  lower_service_billing_acknowledged: boolean;
  provenance: Record<string, { source_type: 'observed' | 'assumed' | null; reference_year: number | null; note: string }>;
};

const EMPTY: Config = {
  version: 1, enabled: false, billed_share_sm: null, billed_share_basic: null,
  household_volume_share: null, marginal_cost: null, zero_cost_confirmed: false,
  alignment: null, baseline_volume_mld: null, funding_reference: null,
  reference_confirmed: false, funding_includes_reforms: false, reference_series: {},
  nonhousehold_growth_rate: null, lower_service_billing_acknowledged: false, provenance: {},
};

const fieldLabels: Record<string, string> = {
  billed_share_sm: 'Safely-managed billed share',
  billed_share_basic: 'Basic-service billed share',
  household_volume_share: 'Household share of billed volume',
  marginal_cost: 'Marginal variable operating cost',
  baseline_volume_mld: 'Baseline-aligned billed volume',
  nonhousehold_growth_rate: 'Non-household annual growth',
  consumption_m3: 'Consumption per billed household',
  observed_billed_households: 'Observed billed households',
  reference_series: 'Funding reference series',
};

function parseOptionalNumber(value: string) {
  return value.trim() === '' ? null : Number(value);
}

export function revenueBasesRequestBody(inputs: any) {
  return JSON.stringify(inputs);
}

function errorsFor(config: Config, inputs: any, sector: string) {
  const errors: string[] = [];
  const baseline = Number(inputs?.period?.baseline_year);
  const canonicalYear = inputs?.revenue_bases?.[sector]?.reference_year;
  const needsObservedVolume = config.alignment === 'observation';
  const anchorNeedsEstimate = canonicalYear != null && Number(canonicalYear) !== baseline;
  (['billed_share_sm', 'billed_share_basic', 'household_volume_share'] as const).forEach(key => {
    const value = config[key];
    if (value == null) errors.push(`${fieldLabels[key]} is required.`);
    else if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`${fieldLabels[key]} must be between 0 and 1.`);
  });
  if (config.marginal_cost == null) errors.push('Enter a marginal variable operating cost; confirm zero explicitly if using the gross-revenue simplification.');
  else if (!Number.isFinite(config.marginal_cost) || config.marginal_cost < 0) errors.push('Marginal variable operating cost must be finite and nonnegative.');
  if (config.marginal_cost === 0 && !config.zero_cost_confirmed) errors.push('Explicitly confirm the zero-cost assumption.');
  if (!config.alignment) errors.push('Choose how canonical billed volume aligns to the model baseline.');
  if (needsObservedVolume && (config.baseline_volume_mld == null || !Number.isFinite(config.baseline_volume_mld) || config.baseline_volume_mld < 0)) {
    errors.push('A baseline-year observed billed volume is required.');
  }
  if (config.baseline_volume_mld != null && (!Number.isFinite(config.baseline_volume_mld) || config.baseline_volume_mld < 0)) {
    errors.push('Baseline-aligned billed volume must be finite and nonnegative.');
  }
  if (anchorNeedsEstimate && config.alignment !== 'estimate' && config.alignment !== 'observation') {
    errors.push('The canonical anchor differs from baseline; explicitly authorize a baseline-year estimate or provide an observation.');
  }
  if (!config.funding_reference) errors.push('Choose what revenue volume is already represented in funding.');
  if (!config.reference_confirmed) errors.push('Confirm the funding-reference assumption.');
  if (config.funding_includes_reforms) errors.push('Funding already includes future tariff or collection reforms; reconcile this assumption before enabling dynamic comparison.');
  if (config.funding_reference === 'series') {
    const years = Object.keys(config.reference_series);
    if (!years.length || years.some(y => !Number.isInteger(Number(y)) || config.reference_series[y] == null || !Number.isFinite(config.reference_series[y]) || Number(config.reference_series[y]) < 0)) {
      errors.push('Provide a complete, nonnegative year:value funding reference series.');
    }
    const firstYear = Number(inputs?.period?.baseline_year) + 1;
    const lastYear = Number(inputs?.period?.forecast_end_year);
    if (Number.isInteger(firstYear) && Number.isInteger(lastYear) && lastYear >= firstYear) {
      const missing = Array.from({ length: lastYear - firstYear + 1 }, (_, i) => String(firstYear + i))
        .filter(year => !Object.prototype.hasOwnProperty.call(config.reference_series, year));
      if (missing.length) errors.push(`Funding reference series is missing model years: ${missing.join(', ')}.`);
    }
  }
  const provenanceKeys = ['billed_share_sm', 'billed_share_basic', 'household_volume_share', 'marginal_cost'];
  if (config.alignment === 'observation') provenanceKeys.push('baseline_volume_mld');
  if (config.nonhousehold_growth_rate != null) provenanceKeys.push('nonhousehold_growth_rate');
  if (config.consumption_m3 != null) provenanceKeys.push('consumption_m3');
  if (config.observed_billed_households != null) provenanceKeys.push('observed_billed_households');
  if (config.funding_reference === 'series') provenanceKeys.push('reference_series');
  provenanceKeys.forEach(key => {
    const p = config.provenance?.[key];
    if (!p?.source_type || !p.note?.trim()) errors.push(`Add observed/assumed provenance and a source note for ${fieldLabels[key]}.`);
    if (p?.reference_year != null && (!Number.isInteger(Number(p.reference_year)) || Number(p.reference_year) < 1)) {
      errors.push(`Reference year for ${fieldLabels[key]} must be a positive integer.`);
    }
  });
  if (config.nonhousehold_growth_rate != null && (!Number.isFinite(config.nonhousehold_growth_rate) || config.nonhousehold_growth_rate <= -1)) {
    errors.push('Non-household growth must be finite and greater than −100%.');
  }
  if (config.consumption_m3 != null && (!Number.isFinite(config.consumption_m3) || config.consumption_m3 < 0)) {
    errors.push('Consumption assumption must be finite and nonnegative.');
  }
  if (config.observed_billed_households != null && (!Number.isFinite(config.observed_billed_households) || config.observed_billed_households < 0)) {
    errors.push('Observed billed households must be finite and nonnegative.');
  }
  return errors;
}

function ProvenanceEditor({ config, field, year, onChange }: {
  config: Config; field: string; year: number | null; onChange: (next: Config) => void;
}) {
  const value = config.provenance?.[field] || { source_type: null, reference_year: year, note: '' };
  const update = (patch: Partial<typeof value>) => onChange({
    ...config,
    provenance: { ...config.provenance, [field]: { ...value, ...patch } },
  });
  return <div style={{ display: 'grid', gridTemplateColumns: '120px minmax(105px, 140px) minmax(140px, 1fr)', gap: 6, marginTop: 5 }}>
    <select aria-label={`${fieldLabels[field]} source type`} value={value.source_type || ''}
      onChange={e => update({ source_type: (e.target.value || null) as 'observed' | 'assumed' | null })}>
      <option value="">Choose source…</option>
      <option value="assumed">Assumed</option><option value="observed">Observed</option>
    </select>
    <input aria-label={`${fieldLabels[field]} reference year`} type="number" min="1" placeholder="Reference year"
      value={value.reference_year ?? ''} onChange={e => update({ reference_year: parseOptionalNumber(e.target.value) })} />
    <input aria-label={`${fieldLabels[field]} source note`} placeholder="Source / short note (required)"
      value={value.note} onChange={e => update({ note: e.target.value })} />
  </div>;
}

export default function ConnectionRevenue({ inputs, onChange, sector, area }: {
  inputs: any; onChange: (value: any) => void; sector: 'water' | 'sanitation'; area: string;
}) {
  const id = useId();
  const [validation, setValidation] = useState<{ key: string; errors: string[]; remote: string; remoteStatus: any } | null>(null);
  const stored = inputs.connection_revenue?.[sector] as Config | undefined;
  const config = useMemo(() => ({ ...EMPTY, ...(stored || {}), version: 1 as const,
    reference_series: { ...(stored?.reference_series || {}) }, provenance: { ...(stored?.provenance || {}) } }), [stored]);
  const errors = config.enabled ? errorsFor(config, inputs, sector) : [];
  const key = JSON.stringify({ inputs, sector });
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let remote = '';
      let remoteStatus = null;
      try {
        const response = await fetch('/api/revenue-bases', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: revenueBasesRequestBody(inputs), signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        remoteStatus = payload?.[sector]?.connection || payload?.connection_revenue?.[sector] || null;
        if (!response.ok) remote = typeof payload.detail === 'string' ? payload.detail : 'Server validation is not available yet; local checks remain active.';
      } catch (e: any) {
        if (!controller.signal.aborted) remote = e?.name === 'AbortError' ? '' : 'Server validation is not available yet; local checks remain active.';
      }
      if (!controller.signal.aborted) setValidation({ key, errors, remote, remoteStatus });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key]);
  const current = validation?.key === key ? validation : null;
  const update = (next: Config) => onChange({
    ...inputs, connection_revenue: { ...(inputs.connection_revenue || {}), [sector]: { ...next, version: 1 } },
  });
  const setField = (field: keyof Config, value: any) => update({ ...config, [field]: value });
  const field = (name: keyof Config, label: string, unit?: string, step = 'any') => (
    <label key={name} htmlFor={`${id}-${name}`} style={{ display: 'grid', gap: 4, fontSize: 11, minWidth: 155, flex: '1 1 190px' }}>
      {label}{unit && <span style={{ color: '#64748b' }}>{unit}</span>}
      <input id={`${id}-${name}`} type="number" step={step} min={name === 'nonhousehold_growth_rate' ? '-0.9999' : '0'} max={String(name).includes('share') ? 1 : undefined}
        value={(config[name] as number | null | undefined) ?? ''}
        onChange={e => setField(name, parseOptionalNumber(e.target.value))}
        style={{ padding: '6px 8px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }} />
    </label>
  );
  const provenanceField = (name: string) => <div key={name} style={{ marginTop: 7, fontSize: 10.5 }}>
    <strong>{fieldLabels[name]} provenance</strong>
    <ProvenanceEditor config={config} field={name} year={Number(inputs.period?.baseline_year) || null} onChange={update} />
  </div>;
  const base = inputs.revenue_bases?.[sector] || {};
  const calibration = current?.remoteStatus?.calibration;
  const baselineBilled = calibration?.baseline_billed_households;
  const baselineVolumeMillion = calibration?.baseline_volume_million_m3 ?? calibration?.baseline_household_volume_million_m3;
  const calibratedBaselineMld = calibration?.baseline_volume_mld ?? calibration?.baseline_billed_volume_mld;
  const originalBaselineEstimate = calibration?.original_baseline_estimate_million_m3;
  const originalVolumeMld = calibration?.original_volume_mld;
  const originalReferenceYear = calibration?.original_reference_year;
  const consumption = calibration?.consumption_m3;
  const effectiveValue = String(current?.remoteStatus?.effective ?? '').toLowerCase().replace(/[_ ]/g, '-');
  const applicable = current?.remoteStatus?.effective === true || effectiveValue.includes('connection') || effectiveValue === 'dynamic';
  const effectiveLabel = current?.remoteStatus?.effective === false || effectiveValue.includes('exogenous')
    ? 'exogenous' : applicable ? 'connection-based' : config.enabled ? 'not yet confirmed; exogenous retained' : 'exogenous';
  const requested = current?.remoteStatus?.requested ?? config.enabled;
  const years = Object.keys(config.reference_series).sort((a, b) => Number(a) - Number(b));
  return <section aria-label={`Connection-based revenue — ${area} — ${sector}`} style={{ gridColumn: '1 / -1', border: '1px solid #b8c9d7', borderRadius: 6, padding: 12, background: '#f8fbfc', marginTop: 9 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 10, flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#164e63' }}>Connection-based revenue</h3>
        <p style={{ margin: 0, fontSize: 11, color: '#475569', maxWidth: 760 }}>Optional baseline model, separate from interventions. Household billing follows previously delivered safely-managed/basic households; incremental net cash is not a direct service credit.</p>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: '#164e63' }}>
        <input type="checkbox" checked={config.enabled} onChange={e => setField('enabled', e.target.checked)} />
        Request connection-based mode
      </label>
    </div>
    <div role="status" style={{ margin: '9px 0', padding: '7px 9px', background: applicable ? '#ecfdf5' : '#f1f5f9', border: `1px solid ${applicable ? '#a7f3d0' : '#cbd5e1'}`, borderRadius: 4, fontSize: 11 }}>
      Requested: <b>{requested ? 'connection-based' : 'exogenous'}</b> · Effective: <b>{effectiveLabel}</b>
      {!applicable && config.enabled && <span> — dynamic mode is not shown as effective until the backend confirms it.</span>}
      {baselineBilled != null && <span> · Baseline billed households: <b>{Number(baselineBilled).toLocaleString()}</b></span>}
      {consumption != null && <span> · Calibrated consumption: <b>{Number(consumption).toLocaleString()} m³ / billed household / year</b></span>}
      {baselineVolumeMillion != null && <span> · Baseline-aligned billed volume used for calibration: <b>{Number(baselineVolumeMillion).toLocaleString()} million m³/year</b></span>}
      {calibratedBaselineMld != null && <span> · Backend baseline estimate: <b>{Number(calibratedBaselineMld).toLocaleString()} million litres/day</b></span>}
      {originalBaselineEstimate != null && <span> · Original-anchor baseline estimate: <b>{Number(originalBaselineEstimate).toLocaleString()} million m³/year</b></span>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
      {field('billed_share_sm', 'Safely-managed billed share', 'fraction (0–1)')}
      {field('billed_share_basic', 'Basic-service billed share', 'fraction (0–1)')}
      {field('household_volume_share', 'Household share of billed volume', 'fraction (0–1)')}
      {field('marginal_cost', `Marginal variable cost (${inputs.country_config?.currency || 'LCU'}/m³, real)`, 'Utility-sourced or documented assumption')}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 9, marginTop: 9 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>Volume alignment
        <select value={config.alignment || ''} onChange={e => setField('alignment', e.target.value || null)}
          style={{ padding: 7, border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }}>
          <option value="">Choose alignment…</option><option value="observation">Baseline-year observation</option><option value="estimate">Authorize estimate from the canonical volume path</option>
        </select>
      </label>
      {config.alignment === 'observation' && <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>Observed baseline-year billed volume (million litres/day)
        <input type="number" min="0" step="any" value={config.baseline_volume_mld ?? ''}
          onChange={e => setField('baseline_volume_mld', parseOptionalNumber(e.target.value))}
          placeholder="Required baseline-year observation"
          style={{ padding: 7, border: '1px solid #cbd5e1', borderRadius: 4 }} />
      </label>}
      <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>Non-household annual growth (blank = canonical growth)
        <input type="number" step="any" min="-0.9999" value={config.nonhousehold_growth_rate ?? ''}
          onChange={e => setField('nonhousehold_growth_rate', parseOptionalNumber(e.target.value))}
          style={{ padding: 7, border: '1px solid #cbd5e1', borderRadius: 4 }} />
      </label>
      {field('consumption_m3', 'Optional consumption calibration (m³ / household / year)')}
      {field('observed_billed_households', 'Optional observed billed households')}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 9, marginTop: 9 }}>
      <label style={{ display: 'grid', gap: 4, fontSize: 11 }}>Funding reference
        <select value={config.funding_reference || ''} onChange={e => setField('funding_reference', e.target.value || null)}
          style={{ padding: 7, border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff' }}>
          <option value="">Choose funding reference…</option><option value="exogenous">Existing exogenous path</option><option value="fixed">Fixed baseline volume</option><option value="series">Complete supplied reference series</option>
        </select>
      </label>
      {config.funding_reference === 'series' && <div style={{ gridColumn: 'span 2', fontSize: 11 }}>
        <strong>Reference series (raw m³/year)</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
          {years.map(year => <div key={year} style={{ display: 'flex', gap: 3 }}>
            <span style={{ alignSelf: 'center' }}>{year}</span><input aria-label={`Reference billed volume ${year}`} type="number" min="0" step="any"
              value={config.reference_series[year] ?? ''} onChange={e => update({ ...config, reference_series: { ...config.reference_series, [year]: parseOptionalNumber(e.target.value) } })}
              style={{ width: 115, padding: 5 }} />
            <button type="button" aria-label={`Remove reference year ${year}`} onClick={() => {
              const next = { ...config.reference_series }; delete next[year]; update({ ...config, reference_series: next });
            }}>Remove</button>
          </div>)}
          <button type="button" disabled={!Number.isInteger(Number(inputs.period?.baseline_year))} onClick={() => {
            const candidate = String((Number(years[years.length - 1]) || Number(inputs.period?.baseline_year)) + 1);
            if (config.reference_series[candidate] == null) update({ ...config, reference_series: { ...config.reference_series, [candidate]: null } });
          }}>Add year</button>
        </div>
      </div>}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 9, fontSize: 11 }}>
      <label><input type="checkbox" checked={config.zero_cost_confirmed} onChange={e => setField('zero_cost_confirmed', e.target.checked)} /> I explicitly confirm zero cost as a gross-revenue simplification</label>
      <label><input type="checkbox" checked={config.reference_confirmed} onChange={e => setField('reference_confirmed', e.target.checked)} /> I confirm this funding reference is what baseline financing already includes</label>
      <label><input type="checkbox" checked={config.funding_includes_reforms} onChange={e => setField('funding_includes_reforms', e.target.checked)} /> Baseline funding already includes future tariff / collection reforms</label>
      <label><input type="checkbox" checked={config.lower_service_billing_acknowledged} onChange={e => setField('lower_service_billing_acknowledged', e.target.checked)} /> I acknowledge limited / lower-service billing is excluded</label>
    </div>
    <div style={{ marginTop: 9, paddingTop: 8, borderTop: '1px solid #dbe5ea' }}>
      <div style={{ fontSize: 10.5, color: '#475569' }}>For every empirical value, record whether it is observed or assumed, its reference year where applicable, and a short source note.</div>
      {['billed_share_sm', 'billed_share_basic', 'household_volume_share', 'marginal_cost',
        ...(config.baseline_volume_mld != null || config.alignment === 'observation' ? ['baseline_volume_mld'] : []),
        ...(config.nonhousehold_growth_rate != null ? ['nonhousehold_growth_rate'] : []),
        ...(config.consumption_m3 != null ? ['consumption_m3'] : []),
        ...(config.observed_billed_households != null ? ['observed_billed_households'] : []),
        ...(config.funding_reference === 'series' ? ['reference_series'] : []),
      ].map(provenanceField)}
    </div>
    {errors.length > 0 && <div role="alert" style={{ marginTop: 9, color: '#9f1239', fontSize: 11, background: '#fff1f2', border: '1px solid #fecdd3', padding: '7px 9px', borderRadius: 4 }}>
      <strong>Dynamic mode is not effective. Exogenous revenue is retained.</strong>
      <ul style={{ margin: '5px 0 0', paddingLeft: 20 }}>{errors.map(error => <li key={error}>{error}</li>)}</ul>
    </div>}
    {!!current?.remoteStatus?.errors?.length && <div role="alert" style={{ marginTop: 7, color: '#9f1239', fontSize: 11 }}>
      Server validation: {current?.remoteStatus?.errors?.join(' · ')}
    </div>}
    {current?.remote && <div role="status" style={{ marginTop: 6, color: '#64748b', fontSize: 10.5 }}>{current.remote}</div>}
    <div style={{ marginTop: 7, fontSize: 10, color: '#64748b' }}>
      Canonical revenue base anchor: {base.reference_year ?? 'not set'} · baseline year: {inputs.period?.baseline_year ?? 'not set'}.
      {originalReferenceYear != null && <> Backend source anchor: {originalReferenceYear}, {originalVolumeMld} million litres/day.</>}
      {config.alignment === 'estimate' && Number(base.reference_year) !== Number(inputs.period?.baseline_year) && <> The selected estimate authorizes conversion along the canonical volume path; the backend calibration above reports its baseline-year estimate.</>}
      {' '}Consumption is calibrated against baseline households only; no future simulated households are used.
    </div>
  </section>;
}

export { errorsFor as connectionRevenueErrors, EMPTY as EMPTY_CONNECTION_REVENUE };
