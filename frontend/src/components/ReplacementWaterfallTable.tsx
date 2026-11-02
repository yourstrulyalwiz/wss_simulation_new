import React from 'react';
import TableExport from './TableExport';
import { REPLACEMENT_WATERFALL_FIELDS } from '../replacementWaterfall';
import type { CurrencyDisplaySettings } from '../currencyDisplay';

export default function ReplacementWaterfallTable({ rows, moneyFactor, currency, filename, currencyDisplay, label }: {
  rows: { year: number; values: (number | null)[] }[]; moneyFactor: number; currency: string;
  filename: string; currencyDisplay: CurrencyDisplaySettings; label?: string;
}) {
  if (!rows.length) return null;
  const headers = ['Reconciliation measure', 'Timing', ...rows.map(row => String(row.year))];
  const values = REPLACEMENT_WATERFALL_FIELDS.map(([, label, timing], i) => [
    label, timing, ...rows.map(row => row.values[i] == null ? null : row.values[i]! * moneyFactor / 1000),
  ]);
  return <details className="modern-bau-plot-panel">
    <summary>Annual replacement and expansion reconciliation{label ? ` — ${label}` : ''}</summary>
    <p>Sector total, B {currency}. After current losses and contractual debt service, available ordinary funding pays current-year replacement, unpaid replacement from prior years, then unpaid treatment costs from prior years, before current eligible expansion. Treatment settlement is included in ancillary spending, not an extra charge. Restricted loans, earmarked household finance and noncash delivery remain subject to their existing expansion restrictions. Historical operating and debt cash shortfalls are not repaid here.</p>
    <p>Opening and closing backlogs are snapshots: never sum them across years. Total paid is a subtotal, not an additional payment. — means the engine did not report the field.</p>
    <TableExport filename={filename} sheetName="Annual waterfall" headers={headers} rows={values} currencyDisplay={currencyDisplay} freezeColumns={2} />
    <div style={{ overflowX: 'auto' }}>
      <table className="data-table" style={{ borderCollapse: 'collapse', minWidth: '100%' }}>
        <thead><tr>{headers.map((header, i) => <th key={header} style={{ padding: '10px 12px', minWidth: i === 0 ? 240 : 100, textAlign: i < 2 ? 'left' : 'right' }}>{header}</th>)}</tr></thead>
        <tbody>{values.map((row, i) => <tr key={i}>{row.map((value, j) => <td key={j} style={{ padding: '10px 12px', borderTop: '1px solid #dce6ea', textAlign: j < 2 ? 'left' : 'right', whiteSpace: j > 1 ? 'nowrap' : 'normal' }}>{typeof value === 'number' ? value.toLocaleString('en-US', { maximumFractionDigits: 4 }) : value ?? '—'}</td>)}</tr>)}</tbody>
      </table>
    </div>
  </details>;
}
