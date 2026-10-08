import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { runCalculation } from '../api';
import { REVENUE_SOURCES, reconciliationVersion, revenueSourceRows } from '../revenueSources';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { interventionEnabled } from '../interventionRegistry';
import TableExport from './TableExport';

export default function RevenueSourceChart({ inputs, results, sector, currencyDisplay }: {
  inputs: any | any[]; results?: any | any[]; sector: 'water' | 'sanitation'; currencyDisplay: CurrencyDisplaySettings;
}) {
  const datasets = Array.isArray(inputs) ? inputs : [inputs];
  const key = JSON.stringify(datasets);
  const [loaded, setLoaded] = useState<{ key: string; results: any[]; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (results) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all(datasets.map(runCalculation)).then(data => {
        if (!cancelled) setLoaded({ key, results: data, error: '' });
      }).catch(error => {
        if (!cancelled) setLoaded({ key, results: [], error: error.message });
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, !!results, attempt]);
  const current = loaded?.key === key ? loaded : null;
  const resultList = results ? (Array.isArray(results) ? results : [results]) : current?.results || [];
  const sectorKey = sector === 'water' ? 'water_supply' : 'sanitation';
  const currentVersion = resultList.length > 0 && resultList.every(result => reconciliationVersion(result, sectorKey) === 4);
  const currency = datasets[0]?.country_config?.currency || 'LCU';
  const rows = revenueSourceRows(resultList, sectorKey);
  const displayRows = rows.map(row => Object.fromEntries(Object.entries(row).map(([field, value]) =>
    [field, field === 'year' || value == null ? value : convertMoney(value, currencyDisplay, currency)])));
  const unit = `${displayCurrency(currencyDisplay, currency)} millions/year`;
  const selected = (key: string) => datasets.some(input => interventionEnabled(input,
    `${sector === 'water' ? 'ws' : 'san'}_${key === 'connections' ? 'connections' : key === 'collection' ? 'collection_efficiency' : key === 'nrw' && sector === 'sanitation' ? 'nrw_link' : key}_enabled`));
  const fmt = (value: any) => value == null ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
  const headers = ['Year', ...REVENUE_SOURCES.map(source => `${source.label} (${unit})`), `Total (${unit})`];
  const exportRows = displayRows.map(row => [row.year, ...REVENUE_SOURCES.map(source => row[source.key] ?? ''), row.total ?? '']);
  return <section data-testid="revenue-source-chart" style={{ margin: '16px 0', padding: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#f5f9fa' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <h3 style={{ fontSize: 14, margin: 0, color: '#164e63' }}>Additional revenue by source</h3>
      {rows.length > 0 && <TableExport filename={`${sector}_additional_revenue_by_source`} sheetName="Revenue sources" headers={headers} rows={exportRows} compact />}
    </div>
    <p style={{ fontSize: 11, color: '#526a75', lineHeight: 1.5 }}>
      {currentVersion ? 'Final-scenario ledger · baseline-rate connection and NRW sales; collection and tariff uplifts on full reconciled volume.' :
        resultList.length ? 'Legacy or unversioned results · source cash retains its original attribution. Recalculate for version 4.' : 'Calculating final-scenario source cash…'}
      {' '}Signed cash in {unit}. Funding injections and capital efficiencies are not revenue. Model estimates; uncertainty bounds are unavailable.
    </p>
    {current?.error && <div role="alert">{current.error} <button onClick={() => setAttempt(n => n + 1)}>Retry calculation</button></div>}
    {!resultList.length && !current?.error && <div aria-label="Loading revenue sources" style={{ height: 90, background: '#e8f0f4', borderRadius: 4 }} />}
    {!!resultList.length && !rows.length && <p>No annual source series returned. Recalculate to load the ledger.</p>}
    {rows.length > 0 && <>
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={displayRows} stackOffset="sign">
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" /><YAxis tickFormatter={value => fmt(value)} width={85} />
          <Tooltip formatter={(value: any, name: any) => [`${fmt(value)} ${unit}`, name]} />
          <Legend /><ReferenceLine y={0} stroke="#647b85" />
          {REVENUE_SOURCES.map(source => <Bar key={source.key} dataKey={source.key} name={source.label}
            fill={source.color} stackId="cash" isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>
      <div style={{ overflowX: 'auto', maxHeight: 300 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11 }}>
          <thead><tr><th>Year</th>{REVENUE_SOURCES.map(source => <th key={source.key} style={{ padding: 8 }}>
            {source.label}<small style={{ display: 'block', fontWeight: 400 }}>{selected(source.key) ? 'Selected' : 'Off'}</small>
          </th>)}<th>Total</th></tr></thead>
          <tbody>{displayRows.map(row => <tr key={row.year} style={{ borderTop: '1px solid #d5e0e4' }}>
            <th style={{ padding: 7 }}>{row.year}</th>
            {REVENUE_SOURCES.map(source => <td key={source.key} style={{ textAlign: 'right', padding: 7 }}>{fmt(row[source.key])}</td>)}
            <td style={{ textAlign: 'right', padding: 7, fontWeight: 700 }}>{fmt(row.total)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
