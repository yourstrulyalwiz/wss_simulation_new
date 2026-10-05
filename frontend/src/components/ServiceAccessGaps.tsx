import TableExport from './TableExport';
import { ACCESS_COLUMNS, type AccessRow } from '../serviceAccess';

const format = (value: number) => Number(value.toPrecision(5)).toLocaleString('en-US', { maximumFractionDigits: 5 });

export default function ServiceAccessGaps({ rows, filename }: { rows: AccessRow[]; filename: string }) {
  if (!rows.length) return null;
  const endYear = rows[rows.length - 1].year;
  const endRows = rows.filter(row => row.year === endYear);
  const headers = ['Year', 'Pass', ...ACCESS_COLUMNS.map(([label]) => `${label} (M HH)`)];
  const exportRows = rows.map(row => [row.year, row.pass, ...row.values]);
  return (
    <div data-service-access={filename} style={{ fontSize: 11, color: '#334155', margin: '8px 0 12px' }}>
      <p style={{ margin: '4px 0', lineHeight: 1.5 }}>
        Basic coverage is <b>basic-only</b>; households upgraded to safely managed are not losing access.
        Safely managed coverage above its target counts toward the basic minimum.
        Basic-entry costs follow the <b>at-least-basic access gap</b> (SM + basic).
        Replacement, ancillary and accumulated financial shortfalls remain separate.
        Gaps are assessed within each area before aggregation.
      </p>
      <div>
        <b>{endYear} at-least-basic access gap:</b>{' '}
        {endRows.map(row => `${row.pass} ${format(row.values[10])} M households`).join(' · ')}.
        {' '}Zero access gaps do not necessarily mean zero financing need.
      </div>
      <details style={{ marginTop: 5 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Service access gaps and outstanding transitions</summary>
        <TableExport filename={filename} sheetName="Service access gaps" headers={headers} rows={exportRows} compact />
        <div style={{ overflowX: 'auto', maxHeight: 320 }}>
          <table style={{ borderCollapse: 'collapse', whiteSpace: 'nowrap', fontSize: 10 }}>
            <thead><tr>{headers.map(header => <th key={header} style={{ padding: '5px 8px', background: '#f1f5f9' }}>{header}</th>)}</tr></thead>
            <tbody>{rows.map(row => (
              <tr key={`${row.year}-${row.pass}`}>
                {[row.year, row.pass, ...row.values.map(format)].map((value, i) =>
                  <td key={i} style={{ padding: '4px 8px', textAlign: i > 1 ? 'right' : 'left', borderBottom: '1px solid #e2e8f0' }}>{value}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
