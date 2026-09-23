import React, { useRef } from 'react';
import { CartesianGrid, ComposedChart, Label, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { C } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import ChartExport from './ChartExport';

export type BasicCoverageRow = {
  year: number;
  total: number;
  bau: number;
  scenario: number;
  target: number;
};

export default function BasicCoverageChart({ title, rows, isShare, filename, captureKey }: {
  title: string;
  rows: BasicCoverageRow[];
  isShare: boolean;
  filename: string;
  captureKey: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  // The Basic rung is exclusive: moving to Safely Managed decreases this series.
  // Plot complete paths rather than clipping signed changes into positive stacked bands.
  const data = rows.map(r => {
    const convert = (n: number) => isShare ? (r.total > 0 ? n / r.total : 0) : n;
    return { year: r.year, bau: convert(r.bau), scenario: convert(r.scenario), target: convert(r.target) };
  });
  const yLabel = isShare ? '% of households' : '# households (millions)';
  const fmt = (n: number) => isShare
    ? `${(n * 100).toFixed(1)}%`
    : Number(n.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const lines = [
    { key: 'bau', name: 'BAU (basic)', color: C.bau },
    { key: 'scenario', name: 'With interventions (basic)', color: C.scenario },
    { key: 'target', name: 'Target (basic)', color: C.target, dash: '6 3' },
  ];
  return (
    <div data-results-chart={captureKey} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, height: 50, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f', margin: '0 0 1px' }}>{title}</h4>
          <div style={{ fontSize: 10.5, color: '#64748b' }}>
            Exclusive Basic rung: a decrease can reflect upgrades to Safely Managed, not lost access.
          </div>
        </div>
        <ChartExport chartRef={chartRef} filename={filename} title={title} compact
          sheets={[{ name: 'Data', headers: ['Year', ...lines.map(l => l.name)],
            rows: data.map(r => [r.year, r.bau, r.scenario, r.target]) }]}
          chartSpec={{ category: 'Year', lines: lines.map(l => ({ name: l.name, color: l.color, dash: !!l.dash })),
            yTitle: yLabel, xTitle: 'Year' }} />
      </div>
      <div ref={chartRef} style={{ background: '#fff' }}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 24, bottom: 5, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(data)} />
            <YAxis tick={{ fontSize: 10 }} domain={isShare ? [0, 1] : undefined} tickFormatter={fmt}>
              <Label value={yLabel} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
            </YAxis>
            <Tooltip formatter={(v: any) => fmt(+v) as any} labelFormatter={(y: any) => String(y)} contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {lines.map(l => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2}
                strokeDasharray={l.dash} dot={false} legendType="plainline" isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}