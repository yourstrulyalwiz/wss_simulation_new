import React from 'react';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ComposedChart, Line
} from 'recharts';

const COLORS = {
  bau: '#014972',
  target: '#009CA7',
  gap: '#ef4444',
  ce_nrw: '#4C809C',
  capeff: '#f59e0b',
  tariff: '#8b5cf6',
  microfinance: '#06b6d4',
  compare: '#4C809C',
  inv_need: '#ef4444',
  bau_inv: '#014972',
};

interface ServiceGapChartProps {
  years: number[];
  targetHH: number[];
  bauHH: number[];
  interventions: { name: string; data: number[]; color: string; }[];
  title: string;
  startYear: number;
  compareBauHH?: number[];
  compareName?: string;
}

export function ServiceGapChart({ years, targetHH, bauHH, interventions, title, startYear, compareBauHH, compareName }: ServiceGapChartProps) {
  const startIdx = Math.max(0, years.indexOf(startYear));
  const data = years.slice(startIdx).map((year, i) => {
    const idx = startIdx + i;
    const row: any = { year };
    row['BAU'] = bauHH[idx] || 0;
    for (const interv of interventions) {
      row[interv.name] = interv.data[idx] || 0;
    }
    row['Target'] = targetHH[idx] || 0;
    if (compareBauHH) row[compareName || 'Scenario B'] = compareBauHH[idx] || 0;
    return row;
  });

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <ComposedChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: 'HH (millions)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <Tooltip formatter={(value: any) => (+(value ?? 0)).toFixed(4)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="BAU" stackId="1" fill={COLORS.bau} stroke={COLORS.bau} fillOpacity={0.6} />
          {interventions.map(interv => (
            <Area key={interv.name} type="monotone" dataKey={interv.name} stackId="1"
              fill={interv.color} stroke={interv.color} fillOpacity={0.7} />
          ))}
          <Line type="monotone" dataKey="Target" stroke={COLORS.target} strokeWidth={2.5}
            dot={false} strokeDasharray="6 3" />
          {compareBauHH && <Line type="monotone" dataKey={compareName || 'Scenario B'}
            stroke={COLORS.compare} strokeWidth={2} dot={false} strokeDasharray="4 4" />}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

interface FinancingGapChartProps {
  years: number[];
  investmentNeed: number[];
  bauInvestment: number[];
  intervInvestment?: number[];
  title: string;
  startYear: number;
  compareInvNeed?: number[];
  compareBauInv?: number[];
  compareName?: string;
}

export function FinancingGapChart({ years, investmentNeed, bauInvestment, intervInvestment, title, startYear, compareInvNeed, compareBauInv, compareName }: FinancingGapChartProps) {
  const startIdx = Math.max(0, years.indexOf(startYear));
  const data = years.slice(startIdx).map((year, i) => {
    const idx = startIdx + i;
    const row: any = {
      year,
      'Investment Need': (investmentNeed[idx] || 0) / 1000,
      'BAU Investment': (bauInvestment[idx] || 0) / 1000,
    };
    if (intervInvestment) row['Intervention Cash'] = (intervInvestment[idx] || 0) / 1000;
    if (compareInvNeed) row[`${compareName || 'B'} Inv Need`] = (compareInvNeed[idx] || 0) / 1000;
    if (compareBauInv) row[`${compareName || 'B'} BAU Inv`] = (compareBauInv[idx] || 0) / 1000;
    return row;
  });

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: 'Billions', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <Tooltip formatter={(value: any) => (+(value ?? 0)).toFixed(2)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Investment Need" fill={COLORS.inv_need} opacity={0.7} />
          <Bar dataKey="BAU Investment" stackId="funding" fill={COLORS.bau_inv} opacity={0.7} />
          {intervInvestment && <Bar dataKey="Intervention Cash" stackId="funding" fill={COLORS.ce_nrw} opacity={0.7} />}
          {compareInvNeed && <Bar dataKey={`${compareName || 'B'} Inv Need`} fill={COLORS.compare} opacity={0.5} />}
          {compareBauInv && <Bar dataKey={`${compareName || 'B'} BAU Inv`} fill="#94a3b8" opacity={0.5} />}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

interface CumulativeChartProps {
  years: number[];
  cumulativeNeed: number[];
  cumulativeBau: number[];
  title: string;
  startYear: number;
}

export function CumulativeChart({ years, cumulativeNeed, cumulativeBau, title, startYear }: CumulativeChartProps) {
  const startIdx = Math.max(0, years.indexOf(startYear));
  const data = years.slice(startIdx).map((year, i) => {
    const idx = startIdx + i;
    return {
      year,
      'Cumulative Need': (cumulativeNeed[idx] || 0) / 1000,
      'Cumulative BAU': (cumulativeBau[idx] || 0) / 1000,
    };
  });

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8, fontWeight: 600 }}>{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} label={{ value: 'Billions', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
          <Tooltip formatter={(value: any) => (+(value ?? 0)).toFixed(2)} contentStyle={{ fontSize: 12 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="Cumulative Need" fill={COLORS.inv_need} stroke={COLORS.inv_need} fillOpacity={0.3} />
          <Area type="monotone" dataKey="Cumulative BAU" fill={COLORS.bau_inv} stroke={COLORS.bau_inv} fillOpacity={0.3} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface WaterfallChartProps {
  serviceGap: number;
  interventions: { name: string; value: number; color: string; }[];
  title: string;
  targetYear: number;
}

export function WaterfallChart({ serviceGap, interventions, title, targetYear }: WaterfallChartProps) {
  const totalClosed = interventions.reduce((s, i) => s + i.value, 0);
  const remaining = Math.max(0, serviceGap - totalClosed);
  const pctClosed = serviceGap > 0 ? (totalClosed / serviceGap * 100) : 0;

  const items = [
    { name: `Gap (${targetYear})`, value: serviceGap, color: '#ef4444', isGap: true },
    ...interventions.map(i => ({ ...i, isGap: false })),
    { name: 'Remaining Gap', value: remaining, color: '#fca5a5', isGap: true },
  ];

  const maxVal = serviceGap;
  const barWidth = 100;

  return (
    <div style={{ marginBottom: 32 }}>
      <h3 style={{ fontSize: 14, marginBottom: 4, fontWeight: 600 }}>{title}</h3>
      <p style={{ fontSize: 11, color: '#64748b', marginBottom: 12 }}>
        {pctClosed.toFixed(0)}% of the service gap closed by interventions at {targetYear}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {items.map((item, i) => {
          const width = maxVal > 0 ? Math.max(1, (Math.abs(item.value) / maxVal) * barWidth) : 0;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 180, fontSize: 11, color: '#374151', textAlign: 'right', flexShrink: 0 }}>{item.name}</span>
              <div style={{ flex: 1, position: 'relative', height: 22 }}>
                <div style={{
                  width: `${width}%`, height: '100%', borderRadius: 3,
                  background: item.color, opacity: item.isGap ? 0.6 : 0.85,
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
                }}>
                  {width > 15 && <span style={{ fontSize: 10, color: '#fff', fontWeight: 600 }}>
                    {(item.value * 1000000).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} HH
                  </span>}
                </div>
              </div>
              <span style={{ fontSize: 10, color: '#64748b', width: 70, textAlign: 'right' }}>
                {item.value.toFixed(4)} M
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { COLORS };
