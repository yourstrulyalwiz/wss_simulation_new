import React, { useRef } from 'react';
import { Area, CartesianGrid, ComposedChart, Label, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { C } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import { linesFirstLegend } from './chartLegend';
import ChartExport from './ChartExport';

export type BasicCoverageRow = {
  year: number;
  total: number;
  bau: number;
  scenario: number;
  target: number;
};

export default function BasicCoverageChart({ title, rows, isShare, domain, filename, captureKey }: {
  title: string;
  rows: BasicCoverageRow[];
  isShare: boolean;
  domain: [number, number];
  filename: string;
  captureKey: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  // The Basic rung is exclusive: moving to Safely Managed decreases this series.
  // Plot complete paths rather than clipping signed changes into positive stacked bands.
  const data = rows.map(r => {
    const convert = (n: number) => isShare ? (r.total > 0 ? n / r.total : 0) : n;
    return { year: r.year, bau: convert(r.bau), scenario: convert(r.scenario),
      target: convert(r.target), total: isShare ? (r.total > 0 ? 1 : 0) : r.total };
  });
  const yLabel = isShare ? '% of population' : '# households (millions)';
  const fmt = (n: number) => isShare
    ? `${Math.round(n * 100)}%`
    : Number(n.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const lines = [
    { key: 'scenario', name: 'With interventions (basic)', color: C.scenario },
    { key: 'target', name: 'Target (basic)', color: C.target, dash: '6 3' },
    { key: 'total', name: 'Total households', color: C.total, dash: '8 4' },
  ];
  return (
    <div data-results-chart={captureKey} style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, height: 50, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f', margin: '0 0 1px' }}>{title}</h4>
          <div style={{ fontSize: 10.5, color: '#64748b' }}>
            BAU base, scenario, target & total; Basic may fall after upgrades to Safely Managed.
          </div>
        </div>
        <ChartExport chartRef={chartRef} filename={filename} title={title} compact
          sheets={[{ name: 'Data', headers: ['Year', 'BAU (basic)', ...lines.map(l => l.name)],
            rows: data.map(r => [r.year, r.bau, r.scenario, r.target, r.total]) }]}
          chartSpec={{ category: 'Year', areas: [{ name: 'BAU (basic)', color: C.bauFill }],
            lines: lines.map(l => ({ name: l.name, color: l.color, dash: !!l.dash })),
            yTitle: yLabel, xTitle: 'Year' }} />
      </div>
      <div ref={chartRef} style={{ background: '#fff' }}>
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 10, right: 24, bottom: 5, left: 12 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(data)} />
            <YAxis tick={{ fontSize: 10 }} domain={domain} tickFormatter={fmt}>
              <Label value={yLabel} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
            </YAxis>
            <Tooltip formatter={(v: any) => fmt(+v) as any} labelFormatter={(y: any) => String(y)} contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} content={linesFirstLegend} />
            <Area type="monotone" dataKey="bau" name="BAU (basic)" fill={C.bauFill} stroke={C.bau}
              fillOpacity={0.7} strokeWidth={1.25} legendType="rect" isAnimationActive={false} />
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