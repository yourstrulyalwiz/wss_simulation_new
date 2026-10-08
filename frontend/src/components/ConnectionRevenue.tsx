import React, { useEffect, useId, useMemo, useState } from 'react';
import { migrateConnectionRevenueConfig, validateConnectionRevenueConfig, type ConnectionRevenueConfig } from '../connectionRevenueConfig';
import { resolveRevenueBases } from '../api';

export function revenueBasesRequestBody(inputs: any) { return JSON.stringify(inputs); }
export function connectionRevenueStatus(data: any, sector: 'water' | 'sanitation') {
  return data?.[sector]?.connection ?? data?.[sector]?.connection_revenue ?? data?.connection_revenue?.[sector] ?? null;
}
const fmt = (value: any, digits = 2) => value == null || !Number.isFinite(Number(value))
  ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '7px 9px',
  border: '1px solid #d9c884', borderRadius: 4, background: '#fff9e6', color: '#20323d' };

export default function ConnectionRevenue({ inputs, onChange, sector, area }: {
  inputs: any; onChange: (value: any) => void; sector: 'water' | 'sanitation'; area: string; label?: string;
}) {
  const id = useId();
  const stored = inputs.connection_revenue?.[sector];
  const config = useMemo(() => migrateConnectionRevenueConfig(stored), [stored]);
  const [validation, setValidation] = useState<{ key: string; status: any; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const key = revenueBasesRequestBody(inputs);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await resolveRevenueBases(inputs, controller.signal);
        if (!controller.signal.aborted) setValidation({ key, status: connectionRevenueStatus(data, sector), error: '' });
      } catch (error: any) {
        if (!controller.signal.aborted) setValidation({ key, status: null, error: error.message });
      }
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [key, sector, attempt]);
  const current = validation?.key === key ? validation : null;
  const calibration = current?.status?.calibration || {};
  const base = inputs.revenue_bases?.[sector] || {};
  const errors = [...new Set([...validateConnectionRevenueConfig(config),
    ...(Array.isArray(current?.status?.errors) ? current.status.errors : [])])];
  const state = !config.enabled ? 'Off' : errors.length ? 'Incomplete' :
    current?.error ? 'Verification unavailable' : !current?.status ? 'Checking current inputs…' :
      current.status.effective === true || ['aggregate_coverage_expansion', 'aggregate-coverage-expansion'].includes(current.status.effective) || ['on', 'active', 'effective'].includes(current.status.state)
        ? 'Active' : 'Incomplete';
  const update = (patch: Partial<ConnectionRevenueConfig>) => {
    const toggleKey = sector === 'water' ? 'ws_connections_enabled' : 'san_connections_enabled';
    onChange({ ...inputs, connection_revenue: { ...inputs.connection_revenue, [sector]: { ...config, ...patch } },
      toggles: { ...inputs.toggles, [toggleKey]: patch.enabled ?? config.enabled } });
  };
  const noticeKey = `${area}:${sector}`;
  const currency = inputs.country_config?.currency || 'LCU';
  return <section data-testid="connection-revenue" aria-label={`Revenue from new connections — ${area} — ${sector}`}
    style={{ marginTop: 12, border: '1px solid #c2d3da', borderRadius: 6, padding: 12, background: '#f3f8f9', minWidth: 0 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
      <label htmlFor={`${id}-enabled`} style={{ fontSize: 13, fontWeight: 700, color: '#164e63' }}>
        <input id={`${id}-enabled`} type="checkbox" checked={config.enabled} onChange={e => update({ enabled: e.target.checked })} />
        {' '}Include revenue from new connections
      </label>
      <span role="status" style={{ fontSize: 11 }}>{state}</span>
    </div>
    {config.current_behavior_notice && !dismissed.includes(noticeKey) && <div role="status" style={{ fontSize: 11, padding: '8px 0' }}>
      {config.current_behavior_notice} <button type="button" onClick={() => {
        setDismissed([...dismissed, noticeKey]);
        update({ current_behavior_notice: undefined });
      }}>Dismiss notice</button>
    </div>}
    {config.migration_notice && <div role="note" style={{ fontSize: 10.5, padding: '4px 0', color: '#657780' }}>
      Preserved saved migration note: {config.migration_notice}
    </div>}
    <p style={{ fontSize: 11.5, lineHeight: 1.55 }}>
      Adds revenue from positive marginal coverage expansion at baseline tariff and collection rates. If weighted coverage falls below baseline,
      this feature adds zero; it does not deduct baseline revenue. Receipts begin one year after delivery.
    </p>
    <p style={{ fontSize: 10.5, lineHeight: 1.5, color: '#526a75' }}>
      Keeps the existing population/volume-growth baseline. Basic-to-Safely-Managed transfers use the difference between Basic and SM billing percentages;
      the combined transfer calculation is not floored by service band. Selected reforms apply separately to reconciled volume. Connection operating costs are excluded.
    </p>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 10 }}>
      {([['basic', 'Basic expansion billed (%)'], ['sm', 'Safely Managed expansion billed (%)']] as const).map(([rung, label]) => {
        const field = `new_billed_share_${rung}` as const;
        return <label key={field} style={{ display: 'grid', gap: 5, fontSize: 12 }}>
          {label}<input aria-label={label} type="number" min="0" max="100" step="any"
            value={config[field] == null ? '' : Number((config[field]! * 100).toPrecision(12))}
            onChange={e => update({ [field]: e.target.value === '' ? null : Number(e.target.value) / 100 })}
            style={inputStyle} />
        </label>;
      })}
      <label style={{ display: 'grid', gap: 5, fontSize: 12 }}>Source / assumption note (optional)
        <input aria-label="Source / assumption note (optional)" value={config.shared_assumption_note}
          onChange={e => update({ shared_assumption_note: e.target.value })} style={inputStyle} />
      </label>
    </div>
    <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 210px), 1fr))', gap: 10, fontSize: 11, margin: '14px 0' }}>
      {[
        ['Shared baseline tariff', `${fmt(calibration.baseline_tariff ?? base.tariff)} ${currency}/m³`],
        ['Shared baseline collection', `${fmt((calibration.baseline_collection_ratio ?? base.collection_ratio) == null ? null : (calibration.baseline_collection_ratio ?? base.collection_ratio) * 100)}%`],
        ['Billed-volume anchor', `${fmt(calibration.original_volume_mld ?? base.volume_mld)} MLD · ${calibration.reference_year ?? base.reference_year ?? '—'}`],
        ['Baseline billed volume', `${fmt(calibration.baseline_volume_million_m3)} million m³/year`],
        ['Volume growth method', base.growth_rate == null ? 'Population growth' : `${fmt(base.growth_rate * 100)}% annually`],
        ['Baseline Basic-or-better coverage', `${fmt(calibration.baseline_coverage == null ? null : calibration.baseline_coverage * 100)}%`],
        ['Baseline Basic / Safely Managed', `${fmt(calibration.baseline_basic_share == null ? null : calibration.baseline_basic_share * 100)}% / ${fmt(calibration.baseline_sm_share == null ? null : calibration.baseline_sm_share * 100)}%`],
        ['Baseline households (raw count)', fmt(calibration.baseline_households, 0)],
        ['Aggregate volume-scaling basis', `${fmt(calibration.aggregate_volume_proxy_m3)} m³/reference served-household equivalent`],
      ].map(([label, value]) => <div key={label}><dt style={{ color: '#526a75' }}>{label}</dt><dd style={{ margin: '4px 0 0', fontWeight: 600 }}>{value}</dd></div>)}
    </dl>
    <p style={{ fontSize: 10.5, color: '#526a75', lineHeight: 1.5, marginBottom: 0 }}>
      Delivered coverage affects receipts one year later. Basic-to-SM transfers use the difference between the two billing percentages;
      equal percentages give no additional volume. This is an aggregate customer-mix proxy, not observed household consumption.
      Baseline collected revenue is comparison-only, not an extra funding injection.
    </p>
    {config.enabled && errors.length > 0 && <div role="alert" style={{ color: '#8b2c35', fontSize: 11, marginTop: 9 }}>
      <strong>Requested feature is incomplete; the baseline remains calculable.</strong>
      <ul>{errors.map(error => <li key={error}>{error}</li>)}</ul>
    </div>}
    {current?.error && <div role="alert" style={{ fontSize: 11, marginTop: 8 }}>{current.error}{' '}
      <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry verification</button>
    </div>}
  </section>;
}

export function connectionRevenueErrors(config: any, inputs: any, sector: 'water' | 'sanitation') {
  return validateConnectionRevenueConfig(migrateConnectionRevenueConfig(config), inputs, sector);
}
export { migrateConnectionRevenueConfig, type ConnectionRevenueConfig };
