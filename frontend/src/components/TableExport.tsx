import React, { useState } from 'react';
import { csvDownload, postForBlob } from './exportUtils';
import type { CurrencyDisplaySettings } from '../currencyDisplay';

// Small "⤓ CSV / ⤓ Excel" control placed next to any table. CSV is generated client-side; Excel is built
// server-side (/api/export/table) so it gets proper column widths, header styling and frozen panes.
export default function TableExport({ filename, sheetName, headers, rows, compact, currencyDisplay }: {
  filename: string; sheetName?: string; headers: any[]; rows: any[][]; compact?: boolean; currencyDisplay?: CurrencyDisplaySettings;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  if (!rows || !rows.length) return null;
  const btn: React.CSSProperties = {
    padding: compact ? '2px 7px' : '3px 9px', fontSize: 10.5, border: '1px solid #cbd5e1',
    borderRadius: 5, background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 600,
  };
  const xlsx = async () => {
    setBusy('xlsx');
    try { await postForBlob('/api/export/table', { filename, sheets: [{ name: sheetName || 'Table', headers, rows }], currency_display: currencyDisplay }, filename + '.xlsx'); }
    catch (error) { alert(error instanceof Error ? error.message : 'Excel export failed. Please try again.'); }
    finally { setBusy(null); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button style={btn} title="Download this table as CSV" onClick={() => csvDownload(headers, rows, filename + '.csv', currencyDisplay)}>⤓ CSV</button>
      <button style={btn} title="Download this table as Excel (.xlsx)" disabled={busy !== null} onClick={xlsx}>{busy === 'xlsx' ? '…' : '⤓ Excel'}</button>
    </span>
  );
}
