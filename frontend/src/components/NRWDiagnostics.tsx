import React from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { aggregateNrwDiagnosticField, hasNrwArray, NRW_DIAGNOSTIC_FIELDS, nrwRevenueMetadata, type NRWDiagnosticField } from '../nrwRevenue';
import TableExport from './TableExport';

type Props = {
  results?: any | any[];
  currency?: string;
  currencyDisplay?: CurrencyDisplaySettings;
  title?: string;
  sector?: 'water_supply' | 'sanitation';
};

export default function NRWDiagnostics({ results, currency = 'LCU', currencyDisplay, title = 'NRW & revenue reconciliation', sector = 'water_supply' }: Props) {
  const datasets = (Array.isArray(results) ? results : results ? [results] : []).filter(Boolean);
  const years: number[] = datasets[0]?.years || [];
  const knownFields: readonly NRWDiagnosticField[] = NRW_DIAGNOSTIC_FIELDS;
  const discoveredKeys = [...new Set(datasets.flatMap(result => {
    const sec = result?.[sector] ?? result;
    return Object.keys(sec || {}).filter(key => key.startsWith('scenario_'))
      .map(key => key.slice('scenario_'.length))
      .filter(key => /(nrw|cohort|eligible.*pool|microfinance|mf.*flow|grant.*flow|overachievement|mf.*offer|offer.*mf|mf.*unserved|unserved.*mf|mf.*self.*excluded|self.*excluded.*mf)/i.test(key));
  }))];
  const dynamicFields: NRWDiagnosticField[] = discoveredKeys
    .filter(key => !knownFields.some(field => field.key === key))
    .map(key => {
      const normalized = key.toLowerCase();
      const kind: NRWDiagnosticField['kind'] = /cash|revenue|capital|cost|net/.test(normalized) ? 'money'
        : /tariff|ratio|rate|share/.test(normalized) ? 'rate'
          : /volume|capacity/.test(normalized) && !/(household|_hh)/.test(normalized) ? 'volume' : 'households';
      const unit = kind === 'money' ? 'currency millions'
        : kind === 'rate' ? normalized.includes('tariff') ? 'currency/m³' : 'fraction'
          : kind === 'volume' ? 'million m³/year' : 'million households';
      const label = key.replace(/^nrw_/, 'NRW ').replace(/^mf_/, 'Microfinance ')
        .replace(/_hh\b/g, ' households').replace(/_million_m3\b/g, ' million m³')
        .replace(/_/g, ' ').replace(/\b\w/g, character => character.toUpperCase());
      return { key, label, unit, kind };
    });
  const present: NRWDiagnosticField[] = [...knownFields, ...dynamicFields]
    .filter(field => datasets.some(result => hasNrwArray(result, field.key, sector)));
  if (!datasets.length || !years.length) return null;

  const allMetadata = datasets.map(result => nrwRevenueMetadata(result, sector));
  const metadata = allMetadata.filter(Boolean);
  const migrationNotices = [...new Set(metadata.map(item => item.migration_notice).filter(Boolean))];
  const conflicts = metadata.some(item => item.legacy_rate_conflict);
  const attribution = metadata.find(item => item.attribution || item.attribution_description)?.attribution ??
    metadata.find(item => item.attribution_description)?.attribution_description;
  const displayCurrencyCode = currencyDisplay ? displayCurrency(currencyDisplay, currency) : currency;
  const factorMoney = (value: number) => currencyDisplay ? convertMoney(value, currencyDisplay, currency) as number : value;
  const version2 = metadata.length === datasets.length && metadata.every(item => Number(item.version) >= 2);
  const combined = (field: NRWDiagnosticField, index: number) =>
    aggregateNrwDiagnosticField(datasets, field, index, sector);
  const headers = ['Year', ...present.map(field => `${field.label} (${field.unit.replace('currency', displayCurrencyCode)})`)];
  const exportRows = years.map((year, index) => [
    year,
    ...present.map(field => {
      const value = combined(field, index);
      return value == null ? '' : field.kind === 'money' || field.unit.includes('currency') ? factorMoney(value) : value;
    }),
  ]);
  const fmt = (field: NRWDiagnosticField, value: number | null) => {
    if (value == null) return '—';
    const shown = field.kind === 'money' || field.unit.includes('currency') ? factorMoney(value) : value;
    return shown.toLocaleString('en-US', { maximumFractionDigits: field.kind === 'households' ? 4 : 5 });
  };
  const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, padding: '6px 8px', textAlign: 'right', background: '#e8f0f4', borderBottom: '1px solid #cbd5e1', fontSize: 10, whiteSpace: 'nowrap' };
  return <section data-testid="nrw-diagnostics" style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fbfdfe', padding: '10px 11px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <h3 style={{ margin: 0, color: '#164e63', fontSize: 13 }}>{title}</h3>
      {exportRows.length > 0 && <TableExport filename="nrw_revenue_reconciliation" sheetName="NRW reconciliation" headers={headers} rows={exportRows} compact />}
    </div>
    {version2 && <p style={{ margin: '6px 0', fontSize: 10.5, color: '#475569' }}>
      {sector === 'sanitation'
        ? 'Version 2 sanitation attribution: eligible linked volume is physical recovery × return ratio × explicit sewer-billable share, reconciled against only the supplied overlap series and valued at shared scenario sanitation rates.'
        : 'Version 2 reconciliation: connection sales are attributed at reference rates; collection is applied before tariff on non-NRW volume, and the full joint tariff/collection effect on NRW sales is assigned to NRW. Avoided-cost value is separate and is not tariff sales.'}
    </p>}
    {!version2 && <p style={{ margin: '6px 0', fontSize: 10.5, color: '#64748b' }}>Backend version 2 attribution metadata is not present; diagnostics below show only fields returned by the calculation.</p>}
    {conflicts && <div role="status" style={{ margin: '6px 0', padding: 7, background: '#fff7ed', border: '1px solid #fed7aa', color: '#9a3412', fontSize: 10.5 }}>
      Shared revenue-base rates are authoritative for NRW sales. The legacy NRW-only tariff differs and is retained unchanged for audit.
    </div>}
    {migrationNotices.map(notice => <div key={notice} role="status" style={{ margin: '6px 0', fontSize: 10.5, color: '#475569' }}>{notice}</div>)}
    {attribution && <p style={{ margin: '5px 0', fontSize: 10, color: '#64748b' }}>{attribution}</p>}
    {!present.length ? <div style={{ padding: '10px 4px', marginTop: 7, color: '#64748b', fontSize: 11 }}>No NRW or reconciliation arrays are present in this calculation response yet.</div> : <div style={{ overflowX: 'auto', maxHeight: 330, border: '1px solid #e2e8f0', borderRadius: 4, marginTop: 7 }}>
      <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%' }}>
        <thead><tr><th style={{ ...th, textAlign: 'left', left: 0 }}>Year</th>{present.map(field => <th key={field.key} style={th}>{field.label}<br /><span style={{ fontWeight: 400 }}>{field.unit.replace('currency', displayCurrencyCode)}</span></th>)}</tr></thead>
        <tbody>{years.map((year, index) => <tr key={year} style={{ background: index % 2 ? '#f6f9fa' : '#fff' }}>
          <th scope="row" style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid #edf1f3', fontSize: 10.5 }}>{year}</th>
          {present.map(field => <td key={field.key} style={{ padding: '5px 8px', textAlign: 'right', borderBottom: '1px solid #edf1f3', fontSize: 10.5, whiteSpace: 'nowrap' }}>{fmt(field, combined(field, index))}</td>)}
        </tr>)}</tbody>
      </table>
    </div>}
    <p style={{ margin: '6px 0 0', fontSize: 10, color: '#64748b' }}>Missing backend arrays remain unavailable (—); no values are inferred. Money is shown in {displayCurrencyCode} millions. Water NRW net is signed after implementation cost; eligible NRW-linked sanitation cash is a separate signed sanitation source, not part of water nrw_net.</p>
  </section>;
}
