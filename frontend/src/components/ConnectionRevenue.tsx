import React, { useEffect, useId, useMemo, useState } from 'react';
import {
  annualCostPerHousehold,
  migrateConnectionRevenueConfig,
  operatingExpenditureSource,
  snapshotOperatingExpenditureProxy,
  validateConnectionRevenueConfig,
  type ConnectionRevenueConfig,
} from '../connectionRevenueConfig';

export function revenueBasesRequestBody(inputs: any) {
  return JSON.stringify(inputs);
}

const labels: Record<string, string> = {
  billed_share_sm: 'Baseline Safely Managed billed share',
  billed_share_basic: 'Baseline Basic billed share',
  new_billed_share_sm: 'New Safely Managed billed share',
  new_billed_share_basic: 'New Basic billed share',
  household_volume_share: 'Household share of billed volume',
  marginal_cost: 'Manual marginal cost per m³',
  annual_cost_per_household: 'Annual cost per billed household',
  baseline_volume_mld: 'Baseline-year observed billed volume',
  nonhousehold_growth_rate: 'Non-household annual growth',
  consumption_m3: 'Consumption per billed household',
  observed_billed_households: 'Observed billed households',
  cost_proxy: 'Operating expenditure proxy',
};

const styles: Record<string, React.CSSProperties> = {
  input: { boxSizing: 'border-box', width: '100%', padding: '7px 9px', border: '1px solid #b8c9d7', borderRadius: 4, background: '#fff', color: '#20323d' },
  label: { display: 'grid', gap: 4, fontSize: 11.5, color: '#263d49', minWidth: 0 },
  select: { padding: '7px 9px', border: '1px solid #b8c9d7', borderRadius: 4, background: '#fff', color: '#20323d' },
  note: { fontSize: 10.5, color: '#526a75', lineHeight: 1.45 },
};

const optionalNumber = (value: string) => value.trim() === '' ? null : Number(value);
const fmt = (value: any, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });

function ProvenanceEditor({ config, field, year, onChange }: {
  config: ConnectionRevenueConfig; field: string; year: number | null; onChange: (next: ConnectionRevenueConfig) => void;
}) {
  const value = config.provenance?.[field] || { source_type: null, reference_year: year, note: '' };
  const patch = (updates: Partial<typeof value>) => onChange({
    ...config, provenance: { ...config.provenance, [field]: { ...value, ...updates } },
  });
  const useSharedNote = () => {
    const provenance = { ...config.provenance };
    delete provenance[field];
    onChange({ ...config, provenance });
  };
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .7fr) minmax(110px, .6fr) minmax(170px, 1.5fr) auto', gap: 6, marginTop: 5 }}>
    <select aria-label={`${labels[field] || field} source type`} value={value.source_type || ''}
      onChange={e => {
        if (!e.target.value) useSharedNote();
        else patch({ source_type: e.target.value as 'observed' | 'assumed' });
      }} style={styles.select}>
      <option value="">Choose source…</option><option value="assumed">Assumed</option><option value="observed">Observed</option>
    </select>
    <input aria-label={`${labels[field] || field} reference year`} type="number" min="1" placeholder="Reference year"
      value={value.reference_year ?? ''} onChange={e => patch({ reference_year: optionalNumber(e.target.value) })} style={styles.input} />
    <input aria-label={`${labels[field] || field} source note`} placeholder="Field-specific source note"
      value={value.note} onChange={e => patch({ note: e.target.value })} style={styles.input} />
    <button type="button" aria-label={`Use shared note for ${labels[field] || field}`} onClick={useSharedNote}>Use shared note</button>
  </div>;
}

export default function ConnectionRevenue({ inputs, onChange, sector, area }: {
  inputs: any; onChange: (value: any) => void; sector: 'water' | 'sanitation'; area: string;
}) {
  const id = useId();
  const [validation, setValidation] = useState<{ key: string; errors: string[]; remote: string; remoteStatus: any } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const stored = inputs.connection_revenue?.[sector];
  const config = useMemo(() => migrateConnectionRevenueConfig(stored), [stored]);
  const base = inputs.revenue_bases?.[sector] || {};
  const currency = inputs.country_config?.currency || 'LCU';
  const expenditureSource = operatingExpenditureSource(inputs, sector);
  const key = JSON.stringify(inputs);
  const calibrationForInputs = validation?.key === key ? validation.remoteStatus?.calibration : null;
  const referenceYear = Number(base.reference_year ?? inputs.period?.baseline_year) || null;
  const estimateExpenditure = expenditureSource.expenditure;
  const proxyCurrentValue = config.cost_proxy?.expenditure;
  const proxySourceChanged = config.cost_basis === 'expenditure_proxy' &&
    (proxyCurrentValue !== estimateExpenditure || config.cost_proxy?.baseline_year !== expenditureSource.baseline_year ||
      config.cost_proxy?.currency !== expenditureSource.currency || config.cost_proxy?.currency_basis !== expenditureSource.currency_basis ||
      config.cost_proxy?.sector !== expenditureSource.sector || config.cost_proxy?.area !== expenditureSource.area);
  const effectiveCost = config.cost_basis === 'annual_household'
    ? config.annual_cost_per_household
    : config.cost_basis === 'expenditure_proxy'
      ? config.cost_proxy?.allocation_confirmed && config.cost_proxy.household_allocation != null && Number(config.observed_billed_households || calibrationForInputs?.baseline_billed_households) > 0
        ? Number(config.cost_proxy.expenditure) * Number(config.cost_proxy.household_allocation) /
        Number(config.observed_billed_households || calibrationForInputs?.baseline_billed_households)
        : null
      : annualCostPerHousehold(
        calibrationForInputs?.consumption_m3 == null ? null : Number(calibrationForInputs.consumption_m3),
        config.marginal_cost == null ? null : Number(config.marginal_cost));
  const errors = config.enabled ? validateConnectionRevenueConfig(config, { ...inputs, area }, sector) : [];
  const extraErrors: string[] = config.enabled && config.cost_basis === 'expenditure_proxy'
    ? [
      !config.cost_proxy ? 'Use the deliberate estimate action to snapshot the selected operating expenditure.' : '',
      proxySourceChanged ? 'The source expenditure or scope changed after this estimate. Review and refresh the proxy snapshot.' : '',
      config.cost_proxy && Number(config.cost_proxy.expenditure) <= 0 ? 'Proxy expenditure must be positive; zero placeholders are not valid costs.' : '',
      config.cost_proxy && !(Number(config.observed_billed_households || calibrationForInputs?.baseline_billed_households) > 0)
        ? 'The expenditure proxy requires a positive calibrated baseline billed-household count.' : '',
      !Number.isFinite(Number(expenditureSource.expenditure)) || Number(expenditureSource.expenditure) <= 0
        ? 'A positive existing annual operating-expenditure source is required.' : '',
      !expenditureSource.area || !expenditureSource.currency ? 'The operating-expenditure source must have an explicit area and currency scope.' : '',
      Number(expenditureSource.baseline_year) !== Number(inputs.period?.baseline_year)
        ? 'The operating-expenditure source year must match the model baseline year.' : '',
      expenditureSource.currency_basis !== 'real_raw' ? 'Only real raw-currency operating expenditure can be used for this proxy.' : '',
    ].filter(Boolean) : [];
  const calibratedConsumption = calibrationForInputs?.consumption_m3 == null
    ? config.consumption_m3 : Number(calibrationForInputs.consumption_m3);
  if (config.enabled && config.cost_basis !== 'per_m3' && calibratedConsumption === 0 &&
      Number(config.cost_basis === 'annual_household' ? config.annual_cost_per_household : effectiveCost) > 0) {
    extraErrors.push('A positive annual household cost with zero calibrated consumption is unsupported; supply a compatible calibration.');
  }
  const allErrors = [...errors, ...extraErrors];
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      let remote = '';
      let remoteStatus = null;
      try {
        const response = await fetch('/api/revenue-bases', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: revenueBasesRequestBody(inputs), signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (controller.signal.aborted) return;
        remoteStatus = payload?.[sector]?.connection || payload?.connection_revenue?.[sector] || null;
        if (!response.ok) remote = typeof payload.detail === 'string' ? payload.detail : 'Server validation is unavailable; local checks remain active.';
      } catch (error: any) {
        if (!controller.signal.aborted) remote = error?.name === 'AbortError' ? '' : 'Server validation is unavailable; local checks remain active.';
      }
      if (!controller.signal.aborted) setValidation({ key, errors: allErrors, remote, remoteStatus });
    }, 350);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [key]);
  const current = validation?.key === key ? validation : null;
  const update = (next: ConnectionRevenueConfig) => onChange({
    ...inputs,
    connection_revenue: { ...(inputs.connection_revenue || {}), [sector]: { ...next, version: 3 } },
  });
  const setField = (field: keyof ConnectionRevenueConfig, value: any) => {
    const next = { ...config, [field]: value };
    if ((field === 'new_billed_share_basic' || field === 'new_billed_share_sm') && value !== config[field]) {
      const provenance = { ...config.provenance };
      delete provenance[field];
      next.provenance = provenance;
    }
    update(next);
  };
  const baselineYear = Number(inputs.period?.baseline_year) || null;
  const anchorMismatch = referenceYear != null && baselineYear != null && referenceYear !== baselineYear;
  const calibration = current?.remoteStatus?.calibration;
  const remoteErrors: string[] = current?.remoteStatus?.errors || [];
  const missingCalibration = [
    config.billed_share_sm == null && 'Baseline Safely Managed billed share',
    config.billed_share_basic == null && 'Baseline Basic billed share',
    config.household_volume_share == null && 'Household share of billed volume',
    config.cost_basis === 'per_m3' && config.marginal_cost == null && 'Marginal cost per m³',
    config.cost_basis === 'annual_household' && config.annual_cost_per_household == null && 'Annual household cost',
    config.cost_basis === 'expenditure_proxy' && !config.cost_proxy && 'Operating expenditure estimate',
    config.alignment === 'observation' && config.baseline_volume_mld == null && 'Baseline-year billed-volume observation',
    referenceYear != null && baselineYear != null && referenceYear !== baselineYear && !config.alignment && 'Baseline volume alignment approval',
    config.new_billed_share_basic == null && 'New Basic connections billed',
    config.new_billed_share_sm == null && 'New Safely Managed connections billed',
    !config.funding_reference && 'Funding reference',
    ['billed_share_sm', 'billed_share_basic', 'new_billed_share_basic', 'new_billed_share_sm', 'household_volume_share']
      .some(key => {
        const p = config.provenance?.[key];
        const hasDraft = !!p && (!!p.source_type || !!p.note?.trim() || p.reference_year != null);
        return hasDraft ? !p?.source_type || !p.note?.trim() : !config.shared_assumption_note.trim();
      }) && 'Source / assumption provenance',
  ].filter(Boolean);
  useEffect(() => {
    if (missingCalibration.length) setAdvancedOpen(true);
  }, [missingCalibration.join('|')]);
  const effectiveValue = String(validation?.key === key ? validation.remoteStatus?.effective ?? '' : '')
    .toLowerCase().replace(/[_ ]/g, '-');
  const backendApplicable = validation?.key === key &&
    (validation.remoteStatus?.effective === true || effectiveValue.includes('connection') || effectiveValue === 'dynamic');
  const backendExogenous = validation?.key === key &&
    (validation.remoteStatus?.effective === false || effectiveValue.includes('exogenous'));
  const effectiveText = !config.enabled ? 'Off' : backendApplicable ? 'Active'
    : allErrors.length || remoteErrors.length ? 'Incomplete' : 'Pending backend confirmation';
  const effectiveLabel = backendApplicable ? 'connection-based' : backendExogenous ? 'exogenous'
    : config.enabled ? 'incomplete; exogenous retained' : 'exogenous';
  const annualCostFromM3 = calibration?.consumption_m3 != null && config.marginal_cost != null
    ? annualCostPerHousehold(Number(calibration.consumption_m3), Number(config.marginal_cost)) : null;
  const selectedCostIsZero = config.cost_basis === 'per_m3'
    ? config.marginal_cost === 0 : effectiveCost === 0;
  const baselineBilled = calibration?.baseline_billed_households;
  const consumption = calibration?.consumption_m3;
  const displayedCost = config.cost_basis === 'annual_household' ? config.annual_cost_per_household
    : config.cost_basis === 'expenditure_proxy' ? effectiveCost : annualCostFromM3;
  const costSource = config.cost_basis === 'per_m3' ? 'Converted from marginal cost per m³'
    : config.cost_basis === 'annual_household' ? 'Manual annual household cost'
      : 'Average operating cost used as a proxy';
  const provenanceFields = [
    'billed_share_sm', 'billed_share_basic', 'new_billed_share_basic', 'new_billed_share_sm', 'household_volume_share',
    ...(config.cost_basis === 'per_m3' ? ['marginal_cost'] : config.cost_basis === 'annual_household' ? ['annual_cost_per_household'] : ['cost_proxy']),
    ...(config.alignment === 'observation' ? ['baseline_volume_mld'] : []),
    ...(config.nonhousehold_growth_rate != null ? ['nonhousehold_growth_rate'] : []),
    ...(config.consumption_m3 != null ? ['consumption_m3'] : []),
    ...(config.observed_billed_households != null ? ['observed_billed_households'] : []),
    ...(config.funding_reference === 'series' ? ['reference_series'] : []),
  ];
  const field = (name: keyof ConnectionRevenueConfig, label: string, unit?: string) => <label key={name} htmlFor={`${id}-${name}`} style={styles.label}>
    {label}{unit && <span style={styles.note}>{unit}</span>}
    <input id={`${id}-${name}`} type="number" step="any" min={name === 'nonhousehold_growth_rate' ? '-0.9999' : '0'}
      value={(config[name] as number | null | undefined) ?? ''}
      onChange={e => setField(name, optionalNumber(e.target.value))} style={styles.input} />
  </label>;
  const useProxyEstimate = () => {
    // The estimate button snapshots cost data only; allocation must still be
    // deliberately entered or accepted in the allocation control below.
    const allocation = config.cost_proxy?.household_allocation ?? null;
    const costProxy = snapshotOperatingExpenditureProxy(inputs, sector, allocation);
    if (!costProxy) return;
    update({
      ...config,
      cost_basis: 'expenditure_proxy',
      cost_proxy: costProxy,
    });
  };
  const setProxyAllocation = (value: number | null) => {
    if (!config.cost_proxy) return;
    update({ ...config, cost_proxy: { ...config.cost_proxy, household_allocation: value, allocation_confirmed: value != null } });
  };
  const sharedAnchorAutoAlign = referenceYear != null && baselineYear != null && referenceYear === baselineYear && !config.alignment;
  useEffect(() => {
    if (sharedAnchorAutoAlign) update({ ...config, alignment: 'estimate' });
  // Deliberately only auto-align once when the shared anchor matches baseline.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedAnchorAutoAlign]);
  return <section aria-label={`Connection-based revenue — ${area} — ${sector}`}
    style={{ gridColumn: '1 / -1', border: '1px solid #b8c9d7', borderRadius: 6, padding: 12, background: '#f8fbfc', marginTop: 9, color: '#243b47' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ margin: '0 0 4px', fontSize: 14, color: '#164e63' }}>Connection-based revenue</h3>
        <p style={{ margin: 0, maxWidth: 760, fontSize: 11, color: '#475d68' }}>Optional baseline model. Billable households are separate from collection efficiency; unpaid bills still incur modeled operating costs. Revenue and costs start the year after delivery.</p>
      </div>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 700, color: '#164e63' }}>
        <input type="checkbox" checked={config.enabled} onChange={e => setField('enabled', e.target.checked)} />
        Include revenue from new connections
      </label>
    </div>
    <div role="status" style={{ margin: '9px 0', padding: '7px 9px', background: effectiveText === 'Active' ? '#edf7f2' : '#f0f5f7', border: '1px solid #c4d8dc', borderRadius: 4, fontSize: 11 }}>
      <b>Requested: {config.enabled ? 'connection-based' : 'exogenous'} · Effective: {effectiveLabel} · Mode: {effectiveText}</b>
      {backendApplicable ? ' · Backend confirmed connection-based mode' : config.enabled ? ' · Exogenous revenue is retained until backend calibration confirms activation' : ' · Existing exogenous revenue remains in use'}
      {baselineBilled != null && <span> · Baseline billed households: <b>{fmt(baselineBilled, 0)}</b></span>}
      {consumption != null && <span> · Consumption: <b>{fmt(consumption)} m³/household/year</b> ({fmt(Number(consumption) / 12)} per month)</span>}
      {calibration?.baseline_tariff != null && <span> · Baseline tariff: <b>{fmt(calibration.baseline_tariff)} {currency}/m³</b></span>}
      {calibration?.baseline_collection_ratio != null && <span> · Baseline collection: <b>{fmt(Number(calibration.baseline_collection_ratio) * 100, 1)}%</b></span>}
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 205px), 1fr))', gap: 9 }}>
      {([
        ['new_billed_share_basic', 'New Basic connections billed (%)', 'Percent of newly delivered Basic households receiving a bill. Stored as a 0–1 fraction.'],
        ['new_billed_share_sm', 'New Safely Managed connections billed (%)', 'SM upgrades replace prior Basic billing status; already billed households are not counted as entirely new customers.'],
      ] as const).map(([name, label, help]) => <label key={name} style={styles.label}>
        {label}<span style={styles.note}>{help}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input aria-label={label} type="number" min="0" max="100" step="any" placeholder="Required; blank is not zero"
            value={config[name] == null ? '' : Number(config[name]) * 100}
            onChange={e => setField(name, e.target.value.trim() === '' ? null : Number(e.target.value) / 100)}
            style={styles.input} /><span>%</span>
        </div>
      </label>)}
      <label style={styles.label}>Annual operating cost per billed household
        <span style={styles.note}>{currency}/household/year, real. Unbilled households may also incur costs; this is not a full utility operating account.</span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {config.cost_basis === 'annual_household'
            ? <input aria-label="Annual operating cost per billed household" type="number" min="0" step="any" placeholder="Enter annual cost"
              value={config.annual_cost_per_household ?? ''} onChange={e => setField('annual_cost_per_household', optionalNumber(e.target.value))} style={styles.input} />
            : <output aria-label="Calculated annual operating cost per billed household" style={{ ...styles.input, display: 'block', minHeight: 31, background: '#f0f5f7' }}>{fmt(displayedCost)} {currency}/year</output>}
        </div>
        <span style={styles.note}>Selected source: {costSource}{config.cost_basis === 'per_m3' ? ' (baseline consumption × marginal cost)' : ''}</span>
      </label>
      <label style={styles.label}>Cost source
        <select aria-label="Cost source" value={config.cost_basis} onChange={e => {
          const nextBasis = e.target.value as ConnectionRevenueConfig['cost_basis'];
          if (nextBasis === 'annual_household') setField('annual_cost_per_household', annualCostFromM3 ?? config.annual_cost_per_household);
          setField('cost_basis', nextBasis);
        }} style={styles.select}>
          <option value="per_m3">Convert existing cost per m³</option>
          <option value="annual_household">Manual annual household cost</option>
          <option value="expenditure_proxy">Operating-expenditure average-cost proxy</option>
        </select>
      </label>
    </div>
    {config.cost_basis === 'expenditure_proxy' && <div style={{ marginTop: 8, padding: 9, border: '1px solid #d6c99d', borderRadius: 4, background: '#fffaf0' }}>
      <strong style={{ fontSize: 11 }}>Average operating cost used as a proxy</strong>
      <p style={{ ...styles.note, margin: '4px 0 7px' }}>Includes fixed costs; it is not necessarily marginal. Snapshot scope follows the normalized area and currency on the operating-expenditure source (not the display label). The source year must match model baseline.</p>
      <div style={{ display: 'flex', gap: 7, alignItems: 'end', flexWrap: 'wrap' }}>
      <button type="button" onClick={useProxyEstimate} disabled={!Number.isFinite(Number(estimateExpenditure)) ||
        Number(estimateExpenditure) <= 0 || !baselineYear || expenditureSource.baseline_year !== baselineYear ||
        !expenditureSource.area || !expenditureSource.currency || expenditureSource.currency_basis !== 'real_raw'}>
          Estimate from existing operating expenditure
        </button>
        {config.cost_proxy && <>
          <label style={{ ...styles.label, maxWidth: 230 }}>Household-cost allocation (0–100%)
            <input aria-label="Household cost allocation percent" type="number" min="0" max="100" step="any"
              value={config.cost_proxy.household_allocation == null ? '' : config.cost_proxy.household_allocation * 100}
              onChange={e => setProxyAllocation(e.target.value.trim() === '' ? null : Number(e.target.value) / 100)} style={styles.input} />
          </label>
          <span style={styles.note}>Snapshot: {fmt(config.cost_proxy.expenditure, 0)} {config.cost_proxy.currency}/year · {config.cost_proxy.baseline_year} · {config.cost_proxy.area} {config.cost_proxy.sector}.</span>
        </>}
      </div>
      {!config.cost_proxy && <p style={{ ...styles.note, marginBottom: 0 }}>No estimate is selected. A positive expenditure source and explicit household allocation are required; the household volume share can be entered as an assumption, never applied silently.</p>}
      {proxySourceChanged && <div role="alert" style={{ marginTop: 6, color: '#8a431c', fontSize: 11 }}>Source inputs changed since this estimate was saved. Re-estimate and confirm its allocation.</div>}
    </div>}
    <label style={{ ...styles.label, marginTop: 9 }}>What household revenue is already included in your funding projection?
      <select aria-label="Funding reference" value={config.funding_reference || ''} onChange={e => setField('funding_reference', e.target.value || null)} style={styles.select}>
        <option value="">Choose a reference…</option>
        <option value="exogenous">Revenue follows the existing volume-growth assumption</option>
        <option value="fixed">Only the baseline household revenue contribution is included</option>
        <option value="series">Specify an annual reference under Advanced</option>
      </select>
    </label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))', gap: 7, marginTop: 6, ...styles.note }}>
      <span><b>Existing volume-growth assumption:</b> compare with household share of the existing projected volume path.</span>
      <span><b>Baseline contribution only:</b> compare with baseline household volume held constant.</span>
      <span><b>Annual reference:</b> use the custom household-volume series entered below.</span>
    </div>
    <label style={{ ...styles.label, marginTop: 9 }}>Source / assumption note
      <input aria-label="Source / assumption note" value={config.shared_assumption_note}
        onChange={e => setField('shared_assumption_note', e.target.value)} placeholder="Required when field-specific sources are not supplied" style={styles.input} />
      <span style={styles.note}>Field-specific observed/assumed sources under Advanced take precedence. This shared note is treated as assumed provenance only when a field source is absent.</span>
    </label>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8, fontSize: 11 }}>
      {selectedCostIsZero && <label><input type="checkbox" checked={config.zero_cost_confirmed} onChange={e => setField('zero_cost_confirmed', e.target.checked)} /> I explicitly confirm zero cost as a gross-revenue simplification</label>}
      <label><input type="checkbox" checked={config.reference_confirmed} onChange={e => setField('reference_confirmed', e.target.checked)} /> This selected household revenue contribution is already represented in baseline funding</label>
      <label><input type="checkbox" checked={config.funding_includes_reforms} onChange={e => setField('funding_includes_reforms', e.target.checked)} /> Baseline funding already includes future tariff / collection reforms</label>
      <label><input type="checkbox" checked={config.lower_service_billing_acknowledged} onChange={e => setField('lower_service_billing_acknowledged', e.target.checked)} /> Limited / lower-service billing is excluded</label>
    </div>
    <div style={{ marginTop: 8, padding: '7px 9px', background: '#eef4f5', borderRadius: 4, fontSize: 10.5 }}>
      <b>Inherited and calibrated values:</b> Baseline tariff and collection remain inherited from the shared revenue base. Selected tariff/collection reforms use their scenario schedules. Baseline billed households: {fmt(baselineBilled, 0)} · Consumption: {consumption == null ? 'not calibrated' : `${fmt(consumption)} m³/year`} · Annual cost: {fmt(displayedCost)} {currency}/household.
      <br />Billing and recurring costs use the accumulated prior-year customer base; annual operating cost is independent of collection efficiency.
    </div>
    <div style={{ marginTop: 9, borderTop: '1px solid #d5e0e4', paddingTop: 7 }}>
      <button type="button" aria-expanded={advancedOpen} onClick={() => setAdvancedOpen(value => !value)} style={{ fontWeight: 700 }}>
        {advancedOpen ? 'Hide' : 'Show'} Advanced / baseline calibration {missingCalibration.length ? `— ${missingCalibration.join(', ')} need attention` : ''}
      </button>
      {!advancedOpen && missingCalibration.length > 0 && <span style={{ marginLeft: 8, ...styles.note }}>Required calibration gaps remain visible; expand to enter them.</span>}
      <div hidden={!advancedOpen} style={{ paddingTop: 9 }}>
        <p style={{ ...styles.note, marginTop: 0 }}>These baseline shares calibrate existing customers and consumption only. Future billing percentages above are separate. Existing zeroes and partially completed drafts are preserved.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 8 }}>
          {field('billed_share_basic', 'Baseline Basic billed share (0–1)')}
          {field('billed_share_sm', 'Baseline Safely Managed billed share (0–1)')}
          {field('household_volume_share', 'Household share of total billed volume (0–1)')}
          {field('consumption_m3', 'Optional consumption check (m³ / household / year)')}
          {field('observed_billed_households', 'Optional observed billed households (raw count)')}
          {field('nonhousehold_growth_rate', 'Non-household annual growth (blank = shared rule)')}
          {field('marginal_cost', `Manual marginal cost per m³ (${currency}/m³)`)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 8, marginTop: 8 }}>
          <label style={styles.label}>Baseline-volume alignment
            <select aria-label="Baseline-volume alignment" value={config.alignment || ''} onChange={e => setField('alignment', e.target.value || null)} style={styles.select}>
              <option value="">Choose…</option><option value="estimate">Authorize estimate from the canonical volume path</option><option value="observation">Supply baseline-year observation</option>
            </select>
          </label>
          {config.alignment === 'observation' && field('baseline_volume_mld', 'Observed baseline billed volume (million litres/day)')}
        </div>
        {anchorMismatch && <p role="status" style={{ ...styles.note, padding: 7, background: '#fff7e7' }}>Shared volume anchor is {referenceYear}, model baseline is {baselineYear}. The backend derived estimate remains an audit value; choose to authorize it or enter a baseline-year observation.</p>}
        {config.funding_reference === 'series' && <div style={{ marginTop: 8 }}>
          <b style={{ fontSize: 11 }}>Annual household-volume reference (raw m³/year)</b>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 5 }}>
            {Object.keys(config.reference_series).sort((a, b) => Number(a) - Number(b)).map(year => <label key={year} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              {year}<input aria-label={`Reference billed volume ${year}`} type="number" min="0" step="any" value={config.reference_series[year] ?? ''}
                onChange={e => update({ ...config, reference_series: { ...config.reference_series, [year]: optionalNumber(e.target.value) } })} style={{ ...styles.input, width: 125 }} />
              <button type="button" aria-label={`Remove reference year ${year}`} onClick={() => {
                const next = { ...config.reference_series }; delete next[year]; update({ ...config, reference_series: next });
              }}>Remove</button>
            </label>)}
            <button type="button" onClick={() => {
              const years = Object.keys(config.reference_series).map(Number);
              const year = String((Math.max(...years, baselineYear || 0)) + 1);
              if (!Object.prototype.hasOwnProperty.call(config.reference_series, year)) update({ ...config, reference_series: { ...config.reference_series, [year]: null } });
            }}>Add year</button>
          </div>
        </div>}
        <div style={{ marginTop: 9 }}>
          <strong style={{ fontSize: 11 }}>Field-specific provenance</strong>
          <p style={{ ...styles.note, margin: '3px 0' }}>Existing observed sources are retained. A field source overrides the shared note; otherwise the note is used as assumed provenance.</p>
          {provenanceFields.map(name => <div key={name} style={{ marginTop: 8, fontSize: 10.5 }}>
            <b>{labels[name] || name}</b>
            <ProvenanceEditor config={config} field={name} year={baselineYear} onChange={update} />
          </div>)}
        </div>
      </div>
    </div>
    {config.enabled && (allErrors.length > 0 || remoteErrors.length > 0) && <div role="alert" style={{ marginTop: 9, color: '#8b2c35', fontSize: 11, background: '#fff4f2', border: '1px solid #e5b9b2', padding: '7px 9px', borderRadius: 4 }}>
      <strong>Dynamic mode is incomplete. Exogenous revenue is retained.</strong>
      {(allErrors.length > 0 || remoteErrors.length > 0) && <ul style={{ margin: '5px 0 0', paddingLeft: 20 }}>{[...allErrors, ...remoteErrors].map((error, index) => <li key={`${error}-${index}`}>{error}</li>)}</ul>}
      {missingCalibration.length > 0 && <button type="button" onClick={() => setAdvancedOpen(true)}>Review missing calibration</button>}
    </div>}
    {current?.remote && <div role="status" style={{ marginTop: 6, color: '#647b85', fontSize: 10.5 }}>{current.remote}</div>}
    {calibration && <details style={{ marginTop: 8, fontSize: 10.5 }}>
      <summary>Financial calibration audit</summary>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, padding: 7, background: '#eef4f5' }}>
        <span>Selected cost basis: {calibration.selected_cost_basis || config.cost_basis}</span>
        <span>Annual cost/household: {fmt(calibration.annual_cost_per_household)} {currency}</span>
        <span>Equivalent marginal cost: {fmt(calibration.equivalent_marginal_cost)} {currency}/m³</span>
        <span>Baseline billed households: {fmt(calibration.baseline_billed_households, 0)}</span>
        <span>Consumption: {fmt(calibration.consumption_m3)} m³/household/year</span>
        <span>Baseline tariff: {fmt(calibration.baseline_tariff)} {currency}/m³</span>
        <span>Baseline collection: {fmt(Number(calibration.baseline_collection_ratio) * 100, 1)}%</span>
      </div>
    </details>}
    <div style={{ marginTop: 7, fontSize: 10, color: '#627985' }}>
      Shared volume anchor: {referenceYear ?? 'not set'} · model baseline: {baselineYear ?? 'not set'}.
      {anchorMismatch && config.alignment === 'estimate' && <> Estimate authorized; baseline estimate is reported in the calibration audit.</>}
      {' '}Consumption is calibrated against baseline households only; no future simulated households are used.
    </div>
  </section>;
}

export function connectionRevenueErrors(config: any, inputs: any, sector: 'water' | 'sanitation') {
  return validateConnectionRevenueConfig(migrateConnectionRevenueConfig(config), inputs, sector);
}

export { migrateConnectionRevenueConfig, type ConnectionRevenueConfig };
