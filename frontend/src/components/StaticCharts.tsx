import React from 'react';
import {
  Area, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ComposedChart, Line, Label
} from 'recharts';

const allYears = [2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030,2031,2032,2033,2034,2035,2036,2037,2038,2039,2040];

// Geographic scope scaling factors (urban is largest, rural smaller, national = sum)
const SCOPE_FACTORS: Record<string, { total: number; bau: number; tgt: number }> = {
  urban:       { total: 1.0,  bau: 1.0,  tgt: 1.0 },
  rural:       { total: 0.65, bau: 0.45, tgt: 0.55 },
  // Urban + Rural is entered separately then aggregated, so it equals the national sum
  urban_rural: { total: 1.65, bau: 1.45, tgt: 1.55 },
  national:    { total: 1.65, bau: 1.45, tgt: 1.55 },
};

function scopeLabelFor(geoScope: string) {
  return geoScope === 'national' ? 'National'
    : geoScope === 'rural' ? 'Rural'
    : geoScope === 'urban_rural' ? 'Urban + Rural'
    : 'Urban';
}

function makeBAUData(sector: 'water' | 'sanitation', geoScope: string) {
  const f = SCOPE_FACTORS[geoScope] || SCOPE_FACTORS.urban;
  const baseBau = sector === 'water' ? 0.4 : 0.25;
  const bauSlope = sector === 'water' ? 0.5 : 0.4;
  const tgtStart = 2027;                                   // performance improvement begins
  const tgtEnd = allYears[allYears.length - 1];            // target reaches 100% (total HHs) here
  return allYears.map((y) => {
    const t = (y - 2020) / 20;
    const totalHH = (0.8 + t * 0.7) * f.total;
    const bauHH = (baseBau + t * 0.4 * bauSlope) * f.bau;
    // Target ramps from the BAU line at tgtStart up to the Total-households line (100%) at tgtEnd
    const frac = y <= tgtStart ? 0 : Math.min(1, (y - tgtStart) / (tgtEnd - tgtStart));
    const targetHH = bauHH + frac * (totalHH - bauHH);
    return {
      year: y,
      'Total households': +totalHH.toFixed(2),
      'Households under BAU': +bauHH.toFixed(2),
      'Target': +targetHH.toFixed(2),
    };
  });
}

export function BAUForecastChart({ sector = 'water', geoScope = 'urban' }: { sector?: 'water' | 'sanitation'; geoScope?: string }) {
  const data = makeBAUData(sector, geoScope);
  const sectorLabel = sector === 'water' ? 'Water Supply' : 'Sanitation';
  const scopeLabel = scopeLabelFor(geoScope);
  const serviceLabel = sector === 'water' ? 'treated, piped water' : 'safely managed sanitation';
  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 6, fontWeight: 600, color: '#1e3a5f' }}>
        {scopeLabel} {sectorLabel} — BAU Service Gap
      </h3>
      <div style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', padding: '4px 8px', borderRadius: 4, marginBottom: 8 }}>
        Static example data — {scopeLabel} scope
      </div>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, (geoScope === 'national' || geoScope === 'urban_rural') ? 3 : 1.6]}>
            <Label value="# households (millions)" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
          </YAxis>
          <Tooltip formatter={(value: any) => (+(value ?? 0)).toFixed(2) + 'M'} contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {/* BAU shaded area — box legend */}
          <Area type="monotone" dataKey="Households under BAU" fill="#7dd3fc" stroke="#0ea5e9" fillOpacity={0.55} legendType="rect"
            name={`Households with ${serviceLabel} under BAU`} />
          {/* Total HHs dashed line — line legend */}
          <Line type="monotone" dataKey="Total households" stroke="#6b7280" strokeWidth={2.5} dot={false} legendType="plainline"
            strokeDasharray="8 4" name="Total households" />
          {/* Target line — line legend */}
          <Line type="monotone" dataKey="Target" stroke="#16a34a" strokeWidth={3} dot={false} legendType="plainline"
            name="Target" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Intervention Impact Charts ───
export interface IntvActive { collectionNrw: boolean; capital: boolean; tariff: boolean }
const ALL_ACTIVE: IntvActive = { collectionNrw: true, capital: true, tariff: true };

function makeIntvData(sector: 'water' | 'sanitation', geoScope: string, active: IntvActive) {
  const f = SCOPE_FACTORS[geoScope] || SCOPE_FACTORS.urban;
  const baseBau = sector === 'water' ? 0.4 : 0.25;
  const bauSlope = sector === 'water' ? 0.5 : 0.4;
  const ceSlope = sector === 'water' ? 0.025 : 0.015;
  const capSlope = sector === 'water' ? 0.018 : 0.012;
  const tarSlope = sector === 'water' ? 0.012 : 0.008;
  const tgtStart = 2027;                                   // performance improvement begins
  const tgtEnd = allYears[allYears.length - 1];            // target reaches 100% (total HHs) here
  return allYears.map((y) => {
    const t = (y - 2020) / 20;
    const intv = y <= 2027 ? 0 : (y - 2027);
    const totalHH = (0.8 + t * 0.7) * f.total;
    const bauHH = (baseBau + t * 0.4 * bauSlope) * f.bau;
    // Only count the contribution of interventions that are switched on
    const ce  = active.collectionNrw ? intv * ceSlope  * f.tgt : 0;
    const cap = active.capital       ? intv * capSlope * f.tgt : 0;
    const tar = active.tariff        ? intv * tarSlope * f.tgt : 0;
    // Target ramps from the BAU line at tgtStart up to the Total-households line (100%) at tgtEnd
    const tFrac = y <= tgtStart ? 0 : Math.min(1, (y - tgtStart) / (tgtEnd - tgtStart));
    return {
      year: y,
      'Total households': +totalHH.toFixed(2),
      'BAU': +bauHH.toFixed(2),
      'Collection & NRW': +ce.toFixed(3),
      'Capital efficiency': +cap.toFixed(3),
      'Tariff increase': +tar.toFixed(3),
      'Target': +(bauHH + tFrac * (totalHH - bauHH)).toFixed(2),
    };
  });
}

const INTV_COLORS = {
  'BAU': '#4C809C',            // World Bank slate
  'Collection & NRW': '#009CA7', // World Bank teal
  'Capital efficiency': '#6366f1', // indigo
  'Tariff increase': '#f59e0b',   // amber
};

export function InterventionImpactChart({ sector = 'water', geoScope = 'urban', active = ALL_ACTIVE }: { sector?: 'water' | 'sanitation'; geoScope?: string; active?: IntvActive }) {
  const data = makeIntvData(sector, geoScope, active);
  const sectorLabel = sector === 'water' ? 'Water Supply' : 'Sanitation';
  const scopeLabel = scopeLabelFor(geoScope);
  const serviceLabel = sector === 'water' ? 'treated, piped water' : 'safely managed sanitation';
  return (
    <div>
      <h3 style={{ fontSize: 14, marginBottom: 6, fontWeight: 600, color: '#1e3a5f' }}>
        {scopeLabel} {sectorLabel} — Service Gap After Interventions
      </h3>
      <div style={{ fontSize: 10, color: '#92400e', background: '#fef3c7', padding: '4px 8px', borderRadius: 4, marginBottom: 8 }}>
        Static example data — {scopeLabel} scope
      </div>
      <div style={{ fontSize: 11, color: '#475569', background: '#f1f5f9', padding: '6px 10px', borderRadius: 4, marginBottom: 10, lineHeight: 1.5 }}>
        Each band is one intervention, measured in <strong>households (millions)</strong>. It shows the <strong>additional households you could extend service to</strong> using the funds that intervention frees up or mobilises (e.g. revenue recovered, costs saved, or financing raised), stacked on top of the BAU coverage.
      </div>
      <ResponsiveContainer width="100%" height={380}>
        <ComposedChart data={data} margin={{ top: 10, right: 20, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} domain={[0, (geoScope === 'national' || geoScope === 'urban_rural') ? 3 : 1.6]}>
            <Label value="# households (millions)" angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
          </YAxis>
          <Tooltip formatter={(value: any) => (+(value ?? 0)).toFixed(3) + 'M'} contentStyle={{ fontSize: 11 }} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          {/* Stacked intervention areas — only the switched-on ones are drawn */}
          <Area type="monotone" dataKey="BAU" stackId="1" fill={INTV_COLORS['BAU']} stroke="#94a3b8" fillOpacity={0.75} legendType="rect"
            name={`Households with ${serviceLabel} under BAU`} />
          {active.collectionNrw && <Area type="monotone" dataKey="Collection & NRW" stackId="1" fill={INTV_COLORS['Collection & NRW']} stroke={INTV_COLORS['Collection & NRW']} fillOpacity={0.75} legendType="rect"
            name="Increased collection efficiency & NRW reduction" />}
          {active.capital && <Area type="monotone" dataKey="Capital efficiency" stackId="1" fill={INTV_COLORS['Capital efficiency']} stroke={INTV_COLORS['Capital efficiency']} fillOpacity={0.75} legendType="rect"
            name="Increased efficiency in capital expenditure" />}
          {active.tariff && <Area type="monotone" dataKey="Tariff increase" stackId="1" fill={INTV_COLORS['Tariff increase']} stroke={INTV_COLORS['Tariff increase']} fillOpacity={0.75} legendType="rect"
            name="Tariff increase" />}
          {/* Total HHs dashed line — line legend */}
          <Line type="monotone" dataKey="Total households" stroke="#6b7280" strokeWidth={2.5} dot={false} legendType="plainline"
            strokeDasharray="8 4" name="Total households" />
          {/* Target line — line legend */}
          <Line type="monotone" dataKey="Target" stroke="#16a34a" strokeWidth={3} dot={false} legendType="plainline"
            name="Target" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
