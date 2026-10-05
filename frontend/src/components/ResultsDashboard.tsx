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
import { aggregateContributionRows, ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, type CurrencyDisplaySettings, validRate } from '../currencyDisplay';

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
type IntvDef = { key: string; label: string; resourceKey?: string; color: string };
const WATER_INTV: IntvDef[] = [
  { key: 'ws_financial_commitment_enabled', label: 'Increase in Financial Commitments', resourceKey: 'scenario_financial_commitment_cash', color: P.financial },
  { key: 'ws_exogenous_injection_enabled', label: 'Exogenous Injection of Funds', resourceKey: 'scenario_exogenous_injection_cash', color: P.injection },
  { key: 'ws_collection_efficiency_enabled', label: 'Increased collection efficiency', resourceKey: 'scenario_collection_cash', color: P.collection },
  { key: 'ws_nrw_enabled', label: 'NRW reduction', resourceKey: 'scenario_nrw_net', color: P.nrw },
  { key: 'ws_capital_efficiency_enabled', label: 'Budget execution improvement', color: P.budgetExec },
  { key: 'ws_costeff_enabled', label: 'Capex efficiency (unit cost)', color: P.capex },
  { key: 'ws_techmix_enabled', label: 'Optimised technology selection', color: P.techmix },
  { key: 'ws_tariff_enabled', label: 'Tariff reform', resourceKey: 'scenario_tariff_cash', color: P.tariff },
  { key: 'ws_microfinance_enabled', label: 'Microfinance', resourceKey: 'scenario_mf_loan_volume', color: P.microfinance },
];
const SAN_INTV: IntvDef[] = [
  { key: 'san_financial_commitment_enabled', label: 'Increase in Financial Commitments', resourceKey: 'scenario_financial_commitment_cash', color: P.financial },
  { key: 'san_exogenous_injection_enabled', label: 'Exogenous Injection of Funds', resourceKey: 'scenario_exogenous_injection_cash', color: P.injection },
  { key: 'san_collection_efficiency_enabled', label: 'Increased collection efficiency', resourceKey: 'scenario_collection_cash', color: P.collection },
  { key: 'san_capital_efficiency_enabled', label: 'Budget execution improvement', color: P.budgetExec },
  { key: 'san_costeff_enabled', label: 'Capex efficiency (unit cost)', color: P.capex },
  { key: 'san_techmix_enabled', label: 'Optimised technology selection', color: P.techmix },
  { key: 'san_nrw_link_enabled', label: 'NRW-linked sanitation revenue', resourceKey: 'scenario_nrw_link_cash', color: P.nrw },
  { key: 'san_tariff_enabled', label: 'Tariff reform', resourceKey: 'scenario_tariff_cash', color: P.tariff },
  { key: 'san_microfinance_enabled', label: 'Microfinance', resourceKey: 'scenario_mf_loan_volume', color: P.microfinance },
];

interface Props {
  geoScope: 'urban' | 'rural' | 'urban_rural' | 'national';
  scenarios: { name: string; inputs: any }[];
  inputs: any;
  altInputs?: Record<string, any>;
  onToggle?: (key: string, value: boolean) => void;
  contributionView: ContributionView;
  onContributionViewChange: (v: ContributionView) => void;
  currencyDisplay: CurrencyDisplaySettings;
  onCurrencyDisplayChange: (v: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void;
}

type InvTable = { periods: { label: string; lo: number; hi: number }[]; rows: { label: string; vals: number[]; strong?: boolean }[] };
type DebtData = { summary: any; rows: any[]; areas: any[] };
type Series = { sum: any; inv: InvTable; unit: { sm: number; basic: number }; basicRows: BasicCoverageRow[]; financeRows: FinanceYear[]; debt: DebtData };
type Both = { water: Series; sanitation: Series } | null;
type Row = { key: string; label: string; addHH: number; resources: number | null };

// Per-intervention stacked breakdown for a sector. covRows/gapRows are per-year rows keyed by each band's
// label (plus reserved keys __bau/__total/__target for coverage and __remain for the gap). `bands` lists the
// interventions that actually contribute (each with its INTV_PALETTE colour), in stack order.
type ContribBand = { key: string; label: string; color: string; interventionKey?: string; custom?: boolean; members?: { key: string; label: string }[] };
type ContribSeries = { covRows: any[]; gapRows: any[]; bands: ContribBand[] };
type Contrib = { water: ContribSeries; sanitation: ContribSeries } | null;

// A stacked-contribution chart: a base area at the bottom, one stacked band per intervention on top (so the
// coloured stack IS each lever's marginal contribution), plus optional reference lines drawn over the top.
function StackChart({ title, subtitle, data, base, bands, lines, fmt, yLabel, domain, filename, captureKey, currencyDisplay }: {
  title: string; subtitle?: string; data: any[]; yLabel: string;
  base?: { key: string; label: string; stroke: string; fill: string };   // optional bottom area (coverage BAU)
  bands: ContribBand[];
  lines: { key: string; name: string; color: string; dash?: string; width?: number }[];
  fmt: (v: number) => string; domain?: [number, number]; filename: string; captureKey: string;
  currencyDisplay?: CurrencyDisplaySettings;
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
  // Coverage: BAU base at the bottom then a band per intervention. Financing gap: no base — the intervention
  // bands stack up from zero and a reference line marks the total BAU gap (the distance up to it is the gap left).
  const baseArea = base ? (
    <Area key={base.key} type="monotone" dataKey={base.key} name={base.label} stackId="s" fill={base.fill} stroke={base.stroke} fillOpacity={0.7} strokeWidth={1.25} legendType="rect" isAnimationActive={false} />
  ) : null;
  const bandAreas = bands.map(b => (
    <Area key={b.key} type="monotone" dataKey={b.key} name={b.label} stackId="s" fill={b.color} stroke={b.color} fillOpacity={0.6} strokeWidth={1.5} strokeOpacity={1} legendType="rect" isAnimationActive={false} />
  ));
  const stackAreas = base ? [baseArea, ...bandAreas] : bandAreas;
  return (
    <div data-results-chart={captureKey} style={{ marginBottom: 12 }} title="Contributions are incremental in the displayed intervention order. The tariff contribution includes its interaction with collection improvement.">
      {/* Fixed-height header so paired charts' plot areas line up horizontally regardless of subtitle length.
          The title/subtitle column takes the full width (flex:1, minWidth:0 so it can wrap) and overflow is
          clipped to the fixed height. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, height: 50, overflow: 'hidden' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: '#1e3a5f', margin: '0 0 1px' }}>{title}</h4>
          {subtitle && <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 5 }}>{subtitle}</div>}
        </div>
        <ChartExport chartRef={chartRef} filename={filename} title={title} currencyDisplay={currencyDisplay}
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
          <Tooltip formatter={(v: any, name: any, item: any) => {
            const band = bands.find(b => b.label === name || b.key === name);
            if (!band?.members?.length) return fmt(+v) as any;
            const row = item?.payload || {};
            const denominator = row.__source_total || 1;
            const members = band.members.map(m => [m.label, Number(row[m.key] || 0) / denominator] as const)
              .filter(([, amount]) => Math.abs(amount) > 1e-12);
            return `${fmt(+v)}${members.length ? ` · ${members.map(([label, amount]) => `${label}: ${fmt(amount)}`).join(', ')}` : ''}`;
          }} labelFormatter={(l: any) => String(l)} contentStyle={{ fontSize: 11 }} />
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

function UtilityDebtSchedule({ debt, currency, moneyFactor }: { debt: DebtData; currency: string; moneyFactor: number }) {
  if (!debt?.areas?.some(a => a.enabled)) return null;
  const amount = (value: number) => `${sigB(value * moneyFactor)} B`;
  const money = (value: number) => amount(Number(value || 0));
  const summary = debt.summary || {};
  return (
    <section style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', padding: '10px 12px' }}>
      <h4 style={{ margin: '0 0 5px', color: '#1e3a5f', fontSize: 12.5 }}>Utility debt financing — {currency}</h4>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: '#475569', marginBottom: 8 }}>
        Status: <b>{summary.status || 'not enabled'}</b> · accepted principal: <b>{money(summary.accepted_principal)}</b> · scheduled interest: <b>{money(summary.total_interest)}</b> · closing restricted proceeds: <b>{money(summary.closing_restricted_cash)}</b>
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 8, lineHeight: 1.45 }}>
        Per-area assumptions: {debt.areas.filter(a => a.enabled).map((a, i) =>
          <span key={i}>{i ? ' · ' : ''}{a.area}: {((Number(a.allocation_share) || 0) * 100).toFixed(1)}% allocation, {((Number(a.annual_real_interest_rate) || 0) * 100).toFixed(2)}% real rate, {a.repayment_structure || 'annuity'}, disbursed {a.disbursement_year || '—'}, maturity {a.maturity_year || '—'}, {a.verified_feasible ? 'verified' : (a.status || 'not sized')}</span>)}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{summary.tail_capacity_assumption || 'Loan proceeds and eligible operating cash are reported separately.'}</div>
      {debt.rows.length > 0 && <div style={{ overflowX: 'auto', maxHeight: 320 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, whiteSpace: 'nowrap' }}>
          <thead><tr>{[
            'Year', 'Opening principal', 'Disbursement', 'Principal paid', 'Interest paid',
            'Debt service', 'Service capacity', 'Shortfall', 'Opening restricted cash',
            'Loan-funded investment', 'Closing restricted cash',
          ].map(h => <th key={h} style={{ position: 'sticky', top: 0, background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', padding: '5px 7px', textAlign: h === 'Year' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>{debt.rows.map((r: any) => <tr key={r.year}>
            <td style={{ borderBottom: '1px solid #eef2f7', padding: '4px 7px' }}>{r.year}</td>
            {[
              r.opening_principal, r.disbursement, r.principal_payment, r.interest_payment,
              r.total_debt_service, r.annual_service_capacity, r.payment_shortfall,
              r.opening_restricted_cash, r.investment_from_loan_proceeds, r.closing_restricted_cash,
            ].map((v: number, i: number) => <td key={i} style={{ borderBottom: '1px solid #eef2f7', padding: '4px 7px', textAlign: 'right' }}>{money(v)}</td>)}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
  );
}

export default function ResultsDashboard({ geoScope, scenarios, inputs, altInputs, onToggle, contributionView, onContributionViewChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate }: Props) {
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
  const resultCurrencies = [...new Set(datasets.map((data: any) => String(data?.country_config?.currency || 'LCU').toUpperCase()))];
  const mixedCurrencies = resultCurrencies.length > 1;
  const useUsd = currencyDisplay.mode === 'usd' && !mixedCurrencies && validRate(currencyDisplay, cur);
  const displayCur = useUsd ? 'USD' : cur;
  const moneyFactor = useUsd && cur.toUpperCase() !== 'USD' ? 1 / (currencyDisplay.localPerUsd as number) : 1;
  const displayMoney = (v: number) => v * moneyFactor;
  const detailExportCurrency = mixedCurrencies ? { ...currencyDisplay, mode: 'local' as const } : currencyDisplay;
  const toggles = primary?.toggles || {};
  const depKey = JSON.stringify(datasets);

  // ── Fan charts: BAU vs the user's full designed scenario (interventions + customs) ──────────────
  useEffect(() => {
    if (!datasets.length || !datasets[0]) return;
    const h = setTimeout(() => {
      Promise.all(datasets.map((inp: any) =>
        fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(inp) })
          .then(r => { if (!r.ok) throw new Error('calc failed (' + r.status + ')'); return r.json(); })
      )).then(resList => {
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
          const tEnd = totalHH[endIdx] || 0;
          const covPct = (a: number[]) => tEnd > 0 ? Math.min(tEnd, a[endIdx]) / tEnd : 0;
          const endRequirement = (key: string) => sum((r, i) => secOf(r)[key][i])[endIdx];
          // Current (baseline-year) safely-managed coverage — BAU at the baseline = the actual.
          const baseIdx = Math.max(0, years.indexOf(baseYr));
          const tBase = totalHH[baseIdx] || 0;
          const curCov = tBase > 0 ? Math.min(tBase, bau[baseIdx]) / tBase : 0;
          // Investment-gap table (BAU basis): annual flows summed over each period, millions → billions.
          const newCap = sum((r, i) => secOf(r).new_capex_total?.[i] || 0);
          const repl = sum((r, i) => secOf(r).replacement_capex?.[i] || 0);
          const totNeed = sum((r, i) => secOf(r).total_investment_need?.[i] || 0);
          const bauInv = sum((r, i) => secOf(r).bau_available?.[i] || 0);
          const scnInv = sum((r, i) => secOf(r).scenario_available_total[i]);
          const ledger = (key: string) => sum((r, i) => secOf(r)[key][i]);
          const loanCum = sum((r, i) => secOf(r).scenario_mf_loan_volume[i]);
          const grantCum = sum((r, i) => secOf(r).scenario_grant_spend[i]);
          const rungSeries = (key: string, rung: number) => sum((r, i) => secOf(r)[key][rung][i]);
          const rungData = [0, 1].map(rung => ({
            bau: rung === 0 ? bau : basicBau,
            scenario: rung === 0 ? scn : basicScn,
            target: rung === 0 ? tgt : basicTgt,
            newBau: rungSeries('new_capex_by_service', rung),
            replacementBau: rungSeries('replacement_by_service', rung),
            fundedBau: rungSeries('funded_by_service', rung),
            gapBau: rungSeries('financing_gap_by_service', rung),
            newScenario: rungSeries('scenario_new_capex_by_service', rung),
            replacementScenario: rungSeries('scenario_replacement_by_service', rung),
            fundedScenario: rungSeries('scenario_funded_by_service', rung),
            gapScenario: rungSeries('scenario_financing_gap_by_service', rung),
            deficitBau: rungSeries('cash_deficit_by_service', rung),
            deficitScenario: rungSeries('scenario_cash_deficit_by_service', rung),
          }));
          const financeRows: FinanceYear[] = years.flatMap((year, i) => year <= baseYr ? [] : [{
            year, total: totalHH[i], bauAvailable: bauInv[i], scenarioAvailable: scnInv[i],
            planned: ledger('scenario_annual_planned_expansion_cost')[i],
            catchUp: ledger('scenario_catch_up_requirement')[i],
            outstanding: ledger('scenario_closing_outstanding_expansion')[i],
            endlineRequirement: ledger('scenario_endline_financing_requirement')[i],
            stock: ledger('scenario_funded_asset_stock')[i],
            offBudgetLoans: loanCum[i] - (loanCum[i - 1] || 0),
            offBudgetGrants: grantCum[i] - (grantCum[i - 1] || 0),
            bauGap: bauGap[i], scenarioGap: scnGap[i],
            replacementReserved: ledger('scenario_replacement_reserved')[i],
            coverageReplacement: ledger('scenario_bau_replacement_capex')[i],
            expansionAvailable: ledger('scenario_expansion_capital_available')[i],
            purchaseCapital: ledger('scenario_connection_purchase_capital')[i],
            unallocatedCapital: ledger('scenario_unallocated_positive_capital')[i],
            cashDeficit: ledger('scenario_cash_deficit')[i],
            services: rungData.map(d => ({
              bau: d.bau[i], scenario: d.scenario[i], target: d.target[i],
              newBau: d.newBau[i], replacementBau: d.replacementBau[i],
              fundedBau: d.fundedBau[i], gapBau: d.gapBau[i],
              newScenario: d.newScenario[i], replacementScenario: d.replacementScenario[i],
              fundedScenario: d.fundedScenario[i], gapScenario: d.gapScenario[i],
              deficitBau: d.deficitBau[i], deficitScenario: d.deficitScenario[i],
            })) as [FinanceYear['services'][0], FinanceYear['services'][1]],
          }]);
          const periods = buildPeriods(years, baseYr);
          const invRow = (label: string, arr: number[], strong = false, balance = false) =>
            ({ label, strong, vals: periods.map(p => (balance ? arr[Math.max(0, years.filter(y => y <= p.hi).length - 1)] : sumRange(arr, years, p.lo, p.hi)) / 1000) });
          const inv: InvTable = { periods, rows: [
            invRow('Planned expansion — annual flows', ledger('annual_planned_expansion_cost')),
            invRow('Replacement — annual flows', repl),
            invRow('Closing outstanding expansion — end balance', ledger('closing_outstanding_expansion'), false, true),
            invRow('Catch-up before funding — end-year snapshot', ledger('catch_up_requirement'), false, true),
            invRow('Replacement credit — annual flows', ledger('replacement_credit')),
            invRow('Unpaid replacement — annual flows', ledger('unfunded_replacement')),
            invRow('Negative cash — annual flows', ledger('cash_deficit')),
            invRow('Endline requirement incl. all prior shortfalls', ledger('endline_financing_requirement'), true, true),
            invRow('Gross funded asset stock — end balance', ledger('funded_asset_stock'), false, true),
            invRow('Sector-funded expansion — annual flows', ledger('sector_funded_expansion')),
            invRow('Externally funded expansion — annual flows', ledger('externally_funded_expansion')),
            invRow('Total available capital (reporting only)', bauInv),
            invRow('Coverage-stock replacement basis', ledger('bau_replacement_capex')),
            invRow('Replacement funding reserved', ledger('replacement_reserved')),
            invRow('Actual funded connection purchases', ledger('connection_purchase_capital')),
            invRow('Unallocated positive expansion capital', ledger('unallocated_positive_capital')),
          ] };
          const debtAreas = resList.map((r: any, areaIndex: number) => ({
            ...(secOf(r).scenario_utility_debt || {}),
            area: (datasets[areaIndex]?.country_config?.area || datasets[areaIndex]?.country_config?.country || `Area ${areaIndex + 1}`),
          }));
          const debtRowMap = new Map<number, any>();
          const debtFields = [
            'opening_principal', 'disbursement', 'principal_payment', 'interest_payment',
            'total_debt_service', 'closing_principal', 'eligible_additional_revenue',
            'pre_debt_available_capital', 'replacement_requirement', 'annual_service_capacity',
            'payment_shortfall', 'opening_restricted_cash', 'investment_from_loan_proceeds',
            'closing_restricted_cash',
          ];
          debtAreas.forEach(area => (area.schedule || []).forEach((row: any) => {
            const total = debtRowMap.get(Number(row.year)) || { year: Number(row.year), ...Object.fromEntries(debtFields.map(k => [k, 0])) };
            debtFields.forEach(k => { total[k] += Number(row[k] || 0); });
            debtRowMap.set(Number(row.year), total);
          }));
          const sumDebt = (key: string) => debtAreas.reduce((sum, a) => sum + Number(a[key] || 0), 0);
          const debt: DebtData = {
            areas: debtAreas,
            rows: [...debtRowMap.values()].sort((a, b) => a.year - b.year),
            summary: {
              enabled: debtAreas.some(a => a.enabled),
              status: [...new Set(debtAreas.filter(a => a.enabled).map(a => a.status))].join(' · ') || 'disabled',
              accepted_principal: sumDebt('accepted_principal'),
              total_interest: sumDebt('total_interest'),
              total_principal_repaid: sumDebt('total_principal_repaid'),
              closing_restricted_cash: sumDebt('closing_restricted_cash'),
              tail_capacity_assumption: debtAreas.find(a => a.enabled)?.tail_capacity_assumption,
            },
          };
          const unit = { sm: secOf(resList[0]).cost_per_hh || 0, basic: secOf(resList[0]).cost_basic || 0 };
          return { inv, unit, basicRows, financeRows, debt, sum: {
            endline: years[endIdx], curCov, bauCov: covPct(bau), scnCov: covPct(scn), tgtCov: covPct(tgt),
            addHH: Math.min(tEnd, scn[endIdx]) - Math.min(tEnd, bau[endIdx]),
            gapBauCum: endRequirement('endline_financing_requirement'), gapScnCum: endRequirement('scenario_endline_financing_requirement'),
          } };
        };
        setBoth({ water: build('water_supply'), sanitation: build('sanitation') });
        setError(null);
      }).catch(e => { setBoth(null); setError(String(e)); });
    }, 350);
    return () => clearTimeout(h);
  }, [depKey]);

  // ── Per-intervention breakdown: cumulative passes over the ENABLED built-in toggles isolate each lever's
  //    marginal safely-managed households (Δ scenario_hh) and gap reduction (Δ scenario_financing_gap) per
  //    YEAR, plus its mobilised resources at the endline. Feeds both the endline table AND the stacked
  //    per-intervention charts. Enabled customs are folded into one final pass so the stack still tops out
  //    at the true with-interventions scenario (shown as a single "Custom interventions" band). ───────────
  useEffect(() => {
    if (!datasets.length || !datasets[0]) { setTable(null); setContrib(null); return; }
    const enW = WATER_INTV.filter(d => toggles[d.key]);
    const enS = SAN_INTV.filter(d => toggles[d.key]);
    const enabled = [...enW, ...enS];                              // global cumulative order (water then san)
    const hasCustoms = datasets.some((inp: any) => (inp.custom_interventions || []).some((c: any) => c && c.enabled !== false));
    const hasUtilityDebt = datasets.some((inp: any) =>
      ['water', 'sanitation'].some((sector: string) => inp.utility_debt?.[sector]?.enabled && Number(inp.utility_debt?.[sector]?.allocation_share || 0) > 0));
    const h = setTimeout(() => {
      const off = Object.fromEntries(Object.keys(toggles).map(k => [k, false]));
      const sets: any[] = [{ ...off }];                            // pass 0 = BAU (all off)
      let acc: any = { ...off };
      enabled.forEach(d => { acc = { ...acc, [d.key]: true }; sets.push({ ...acc }); });   // +1 pass per lever
      const withoutDebt = (settings: any) => ({
        ...(settings || {}),
        water: { ...(settings?.water || {}), enabled: false },
        sanitation: { ...(settings?.sanitation || {}), enabled: false },
      });
      const fetchPass = (tg: any, useCustoms: boolean, debtEnabled = false) => Promise.all(datasets.map((inp: any) =>
        fetch('/api/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...inp, toggles: tg, custom_interventions: useCustoms ? (inp.custom_interventions || []) : [],
            utility_debt: debtEnabled ? inp.utility_debt : withoutDebt(inp.utility_debt) }) }).then(r => r.json())));
      const specs = sets.map(tg => ({ tg, customs: false }));
      if (hasCustoms) specs.push({ tg: acc, customs: true });      // final pass = all built-ins on + real customs
      Promise.all(specs.map(s => fetchPass(s.tg, s.customs)).concat(hasUtilityDebt ? [fetchPass(acc, true, true)] : [])).then(allPasses => {
        const debtPass = hasUtilityDebt ? allPasses.pop() : null;
        const passes = allPasses;                                // each pass = results[] (one/dataset)
        const years: number[] = passes[0][0].years;
        const per = datasets[0]?.period || {};
        const baseYr = per.baseline_year ?? years[0];
        const endIdx = years.length - 1;
        const nBuiltin = enabled.length;                           // passes[1..nBuiltin] built-in; passes[nBuiltin+1] = customs
        const smY = (rl: any[], sk: string, i: number) => rl.reduce((a, r) => a + (r[sk].scenario_hh[0][i] || 0), 0);
        const gapY = (rl: any[], sk: string, i: number) => rl.reduce((a, r) => a + r[sk].scenario_endline_financing_requirement[i], 0);
        const totY = (i: number) => passes[0].reduce((a: number, r: any) => a + (r.total_hh[i] || 0), 0);
        const tgtY = (sk: string, i: number) => passes[0].reduce((a: number, r: any) => a + (r[sk].target_hh[0][i] || 0), 0);
        const cashCum = (rl: any[], sk: string, f: string) => rl.reduce((a, r) =>
          a + (r[sk][f] || []).reduce((s: number, v: number, i: number) => s + (years[i] > baseYr ? (v || 0) : 0), 0), 0);
        const idxOf = (d: IntvDef) => enabled.findIndex(e => e.key === d.key);   // cumulative position of a lever
        const fullNoDebtIdx = hasCustoms ? nBuiltin + 1 : nBuiltin;

        // ── stacked per-year series for one sector ──
        const buildContrib = (defs: IntvDef[], sk: string): ContribSeries => {
          const en = defs.filter(d => toggles[d.key]);
          const covRows: any[] = [], gapRows: any[] = [];
          years.forEach((y, i) => {
            const covRow: any = { year: y, __bau: +smY(passes[0], sk, i).toFixed(4), __total: +totY(i).toFixed(4), __target: +tgtY(sk, i).toFixed(4) };
            const bauGap = gapY(passes[0], sk, i);
            const gapRow: any = { year: y };
            let sumRed = 0;
            en.forEach(d => {
              const idx = idxOf(d);
              covRow[d.label] = smY(passes[idx + 1], sk, i) - smY(passes[idx], sk, i);
              const red = gapY(passes[idx], sk, i) - gapY(passes[idx + 1], sk, i);
              gapRow[d.label] = red / 1000;          // M → B
              sumRed += red;
            });
            if (hasCustoms) {
              covRow['Custom interventions'] = smY(passes[nBuiltin + 1], sk, i) - smY(passes[nBuiltin], sk, i);
              const redC = gapY(passes[nBuiltin], sk, i) - gapY(passes[nBuiltin + 1], sk, i);
              gapRow['Custom interventions'] = redC / 1000;
              sumRed += redC;
            }
            if (debtPass) {
              covRow['Utility debt financing'] = smY(debtPass, sk, i) - smY(passes[fullNoDebtIdx], sk, i);
              const redDebt = gapY(passes[fullNoDebtIdx], sk, i) - gapY(debtPass, sk, i);
              gapRow['Utility debt financing'] = redDebt / 1000;
              sumRed += redDebt;
            }
            gapRow.__remain = (bauGap - sumRed) / 1000;
            gapRow.__bau_gap = +(bauGap / 1000).toFixed(4);                        // total BAU gap → the target line to close
            covRows.push(covRow); gapRows.push(gapRow);
          });
          const all: ContribBand[] = en.map(d => ({ key: d.label, label: d.label, color: d.color, interventionKey: d.key }));
          if (hasCustoms) all.push({ key: 'Custom interventions', label: 'Custom interventions', color: P.custom, custom: true });
          if (debtPass) all.push({ key: 'Utility debt financing', label: 'Utility debt financing', color: P.utilityDebt, interventionKey: 'utility_debt_financing' });
          // keep only bands that actually move either chart (an enabled-but-unparameterised lever adds 0)
          const bands = all.filter(b => covRows.some(r => Math.abs(r[b.key] || 0) > 1e-12) || gapRows.some(r => Math.abs(r[b.key] || 0) > 1e-12));
          return { covRows, gapRows, bands };
        };
        setContrib({ water: buildContrib(WATER_INTV, 'water_supply'), sanitation: buildContrib(SAN_INTV, 'sanitation') });

        // ── endline resources-and-households table (built-in levers only) ──
        if (!enabled.length && !debtPass) { setTable({ water: [], sanitation: [] }); return; }
        const smEnd = (rl: any[], sk: string) => smY(rl, sk, endIdx);
        const rowsFor = (defs: IntvDef[], sk: string): Row[] => {
          const rows = defs.filter(d => toggles[d.key]).map(d => {
          const idx = idxOf(d);
          const after = passes[idx + 1], before = passes[idx];
          const addHH = (smEnd(after, sk) - smEnd(before, sk)) * 1000;
          const resources = d.resourceKey
            ? (cashCum(after, sk, d.resourceKey) - cashCum(before, sk, d.resourceKey)) / 1000               // M → B
            : null;
          return { key: d.key, label: d.label, addHH, resources };
          });
          if (debtPass) {
            const principal = debtPass.reduce((sum: number, r: any) =>
              sum + Number(r[sk].scenario_utility_debt?.accepted_principal || 0), 0) / 1000;
            const addHH = (smEnd(debtPass, sk) - smEnd(passes[fullNoDebtIdx], sk)) * 1000;
            if (Math.abs(principal) > 1e-12 || Math.abs(addHH) > 1e-12)
              rows.push({ key: 'utility_debt_financing', label: 'Utility debt financing', addHH, resources: principal });
          }
          return rows;
        };
        setTable({ water: rowsFor(WATER_INTV, 'water_supply'), sanitation: rowsFor(SAN_INTV, 'sanitation') });
      }).catch(() => { /* leave the previous view on a transient fetch error */ });
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
    const o: any = { ...r, year: r.year, __source_total: tot, __total: tot > 0 ? 1 : 0, __bau: d(r.__bau || 0), __target: d(r.__target || 0) };
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
    const totRes = rows.reduce((a, r) => a + (r.resources || 0), 0);
    const totHH = rows.reduce((a, r) => a + (r.addHH || 0), 0);
    const th: React.CSSProperties = { padding: '7px 12px', fontSize: 11, fontWeight: 700, color: '#fff', background: '#0ea5e9', textAlign: 'right' };
    const td: React.CSSProperties = { padding: '6px 12px', fontSize: 11.5, borderBottom: '1px solid #eef2f7', textAlign: 'right' };
    const exHeaders = ['Intervention', `Resources / financing (${displayCur} B)`, hhCol];
    const exRows = [...rows.map(r => [r.label, r.resources == null ? 'n/a' : r.resources * moneyFactor, r.addHH]), ['Total', totRes * moneyFactor, totHH]];
    return (
      <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4, maxWidth: 680 }}>
        <TableExport filename="contribution_by_intervention" sheetName="Interventions" headers={exHeaders} rows={exRows} compact currencyDisplay={detailExportCurrency} />
      </div>
      <div style={{ margin: '2px 0 4px', overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, maxWidth: 680 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Intervention</th>
              <th style={th}>Resources / financing ({displayCur} b)</th>
              <th style={th}>{hhCol}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key} style={{ background: i % 2 ? '#f1f8fd' : '#fff' }}>
                <td style={{ ...td, textAlign: 'left', color: '#334155' }}>{r.label}</td>
                <td style={{ ...td, color: '#0369a1' }}>{r.resources == null ? 'n/a' : sig3(r.resources * moneyFactor)}</td>
                <td style={{ ...td, color: '#0369a1' }}>{sig3(r.addHH)}</td>
              </tr>
            ))}
            <tr style={{ background: '#dff1fb', fontWeight: 700 }}>
              <td style={{ ...td, textAlign: 'left', color: '#1e3a5f', borderBottom: 'none' }}>Total</td>
              <td style={{ ...td, color: '#1e3a5f', borderBottom: 'none' }}>{sig3(totRes * moneyFactor)}</td>
              <td style={{ ...td, color: '#1e3a5f', borderBottom: 'none' }}>{sig3(totHH)}</td>
            </tr>
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
          <TableExport filename="executive_summary_coverage" sheetName="Exec summary" headers={exHeaders} rows={exRows} compact currencyDisplay={detailExportCurrency} />
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
    const exHeaders = [`Investment gap (BAU, ${displayCur} B)`, ...inv.periods.map(p => p.label)];
    const exRows = inv.rows.map(r => [r.label, ...r.vals.map(v => +(v * moneyFactor).toFixed(6))]);
    return (
      <div style={{ marginTop: 8 }}>
        <p style={{ fontSize: 11 }}>Flows are summed within each period. Closing balances include opening outstanding work; endline requirements include shortfalls since baseline. Adjacent period-end balances must not be added.</p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>Investment gap (BAU, {displayCur} b)</div>
          <TableExport filename="investment_gap" sheetName="Investment gap" headers={exHeaders} rows={exRows} compact currencyDisplay={detailExportCurrency} />
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
                  {r.vals.map((v, j) => <td key={j} style={{ ...td, color: r.strong ? '#1e3a5f' : '#0369a1' }}>{sig3(v * moneyFactor)}</td>)}
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
    const exHeaders = ['Service', `Unit cost per HH (${displayCur})`];
    const exRows = rows.map(([label, v]) => [label, Math.round(v * moneyFactor)]);
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3, maxWidth: 420 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>Unit cost per household ({displayCur})</div>
          <TableExport filename="unit_cost_per_hh" sheetName="Unit cost" headers={exHeaders} rows={exRows} compact currencyDisplay={detailExportCurrency} />
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6, maxWidth: 420 }}>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {rows.map(([label, v], i) => (
                <tr key={label} style={{ background: i === 2 ? '#eef6fb' : i % 2 ? '#f8fbfd' : '#fff', fontWeight: i === 2 ? 700 : 400 }}>
                  <td style={{ ...td, textAlign: 'left', color: '#334155' }}>{label}</td>
                  <td style={{ ...td, color: '#0369a1' }}>{Math.round(v * moneyFactor).toLocaleString()}</td>
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
    const groupedCov = cs && contributionView === 'category' ? aggregateContributionRows(cs.covRows, cs.bands) : { rows: cs?.covRows ?? [], bands: cs?.bands ?? [] };
    const groupedGap = cs && contributionView === 'category' ? aggregateContributionRows(cs.gapRows, cs.bands) : { rows: cs?.gapRows ?? [], bands: cs?.bands ?? [] };
    const csBands = groupedCov.bands as ContribBand[];
    const gapBands = groupedGap.bands as ContribBand[];
    const allCovData = cs ? (isShare ? asShareStack(groupedCov.rows, csBands) : groupedCov.rows) : [];
    const covData = filterChartYears(allCovData);
    const basicData = filterChartYears(s.basicRows);
    const gapData = filterChartYears(groupedGap.rows).map((r: any) => Object.fromEntries(
      Object.entries(r).map(([key, value]) => [key, key === 'year' || typeof value !== 'number' ? value : value * moneyFactor])
    ));
    // Both coverage charts share a household scale, including the total-households
    // ceiling, so their heights can be compared directly in count mode.
    const maxCoverage = Math.max(0,
      ...covData.map(r => Math.max(r.__total || 0, r.__target || 0,
        (r.__bau || 0) + csBands.reduce((sum, b) => sum + (r[b.key] || 0), 0))),
      ...basicData.map(r => Math.max(r.total, r.bau, r.scenario, r.target)));
    const coverageDomain: [number, number] = isShare ? [0, 1] : [0, maxCoverage > 0 ? maxCoverage * 1.05 : 1];
    // Coverage stack: BAU base (blue) at the bottom, one intervention band on top, then the ceiling & target
    // reference lines (grey Total dashed, green Target dashed) drawn over the stack.
    const covBase = { key: '__bau', label: 'BAU (safely managed)', stroke: C.bau, fill: C.bauFill };
    const covLines = [
      { key: '__total', name: 'Total households', color: C.total, dash: '8 4', width: 1.25 },
      { key: '__target', name: 'Target', color: C.target, dash: '6 3', width: 2 },
    ];
    // Gap chart: NO base area — the intervention gap-reduction bands stack UP from zero (what the levers close),
    // and a dashed line marks the total BAU financing gap. The vertical distance from the top of the stack up to
    // that line is the gap still remaining to reach the fully-financed target.
    const gapLines = [{ key: '__bau_gap', name: 'Total financing gap (BAU) — target to close', color: C.gap, dash: '6 3', width: 2 }];
    const noImpact = Math.abs(s.sum.addHH) < 1e-4 && Math.abs(s.sum.gapBauCum - s.sum.gapScnCum) < 1e-4;
    const rows = secKey === 'water' ? table?.water : table?.sanitation;
    const hhCol = secKey === 'water' ? "Added HHs with treated, piped (HHs '000)" : "Added safely-managed HHs (HHs '000)";
    return (
      <div key={secKey} style={{ marginBottom: 26 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid #e2e8f0', paddingBottom: 4, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e3a5f' }}>{label}</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>· {scopeName}</span>
        </div>
        <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #0ea5e9', borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, marginBottom: 12 }}>
          <b>By {s.sum.endline}</b>, safely-managed coverage increases from <b>{pct(s.sum.bauCov)}</b> (BAU) to <b>{pct(s.sum.scnCov)}</b> with the current interventions — <b>{sig3(s.sum.addHH)} M</b> more households — against a target of <b>{pct(s.sum.tgtCov)}</b>. The endline financing requirement changes from <b>{sigB(displayMoney(s.sum.gapBauCum))}</b> to <b>{sigB(displayMoney(s.sum.gapScnCum))} B {displayCur}</b>.
        </div>
        {noImpact && (
          <div style={{ fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '5px 9px', marginBottom: 10 }}>
            No interventions are active for {label.toLowerCase()}. Toggle some on above to break down the impact by intervention.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 8 }}>
          <StackChart title={`${label} — safely-managed coverage`} subtitle={contributionView === 'category' ? 'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.' : "BAU base + each intervention's added households (target & ceiling shown as lines)"}
            data={covData} yLabel={isShare ? '% of population' : '# households (millions)'}
            base={covBase} bands={csBands} lines={covLines} fmt={covFmt} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_coverage_${contributionView === 'category' ? 'categories' : 'individual'}`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_coverage`} currencyDisplay={detailExportCurrency} />
          <BasicCoverageChart title={`${label} — basic coverage`} rows={basicData} isShare={isShare} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_basic_coverage`}
            captureKey={`${secKey === 'water' ? 'water' : 'san'}_basic_coverage`} />
          <StackChart title={`${label} — year-end financing requirement`} subtitle={contributionView === 'category' ? 'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.' : 'Closing expansion balance plus unpaid replacement and negative cash accumulated since baseline. Year-end balances are not additive.'}
            data={gapData} yLabel={`Year-end requirement (B ${displayCur})`}
            bands={gapBands} lines={gapLines} fmt={gapFmt}
            filename={`${scopeName}_${secKey}_financing_gap_${contributionView === 'category' ? 'categories' : 'individual'}`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_gap`} currencyDisplay={detailExportCurrency} />
        </div>
        <ScenarioGapTables rows={s.financeRows} sector={secKey} label={label} scope={scopeName} currency={displayCur}
          moneyFactor={moneyFactor} currencyDisplay={detailExportCurrency} />
        <UtilityDebtSchedule debt={s.debt} currency={displayCur} moneyFactor={moneyFactor} />
        {rows && rows.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', marginBottom: 3 }}>Contribution by intervention{contributionView === 'category' ? ' — individual detail' : ''} (cumulative to {s.sum.endline})</div>
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
            Safely-managed coverage and financing-gap charts show each intervention's contribution. Basic coverage compares the BAU, full scenario and target; Basic households may move up to Safely Managed.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={cur} canUseUsd={!mixedCurrencies}
            onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency: cur })}
            onEditRate={onEditCurrencyRate} />
          {mixedCurrencies && <span style={{ fontSize: 10, color: '#b45309' }}>USD display and exports require matching area currencies ({resultCurrencies.join(', ')}).</span>}
          <ContributionViewToggle value={contributionView} onChange={onContributionViewChange} />
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
          <ExportButtons inputs={primary} pptxCharts={captureResultsCharts} areas={deckAreas} contributionView={contributionView}
            currencyDisplay={currencyDisplay} />
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
        Table: “Resources / financing” reports cash mobilised or loan principal accepted; utility borrowing is financing,
        not operating revenue. Cost-side and budget-execution levers show “n/a” as they stretch existing budget.
        “Added HHs” is each lever’s marginal safely-managed service. Enabled custom
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
                  const presentation = sc.inputs?.presentation;
                  fetch('/api/export/deck', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ areas: scenarioAreas(sc.inputs), contribution_view: presentation?.contributionView || contributionView,
                      currency_display: presentation?.currencyDisplay || currencyDisplay }) })
                    .then(async r => {
                      if (!r.ok) { const payload = await r.json().catch(() => ({})); throw new Error(payload.detail || `Export failed (${r.status}).`); }
                      return r.blob();
                    }).then(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${sc.name}.pptx`; a.click(); URL.revokeObjectURL(u); })
                    .catch(error => alert(error.message));
                }} style={{ fontSize: 10, padding: '3px 8px', border: '1px solid #d1d5db', borderRadius: 3, background: '#fff', cursor: 'pointer', color: '#374151' }}>
                  Export slides
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
