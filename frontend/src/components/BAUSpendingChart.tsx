import React, { useRef } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartExport from './ChartExport';
import type { BauSpendingRow } from '../bauServiceView';
import type { CurrencyDisplaySettings } from '../currencyDisplay';
import { yearAxisInterval } from '../chartAxis';

export default function BAUSpendingChart({ rows, moneyFactor, currency, scopeLabel, sectorLabel, currencyDisplay }: {
  rows: BauSpendingRow[]; moneyFactor: number; currency: string; scopeLabel?: string; sectorLabel: string;
  currencyDisplay: CurrencyDisplaySettings;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  if (!rows.length) return null;
  const data = rows.map(row => ({
    year: row.year, expansion: row.expansion * moneyFactor / 1000,
    replacement: row.replacement * moneyFactor / 1000, available: row.available * moneyFactor / 1000,
  }));
  const units = `B ${currency}/yr`;
  const format = (value: number) => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
  return <section className="modern-bau-spending modern-bau-plot-panel" aria-label="BAU capital requirements and available funds">
    <h3>BAU capital requirements and available funds</h3>
    <p>{scopeLabel} / {sectorLabel} / Both service levels. Annual target-path expansion and replacement requirements under BAU assumptions, compared with effective capital available. Operating costs are excluded.</p>
    <p>All amounts: {units}. The bars show annual flows, not accumulated unmet obligations. The difference from available capital is not the model's closing financing balance; see the BAU table for that balance.</p>
    <div className="modern-bau-chart-actions">
      <ChartExport chartRef={chartRef} filename={`${scopeLabel || 'area'}_${sectorLabel}_bau_spending`}
        title="BAU capital requirements and available funds" currencyDisplay={currencyDisplay}
        sheets={[{ name: 'Annual capital', headers: ['Year', `Planned expansion (${units})`, `Replacement need (${units})`, `Available capital (${units})`],
          rows: data.map(row => [row.year, row.expansion, row.replacement, row.available]) }]} />
    </div>
    <div ref={chartRef} className="modern-bau-plot-canvas">
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={data} margin={{ top: 16, right: 16, bottom: 8, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} interval={yearAxisInterval(data)} />
          <YAxis width={65} tick={{ fontSize: 11 }} tickFormatter={format} />
          <Tooltip formatter={(value: any) => `${format(Number(value))} ${units}`} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="expansion" name="Planned expansion" stackId="requirements" fill="#347fa9" isAnimationActive={false} />
          <Bar dataKey="replacement" name="Replacement need" stackId="requirements" fill="#a8cfe5" isAnimationActive={false} />
          <Line dataKey="available" name="Available capital" stroke="#01324d" strokeWidth={3} strokeDasharray="7 3" dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  </section>;
}
