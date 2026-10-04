import React, { useState } from 'react';
import { captureImage, downloadBlob, postForBlob } from './exportUtils';
import type { CurrencyDisplaySettings } from '../currencyDisplay';

// Describes how to draw a NATIVE, data-linked Excel chart from the exported data series: which columns are
// stacked area bands vs reference lines (by their header name), plus colours and axis titles. The backend
// binds each series to the data cells, so the Excel chart redraws when the data is edited.
export type ChartSpec = {
  category?: string;                                       // x-axis column header (default: first column)
  stacked?: boolean;                                       // stack the area series
  areas?: { name: string; color: string }[];              // area series, in stack order
  lines?: { name: string; color: string; dash?: boolean }[];  // line (reference) series
  yTitle?: string; xTitle?: string;
};

// Small "⤓ PNG / ⤓ JPG / ⤓ Excel" control for any chart. PNG/JPG capture the referenced chart node to an
// image; Excel posts the chart's data series + a `chartSpec` to /api/export/chart, which returns a workbook
// with the data table AND a live Excel chart bound to those cells (dynamic — edit the data, the chart moves).
export default function ChartExport({ chartRef, filename, title, sheets, chartSpec, compact, currencyDisplay }: {
  chartRef: React.RefObject<any>;
  filename: string; title?: string;
  sheets: { name: string; headers: any[]; rows: any[][] }[];
  chartSpec?: ChartSpec;
  compact?: boolean;
  currencyDisplay?: CurrencyDisplaySettings;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const btn: React.CSSProperties = {
    padding: compact ? '2px 7px' : '4px 10px', fontSize: 11, border: '1px solid #cbd5e1',
    borderRadius: 6, background: '#fff', color: '#475569', cursor: 'pointer', fontWeight: 500,
  };
  const img = async (fmt: 'png' | 'jpeg') => {
    if (!chartRef.current) return;
    setBusy(fmt);
    try {
      const url = await captureImage(chartRef.current, fmt);
      downloadBlob(await (await fetch(url)).blob(), `${filename}.${fmt === 'jpeg' ? 'jpg' : 'png'}`);
    } catch { alert('Image export failed. Please try again.'); }
    finally { setBusy(null); }
  };
  const xlsx = async () => {
    setBusy('xlsx');
    try {
      // Native data-linked chart from chartSpec (no picture). Only fall back to a captured PNG if a caller
      // hasn't supplied a spec, so the export still contains something.
      const body: any = { filename, title, sheets, chartSpec, currency_display: currencyDisplay };
      if (!chartSpec && chartRef.current) {
        try { body.image = await captureImage(chartRef.current, 'png'); } catch { /* data-only workbook */ }
      }
      await postForBlob('/api/export/chart', body, filename + '.xlsx');
    } catch (error) { alert(error instanceof Error ? error.message : 'Excel export failed. Please try again.'); }
    finally { setBusy(null); }
  };
  return (
    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      <button style={btn} disabled={busy !== null} title="Download this chart as a PNG image" onClick={() => img('png')}>{busy === 'png' ? '…' : '⤓ PNG'}</button>
      <button style={btn} disabled={busy !== null} title="Download this chart as a JPG image" onClick={() => img('jpeg')}>{busy === 'jpeg' ? '…' : '⤓ JPG'}</button>
      <button style={btn} disabled={busy !== null} title="Download this chart as Excel — a live chart linked to its data (edit the data, the chart updates)" onClick={xlsx}>{busy === 'xlsx' ? '…' : '⤓ Excel'}</button>
    </span>
  );
}
