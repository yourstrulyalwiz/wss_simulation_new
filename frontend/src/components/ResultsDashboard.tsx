import React, { useEffect, useMemo, useRef, useState } from 'react';
import { areasOf as scenarioAreas, liveAreas } from '../areaBundle';
import {
  Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, ResponsiveContainer, Label,
} from 'recharts';
import { C, INTV_PALETTE as P } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import { linesFirstLegend } from './chartLegend';
import ExportButtons from './ExportButtons';
import ChartExport from './ChartExport';
import TableExport from './TableExport';
import { captureImage } from './exportUtils';
import BasicCoverageChart, { type BasicCoverageRow } from './BasicCoverageChart';
import ScenarioGapTables, { type FinanceYear } from './ScenarioGapTables';
import BorrowingPoolsTable from './BorrowingPoolsTable';
import { closingCashAtPeriodEnd, cumulativeAnnualFlow } from '../programmeFinance';
import { enabledInAnyArea, marginalPassInput } from '../interventionPasses';

// ── formatting helpers (mirrors LiveBAUChart) ──────────────────────────────────────────────────
function round3(v: number): number { return (!isFinite(v) || v === 0) ? 0 : Number(v.toPrecision(3)); }
function sig3(v: number): string { return round3(v).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
// Money is carried in MILLIONS; show as BILLIONS (÷1000) so a 254,000 M gap reads "254 B".
function sigB(vMillions: number): string { return sig3(vMillions / 1000); }

// Period buckets for the investment tables (mirrors the presentation: 2026–2030, 2031–2040, total).
function buildPeriods(years: number[], baseYr: number): { label: string; lo: number; hi: number }[] {
  const first = baseYr + 1;                               // first forecast year (e.g. 2026)
  const end = years[years.length - 1];
  const mid = Math.min(2030, end);
  const ps = [{ label: `${first}–${mid}`, lo: first, hi: mid }];
  if (end > mid) ps.push({ label: `${mid + 1}–${end}`, lo: mid + 1, hi: end });
  ps.push({ label: `Total ${first}–${end}`, lo: first, hi: end });
  return ps;
}
const sumRange = (arr: number[], years: number[], lo: number, hi: number) =>
  years.reduce((a, y, i) => a + (y >= lo && y <= hi ? (arr[i] || 0) : 0), 0);

// ── intervention lists (key → label; resourceKey names the scenario cash stream it mobilises, if any;
//    color = its band colour, shared with the intervention-impact chart via chartColors INTV_PALETTE) ──
type IntvDef = { key: string; label: string; resourceKey?: string; effectKind?: string; color: string; order: number };
const WATER_INTV: IntvDef[] = [
  { key: 'ws_capital_efficiency_enabled', label: 'Water · Budget execution', resourceKey: 'scenario_available_capex', effectKind: 'Usable capital gained', color: P.budgetExec, order: 10 },
  { key: 'ws_collection_efficiency_enabled', label: 'Water · Collection efficiency', resourceKey: 'scenario_collection_cash', effectKind: 'Recurring utility cash', color: P.collection, order: 20 },
  { key: 'ws_nrw_enabled', label: 'Water · NRW reduction', resourceKey: 'scenario_nrw_net', effectKind: 'Recurring utility cash', color: P.nrw, order: 30 },
  { key: 'ws_costeff_enabled', label: 'Water · Capex efficiency (unit cost)', effectKind: 'Investment costs avoided', color: P.capex, order: 40 },
  { key: 'ws_techmix_enabled', label: 'Water · Optimised technology selection', effectKind: 'Investment costs avoided', color: P.techmix, order: 50 },
  { key: 'ws_tariff_enabled', label: 'Water · Tariff reform', resourceKey: 'scenario_tariff_cash', effectKind: 'Recurring utility cash', color: P.tariff, order: 60 },
  { key: 'ws_microfinance_enabled', label: 'Water · Microfinance', resourceKey: 'scenario_mf_loan_volume', effectKind: 'Household loan capital', color: P.microfinance, order: 70 },
  { key: 'ws_borrowing_enabled', label: 'Water · Borrowing', resourceKey: 'scenario_loan_drawdown', effectKind: 'Borrowed capital', color: P.financial, order: 80 },
  { key: 'ws_financial_commitment_enabled', label: 'Water · Public financial commitment', resourceKey: 'scenario_financial_commitment_cash', effectKind: 'Explicit public capital', color: P.financial, order: 90 },
  { key: 'ws_exogenous_injection_enabled', label: 'Water · Public exogenous injection', resourceKey: 'scenario_exogenous_injection_cash', effectKind: 'Explicit public capital', color: P.injection, order: 92 },
];
const SAN_INTV: IntvDef[] = [
  { key: 'san_capital_efficiency_enabled', label: 'Sanitation · Budget execution', resourceKey: 'scenario_available_capex', effectKind: 'Usable capital gained', color: P.budgetExec, order: 11 },
  { key: 'san_collection_efficiency_enabled', label: 'Sanitation · Collection efficiency', resourceKey: 'scenario_collection_cash', effectKind: 'Recurring utility cash', color: P.collection, order: 21 },
  { key: 'san_nrw_link_enabled', label: 'Sanitation · NRW-linked revenue', resourceKey: 'scenario_nrw_link_cash', effectKind: 'Recurring utility cash', color: P.nrw, order: 31 },
  { key: 'san_costeff_enabled', label: 'Sanitation · Capex efficiency (unit cost)', effectKind: 'Investment costs avoided', color: P.capex, order: 41 },
  { key: 'san_techmix_enabled', label: 'Sanitation · Optimised technology selection', effectKind: 'Investment costs avoided', color: P.techmix, order: 51 },
  { key: 'san_tariff_enabled', label: 'Sanitation · Tariff reform', resourceKey: 'scenario_tariff_cash', effectKind: 'Recurring utility cash', color: P.tariff, order: 61 },
  { key: 'san_microfinance_enabled', label: 'Sanitation · Microfinance', resourceKey: 'scenario_mf_loan_volume', effectKind: 'Household loan capital', color: P.microfinance, order: 71 },
  { key: 'san_borrowing_enabled', label: 'Sanitation · Borrowing', resourceKey: 'scenario_loan_drawdown', effectKind: 'Borrowed capital', color: P.financial, order: 81 },
  { key: 'san_financial_commitment_enabled', label: 'Sanitation · Public financial commitment', resourceKey: 'scenario_financial_commitment_cash', effectKind: 'Explicit public capital', color: P.financial, order: 91 },
  { key: 'san_exogenous_injection_enabled', label: 'Sanitation · Public exogenous injection', resourceKey: 'scenario_exogenous_injection_cash', effectKind: 'Explicit public capital', color: P.injection, order: 93 },
];

interface Props {
  geoScope: 'urban' | 'rural' | 'urban_rural' | 'national';
  scenarios: { name: string; inputs: any }[];
  inputs: any;
  altInputs?: Record<string, any>;
  onToggle?: (key: string, value: boolean) => void;
}

type InvTable = { periods: { label: string; lo: number; hi: number }[]; rows: { label: string; vals: number[]; strong?: boolean }[] };
type OutputRow = { key: string; label: string; kind: 'money' | 'physical' | 'households' | 'volume' | 'factor' | 'ratio' | 'rate'; values: number[] };
type Series = { sum: any; inv: InvTable; unit: { sm: number; basic: number }; basicRows: BasicCoverageRow[]; financeRows: FinanceYear[]; outputRows: OutputRow[]; outputYears: number[] };
type Both = { water: Series; sanitation: Series } | null;
type Row = { key: string; label: string; addHH: number; effectLabel: string; resources: number | null };

// Per-intervention stacked breakdown for a sector. covRows/gapRows are per-year rows keyed by each band's
// label (plus reserved keys __bau/__total/__target for coverage and __remain for the gap). `bands` lists the
// interventions that actually contribute (each with its INTV_PALETTE colour), in stack order.
type ContribBand = { key: string; label: string; color: string };
type ContribSeries = { covRows: any[]; gapRows: any[]; bands: ContribBand[] };
type Contrib = { water: ContribSeries; sanitation: ContribSeries } | null;

// A marginal-contribution chart: a base area at the bottom, one ordered signed band per intervention, plus
// optional reference lines. Positive and negative deltas are preserved rather than floored.
function StackChart({ title, subtitle, data, base, bands, lines, fmt, yLabel, domain, filename, captureKey }: {
  title: string; subtitle?: string; data: any[]; yLabel: string;
  base?: { key: string; label: string; stroke: string; fill: string };   // optional bottom area (coverage BAU)
  bands: ContribBand[];
  lines: { key: string; name: string; color: string; dash?: string; width?: number }[];
  fmt: (v: number) => string; domain?: [number, number]; filename: string; captureKey: string;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  // Data series behind the chart, for the "⤓ Excel" export: Year, [base], each band, then the reference lines.
  const exHeaders = ['Year', ...(base ? [base.label] : []), ...bands.map(b => b.label), ...lines.map(l => l.name)];
  const exRows = data.map((r: any) => [r.year, ...(base ? [r[base.key] ?? 0] : []), ...bands.map(b => r[b.key] ?? 0), ...lines.map(l => r[l.key] ?? '')]);
  // Native Excel chart: optional base area at the bottom, then the intervention bands stacked up, plus the lines.
  const chartSpec = {
    category: 'Year', stacked: true,
    areas: [...(base ? [{ name: base.label, color: base.fill }] : []), ...bands.map(b => ({ name: b.label, color: b.color }))],
    lines: lines.map(l => ({ name: l.name, color: l.color, dash: !!l.dash })),
    yTitle: yLabel, xTitle: 'Year',
  };
  // Coverage: BAU base at the bottom then a band per intervention. Gap: no base; signed marginal bands start
  // at zero, with the total BAU gap shown as a reference.
  const baseArea = base ? (
    <Area key={base.key} type="monotone" dataKey={base.key} name={base.label} stackId="s" fill={base.fill} stroke={base.stroke} fillOpacity={0.7} strokeWidth={1.25} legendType="rect" isAnimationActive={false} />
  ) : null;
  const bandAreas = bands.map(b => (
    <Area key={b.key} type="monotone" dataKey={b.key} name={b.label} stackId="s" fill={b.color} stroke={b.color} fillOpacity={0.6} strokeWidth={1.5} strokeOpacity={1} legendType="rect" isAnimationActive={false} />
  ));
  const stackAreas = base ? [baseArea, ...bandAreas] : bandAreas;
  return (
    <div data-results-chart={captureKey} style={{ marginBottom: 12 }}>
      {/* Fixed-height header so paired charts' plot areas line up horizontally regardless of subtitle length.
          The title/subtitle column takes the full width (flex:1, minWidth:0 so it can wrap) and overflow is
          clipped to the fixed height. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, height: 50, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f', margin: '0 0 1px' }}>{title}</h4>
          {subtitle && <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 5 }}>{subtitle}</div>}
        </div>
        <ChartExport chartRef={chartRef} filename={filename} title={title}
          sheets={[{ name: 'Data', headers: exHeaders, rows: exRows }]} chartSpec={chartSpec} compact />
      </div>
      <div ref={chartRef} style={{ background: '#fff' }}>
      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 10, right: 24, bottom: 5, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(data)} />
          <YAxis tick={{ fontSize: 10 }} domain={domain} tickFormatter={fmt}>
            <Label value={yLabel} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
          </YAxis>
          <Tooltip formatter={(v: any) => fmt(+v) as any} labelFormatter={(l: any) => String(l)} contentStyle={{ fontSize: 11 }} />
          {/* Legend lists reference lines first, then the stacked area fills (see chartLegend). */}
          <Legend wrapperStyle={{ fontSize: 10 }} content={linesFirstLegend} />
          {/* Coverage: BAU base at the bottom then a band per intervention. Financing gap: no base — the bands
              stack up from zero and a reference line (in `lines`) marks the total BAU gap to close. */}
          {stackAreas}
          {lines.map(l => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={l.width ?? 2}
              strokeDasharray={l.dash} dot={false} legendType="plainline" connectNulls isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

function InterventionOutputTable({ rows, years, currency, sector, scope }: {
  rows: OutputRow[]; years: number[]; currency: string; sector: string; scope: string;
}) {
  const headers = ['Output / definition', 'Units', ...years.map(String)];
  const unitLabel = (kind: OutputRow['kind']) => kind === 'money' ? `${currency} M/yr`
    : kind === 'ratio' ? '%' : kind === 'rate' ? `${currency}/m³` : kind === 'factor' ? 'unit-cost factor' : kind === 'volume' ? 'MLD' : 'physical units/yr';
  const outputUnitLabel = (kind: OutputRow['kind']) => kind === 'households' ? 'million HH/yr' : unitLabel(kind);
  const rawRows = rows.map(r => [r.label, outputUnitLabel(r.kind), ...r.values]);
  const shownRows = rows.map(r => [r.label, outputUnitLabel(r.kind), ...r.values.map(v => r.kind === 'ratio' ? `${(v * 100).toFixed(2)}%` : sig3(v))]);
  return (
    <details style={{ margin: '10px 0 16px', border: '1px solid #dbe3ec', borderRadius: 6, background: '#fff' }}>
      <summary style={{ cursor: 'pointer', padding: '9px 12px', color: '#1e3a5f', fontSize: 12, fontWeight: 700 }}>
        Recurring cash, implementation & physical-benefit breakdown
      </summary>
      <div style={{ padding: '0 12px 12px' }}>
        <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.5, margin: '0 0 8px' }}>
          Revenue attribution runs collection at BAU tariff first, NRW additional billed volume at BAU tariff and scenario collection second, then tariff reform over total scenario billed volume. The combined shared-revenue line is the exact scenario-minus-BAU control total. NRW service/commercial cash are subsets of that total—not additional revenue. Implementation capex and recurring operating costs are separate; NRW physical service benefits require connection/upgrade costs already included in scheduled programme need.
        </div>
        {rows.length ? <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
            <TableExport filename={`${scope}_${sector}_intervention_outputs`} sheetName="Intervention outputs"
              headers={headers} rows={rawRows} compact />
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 5 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: Math.max(640, years.length * 78), fontSize: 10.5 }}>
              <thead><tr>{headers.map((h, i) => <th key={h} style={{ position: i < 2 ? 'sticky' : undefined, left: i === 0 ? 0 : i === 1 ? 360 : undefined,
                minWidth: i === 0 ? 300 : i === 1 ? 105 : undefined, maxWidth: i === 0 ? 360 : undefined,
                padding: '6px 8px', background: '#f1f5f9', color: '#334155', textAlign: i < 2 ? 'left' : 'right', whiteSpace: i === 0 ? 'normal' : 'nowrap' }}>{h}</th>)}</tr></thead>
              <tbody>{shownRows.map((row, ri) => <tr key={rows[ri].key} style={{ background: ri % 2 ? '#fafbfc' : '#fff' }}>
                {row.map((v, ci) => <td key={ci} style={{ position: ci < 2 ? 'sticky' : undefined, left: ci === 0 ? 0 : ci === 1 ? 360 : undefined,
                  minWidth: ci === 0 ? 300 : ci === 1 ? 105 : undefined, maxWidth: ci === 0 ? 360 : undefined,
                  padding: '5px 8px', borderBottom: '1px solid #eef2f7', background: ci < 2 ? (ri % 2 ? '#fafbfc' : '#fff') : undefined,
                  textAlign: ci < 2 ? 'left' : 'right', whiteSpace: ci === 0 ? 'normal' : 'nowrap', color: ci === 0 ? '#1e3a5f' : '#475569' }}>{v}</td>)}
              </tr>)}</tbody>
            </table>
          </div>
        </> : <div style={{ padding: 8, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, fontSize: 11 }}>
          The calculation response did not include the detailed intervention-output breakdown.
        </div>}
      </div>
    </details>
  );
}

export default function ResultsDashboard({ geoScope, scenarios, inputs, altInputs, onToggle }: Props) {
  const [viewScope, setViewScope] = useState<'urban' | 'rural' | 'national'>(
    geoScope === 'urban' ? 'urban' : geoScope === 'rural' ? 'rural' : 'national'
  );
  const [unitMode, setUnitMode] = useState<'count' | 'share'>('count');
  // Graph-only year window. It intentionally does not enter the calculation payload or saved inputs.
  const [chartStart, setChartStart] = useState<number | null>(null);
  const [chartEnd, setChartEnd] = useState<number | null>(null);
  // Areas to ship to the slide-deck export. The deck covers every scope in one file, so this follows
  // the ENTRY mode (how the user filled the data in), not the Scope dropdown above, which only
  // chooses what this tab displays. In national-entry mode the national dataset lives in altInputs
  // and `inputs` is still the urban primary, so read it explicitly rather than exporting urban.
  const deckAreas = React.useMemo(() => liveAreas(geoScope, inputs, altInputs), [geoScope, inputs, altInputs]);
  const [both, setBoth] = useState<Both>(null);
  const [table, setTable] = useState<{ water: Row[]; sanitation: Row[] } | null>(null);
  const [contrib, setContrib] = useState<Contrib>(null);   // per-intervention stacked series
  const [error, setError] = useState<string | null>(null);
  const [borrowingPools, setBorrowingPools] = useState<any[] | null>(null);

  // The dataset the user actually filled in. Same asymmetry deckAreas handles above: in national-ENTRY
  // mode the dataset being edited lives in altInputs.national and `inputs` is still the urban primary
  // seed, so it has to be read explicitly — otherwise everything on this tab (charts, tables, the
  // intervention toggles and the whole-scenario exports) reports seed numbers the user never entered.
  const primary = useMemo(
    () => (geoScope === 'national' ? (altInputs?.['national'] ?? inputs) : inputs),
    [geoScope, inputs, altInputs]);
  // National entry has no urban/rural split to look at, so the Scope dropdown collapses to National
  // (below) and every view resolves to that single dataset.
  const effScope = geoScope === 'national' ? 'national' : viewScope;

  // Datasets for the chosen scope (national = urban + rural summed, when rural data exists).
  const datasets = useMemo(() => {
    // Selecting urban+rural seeds altInputs.rural and switching to national entry does not clear it, so
    // national entry returns its one dataset rather than summing in an area that is no longer in play.
    if (geoScope === 'national') return [primary];
    const rural = altInputs?.['rural'];
    if (effScope === 'urban') return [primary];
    if (effScope === 'rural') return [rural ?? primary];
    return rural ? [primary, rural] : [primary];      // national
  }, [primary, geoScope, altInputs, effScope]);

  const cur = datasets[0]?.country_config?.currency || 'LCU';
  const toggles = primary?.toggles || {};
  const depKey = JSON.stringify(datasets);

  // ── Fan charts: BAU vs the user's full designed scenario (interventions + customs) ──────────────
  useEffect(() => {
    if (!datasets.length || !datasets[0]) return;
    setBorrowingPools(null);
    const h = setTimeout(() => {
      Promise.all(datasets.map((inp: any) =>
        fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inp) })
          .then(r => { if (!r.ok) throw new Error('calc failed (' + r.status + ')'); return r.json(); })
      )).then(resList => {
        // Keep the backend's schedules attached to their source area and sector. Never add pool
        // metadata or maturity schedules together: matching entity names do not imply shared debt.
        const poolRecords = resList.flatMap((res: any, areaIndex: number) => {
          const fallbackArea = datasets.length > 1
            ? (areaIndex === 0 ? 'Urban' : 'Rural')
            : geoScope === 'national' ? 'National'
              : effScope === 'rural' ? 'Rural' : 'Urban';
          const found: any[] = [];
          if (Array.isArray(res?.scenario_borrowing_pools)) {
            res.scenario_borrowing_pools.forEach((pool: any) => found.push({ ...pool, _areaLabel: fallbackArea }));
          }
          ([
            ['water_supply', 'Water Supply'],
            ['sanitation', 'Sanitation'],
          ] as const).forEach(([key, sectorName]) => {
            const pools = res?.[key]?.scenario_borrowing_pools;
            if (Array.isArray(pools)) pools.forEach((pool: any) => found.push({
              ...pool, sector: pool.sector || sectorName,
              _areaLabel: `${fallbackArea}${pool.area ? ` · ${pool.area}` : ''}`,
            }));
          });
          const seen = new Set<string>();
          return found.filter((pool: any) => {
            const key = JSON.stringify([pool.area || pool._areaLabel, pool.sector, pool.entity_name, pool.loan_principal, pool.schedule?.years]);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        });
        setBorrowingPools(poolRecords);
        const years: number[] = resList[0].years;
        const per = datasets[0]?.period || {};
        const baseYr = per.baseline_year ?? years[0];
        const endIdx = years.length - 1;
        const sum = (pick: (res: any, i: number) => number) =>
          years.map((_: number, i: number) => resList.reduce((a, res) => a + (pick(res, i) || 0), 0));
        const totalHH = years.map((_, i) => resList.reduce((a, res) => a + (res.total_hh[i] || 0), 0));
        const build = (secKey: 'water_supply' | 'sanitation'): Series => {
          const secOf = (res: any) => res[secKey];
          const bau = sum((r, i) => secOf(r).bau_hh[0][i]);
          const scn = sum((r, i) => secOf(r).scenario_hh[0][i]);
          const tgt = sum((r, i) => secOf(r).target_hh[0][i]);
          const basicBau = sum((r, i) => secOf(r).bau_hh[1][i]);
          const basicScn = sum((r, i) => secOf(r).scenario_hh[1][i]);
          const basicTgt = sum((r, i) => secOf(r).target_hh[1][i]);
          const basicRows = years.map((year, i) => ({
            year, total: totalHH[i], bau: basicBau[i], scenario: basicScn[i], target: basicTgt[i],
          }));
          const bauGap = sum((r, i) => (secOf(r).financing_gap || [])[i] || 0);
          const scnGap = sum((r, i) => (secOf(r).scenario_financing_gap || [])[i] || 0);
          const residualBefore = sum((r, i) => (secOf(r).scenario_financing_gap_before_additional_public || [])[i] || 0);
          const residualAfter = sum((r, i) => (secOf(r).scenario_financing_gap || [])[i] || 0);
          const additionalPublic = sum((r, i) => (secOf(r).scenario_additional_public_capital || [])[i] || 0);
          const cumulativeResidualBefore = sum((r, i) => (secOf(r).scenario_cumulative_residual_public_before || [])[i] || 0);
          const cumulativeResidualAfter = sum((r, i) => (secOf(r).scenario_cumulative_residual_public_after || [])[i] || 0);
          const tEnd = totalHH[endIdx] || 0;
          const covPct = (a: number[]) => tEnd > 0 ? Math.min(tEnd, a[endIdx]) / tEnd : 0;
          const cumGap = (a: number[]) => cumulativeAnnualFlow(a, years, baseYr);
          // Current (baseline-year) safely-managed coverage — BAU at the baseline = the actual.
          const baseIdx = Math.max(0, years.indexOf(baseYr));
          const tBase = totalHH[baseIdx] || 0;
          const curCov = tBase > 0 ? Math.min(tBase, bau[baseIdx]) / tBase : 0;
          // Investment-gap table (BAU basis): annual flows summed over each period, millions → billions.
          const newCap = sum((r, i) => secOf(r).new_capex_total?.[i] || 0);
          const repl = sum((r, i) => secOf(r).replacement_capex?.[i] || 0);
          const totNeed = sum((r, i) => secOf(r).total_investment_need?.[i] || 0);
          const impl = sum((r, i) => secOf(r).implementation_capex?.[i] || 0);
          const freshBau = sum((r, i) => secOf(r).current_year_financing[i]);
          const appliedBau = sum((r, i) => secOf(r).funded_investment[i]);
          const closingBau = sum((r, i) => secOf(r).cash_carry_forward[i]);
          const bauInv = sum((r, i) => secOf(r).bau_available?.[i] || 0);
          const scnInv = sum((r, i) => secOf(r).scenario_available_total[i]);
          const loanCum = sum((r, i) => secOf(r).scenario_mf_loan_volume[i]);
          const grantCum = sum((r, i) => secOf(r).scenario_grant_spend[i]);
          const scenarioField = (key: string, i: number) =>
            resList.reduce((total, res) => total + (secOf(res)[`scenario_${key}`]?.[i] || 0), 0);
          // Keep this signed engine output as reported. A missing canonical array stays unavailable;
          // it is never inferred from revenues, costs, debt service, or a floored financing gap.
          const signedOperatingCashKeys = [
            'scenario_additional_net_utility_cash',
            'scenario_additional_net_operating_cash',
            'scenario_net_operating_cash',
            'scenario_net_utility_cash',
          ];
          const signedOperatingCashKey = signedOperatingCashKeys.find(key =>
            resList.some(res => Array.isArray(secOf(res)[key])));
          const signedOperatingCash = (i: number): number | null => signedOperatingCashKey
            ? resList.reduce((total, res) => total + (Array.isArray(secOf(res)[signedOperatingCashKey])
              ? Number(secOf(res)[signedOperatingCashKey][i]) || 0 : 0), 0)
            : null;
          const areaLabels = datasets.length > 1 ? ['Urban', 'Rural'] :
            [geoScope === 'national' ? 'National' : effScope === 'rural' ? 'Rural' : 'Urban'];
          const outputRows: OutputRow[] = [];
          const addCombinedOutput = (key: string, label: string, kind: OutputRow['kind'], get: (res: any) => number[] | undefined) => {
            if (!resList.some(res => Array.isArray(get(res)))) return;
            outputRows.push({ key, label, kind, values: years.map((_, i) => resList.reduce((total, res) => total + (+((get(res) || [])[i]) || 0), 0)) });
          };
          addCombinedOutput('shared-revenue', 'Net shared tariff / collection cash vs BAU (control total; includes NRW collected revenue)', 'money', r => secOf(r).scenario_shared_revenue_cash);
          addCombinedOutput('billed-bau', 'Billed volume — BAU', 'volume', r => secOf(r).scenario_billed_volume_bau);
          addCombinedOutput('billed-scenario', 'Billed volume — scenario', 'volume', r => secOf(r).scenario_billed_volume_scenario);
          addCombinedOutput('nrw-service-cash', 'NRW physical-service collected cash (included in shared revenue; not additive)', 'money', r => secOf(r).scenario_nrw_service_cash);
          addCombinedOutput('nrw-commercial-cash', 'NRW commercial-recovery collected cash (included in shared revenue; not additive)', 'money', r => secOf(r).scenario_nrw_commercial_cash);
          addCombinedOutput('nrw-production-volume', 'NRW recovered physical volume allocated to reduced production', 'volume', r => secOf(r).scenario_nrw_production_avoided_vol);
          addCombinedOutput('new-sm-connections', 'Target-path new Safely Managed connections', 'households', r => secOf(r).scenario_target_new_sm_connections);
          addCombinedOutput('new-basic-connections', 'Target-path new Basic connections', 'households', r => secOf(r).scenario_target_new_basic_connections);
          addCombinedOutput('basic-sm-upgrades', 'Target-path Basic to Safely Managed upgrades', 'households', r => secOf(r).scenario_target_sm_upgrades);
          const interventionOutput = (r: any) => secOf(r).scenario_intervention_outputs || {};
          const prettify = (path: string) => path
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_.-]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
          const outputPaths = new Set<string>();
          const visitOutputs = (value: any, path: string) => {
            if (typeof value === 'number' && path) {
              outputPaths.add(path);
              return;
            }
            if (Array.isArray(value) && value.every(v => v == null || typeof v === 'number')) {
              if (path) outputPaths.add(path);
              return;
            }
            if (Array.isArray(value)) {
              value.forEach((child, i) => visitOutputs(child, `${path}.${i}`));
              return;
            }
            if (value && typeof value === 'object') {
              Object.entries(value).forEach(([key, child]) => visitOutputs(child, path ? `${path}.${key}` : key));
            }
          };
          resList.forEach(r => visitOutputs(interventionOutput(r), ''));
          const outputAt = (value: any, path: string): number[] | undefined => {
            const found = path.split('.').reduce((node, key) => node?.[key], value);
            if (typeof found === 'number') return years.map(() => found);
            return Array.isArray(found) && found.every(v => v == null || typeof v === 'number') ? found : undefined;
          };
          outputPaths.forEach(path => {
            const lowerPath = path.toLowerCase();
            const kind: OutputRow['kind'] = /tariff|price/.test(lowerPath) ? 'rate'
              : /unit.?cost|factor/.test(lowerPath) ? 'factor'
              : /ratio|share|percent|efficiency/.test(lowerPath) ? 'ratio'
              : /revenue|cash|cost|saving|capex|spend|investment|amount/.test(lowerPath) ? 'money' : 'physical';
            const label = `Intervention output · ${prettify(path)}`;
            if (/unit.?cost|factor/.test(lowerPath)) {
              resList.forEach((r, areaIndex) => {
                const values = outputAt(interventionOutput(r), path);
                if (values) outputRows.push({
                  key: `intervention-output-${path}-${areaIndex}`,
                  label: `${areaLabels[areaIndex] || `Area ${areaIndex + 1}`} · ${label}`,
                  kind, values: years.map((_, i) => +values[i] || 0),
                });
              });
            } else {
              addCombinedOutput(`intervention-output-${path}`, label, kind,
                r => outputAt(interventionOutput(r), path));
            }
          });
          const addPerAreaPath = (key: string, label: string, kind: OutputRow['kind'], get: (r: any) => number[] | undefined) => {
            resList.forEach((r, areaIndex) => {
              const values = get(r);
              if (Array.isArray(values)) outputRows.push({ key: `${key}-${areaIndex}`, label: `${areaLabels[areaIndex] || `Area ${areaIndex + 1}`} · ${label}`, kind, values: years.map((_, i) => +values[i] || 0) });
            });
          };
          addPerAreaPath('tariff-path', 'Scenario tariff path', 'rate', r => secOf(r).scenario_tariff_path);
          addPerAreaPath('collection-path', 'Scenario collection path', 'ratio', r => secOf(r).scenario_collection_path);
          const rungSeries = (key: string, rung: number) => sum((r, i) => secOf(r)[key][rung][i]);
          const rungHouseholdGap = (key: 'service_gap_display' | 'scenario_service_gap', rung: number) =>
            years.map((_, i) => resList.reduce((total, res) => {
              const sectorResult = secOf(res);
              const canonical = sectorResult[key] || (key === 'scenario_service_gap' ? sectorResult.service_gap_display : undefined);
              return total + (canonical?.[rung]?.[i] || 0);
            }, 0));
          const rungData = [0, 1].map(rung => ({
            bau: rung === 0 ? bau : basicBau,
            scenario: rung === 0 ? scn : basicScn,
            target: rung === 0 ? tgt : basicTgt,
            newBau: rungSeries('new_capex_by_service', rung),
            replacementBau: rungSeries('replacement_by_service', rung),
            fundedBau: rungSeries('funded_by_service', rung),
            gapBau: rungSeries('financing_gap_by_service', rung),
            gapBauHH: rungHouseholdGap('service_gap_display', rung),
            newScenario: rungSeries('scenario_new_capex_by_service', rung),
            replacementScenario: rungSeries('scenario_replacement_by_service', rung),
            fundedScenario: rungSeries('scenario_funded_by_service', rung),
            gapScenario: rungSeries('scenario_financing_gap_by_service', rung),
            gapScenarioHH: rungHouseholdGap('scenario_service_gap', rung),
          }));
          const financeRows: FinanceYear[] = years.flatMap((year, i) => year <= baseYr ? [] : [{
            year, total: totalHH[i], bauAvailable: bauInv[i], scenarioAvailable: scnInv[i],
            scenarioNeed: scenarioField('total_investment_need', i),
            publicCapital: scenarioField('public_capital', i),
            otherCapital: scenarioField('other_capital', i),
            newFinancing: scenarioField('current_year_financing', i),
            openingCash: scenarioField('cash_opening', i),
            closingCash: scenarioField('cash_carry_forward', i),
            financingApplied: scenarioField('funded_investment', i),
            cashDeficit: scenarioField('financing_cash_deficit', i),
            cumulativeNeed: scenarioField('cumulative_investment_requirement', i),
            cumulativeShortfall: scenarioField('cumulative_financing_gap', i),
             residualPublicBefore: residualBefore[i] || 0,
             additionalPublicCapital: additionalPublic[i] || 0,
             residualPublicAfter: residualAfter[i] || 0,
             cumulativeResidualPublicBefore: cumulativeResidualBefore[i] || 0,
             cumulativeResidualPublicAfter: cumulativeResidualAfter[i] || 0,
            implementationCapex: scenarioField('implementation_capex', i),
            utilityCashDirect: scenarioField('cash_allocated_to_direct_investment', i),
            utilityCashCommitted: scenarioField('cash_committed_to_debt', i),
            loanDrawdown: scenarioField('loan_drawdown', i),
            loanDebtService: scenarioField('loan_debt_service', i),
            loanInterest: scenarioField('loan_interest', i),
            loanClosingDebt: scenarioField('loan_closing_debt', i),
            loanDebtServiceShortfall: scenarioField('loan_debt_service_shortfall', i),
            additionalNetOperatingCash: signedOperatingCash(i),
            offBudgetLoans: loanCum[i] - (loanCum[i - 1] || 0),
            offBudgetGrants: grantCum[i] - (grantCum[i - 1] || 0),
            bauGap: bauGap[i], scenarioGap: scnGap[i],
            services: rungData.map(d => ({
              bau: d.bau[i], scenario: d.scenario[i], target: d.target[i],
              newBau: d.newBau[i], replacementBau: d.replacementBau[i],
              fundedBau: d.fundedBau[i], gapBau: d.gapBau[i],
              gapBauHH: d.gapBauHH[i],
              newScenario: d.newScenario[i], replacementScenario: d.replacementScenario[i],
              fundedScenario: d.fundedScenario[i], gapScenario: d.gapScenario[i],
              gapScenarioHH: d.gapScenarioHH[i],
            })) as [FinanceYear['services'][0], FinanceYear['services'][1]],
          }]);
          const periods = buildPeriods(years, baseYr);
          const invRow = (label: string, arr: number[], strong = false) =>
            ({ label, strong, vals: periods.map(p => sumRange(arr, years, p.lo, p.hi) / 1000) });
          const inv: InvTable = { periods, rows: [
            invRow('Expansion and upgrades (A)', newCap),
            invRow('Replacement allowance, approximate (B)', repl),
            invRow('Implementation capex (C)', impl),
            invRow('Programme investment requirement (A + B + C)', totNeed, true),
            invRow('New financing received (excludes carry)', freshBau),
            invRow('Financing applied to annual requirements', appliedBau),
            { label: 'Closing investment cash (period-end balance)',
              vals: periods.map(p => closingCashAtPeriodEnd(closingBau, years, p.lo, p.hi) / 1000) },
            invRow('Sum of annual financing shortfalls', bauGap, true),
          ] };
          const unit = { sm: secOf(resList[0]).cost_per_hh || 0, basic: secOf(resList[0]).cost_basic || 0 };
          return { inv, unit, basicRows, financeRows, outputRows, outputYears: years, sum: {
            endline: years[endIdx], curCov, bauCov: covPct(bau), scnCov: covPct(scn), tgtCov: covPct(tgt),
             addHH: Math.min(tEnd, scn[endIdx]) - Math.min(tEnd, bau[endIdx]),
            gapBauCum: cumGap(bauGap), gapScnCum: cumGap(scnGap),
            requirementBau: cumGap(totNeed),
            requirementScenario: cumGap(sum((r, i) => secOf(r).scenario_total_investment_need[i])),
             residualPublicBefore: cumulativeResidualBefore[endIdx] || 0,
             residualPublicAfter: cumulativeResidualAfter[endIdx] || 0,
             additionalPublicCapital: cumGap(additionalPublic),
            unmetSm: Math.max(0, tgt[endIdx] - scn[endIdx]),
            unmetBasic: Math.max(0, basicTgt[endIdx] - basicScn[endIdx]),
          } };
        };
        setBoth({ water: build('water_supply'), sanitation: build('sanitation') });
        setError(null);
      }).catch(e => { setBoth(null); setBorrowingPools([]); setError(String(e)); });
    }, 350);
    return () => clearTimeout(h);
  }, [depKey]);

  // ── Per-intervention breakdown: cumulative passes over the ENABLED built-in toggles isolate each lever's
  //    signed marginal safely-managed households (Δ scenario_hh) and financing gap (−Δ scenario_financing_gap) per
  //    YEAR, plus its mobilised resources at the endline. Feeds both the endline table AND the stacked
  //    per-intervention charts. Customs are an additional-options step that remains on in subsequent
  //    financing passes, so the stack reconciles to the true combined scenario. ───────────
  useEffect(() => {
    if (!datasets.length || !datasets[0]) { setTable(null); setContrib(null); return; }
    const enabled = [...WATER_INTV, ...SAN_INTV].filter(d => enabledInAnyArea(datasets, d.key)).sort((a, b) => a.order - b.order);
    const hasCustoms = datasets.some((inp: any) => (inp.custom_interventions || []).some((c: any) => c && c.enabled !== false));
    setTable(null);
    setContrib(null);
    const h = setTimeout(() => {
      const off = Object.fromEntries([...WATER_INTV, ...SAN_INTV].map(d => [d.key, false]));
      let acc: any = { ...off };
      const specs: { tg: any; customs: boolean; key?: string; label?: string; color?: string }[] =
        [{ tg: { ...off }, customs: false }];
      const addCustomStep = () => { if (hasCustoms) specs.push({ tg: { ...acc }, customs: true, key: '__custom', label: 'Custom interventions', color: P.custom }); };
      enabled.filter(d => d.order < 80).forEach(d => {
        acc = { ...acc, [d.key]: true };
        specs.push({ tg: { ...acc }, customs: false, key: d.key, label: d.label, color: d.color });
      });
      // Custom interventions are an additional option: after operating/capex/tariff/microfinance, before borrowing and public sources.
      addCustomStep();
      enabled.filter(d => d.order >= 80).forEach(d => {
        acc = { ...acc, [d.key]: true };
        specs.push({ tg: { ...acc }, customs: hasCustoms, key: d.key, label: d.label, color: d.color });
      });
      const fetchPass = (tg: any, useCustoms: boolean) => Promise.all(datasets.map((inp: any) =>
        fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(marginalPassInput(inp, tg, useCustoms)) })
          .then(r => { if (!r.ok) throw new Error(`Calculation failed (${r.status})`); return r.json(); })));
      Promise.all(specs.map(s => fetchPass(s.tg, s.customs))).then(passes => {
        const years: number[] = passes[0][0].years;
        const per = datasets[0]?.period || {};
        const baseYr = per.baseline_year ?? years[0];
        const endIdx = years.length - 1;
        const smY = (rl: any[], sk: string, i: number) => rl.reduce((a, r) => a + (r[sk].scenario_hh[0][i] || 0), 0);
        const gapY = (rl: any[], sk: string, i: number) => rl.reduce((a, r) => a + ((r[sk].scenario_financing_gap || [])[i] || 0), 0);
        const totY = (i: number) => passes[0].reduce((a: number, r: any) => a + (r.total_hh[i] || 0), 0);
        const tgtY = (sk: string, i: number) => passes[0].reduce((a: number, r: any) => a + (r[sk].target_hh[0][i] || 0), 0);
        const cashCum = (rl: any[], sk: string, f: string) => rl.reduce((a, r) =>
          a + (r[sk][f] || []).reduce((s: number, v: number, i: number) => s + (years[i] > baseYr ? (v || 0) : 0), 0), 0);
        // ── stacked per-year series for one sector ──
        const buildContrib = (_defs: IntvDef[], sk: string): ContribSeries => {
          const covRows: any[] = [], gapRows: any[] = [];
          years.forEach((y, i) => {
            const covRow: any = { year: y, __bau: +smY(passes[0], sk, i).toFixed(4), __total: +totY(i).toFixed(4), __target: +tgtY(sk, i).toFixed(4) };
            const bauGap = gapY(passes[0], sk, i);
            const gapRow: any = { year: y };
            specs.slice(1).forEach((step, si) => {
              const label = step.label!;
              const before = passes[si], after = passes[si + 1];
              covRow[label] = +(smY(after, sk, i) - smY(before, sk, i)).toFixed(4);
              gapRow[label] = +((gapY(before, sk, i) - gapY(after, sk, i)) / 1000).toFixed(4);
            });
            gapRow.__remain = +(gapY(passes[passes.length - 1], sk, i) / 1000).toFixed(4);
            gapRow.__bau_gap = +(bauGap / 1000).toFixed(4);                        // total BAU gap → the target line to close
            covRows.push(covRow); gapRows.push(gapRow);
          });
          const bands: ContribBand[] = specs.slice(1).map(s => ({ key: s.label!, label: s.label!, color: s.color! }));
          return { covRows, gapRows, bands };
        };
        setContrib({ water: buildContrib(WATER_INTV, 'water_supply'), sanitation: buildContrib(SAN_INTV, 'sanitation') });

        // ── Order-dependent marginal contribution table, including cross-sector effects ──
        const smEnd = (rl: any[], sk: string) => smY(rl, sk, endIdx);
        const rowsFor = (sk: string): Row[] => specs.slice(1).map((step, i) => {
          const before = passes[i], after = passes[i + 1];
          const addHH = (smEnd(after, sk) - smEnd(before, sk)) * 1000;
          const def = [...WATER_INTV, ...SAN_INTV].find(d => d.key === step.key);
          const needCum = (rl: any[]) => rl.reduce((total, r) => total +
            (r[sk].scenario_total_investment_need || []).reduce((sum: number, value: number, yearIndex: number) =>
              sum + (years[yearIndex] > baseYr ? (+value || 0) : 0), 0), 0);
          const resources = def?.resourceKey
            ? (cashCum(after, sk, def.resourceKey) - cashCum(before, sk, def.resourceKey)) / 1000
            : def?.effectKind === 'Investment costs avoided' ? (needCum(before) - needCum(after)) / 1000 : null;
          return { key: step.key || '', label: step.label || '', addHH, resources, effectLabel: def?.effectKind || (step.key === '__custom' ? 'Custom intervention effect' : 'Scenario effect') };
        });
        setTable({ water: rowsFor('water_supply'), sanitation: rowsFor('sanitation') });
        setError(null);
      }).catch((e: any) => {
        setTable(null);
        setContrib(null);
        setError(`Could not update order-dependent contributions: ${String(e)}`);
      });
    }, 400);
    return () => clearTimeout(h);
  }, [depKey, JSON.stringify(toggles)]);

  const isShare = unitMode === 'share';
  const chartYears: number[] = contrib?.water?.covRows?.map((r: any) => r.year) ?? [];
  const filterChartYears = (rows: any[]) => {
    if (!rows.length) return rows;
    const lo = chartStart ?? rows[0].year;
    const hi = chartEnd ?? rows[rows.length - 1].year;
    return rows.filter(r => r.year >= lo && r.year <= hi);
  };
  const covFmt = isShare ? (v: number) => Math.round(v * 100) + '%' : (v: number) => sig3(v);
  // gapRows are ALREADY in billions (÷1000 when built), so format with sig3 — sigB would divide twice.
  const gapFmt = (v: number) => sig3(v);
  // Coverage stack in % mode: divide the base, every band, and the target/ceiling by that year's total.
  const asShareStack = (rows: any[], bands: ContribBand[]) => rows.map(r => {
    const tot = r.__total || 0; const d = (v: number) => tot > 0 ? v / tot : 0;
    const o: any = { year: r.year, __total: tot > 0 ? 1 : 0, __bau: d(r.__bau || 0), __target: d(r.__target || 0) };
    bands.forEach(b => { o[b.key] = d(r[b.key] || 0); });
    return o;
  });

  const scopeName = effScope === 'rural' ? 'Rural' : effScope === 'urban' ? 'Urban' : 'National';
  const pct = (f: number) => (f * 100).toFixed(1) + '%';

  // Capture by identity, not DOM order: the Basic charts must not shift the existing deck images.
  const captureResultsCharts = async (): Promise<Record<string, string>> => {
    const keys = ['water_coverage', 'water_basic_coverage', 'water_gap', 'san_coverage', 'san_basic_coverage', 'san_gap'];
    const out: Record<string, string> = {};
    for (const key of keys) {
      const wrap = document.querySelector(`[data-results-chart="${key}"] .recharts-wrapper`) as HTMLElement | null;
      if (!wrap) continue;
      try { out[key] = await captureImage(wrap, 'png'); } catch { /* skip a chart that fails to capture */ }
    }
    return out;
  };

  // ── Resources-and-households table (per sector) ────────────────────────────────────────────────
  const ImpactTable = ({ rows, hhCol }: { rows: Row[]; hhCol: string }) => {
    if (!rows || !rows.length) return null;
    const th: React.CSSProperties = { padding: '7px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: '#0ea5e9', textAlign: 'right' };
    const td: React.CSSProperties = { padding: '6px 12px', fontSize: 11.5, borderBottom: '1px solid #eef2f7', textAlign: 'right' };
    const exHeaders = ['Order-dependent marginal effects', 'Effect category', `Signed marginal amount (${cur} B)`, `Signed household change · ${hhCol}`];
    const exRows = rows.map(r => [r.label, r.effectLabel, r.resources == null ? 'n/a' : r.resources, r.addHH]);
    return (
      <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, maxWidth: 680 }}>
        <TableExport filename="contribution_by_intervention" sheetName="Interventions" headers={exHeaders} rows={exRows} compact />
      </div>
      <div style={{ margin: '2px 0 4px', overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, maxWidth: 680 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Order-dependent marginal effects</th>
              <th style={{ ...th, textAlign: 'left' }}>Effect category</th>
              <th style={th}>Signed marginal amount ({cur} B)</th>
              <th style={th}>Signed household change · {hhCol}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} style={{ background: i % 2 ? '#f1f8fd' : '#fff' }}>
                <td style={{ ...td, textAlign: 'left', color: '#334155' }}>{r.label}</td>
                <td style={{ ...td, textAlign: 'left', color: '#475569' }}>{r.effectLabel}</td>
                <td style={{ ...td, color: '#0369a1' }}>{r.resources == null ? 'n/a' : sig3(r.resources)}</td>
                <td style={{ ...td, color: '#0369a1' }}>{sig3(r.addHH)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </div>
    );
  };

  // ── Table 9: Executive summary — SM coverage now vs BAU / target / with-reforms at the endline ──
  const ExecSummary = () => {
    if (!both) return null;
    const end = both.water.sum.endline;
    const th: React.CSSProperties = { padding: '7px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: '#0ea5e9', textAlign: 'right' };
    const td: React.CSSProperties = { padding: '6px 12px', fontSize: 11.5, borderBottom: '1px solid #eef2f7', textAlign: 'right' };
    const rows: [string, any][] = [['Water Supply', both.water.sum], ['Sanitation', both.sanitation.sum]];
    const exHeaders = [`Sector · ${scopeName}`, 'Current (%)', `BAU ${end} (%)`, `Target ${end} (%)`, `With reforms ${end} (%)`];
    const exRows = rows.map(([label, s]) => [label, +(s.curCov * 100).toFixed(2), +(s.bauCov * 100).toFixed(2), +(s.tgtCov * 100).toFixed(2), +(s.scnCov * 100).toFixed(2)]);
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 4, maxWidth: 720 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f' }}>Executive summary — safely-managed coverage (% of households)</div>
          <TableExport filename="executive_summary_coverage" sheetName="Exec summary" headers={exHeaders} rows={exRows} compact />
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, maxWidth: 720 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 460 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}>Sector · {scopeName}</th>
              <th style={th}>Current</th><th style={th}>BAU {end}</th><th style={th}>Target {end}</th><th style={th}>With reforms {end}</th>
            </tr></thead>
            <tbody>
              {rows.map(([label, s], i) => (
                <tr key={label} style={{ background: i % 2 ? '#f1f8fd' : '#fff' }}>
                  <td style={{ ...td, textAlign: 'left', color: '#334155', fontWeight: 600 }}>{label}</td>
                  <td style={{ ...td, color: '#475569' }}>{pct(s.curCov)}</td>
                  <td style={{ ...td, color: C.bau }}>{pct(s.bauCov)}</td>
                  <td style={{ ...td, color: C.target }}>{pct(s.tgtCov)}</td>
                  <td style={{ ...td, color: C.scenario, fontWeight: 700 }}>{pct(s.scnCov)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ── Table 3: Investment gap (BAU basis), by period. ── & Table 5: Unit costs. ───────────────────
  const InvestmentGapTable = ({ inv }: { inv: InvTable }) => {
    const th: React.CSSProperties = { padding: '6px 10px', fontSize: 10.5, fontWeight: 700, color: '#fff', background: '#0369a1', textAlign: 'right' };
    const td: React.CSSProperties = { padding: '5px 10px', fontSize: 11, borderBottom: '1px solid #eef2f7', textAlign: 'right' };
    const exHeaders = [`Investment gap (BAU, ${cur} B)`, ...inv.periods.map(p => p.label)];
    const exRows = inv.rows.map(r => [r.label, ...r.vals.map(v => +v.toFixed(4))]);
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>Investment gap (BAU, {cur} b)</div>
          <TableExport filename="investment_gap" sheetName="Investment gap" headers={exHeaders} rows={exRows} compact />
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
            <thead><tr>
              <th style={{ ...th, textAlign: 'left' }}> </th>
              {inv.periods.map(p => <th key={p.label} style={th}>{p.label}</th>)}
            </tr></thead>
            <tbody>
              {inv.rows.map((r, i) => (
                <tr key={r.label} style={{ background: r.strong ? '#eef6fb' : i % 2 ? '#f8fbfd' : '#fff', fontWeight: r.strong ? 700 : 400 }}>
                  <td style={{ ...td, textAlign: 'left', color: r.strong ? '#1e3a5f' : '#334155' }}>{r.label}</td>
                  {r.vals.map((v, j) => <td key={j} style={{ ...td, color: r.strong ? '#1e3a5f' : '#0369a1' }}>{sig3(v)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const UnitCostTable = ({ unit }: { unit: { sm: number; basic: number } }) => {
    const td: React.CSSProperties = { padding: '5px 10px', fontSize: 11, borderBottom: '1px solid #eef2f7', textAlign: 'right' };
    const avg = (unit.sm + unit.basic) / 2;
    const rows: [string, number][] = [
      ['Safely-managed service', unit.sm],
      ['Basic service', unit.basic],
      ['Average capex per HH', avg],
    ];
    const exHeaders = ['Service', `Unit cost per HH (${cur})`];
    const exRows = rows.map(([label, v]) => [label, Math.round(v)]);
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3, maxWidth: 420 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>Unit cost per household ({cur})</div>
          <TableExport filename="unit_cost_per_hh" sheetName="Unit cost" headers={exHeaders} rows={exRows} compact />
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, maxWidth: 420 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {rows.map(([label, v], i) => (
                <tr key={label} style={{ background: i === 2 ? '#eef6fb' : i % 2 ? '#f8fbfd' : '#fff', fontWeight: i === 2 ? 700 : 400 }}>
                  <td style={{ ...td, textAlign: 'left', color: '#334155' }}>{label}</td>
                  <td style={{ ...td, color: '#0369a1' }}>{Math.round(v).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 2 }}>Unit costs shown for the selected geographic scope ({scopeName}).</div>
      </div>
    );
  };

  const sectorBlock = (secKey: 'water' | 'sanitation') => {
    if (!both) return null;
    const s = secKey === 'water' ? both.water : both.sanitation;
    const label = secKey === 'water' ? 'Water Supply' : 'Sanitation';
    const cs = secKey === 'water' ? contrib?.water : contrib?.sanitation;
    const csBands = cs?.bands ?? [];
    const allCovData = cs ? (isShare ? asShareStack(cs.covRows, csBands) : cs.covRows) : [];
    const covData = filterChartYears(allCovData);
    const basicData = filterChartYears(s.basicRows);
    const gapData = filterChartYears(cs?.gapRows ?? []);
    // Both coverage charts share a household scale, including the total-households
    // ceiling, so their heights can be compared directly in count mode.
    const coverageExtents = covData.map(r => {
      let running = r.__bau || 0;
      let min = running, max = running;
      csBands.forEach(b => { running += r[b.key] || 0; min = Math.min(min, running); max = Math.max(max, running); });
      return { min, max, ceiling: Math.max(r.__total || 0, r.__target || 0) };
    });
    const maxCoverage = Math.max(0, ...coverageExtents.map(v => Math.max(v.max, v.ceiling)),
      ...basicData.map(r => Math.max(r.total, r.bau, r.scenario, r.target)));
    const minCoverage = Math.min(0, ...coverageExtents.map(v => v.min));
    const coverageDomain: [number, number] = isShare
      ? [minCoverage, 1]
      : [minCoverage < 0 ? minCoverage * 1.05 : 0, maxCoverage > 0 ? maxCoverage * 1.05 : 1];
    // Coverage stack: BAU base (blue) at the bottom, one intervention band on top, then the ceiling & target
    // reference lines (grey Total dashed, green Target dashed) drawn over the stack.
    const covBase = { key: '__bau', label: 'BAU (safely managed)', stroke: C.bau, fill: C.bauFill };
    const covLines = [
      { key: '__total', name: 'Total households', color: C.total, dash: '8 4', width: 1.25 },
      { key: '__target', name: 'Target', color: C.target, dash: '6 3', width: 2 },
    ];
        // Gap chart: NO base area — signed marginal gap changes start at zero, and a dashed line marks the total
        // BAU gap. Positive deltas close that gap; negative deltas widen it.
    const gapLines = [{ key: '__bau_gap', name: 'Total financing gap (BAU) — target to close', color: C.gap, dash: '6 3', width: 2 }];
    const noImpact = Math.abs(s.sum.addHH) < 1e-4 && Math.abs(s.sum.gapBauCum - s.sum.gapScnCum) < 1e-4;
    const hasActiveOption = [...WATER_INTV, ...SAN_INTV].some(d => !!toggles[d.key])
      || datasets.some((inp: any) => (inp.custom_interventions || []).some((c: any) => c && c.enabled !== false));
    const rows = secKey === 'water' ? table?.water : table?.sanitation;
    const hhCol = secKey === 'water' ? "Added HHs with treated, piped (HHs '000)" : "Added safely-managed HHs (HHs '000)";
    return (
      <div key={secKey} style={{ marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid #e2e8f0', paddingBottom: 4, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e3a5f' }}>{label}</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>· {scopeName}</span>
        </div>
        <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #0ea5e9', borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, marginBottom: 12 }}>
            <b>By {s.sum.endline}</b>, safely-managed coverage changes from <b>{pct(s.sum.bauCov)}</b> (BAU) to <b>{pct(s.sum.scnCov)}</b> with the current interventions — a net change of <b>{sig3(s.sum.addHH)} M</b> households — against a target of <b>{pct(s.sum.tgtCov)}</b>.
          <br />Cumulative programme investment requirement: <b>{sigB(s.sum.requirementBau)} B {cur}</b> (BAU costs) and <b>{sigB(s.sum.requirementScenario)} B {cur}</b> (scenario costs). Sum of annual financing shortfalls: <b>{sigB(s.sum.gapBauCum)} B {cur}</b> (BAU) and <b>{sigB(s.sum.gapScnCum)} B {cur}</b> (scenario).
            <br />Additional public financing requirement, holding other scenario financing (including loans and direct utility cash) fixed and recomputing zero-opening carry: before explicit public contributions <b>{sigB(s.sum.residualPublicBefore)} B {cur}</b>; explicit public capital entered <b>{sigB(s.sum.additionalPublicCapital)} B {cur}</b>; residual after contributions <b>{sigB(s.sum.residualPublicAfter)} B {cur}</b>. This is an output, not an automatically supplied government source.
          <br />Terminal unmet coverage in {s.sum.endline}: <b>{sig3(s.sum.unmetSm)} M</b> Safely Managed households and <b>{sig3(s.sum.unmetBasic)} M</b> Basic households (exclusive categories). These are coverage snapshots, not additional investment requirements.
        </div>
        {noImpact && (
          <div style={{ fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '5px 9px', marginBottom: 10 }}>
            {hasActiveOption
              ? `Enabled options produce no net change in ${label.toLowerCase()} endline coverage or cumulative financing gap; individual marginal effects may offset one another.`
              : `No interventions are active for ${label.toLowerCase()}. Toggle some on above to break down the impact by intervention.`}
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 8 }}>
          <StackChart title={`${label} — safely-managed coverage`} subtitle="BAU base + each intervention's signed marginal household change (target & ceiling shown as lines)"
            data={covData} yLabel={isShare ? '% of population' : '# households (millions)'}
            base={covBase} bands={csBands} lines={covLines} fmt={covFmt} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_coverage`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_coverage`} />
          <BasicCoverageChart title={`${label} — basic coverage`} rows={basicData} isShare={isShare} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_basic_coverage`}
            captureKey={`${secKey === 'water' ? 'water' : 'san'}_basic_coverage`} />
          <StackChart title={`${label} — annual financing gap`} subtitle="Signed, order-dependent changes: positive closes the gap; negative widens it"
            data={gapData} yLabel={`Financing gap (B ${cur}/yr)`}
            bands={csBands} lines={gapLines} fmt={gapFmt}
            filename={`${scopeName}_${secKey}_financing_gap`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_gap`} />
        </div>
        <ScenarioGapTables rows={s.financeRows} sector={secKey} label={label} scope={scopeName} currency={cur} />
        <BorrowingPoolsTable pools={borrowingPools} sector={secKey} currency={cur} scope={scopeName} />
        <InterventionOutputTable rows={s.outputRows} years={s.outputYears} currency={cur} sector={secKey} scope={scopeName} />
        {rows && rows.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', marginBottom: 3 }}>Order-dependent marginal effects (cumulative to {s.sum.endline})</div>
            <ImpactTable rows={rows} hhCol={hhCol} />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12, alignItems: 'start' }}>
          <InvestmentGapTable inv={s.inv} />
          <UnitCostTable unit={s.unit} />
        </div>
      </div>
    );
  };

  // ── Intervention on/off toggle bar (details live on the Intervention Design tab) ─────────────────
  const ToggleColumn = ({ title, defs }: { title: string; defs: IntvDef[] }) => (
    <div style={{ flex: 1, minWidth: 220 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1e3a5f', marginBottom: 5 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {defs.map(d => {
          const on = !!toggles[d.key];
          return (
            <label key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, cursor: 'pointer',
              padding: '4px 8px', background: on ? '#eff6ff' : '#fff', border: `1px solid ${on ? '#bfdbfe' : '#e5e7eb'}`, borderRadius: 5 }}>
              <input type="checkbox" checked={on} onChange={e => onToggle?.(d.key, e.target.checked)}
                style={{ width: 15, height: 15, accentColor: '#2563eb' }} />
              <span style={{ color: on ? '#1e3a5f' : '#475569', fontWeight: on ? 600 : 400 }}>{d.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '18px 26px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <h2 style={{ fontSize: 17, color: '#1e3a5f', margin: 0 }}>Results — intervention impact (live)</h2>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
            Safely-managed coverage and financing-gap charts show each intervention's signed contribution. Basic coverage compares the BAU, full scenario and target; Basic households may move up to Safely Managed.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Scope</span>
            {/* National entry is one dataset with no urban/rural split, so the only honest view is National —
                offering Urban/Rural there would label the same national numbers as an area's. */}
            <select value={effScope} onChange={e => setViewScope(e.target.value as any)}
              disabled={geoScope === 'national'}
              title={geoScope === 'national' ? 'The data was entered as a single national dataset — there is no urban/rural breakdown to view.' : undefined}
              style={{ padding: '5px 26px 5px 8px', borderRadius: 5, border: '1px solid #94a3b8', fontSize: 12,
                background: geoScope === 'national' ? '#f1f5f9' : '#fff', color: geoScope === 'national' ? '#64748b' : undefined,
                cursor: geoScope === 'national' ? 'not-allowed' : 'pointer' }}>
              {geoScope === 'national' ? <option value="national">National</option> : (<>
                <option value="urban">Urban</option>
                <option value="rural">Rural</option>
                <option value="national">National</option>
              </>)}
            </select>
          </div>
          {chartYears.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Graph years</span>
              <select aria-label="Graph start year" value={chartStart ?? chartYears[0]}
                onChange={e => {
                  const v = +e.target.value; setChartStart(v);
                  if (chartEnd !== null && v > chartEnd) setChartEnd(v);
                }}
                style={{ padding: '5px 6px', borderRadius: 5, border: '1px solid #94a3b8', background: '#fff', fontSize: 11 }}>
                {chartYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <span style={{ fontSize: 11, color: '#64748b' }}>to</span>
              <select aria-label="Graph end year" value={chartEnd ?? chartYears[chartYears.length - 1]}
                onChange={e => {
                  const v = +e.target.value; setChartEnd(v);
                  if (chartStart !== null && v < chartStart) setChartStart(v);
                }}
                style={{ padding: '5px 6px', borderRadius: 5, border: '1px solid #94a3b8', background: '#fff', fontSize: 11 }}>
                {chartYears.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              {(chartStart !== null || chartEnd !== null) &&
                <button onClick={() => { setChartStart(null); setChartEnd(null); }}
                  style={{ border: 'none', background: 'transparent', color: '#2563eb', fontSize: 10.5, cursor: 'pointer', padding: '3px' }}>
                  Reset
                </button>}
            </div>
          )}
          <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
            {([['count', '# Households'], ['share', '% of population']] as const).map(([m, l]) => (
              <button key={m} onClick={() => setUnitMode(m)} style={{
                padding: '5px 10px', fontSize: 11, border: 'none', cursor: 'pointer',
                background: unitMode === m ? '#2563eb' : '#fff', color: unitMode === m ? '#fff' : '#475569',
                fontWeight: unitMode === m ? 700 : 500,
              }}>{l}</button>
            ))}
          </div>
          {/* Excel/CSV post one dataset and run the engine on it, so they take the edited primary (the
              national dataset in national-entry mode); the deck still covers every entered area. */}
          <ExportButtons inputs={primary} pptxCharts={captureResultsCharts} areas={deckAreas} />
        </div>
      </div>

      {/* Intervention on/off toggles — parameters are set on the Intervention Design tab. */}
      <div style={{ border: '1px solid #c7d2fe', background: '#f5f7ff', borderRadius: 8, padding: '10px 14px', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#312e81' }}>Interventions</span>
          <span style={{ fontSize: 10.5, color: '#64748b' }}>Switch each on or off — set its parameters on the <b>Intervention Design</b> tab.</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ToggleColumn title="Water Supply" defs={WATER_INTV} />
          <ToggleColumn title="Sanitation" defs={SAN_INTV} />
        </div>
      </div>

      {error && <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>{error}</div>}
      {!both && !error && <div style={{ fontSize: 12, color: '#64748b', padding: '20px 0' }}>Computing…</div>}

      {/* Executive summary (table 9) — headline coverage, results-first. */}
      <ExecSummary />

      {sectorBlock('water')}
      {sectorBlock('sanitation')}

      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: -6, marginBottom: 16 }}>
        Table: “Resources generated” is the finance each lever mobilises (revenue collected, tariff income, recovered-water
        value, sewer revenue, or loans) — cost-side and budget-execution levers show “n/a” as they stretch existing budget
        rather than raise new money. “Added HHs” is each lever’s marginal safely-managed service. Enabled custom
        interventions appear as a single “Custom interventions” band on the charts above, but are not itemised in this table.
      </div>

      {scenarios.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <h3 style={{ fontSize: 13, marginBottom: 6, fontWeight: 600, color: '#1e3a5f' }}>Saved scenarios</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {scenarios.map((sc, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 14px', background: '#f8fafc' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1e3a5f', marginBottom: 4 }}>{sc.name}</div>
                <button onClick={() => {
                  // A saved scenario stores every area it was entered with, so export the full deck.
                  fetch('/api/export/deck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ areas: scenarioAreas(sc.inputs) }) })
                    .then(r => r.blob()).then(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${sc.name}.pptx`; a.click(); URL.revokeObjectURL(u); });
                }} style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#374151' }}>
                  📑 Export slides
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
