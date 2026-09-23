import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label, ReferenceLine,
} from 'recharts';
import ChartExport from './ChartExport';

/**
 * Live intervention-impact chart. INCREMENTAL multi-pass compare: it POSTs /api/calculate once for the
 * pure BAU (every toggle off), then once more for each enabled intervention added CUMULATIVELY on top.
 * The marginal safely-managed households each pass adds become a STACKED band, one colour per
 * intervention, sitting on the grey BAU base — so the coloured stack is the extra coverage the enabled
 * interventions deliver, and the top of the stack is the full with-intervention scenario. Replaces the
 * old synthetic StaticCharts.InterventionImpactChart.
 */
import { C, INTV_PALETTE as P } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import { linesFirstLegend } from './chartLegend';

type Intv = [key: string, label: string, color: string];   // toggle key, legend label, band colour
// Band palette excludes blue (BAU) and green (target) so those meanings stay reserved (see chartColors).
const WATER_INTV: Intv[] = [
  ['ws_financial_commitment_enabled', 'Financial commitments', P.financial],
  ['ws_exogenous_injection_enabled', 'Exogenous injection of funds', P.injection],
  ['ws_collection_efficiency_enabled', 'Collection efficiency', P.collection],
  ['ws_capital_efficiency_enabled', 'Budget execution', P.budgetExec],
  ['ws_costeff_enabled', 'Capex efficiency', P.capex],
  ['ws_techmix_enabled', 'Optimised technology', P.techmix],
  ['ws_nrw_enabled', 'NRW reduction', P.nrw],
  ['ws_tariff_enabled', 'Tariff reform', P.tariff],
  ['ws_microfinance_enabled', 'Microfinance', P.microfinance],
];
const SAN_INTV: Intv[] = [
  ['san_financial_commitment_enabled', 'Financial commitments', P.financial],
  ['san_exogenous_injection_enabled', 'Exogenous injection of funds', P.injection],
  ['san_collection_efficiency_enabled', 'Collection efficiency', P.collection],
  ['san_capital_efficiency_enabled', 'Budget execution', P.budgetExec],
  ['san_costeff_enabled', 'Capex efficiency', P.capex],
  ['san_techmix_enabled', 'Optimised technology', P.techmix],
  ['san_nrw_link_enabled', 'NRW-linked revenue', P.nrw],
  ['san_tariff_enabled', 'Tariff reform', P.tariff],
  ['san_microfinance_enabled', 'Microfinance', P.microfinance],
];

const zeroToggles = (t: any) => Object.fromEntries(Object.keys(t || {}).map(k => [k, false]));
const sig = (v: number) => (!isFinite(v) || v === 0) ? '0' : Number(v.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
const sigSmall = (v: number) => (!isFinite(v) || v === 0) ? '0' : Number(v.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 9 });

export default function LiveInterventionChart({ inputs, sector, scopeLabel, rung = 0 }: {
  inputs: any; sector: 'water' | 'sanitation'; scopeLabel?: string; rung?: 0 | 1;
}) {
  // Investment can now be directed at either rung, so the chart is drawn per rung: 0 = safely managed,
  // 1 = basic. The engine returns every rung, so only the row index and the labels change.
  const rungName = rung === 0 ? 'safely-managed' : 'basic';
  const baseKey = `BAU (${rungName})`;
  const scenarioKey = `With interventions (${rungName})`;
  const [data, setData] = useState<any[]>([]);
  const [bands, setBands] = useState<Intv[]>([]);   // interventions that actually contribute, in stack order
  const [summary, setSummary] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  // Unit toggle, matching the BAU chart and the Results dashboard: absolute households or share of
  // population. The engine always returns household counts; share mode is a pure display conversion.
  const [unitMode, setUnitMode] = useState<'count' | 'share'>('count');
  // Display-only x-axis window. These values are local UI state and are never written into model inputs.
  const [chartStart, setChartStart] = useState<number | null>(null);
  const [chartEnd, setChartEnd] = useState<number | null>(null);

  const depKey = JSON.stringify(inputs) + '|' + sector;
  useEffect(() => {
    if (!inputs) return;
    const list = sector === 'water' ? WATER_INTV : SAN_INTV;
    const enabled = list.filter(([k]) => inputs?.toggles?.[k]);
    // Enabled CUSTOM interventions that apply to this sector become trailing bands after the built-in ones.
    const enabledCustoms: any[] = (inputs?.custom_interventions || [])
      .filter((c: any) => c && c.enabled !== false && (c.sector === sector || c.sector === 'both'));
    let cancelled = false;
    const h = setTimeout(() => {
      const post = (body: any) => fetch('/api/calculate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }).then(r => { if (!r.ok) throw new Error('calc failed (' + r.status + ')'); return r.json(); });
      const secOf = (res: any) => sector === 'water' ? res.water_supply : res.sanitation;
      const off = zeroToggles(inputs?.toggles);
      // Cross-sector prerequisite: the sanitation "NRW-linked revenue" lever only has recovered water to
      // charge for when the WATER NRW lever is on, so keep ws_nrw_enabled at the user's setting in every
      // sanitation pass (it doesn't affect any of the other sanitation levers). Without this the linked
      // band would always read 0 on the sanitation chart even with water NRW switched on.
      if (sector === 'sanitation') off.ws_nrw_enabled = !!inputs?.toggles?.ws_nrw_enabled;
      // Cumulative payloads: [BAU] → +each toggle → +each custom. The baseline and toggle passes carry NO
      // customs (custom_interventions:[]) so the grey base is the pure BAU and customs show as their own
      // bands on top; customs are then added one-by-one over all toggles.
      const payloads: any[] = [{ ...inputs, toggles: off, custom_interventions: [] }];
      let acc: any = { ...off };
      enabled.forEach(([k]) => { acc = { ...acc, [k]: true }; payloads.push({ ...inputs, toggles: { ...acc }, custom_interventions: [] }); });
      let accCustoms: any[] = [];
      enabledCustoms.forEach((c: any) => { accCustoms = [...accCustoms, c]; payloads.push({ ...inputs, toggles: { ...acc }, custom_interventions: accCustoms }); });
      // Combined stack order (toggles then customs) with UNIQUE labels for the chart dataKeys.
      const bandDefs: Intv[] = [...enabled];
      const seen = new Set<string>(enabled.map(([, label]) => label));
      enabledCustoms.forEach((c: any, i: number) => {
        let label = ((c.name || '').trim()) || `Custom ${i + 1}`;
        while (seen.has(label)) label += ' ';
        seen.add(label);
        bandDefs.push([`custom_${i}`, label, c.color || P.custom]);
      });
      Promise.all(payloads.map(post)).then(results => {
        const years: number[] = results[0].years;
        // The engine returns a PURE BAU (`bau_hh`, invariant) plus the SCENARIO safely-managed path under
        // that pass's toggles+customs (`scenario_hh`). Grey base = pure BAU; each pass's scenario_hh gives
        // the extra SM its newly-added lever delivers (sm[p+1] − sm[p] for band p, in payload order).
        const bauBase = secOf(results[0]).bau_hh[rung];              // pure BAU (same in every pass)
        const sm = results.map((r: any) => secOf(r).scenario_hh[rung]); // rung WITH the pass's levers
        const rows = years.map((y: number, i: number) => {
          const row: any = { year: +y, [baseKey]: +(+bauBase[i]).toFixed(6),
            [scenarioKey]: +(+sm[sm.length - 1][i]).toFixed(6),
            'Total households': +(+results[0].total_hh[i]).toFixed(6) };
          bandDefs.forEach(([, label], p) => { row[label] = +(sm[p + 1][i] - sm[p][i]).toFixed(6); });
          return row;
        });
        const contributing = bandDefs.filter(([, label]) => rows.some((r: any) => Math.abs(r[label]) > 0));
        if (cancelled) return;
        setData(rows);
        setBands(contributing);
        const full = secOf(results[results.length - 1]);            // all enabled toggles + customs applied
        const bau = secOf(results[0]);
        const e = years.length - 1;
        const cum = (a: number[]) => (a || []).reduce((s: number, v: number) => s + (+v || 0), 0);
        setSummary({
          // Compare the full-scenario SM / gap against the PURE BAU (bau_hh / financing_gap).
          endline: years[e], addHH: (+full.scenario_hh[rung][e]) - (+bau.bau_hh[rung][e]),
          gapBau: cum(bau.financing_gap), gapIntv: cum(full.scenario_financing_gap),
          cur: inputs?.country_config?.currency || 'LCU',
          funding: enabled.slice(0, 2).filter(([key]) => key.endsWith('_financial_commitment_enabled') || key.endsWith('_exogenous_injection_enabled'))
            .map(([key, label]) => ({
              label, amount: cum(full[key.endsWith('_financial_commitment_enabled')
                ? 'scenario_financial_commitment_cash' : 'scenario_exogenous_injection_cash'] || []),
              hasOutcome: rows.some((row: any) => Math.abs(row[label]) > 0),
            })),
        });
        setError(null);
      }).catch((err: any) => { if (!cancelled) setError(String(err)); });
    }, 350);
    return () => { cancelled = true; clearTimeout(h); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, rung]);

  const sectorLabel = sector === 'water' ? 'Water Supply' : 'Sanitation';
  const chartRef = useRef<HTMLDivElement>(null);
  const isShare = unitMode === 'share';
  // Share mode divides the BAU base, every intervention band and the ceiling by that year's total
  // households, so the stack still adds up and the ceiling becomes a flat 100%. One household size
  // is used throughout the model, so the household share is also the share of population.
  const displayData = useMemo(() => {
    if (!isShare) return data;
    return data.map((r: any) => {
      const tot = r['Total households'] || 0;
      const d = (v: number) => (tot > 0 ? (+v || 0) / tot : 0);
       const o: any = { year: r.year, 'Total households': tot > 0 ? 1 : 0,
         [baseKey]: d(r[baseKey]), [scenarioKey]: d(r[scenarioKey]) };
      bands.forEach(([, label]) => { o[label] = d(r[label]); });
      return o;
    });
  }, [data, bands, isShare]);
  const visibleData = useMemo(() => {
    if (!displayData.length) return displayData;
    const lo = chartStart ?? displayData[0].year;
    const hi = chartEnd ?? displayData[displayData.length - 1].year;
    return displayData.filter((r: any) => r.year >= lo && r.year <= hi);
  }, [displayData, chartStart, chartEnd]);
  const availableYears = data.map((r: any) => r.year as number);
  const fmtAxis = (v: number) => (isShare ? Math.round(v * 100) + '%' : sig(v));
  const fmtVal = (v: number) => (isShare ? (v * 100).toFixed(1) + '%' : sig(v) + ' M');
  // Exclusive Basic households may decline when households upgrade. A negative band cannot
  // be stacked on top of BAU as an added household area; show signed deltas below instead.
  const useStack = rung === 0 && !bands.some(([, label]) => data.some(r => r[label] < 0));
  // Data series behind the chart, for the "⤓ Excel" export: Year, BAU base, each band, and the ceiling.
  const exportHeaders = ['Year', baseKey, scenarioKey, ...bands.map(([, label]) => label), 'Total households'];
  const exportRows = visibleData.map((r: any) => [r.year, r[baseKey], r[scenarioKey], ...bands.map(([, label]) => r[label] ?? 0), r['Total households']]);
  // Native Excel chart: grey BAU base + each contributing intervention band as stacked areas, ceiling as a line.
  const chartSpec = {
    category: 'Year', stacked: useStack,
    areas: useStack ? [{ name: baseKey, color: C.bauFill }, ...bands.map(([, label, color]) => ({ name: label, color }))] : [],
    lines: [...(useStack ? [] : [{ name: baseKey, color: C.bau }]),
      { name: scenarioKey, color: C.scenario }, { name: 'Total households', color: C.total, dash: true }],
    yTitle: isShare ? '% of population' : '# households (millions)', xTitle: 'Year',
  };
  const fileBase = `${scopeLabel ? scopeLabel + '_' : ''}${sector}_${rung === 0 ? 'sm' : 'basic'}_intervention_impact`;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <h3 style={{ fontSize: 14, margin: 0, fontWeight: 600, color: '#1e3a5f' }}>
          {scopeLabel ? scopeLabel + ' ' : ''}{sectorLabel} — {rungName} impact (live)
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {availableYears.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, color: '#475569' }}>
              <span style={{ fontWeight: 600 }}>Years</span>
              <select aria-label="Chart start year" value={chartStart ?? availableYears[0]}
                onChange={e => {
                  const v = +e.target.value; setChartStart(v);
                  if (chartEnd !== null && v > chartEnd) setChartEnd(v);
                }}
                style={{ padding: '3px 5px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', fontSize: 10.5 }}>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span>to</span>
              <select aria-label="Chart end year" value={chartEnd ?? availableYears[availableYears.length - 1]}
                onChange={e => {
                  const v = +e.target.value; setChartEnd(v);
                  if (chartStart !== null && v < chartStart) setChartStart(v);
                }}
                style={{ padding: '3px 5px', border: '1px solid #cbd5e1', borderRadius: 4, background: '#fff', fontSize: 10.5 }}>
                {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {(chartStart !== null || chartEnd !== null) &&
                <button onClick={() => { setChartStart(null); setChartEnd(null); }}
                  style={{ border: 'none', background: 'transparent', color: '#2563eb', fontSize: 10, cursor: 'pointer', padding: '2px 3px' }}>
                  Reset
                </button>}
            </div>
          )}
          <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            {([['count', '# Households'], ['share', '% of population']] as const).map(([m, l]) => (
              <button key={m} onClick={() => setUnitMode(m)} style={{
                padding: '4px 9px', fontSize: 10.5, border: 'none', cursor: 'pointer',
                background: unitMode === m ? '#2563eb' : '#fff', color: unitMode === m ? '#fff' : '#475569',
                fontWeight: unitMode === m ? 700 : 500,
              }}>{l}</button>
            ))}
          </div>
          <ChartExport chartRef={chartRef} filename={fileBase} title={`${sectorLabel} — intervention impact`}
            sheets={[{ name: `${sectorLabel} impact`, headers: exportHeaders, rows: exportRows }]} chartSpec={chartSpec} compact />
        </div>
      </div>
      <div style={{ fontSize: 10, color: '#334155', background: '#f1f5f9', padding: '4px 8px', borderRadius: 4, marginBottom: 8 }}>
        Live engine output. Effects are marginal to earlier enabled levers, not standalone effects. Funding amounts below are independently additive; where a rung can decline, signed effects are shown separately.
      </div>
      {error && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
      {summary && (
        <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `3px solid ${C.scenario}`, borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, marginBottom: 10 }}>
          <b>Impact.</b> By {summary.endline}, the enabled interventions change {rungName} coverage by <b>{sigSmall(summary.addHH)} M</b> households and change the cumulative financing gap from <b>{sig(summary.gapBau)}</b> to <b>{sig(summary.gapIntv)} M {summary.cur}</b>
          {summary.gapBau > 0 && <> (a <b>{Math.round((1 - summary.gapIntv / summary.gapBau) * 100)}%</b> reduction)</>}.
        </div>
      )}
      {summary?.funding?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {summary.funding.map((f: any) => (
            <div key={f.label} style={{ border: '1px solid #dbeafe', borderRadius: 6, background: '#f8fbff', padding: '7px 10px', fontSize: 11, color: '#334155' }}>
              <b>{f.label}</b>: {sigSmall(f.amount / 1000)} B {summary.cur} added capital
              {!f.hasOutcome && <span style={{ display: 'block', color: '#92400e', marginTop: 2 }}>
                No additional {rungName} coverage after earlier levers; the funding is still included.
              </span>}
            </div>
          ))}
          {summary.funding.length > 1 && <div style={{ alignSelf: 'center', fontSize: 11, color: '#1e3a5f', fontWeight: 700 }}>
            Combined added capital: {sigSmall(summary.funding.reduce((n: number, f: any) => n + f.amount, 0) / 1000)} B {summary.cur}
          </div>}
        </div>
      )}
      <div ref={chartRef} style={{ background: '#fff' }}>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={visibleData} margin={{ top: 14, right: 24, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(visibleData)} />
          <YAxis tick={{ fontSize: 10 }} domain={isShare ? [0, 1] : undefined} tickFormatter={fmtAxis}>
            <Label value={isShare ? '% of population' : '# households (millions)'} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
          </YAxis>
          <Tooltip formatter={(v: any) => fmtVal(+v)} contentStyle={{ fontSize: 11 }} />
          {/* Legend lists the Total-households line first, then the area fills (see chartLegend). Render
              order below stays areas-then-line so the line still draws on top; only the legend is reordered. */}
          <Legend wrapperStyle={{ fontSize: 10 }} content={linesFirstLegend} />
          {/* Grey BAU base, then one stacked band per contributing intervention. Animated transitions.
              Each band keeps a saturated same-colour top edge (width 1.75) so its boundary reads
              crisply against the lighter translucent band stacked above it — a shape cue on top of
              the hue. Stroke stays the band colour (not white) because recharts derives the legend
              swatch from stroke; the CVD-validated palette (see chartColors) carries identity, and
              the always-present legend is the secondary encoding. */}
          {useStack ? <>
            <Area type="monotone" dataKey={baseKey} stackId="s" fill={C.bauFill} stroke={C.bau} fillOpacity={0.7} strokeWidth={1.5} legendType="rect" isAnimationActive animationDuration={600} animationEasing="ease-out" />
            {bands.map(([k, label, color]) => (
              <Area key={k} type="monotone" dataKey={label} stackId="s" fill={color} stroke={color} fillOpacity={0.6} strokeWidth={1.75} strokeOpacity={1} legendType="rect" isAnimationActive animationDuration={600} animationEasing="ease-out" />
            ))}
          </> : <Line type="monotone" dataKey={baseKey} stroke={C.bau} strokeWidth={2} dot={false} isAnimationActive={false} />}
          <Line type="monotone" dataKey={scenarioKey} stroke={C.scenario} strokeWidth={2} dot={false} isAnimationActive={false} />
          {/* Total households — the coverage ceiling, drawn on top (not stacked). */}
          <Line type="monotone" dataKey="Total households" stroke={C.total} strokeWidth={1.5} strokeDasharray="6 4" dot={false} legendType="plainline" isAnimationActive animationDuration={600} />
        </ComposedChart>
      </ResponsiveContainer>
      {!useStack && bands.length > 0 && <>
        <div style={{ fontSize: 11, fontWeight: 600, color: '#475569', padding: '4px 8px' }}>Signed change from each intervention (+ gain / − decline)</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={visibleData} margin={{ top: 8, right: 24, bottom: 4, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(visibleData)} />
            <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtAxis} />
            <Tooltip formatter={(v: any) => fmtVal(+v)} contentStyle={{ fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#64748b" strokeWidth={1.5} />
            {bands.map(([k, label, color]) => (
              <Line key={k} type="monotone" dataKey={label} stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </>}
      </div>
    </div>
  );
}
