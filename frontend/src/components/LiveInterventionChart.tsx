import React, { useEffect, useMemo, useRef, useState } from 'react';
import { REVENUE_ATTRIBUTION } from './RevenueBase';
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Label,
} from 'recharts';
import ChartExport from './ChartExport';
import { runCalculation } from '../api';
import ServiceAccessGaps from './ServiceAccessGaps';
import { serviceAccessRows, type AccessRow } from '../serviceAccess';

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
import { resolveChartWindow } from '../chartWindow';
import { linesFirstLegend } from './chartLegend';
import { aggregateContributionRows, type ContributionView, type ViewBand } from '../contributionView';
import { convertMoney, currencyRateNote, type CurrencyDisplaySettings } from '../currencyDisplay';
import { connectionRevenueAreaModes, connectionRevenueModeText } from '../connectionRevenueMode';

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

export default function LiveInterventionChart({ inputs, sector, scopeLabel, rung = 0, contributionView, currencyDisplay }: {
  inputs: any; sector: 'water' | 'sanitation'; scopeLabel?: string; rung?: 0 | 1; contributionView: ContributionView; currencyDisplay: CurrencyDisplaySettings;
}) {
  // Investment can now be directed at either rung, so the chart is drawn per rung: 0 = safely managed,
  // 1 = basic. The engine returns every rung, so only the row index and the labels change.
  const rungName = rung === 0 ? 'safely-managed' : 'basic';
  const baseKey = `BAU (${rungName})`;
  const [data, setData] = useState<any[]>([]);
  const [bands, setBands] = useState<Intv[]>([]);   // interventions that actually contribute, in stack order
  const [summary, setSummary] = useState<any>(null);
  const [revenueModeLabel, setRevenueModeLabel] = useState('Effective revenue mode: awaiting calculation');
  const [accessRows, setAccessRows] = useState<AccessRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Unit toggle, matching the BAU chart and the Results dashboard: absolute households or share of
  // population. The engine always returns household counts; share mode is a pure display conversion.
  const [unitMode, setUnitMode] = useState<'count' | 'share'>('count');
  // Display-only x-axis window. These values are local UI state and are never written into model inputs.
  const [chartStartOverride, setChartStart] = useState<number | null>(null);
  const [chartEndOverride, setChartEnd] = useState<number | null>(null);

  const depKey = JSON.stringify(inputs) + '|' + sector;
  useEffect(() => {
    if (!inputs) return;
    const list = sector === 'water' ? WATER_INTV : SAN_INTV;
    const enabled = list.filter(([k]) => inputs?.toggles?.[k]);
    // Enabled CUSTOM interventions that apply to this sector become trailing bands after the built-in ones.
    const enabledCustoms: any[] = (inputs?.custom_interventions || [])
      .filter((c: any) => c && c.enabled !== false && (c.sector === sector || c.sector === 'both'));
    const h = setTimeout(() => {
      const post = runCalculation;
      const secOf = (res: any) => sector === 'water' ? res.water_supply : res.sanitation;
      const off = zeroToggles(inputs?.toggles);
      const withoutDebt = (source: any) => ({
        ...(source || {}),
        water: { ...(source?.water || {}), enabled: false },
        sanitation: { ...(source?.sanitation || {}), enabled: false },
      });
      const includeDebt = ['water', 'sanitation'].some((k: string) =>
        !!inputs?.utility_debt?.[k]?.enabled && Number(inputs?.utility_debt?.[k]?.allocation_share || 0) > 0);
      // Cross-sector prerequisite: the sanitation "NRW-linked revenue" lever only has recovered water to
      // charge for when the WATER NRW lever is on, so keep ws_nrw_enabled at the user's setting in every
      // sanitation pass (it doesn't affect any of the other sanitation levers). Without this the linked
      // band would always read 0 on the sanitation chart even with water NRW switched on.
      if (sector === 'sanitation') off.ws_nrw_enabled = !!inputs?.toggles?.ws_nrw_enabled;
      // Cumulative payloads: [BAU] → +each toggle → +each custom. The baseline and toggle passes carry NO
      // customs (custom_interventions:[]) so the grey base is the pure BAU and customs show as their own
      // bands on top; customs are then added one-by-one over all toggles.
      const payloads: any[] = [{ ...inputs, toggles: off, custom_interventions: [], utility_debt: withoutDebt(inputs?.utility_debt) }];
      let acc: any = { ...off };
      enabled.forEach(([k]) => { acc = { ...acc, [k]: true }; payloads.push({ ...inputs, toggles: { ...acc }, custom_interventions: [], utility_debt: withoutDebt(inputs?.utility_debt) }); });
      let accCustoms: any[] = [];
      enabledCustoms.forEach((c: any) => { accCustoms = [...accCustoms, c]; payloads.push({ ...inputs, toggles: { ...acc }, custom_interventions: accCustoms, utility_debt: withoutDebt(inputs?.utility_debt) }); });
      // Combined stack order (toggles then customs) with UNIQUE labels for the chart dataKeys.
      const bandDefs: Intv[] = [...enabled];
      const seen = new Set<string>(enabled.map(([, label]) => label));
      enabledCustoms.forEach((c: any, i: number) => {
        let label = ((c.name || '').trim()) || `Custom ${i + 1}`;
        while (seen.has(label)) label += ' ';
        seen.add(label);
        bandDefs.push([`custom_${i}`, label, c.color || P.custom]);
      });
      const debtPayload = includeDebt ? {
        ...inputs, toggles: { ...acc }, custom_interventions: enabledCustoms,
        utility_debt: inputs.utility_debt,
      } : null;
      Promise.all(payloads.map(post).concat(debtPayload ? [post(debtPayload)] : [])).then(allResults => {
        const results = includeDebt ? allResults.slice(0, -1) : allResults;
        const debtResult = includeDebt ? allResults[allResults.length - 1] : null;
        setRevenueModeLabel(connectionRevenueModeText(connectionRevenueAreaModes(
          [results[0]], [inputs], sector === 'water' ? 'water_supply' : 'sanitation', sector,
        )).text);
        const years: number[] = results[0].years;
        // The engine returns a PURE BAU (`bau_hh`, invariant) plus the SCENARIO safely-managed path under
        // that pass's toggles+customs (`scenario_hh`). Grey base = pure BAU; each pass's scenario_hh gives
        // the extra SM its newly-added lever delivers (sm[p+1] − sm[p] for band p, in payload order).
        const bauBase = secOf(results[0]).bau_hh[rung];              // pure BAU (same in every pass)
        const sm = results.map((r: any) => secOf(r).scenario_hh[rung]); // rung WITH the pass's levers
        const rows = years.map((y: number, i: number) => {
          const row: any = { year: +y, [baseKey]: +(+bauBase[i]).toFixed(4), 'Total households': +(+results[0].total_hh[i]).toFixed(4) };
          bandDefs.forEach(([, label], p) => { row[label] = sm[p + 1][i] - sm[p][i]; });
          if (debtResult) {
            const noDebtFinal = sm[sm.length - 1][i];
            row['Utility debt financing'] = secOf(debtResult).scenario_hh[rung][i] - noDebtFinal;
          }
          return row;
        });
        if (debtResult) bandDefs.push(['utility_debt_financing', 'Utility debt financing', P.utilityDebt]);
        // Only stack levers that actually move the needle (an enabled-but-unparameterised one adds 0).
        const contributing = bandDefs.filter(([, label]) => rows.some((r: any) => Math.abs(r[label]) > 1e-12));
        setData(rows);
        setBands(contributing);
        const full = debtResult ? secOf(debtResult) : secOf(results[results.length - 1]); // all enabled toggles + customs, then utility debt
        setAccessRows(serviceAccessRows([debtResult || results[results.length - 1]],
          sector === 'water' ? 'water_supply' : 'sanitation', inputs.period.baseline_year));
        const bau = secOf(results[0]);
        const e = years.length - 1;
        const cum = (a: number[]) => (a || []).reduce((s: number, v: number) => s + (+v || 0), 0);
        setSummary({
          // Compare the full-scenario SM / gap against the PURE BAU (bau_hh / financing_gap).
          endline: years[e], addHH: (+full.scenario_hh[rung][e]) - (+bau.bau_hh[rung][e]),
          gapBau: bau.endline_financing_requirement[e], gapIntv: full.scenario_endline_financing_requirement[e],
          cur: inputs?.country_config?.currency || 'LCU',
        });
        setError(null);
      }).catch((err: any) => {
        setError(String(err)); setAccessRows([]); setSummary(null);
        setRevenueModeLabel('Effective revenue mode could not be confirmed because calculation failed.');
      });
    }, 350);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depKey, rung]);

  const sectorLabel = sector === 'water' ? 'Water Supply' : 'Sanitation';
  const chartRef = useRef<HTMLDivElement>(null);
  const isShare = unitMode === 'share';
  const sourceBands: ViewBand[] = useMemo(() => bands.map(([key, label, color]) => ({
    key: label, label, color, interventionKey: key.startsWith('custom_') ? undefined : key,
    custom: key.startsWith('custom_'),
  })), [bands]);
  const grouped = useMemo(() => contributionView === 'category'
    ? aggregateContributionRows(data, sourceBands) : { rows: data, bands: sourceBands },
    [data, contributionView, sourceBands]);
  const displayBands = grouped.bands.map(b => [b.key, b.label, b.color] as Intv);
  // Share mode divides the BAU base, every intervention band and the ceiling by that year's total
  // households, so the stack still adds up and the ceiling becomes a flat 100%. One household size
  // is used throughout the model, so the household share is also the share of population.
  const displayData = useMemo(() => {
    if (!isShare) return grouped.rows;
    return grouped.rows.map((r: any) => {
      const tot = r['Total households'] || 0;
      const d = (v: number) => (tot > 0 ? (+v || 0) / tot : 0);
      const o: any = { ...r, year: r.year, __source_total: tot, 'Total households': tot > 0 ? 1 : 0, [baseKey]: d(r[baseKey]) };
      displayBands.forEach(([key]) => { o[key] = d(r[key]); });
      return o;
    });
  }, [grouped.rows, displayBands, isShare]);
  const chartWindow = resolveChartWindow(data.map(r => r.year), inputs?.period,
    chartStartOverride, chartEndOverride);
  const chartStart = chartWindow.start, chartEnd = chartWindow.end;
  const visibleData = useMemo(() => {
    if (!displayData.length) return displayData;
    const lo = chartStart ?? displayData[0].year;
    const hi = chartEnd ?? displayData[displayData.length - 1].year;
    return displayData.filter((r: any) => r.year >= lo && r.year <= hi);
  }, [displayData, chartStart, chartEnd]);
  const availableYears = chartWindow.years;
  const fmtAxis = (v: number) => (isShare ? Math.round(v * 100) + '%' : sig(v));
  const fmtVal = (v: number) => (isShare ? (v * 100).toFixed(1) + '%' : sig(v) + ' M');
  // Data series behind the chart, for the "⤓ Excel" export: Year, BAU base, each band, and the ceiling.
  const exportHeaders = ['Year', baseKey, ...displayBands.map(([, label]) => label), 'Total households'];
  const exportRows = visibleData.map((r: any) => [r.year, r[baseKey], ...displayBands.map(([key]) => r[key] ?? 0), r['Total households']]);
  // Native Excel chart: grey BAU base + each contributing intervention band as stacked areas, ceiling as a line.
  const chartSpec = {
    category: 'Year', stacked: true,
    areas: [{ name: baseKey, color: C.bauFill }, ...displayBands.map(([, label, color]) => ({ name: label, color }))],
    lines: [{ name: 'Total households', color: C.total, dash: true }],
    yTitle: isShare ? '% of population' : '# households (millions)', xTitle: 'Year',
  };
  const fileBase = `${scopeLabel ? scopeLabel + '_' : ''}${sector}_${rung === 0 ? 'sm' : 'basic'}_intervention_impact_${contributionView === 'category' ? 'categories' : 'individual'}`;
  return (
    <div>
      <p title={REVENUE_ATTRIBUTION} style={{ fontSize: 11 }}>{contributionView === 'category' ? 'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.' : REVENUE_ATTRIBUTION}</p>
      <div style={{ fontSize: 10.5, color: '#334155', background: '#f0fdfa', borderLeft: '3px solid #0f766e', padding: '5px 8px', marginBottom: 6 }}>
        {revenueModeLabel}. Connection-based revenue is a baseline model, not an intervention band.
      </div>
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
        Live engine output. The blue base is business-as-usual {rungName} coverage; each coloured band stacked on top is the extra coverage an enabled intervention delivers. Switch between absolute households and share of population above.
      </div>
      {error && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
      {summary && (
        <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: `3px solid ${C.scenario}`, borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, marginBottom: 10 }}>
          <b>Impact.</b> By {summary.endline}, the enabled interventions serve <b>{sig(summary.addHH)} M</b> more {rungName} households and change the endline financing requirement from <b>{sig(convertMoney(summary.gapBau, currencyDisplay, summary.cur) as number)}</b> to <b>{sig(convertMoney(summary.gapIntv, currencyDisplay, summary.cur) as number)} M {currencyDisplay.mode === 'usd' && summary.cur.toUpperCase() !== 'USD' ? 'USD' : summary.cur}</b>
          {summary.gapBau > 0 && <> (a <b>{Math.round((1 - summary.gapIntv / summary.gapBau) * 100)}%</b> reduction)</>}. <span style={{ color: '#64748b' }}>{currencyRateNote(currencyDisplay, summary.cur)}</span>
        </div>
      )}
      <ServiceAccessGaps rows={accessRows} filename={`${sector}_${rung}_intervention_service_access`} />
      <div ref={chartRef} style={{ background: '#fff' }}>
      <ResponsiveContainer width="100%" height={360}>
        <ComposedChart data={visibleData} margin={{ top: 14, right: 24, bottom: 5, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(visibleData)} />
          <YAxis tick={{ fontSize: 10 }} domain={isShare ? ['auto', 1] : undefined} tickFormatter={fmtAxis}>
            <Label value={isShare ? '% of population' : '# households (millions)'} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
          </YAxis>
          <Tooltip formatter={(v: any, name: any, item: any) => {
            const band = grouped.bands.find(b => b.label === name);
            if (contributionView !== 'category' || !band?.members?.length) return fmtVal(+v);
            const row = item?.payload || {};
            const total = row.__source_total || row['Total households'] || 0;
            const members = band.members.map(m => {
              const raw = Number(row[m.key] || 0);
              return [m.label, isShare ? (total > 0 ? raw / total : 0) : raw] as const;
            }).filter(([, amount]) => Math.abs(amount) > 1e-12);
            return `${fmtVal(+v)}${members.length ? ` · ${members.map(([label, amount]) => `${label}: ${fmtVal(amount)}`).join(', ')}` : ''}`;
          }} contentStyle={{ fontSize: 11 }} />
          {/* Legend lists the Total-households line first, then the area fills (see chartLegend). Render
              order below stays areas-then-line so the line still draws on top; only the legend is reordered. */}
          <Legend wrapperStyle={{ fontSize: 10 }} content={linesFirstLegend} />
          {/* Grey BAU base, then one stacked band per contributing intervention. Animated transitions.
              Each band keeps a saturated same-colour top edge (width 1.75) so its boundary reads
              crisply against the lighter translucent band stacked above it — a shape cue on top of
              the hue. Stroke stays the band colour (not white) because recharts derives the legend
              swatch from stroke; the CVD-validated palette (see chartColors) carries identity, and
              the always-present legend is the secondary encoding. */}
          <Area type="monotone" dataKey={baseKey} stackId="s" fill={C.bauFill} stroke={C.bau} fillOpacity={0.7} strokeWidth={1.5} legendType="rect" isAnimationActive animationDuration={600} animationEasing="ease-out" />
          {displayBands.map(([k, label, color]) => (
            <Area key={k} type="monotone" dataKey={k} name={label} stackId="s" fill={color} stroke={color} fillOpacity={0.6} strokeWidth={1.75} strokeOpacity={1} legendType="rect" isAnimationActive animationDuration={600} animationEasing="ease-out" />
          ))}
          {/* Total households — the coverage ceiling, drawn on top (not stacked). */}
          <Line type="monotone" dataKey="Total households" stroke={C.total} strokeWidth={1.5} strokeDasharray="6 4" dot={false} legendType="plainline" isAnimationActive animationDuration={600} />
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}
