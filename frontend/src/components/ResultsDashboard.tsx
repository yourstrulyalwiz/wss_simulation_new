import React, { useEffect, useMemo, useRef, useState } from 'react';
import { areasOf as scenarioAreas, liveAreas } from '../areaBundle';
import {
  Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ComposedChart, ResponsiveContainer, Label,
} from 'recharts';
import { C, INTV_PALETTE as P } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import { resolveChartWindow } from '../chartWindow';
import { runCalculation } from '../api';
import { resultsInputs } from '../resultsDebtMode';
import { ledgerSnapshots, ledgerRows, ledgerCategory, type LedgerSnapshot, type LedgerContribution, type LedgerMetric, type LedgerService, type LedgerBasis, type LedgerData } from '../resultsLedger';
import ResultsLedgerPanel from './ResultsLedgerPanel';
import { linesFirstLegend } from './chartLegend';
import ExportButtons from './ExportButtons';
import ChartExport from './ChartExport';
import TableExport from './TableExport';
import NRWDiagnostics from './NRWDiagnostics';
import ServiceAccessGaps from './ServiceAccessGaps';
import { serviceAccessRows, type AccessRow } from '../serviceAccess';
import { captureImage } from './exportUtils';
import BasicCoverageChart, { type BasicCoverageRow } from './BasicCoverageChart';
import ScenarioGapTables, { type FinanceYear } from './ScenarioGapTables';
import { aggregateContributionRows, ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, type CurrencyDisplaySettings, validRate } from '../currencyDisplay';
import { aggregateWeightedRevenueRate, connectionRevenueAreaModes, summarizeConnectionRevenueModes } from '../connectionRevenueMode';
import { isModeledLoanSummary, LOAN_FUNDING_QUALIFICATION, LOAN_REPAYMENT_ACCOUNTING, LOAN_SUMMARY_VERSION } from '../loanFunding';
import RevenueSourceChart from './RevenueSourceChart';
import { WATER_INTERVENTIONS as WATER_INTV, SANITATION_INTERVENTIONS as SAN_INTV, GLOBAL_INTERVENTION_ORDER, comparisonInputs, interventionEnabled, type InterventionDefinition as IntvDef } from '../interventionRegistry';

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
type DebtData = { summary: any; rows: any[]; areas: any[]; annualRows: any[] };
type Series = { sum: any; inv: InvTable; unit: { sm: number; basic: number }; ledgerBase: LedgerSnapshot[]; ledgerScenario: LedgerSnapshot[]; ledgerAreas: LedgerData['areas']; coverageRows: any[]; financingRows: any[]; basicRows: BasicCoverageRow[]; financeRows: FinanceYear[]; debt: DebtData; accessRows: AccessRow[]; revenueRows: any[]; revenueModes: any[]; connectionMetadata: any; nrwResults: any[] };
type Both = { water: Series; sanitation: Series } | null;
type Row = { key: string; label: string; addHH: number; resources: number | null };

// Per-intervention stacked breakdown for a sector. covRows/gapRows are per-year rows keyed by each band's
// label (plus reserved keys __bau/__total/__target for coverage and __remain for the gap). `bands` lists the
// interventions that actually contribute (each with its INTV_PALETTE colour), in stack order.
type ContribBand = { key: string; label: string; color: string; interventionKey?: string; custom?: boolean; members?: { key: string; label: string }[] };
type ContribSeries = { covRows: any[]; gapRows: any[]; bands: ContribBand[]; ledgerContributions: LedgerContribution[] };
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
  const loanFundingShown = bands.some(b => b.key === 'Utility debt financing' || b.key === 'Indicative loan funding' || b.key === 'utility_debt_financing');
  const exHeaders = ['Year', ...(base ? [base.label] : []), ...bands.map(b => b.label), ...lines.map(l => l.name), ...(loanFundingShown ? ['Loan funding qualification'] : [])];
  const exRows = data.map((r: any) => [r.year, ...(base ? [r[base.key] ?? 0] : []), ...bands.map(b => r[b.key] ?? 0), ...lines.map(l => r[l.key] ?? ''), ...(loanFundingShown ? [LOAN_FUNDING_QUALIFICATION] : [])]);
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
  const amount = (value: number | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '—' : `${sigB(Number(value) * moneyFactor)} B`;
  const money = (value: number | null | undefined) => amount(value);
  const summary = debt.summary || {};
  const modeled = isModeledLoanSummary(summary);
  const sourceLabels: Record<string, string> = {
    collection: 'Collection efficiency', tariff: 'Tariff reform',
    nrw: 'Water NRW net / eligible sanitation-link net cash',
    connections: 'Revenue from new connections',
  };
  const tableHeaders = ['Year', 'Ordinary funds before service', 'Scheduled debt service', 'Ordinary funds after service',
    'New loan injection', 'Opening unspent proceeds', 'Investment from proceeds', 'Closing unspent proceeds', 'Qualification'];
  const tableRows = debt.rows.map((r: any) => [r.year, money(r.ordinary_before_debt_service), money(r.debt_service),
    money(r.ordinary_after_debt_service), money(r.disbursement), money(r.opening_unspent_proceeds),
    money(r.investment_from_loan_proceeds), money(r.closing_unspent_proceeds), LOAN_FUNDING_QUALIFICATION]);
  const repaymentHeaders = ['Year', 'Opening principal', 'Disbursement', 'Scheduled principal', 'Scheduled interest', 'Debt service', 'Closing principal'];
  const repaymentRows = (debt.summary?.repayment_schedule || []).map((row: any) => [
    row.year, money(row.opening_principal), money(row.disbursement), money(row.principal_payment),
    money(row.interest_payment), money(row.debt_service), money(row.closing_principal),
  ]);
  return (
    <section style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: 7, background: '#fff', padding: '10px 12px' }}>
      <h4 style={{ margin: '0 0 5px', color: '#1e3a5f', fontSize: 12.5 }}>Indicative loan funding — {currency}</h4>
      <div style={{ fontSize: 11, lineHeight: 1.5, color: '#475569', marginBottom: 8 }}>
        Status: <b>{summary.status || 'unavailable'}</b> · loan proceeds: <b>{money(summary.indicative_principal)}</b> · repayment accounting: <b>{modeled ? 'fixed annuity modeled' : 'legacy / not verified'}</b> · feasibility: <b>not assessed</b>
        {modeled && <> · fixed annual debt service: <b>{money(summary.fixed_annual_debt_service)}</b> · first payment: <b>{summary.first_repayment_year ?? '—'}</b> · maturity: <b>{summary.maturity_year ?? '—'}</b> · horizon principal: <b>{money(summary.horizon_closing_principal)}</b> · remaining payments: <b>{summary.remaining_contractual_payments ?? '—'} ({money(summary.remaining_contractual_debt_service)})</b></>}
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginBottom: 8, lineHeight: 1.45 }}>
        Per-area assumptions: {debt.areas.filter(a => a.enabled).map((a, i) => {
          const selected: string[] = Array.isArray(a.revenue_sources) ? a.revenue_sources.filter((key: string) => key in sourceLabels) : ['collection', 'tariff', 'nrw'];
          return <span key={i}>{i ? ' · ' : ''}{a.area}: {((Number(a.allocation_share) || 0) * 100).toFixed(1)}% pooled allocation, {a.annual_real_interest_rate == null ? 'rate incomplete' : `${(Number(a.annual_real_interest_rate) * 100).toFixed(2)}% real rate`}, term {a.loan_term_years ?? 'incomplete'} years, reference/injection year {a.reference_year ?? a.disbursement_year ?? '—'}, sources {selected.length ? selected.map(key => sourceLabels[key]).join(', ') : 'none'}, status {a.status || 'unavailable'}</span>;
        })}
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 6 }}>{LOAN_FUNDING_QUALIFICATION}</div>
      {debt.rows.length > 0 && <div style={{ overflowX: 'auto', maxHeight: 320 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, whiteSpace: 'nowrap' }}>
          <thead><tr>{tableHeaders.map(h => <th key={h} style={{ position: 'sticky', top: 0, background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', padding: '5px 7px', textAlign: h === 'Year' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
          <tbody>{debt.rows.map((r: any) => <tr key={r.year}>
            {tableRows.find(row => row[0] === r.year)?.map((v: any, i: number) => <td key={i} style={{ borderBottom: '1px solid #eef2f7', padding: '4px 7px', textAlign: i ? 'right' : 'left', maxWidth: i === 5 ? 360 : undefined, whiteSpace: i === 5 ? 'normal' : undefined }}>{v}</td>)}
          </tr>)}</tbody>
        </table>
        <TableExport filename="results_indicative_loan_proceeds" sheetName="Loan proceeds" headers={tableHeaders} rows={tableRows} compact />
      </div>}
      {modeled && <div style={{ overflowX: 'auto', maxHeight: 320, marginTop: 10 }} data-testid="results-repayment-schedule">
        <strong style={{ fontSize: 11 }}>Full contractual repayment schedule · obligations, not proof of payment</strong>
        {repaymentRows.length ? <>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10.5, whiteSpace: 'nowrap', marginTop: 4 }}>
            <thead><tr>{repaymentHeaders.map(h => <th key={h} style={{ position: 'sticky', top: 0, background: '#f1f5f9', borderBottom: '1px solid #cbd5e1', padding: '5px 7px', textAlign: h === 'Year' ? 'left' : 'right' }}>{h}</th>)}</tr></thead>
            <tbody>{repaymentRows.map((row: any[], i: number) => <tr key={`${row[0]}-${i}`}>
              {row.map((value, j) => <td key={j} style={{ borderBottom: '1px solid #eef2f7', padding: '4px 7px', textAlign: j ? 'right' : 'left' }}>{value}</td>)}
            </tr>)}</tbody>
          </table>
          <TableExport filename="results_utility_loan_repayment_schedule" sheetName="Repayment schedule" headers={[...repaymentHeaders, 'Qualification']}
            rows={repaymentRows.map((row: any[]) => [...row, LOAN_FUNDING_QUALIFICATION])} compact />
        </> : <p style={{ fontSize: 10.5, color: '#64748b' }}>The full contractual schedule is unavailable.</p>}
        <p style={{ fontSize: 10, color: '#64748b' }}>Unspent proceeds are a restricted funding balance; horizon closing principal is outstanding debt. Cash outside the simulation horizon is unavailable.</p>
      </div>}
    </section>
  );
}

export default function ResultsDashboard({ geoScope, scenarios, inputs, altInputs, onToggle, contributionView, onContributionViewChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate }: Props) {
  const [includeDebt, setIncludeDebt] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dashboardRef = useRef<HTMLDivElement>(null);
  type Selection = { metric: LedgerMetric; service: LedgerService; basis: LedgerBasis };
  const [ledgerSelection, setLedgerSelection] = useState<Record<'water' | 'sanitation', Selection>>({
    water: { metric: 'coverage', service: 'sm', basis: 'closing' },
    sanitation: { metric: 'coverage', service: 'sm', basis: 'closing' },
  });
  const showLedger = (sector: 'water' | 'sanitation', selection: Selection) => {
    setLedgerSelection(current => ({ ...current, [sector]: selection }));
    setTimeout(() => dashboardRef.current?.querySelector(`[data-results-ledger="${sector}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
  };
  const [viewScope, setViewScope] = useState<'urban' | 'rural' | 'national'>(
    geoScope === 'urban' ? 'urban' : geoScope === 'rural' ? 'rural' : 'national'
  );
  const [unitMode, setUnitMode] = useState<'count' | 'share'>('count');
  // Graph-only year window. It intentionally does not enter the calculation payload or saved inputs.
  const [chartStartOverride, setChartStart] = useState<number | null>(null);
  const [chartEndOverride, setChartEnd] = useState<number | null>(null);
  // Areas to ship to the slide-deck export. The deck covers every scope in one file, so this follows
  // the ENTRY mode (how the user filled the data in), not the Scope dropdown above, which only
  // chooses what this tab displays. In national-entry mode the national dataset lives in altInputs
  // and `inputs` is still the urban primary, so read it explicitly rather than exporting urban.
  const deckAreas = React.useMemo(() => Object.fromEntries(
    Object.entries(liveAreas(geoScope, inputs, altInputs)).map(([area, data]) => [area, resultsInputs(data, includeDebt)])),
    [geoScope, inputs, altInputs, includeDebt]);
  const [both, setBoth] = useState<Both>(null);
  const [table, setTable] = useState<{ water: Row[]; sanitation: Row[] } | null>(null);
  const [contrib, setContrib] = useState<Contrib>(null);   // per-intervention stacked series
  const [error, setError] = useState<string | null>(null);
  const [contributionError, setContributionError] = useState<string | null>(null);

  // The dataset the user actually filled in. Same asymmetry deckAreas handles above: in national-ENTRY
  // mode the dataset being edited lives in altInputs.national and `inputs` is still the urban primary
  // seed, so it has to be read explicitly — otherwise everything on this tab (charts, tables, the
  // intervention toggles and the whole-scenario exports) reports seed numbers the user never entered.
  const primaryRaw = useMemo(
    () => (geoScope === 'national' ? (altInputs?.['national'] ?? inputs) : inputs),
    [geoScope, inputs, altInputs]);
  // National entry has no urban/rural split to look at, so the Scope dropdown collapses to National
  // (below) and every view resolves to that single dataset.
  const effScope = geoScope === 'national' ? 'national' : viewScope;

  // Datasets for the chosen scope (national = urban + rural summed, when rural data exists).
  const rawDatasets = useMemo(() => {
    // Selecting urban+rural seeds altInputs.rural and switching to national entry does not clear it, so
    // national entry returns its one dataset rather than summing in an area that is no longer in play.
    if (geoScope === 'national') return [primaryRaw];
    const rural = altInputs?.['rural'];
    if (effScope === 'urban') return [primaryRaw];
    if (effScope === 'rural') return [rural ?? primaryRaw];
    return rural ? [primaryRaw, rural] : [primaryRaw];      // national
  }, [primaryRaw, geoScope, altInputs, effScope]);
  const primary = useMemo(() => resultsInputs(primaryRaw, includeDebt), [primaryRaw, includeDebt]);
  const datasets = useMemo(() => rawDatasets.map(data => resultsInputs(data, includeDebt)), [rawDatasets, includeDebt]);
  const hasConfiguredDebt = Object.values(liveAreas(geoScope, inputs, altInputs)).some(data =>
    ['water', 'sanitation'].some(sector => !!data?.utility_debt?.[sector]?.enabled));

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
    let cancelled = false;
    setBoth(null);
    setError(null);
    const h = setTimeout(() => {
      Promise.all(datasets.map(runCalculation)).then(resList => {
        if (cancelled) return;
        const years: number[] = resList[0].years;
        const per = datasets[0]?.period || {};
        const baseYr = per.baseline_year ?? years[0];
        const endIdx = years.length - 1;
        const sum = (pick: (res: any, i: number) => number) =>
          years.map((_: number, i: number) => resList.reduce((a, res) => a + (pick(res, i) || 0), 0));
        const totalHH = years.map((_, i) => resList.reduce((a, res) => a + (res.total_hh[i] || 0), 0));
        const build = (secKey: 'water_supply' | 'sanitation'): Series => {
          const secOf = (res: any) => res[secKey];
          const revenueFields = [
            'baseline_billed_volume_million_m3', 'connection_raw_volume_million_m3', 'connection_overlap_volume_million_m3',
            'connection_volume_million_m3', 'nrw_avoided_sales_adjustment', 'connection_scale', 'connection_aggregate_volume_proxy',
            'raw_billed_volume_million_m3',
            'non_nrw_billed_volume_million_m3', 'reference_billed_volume_million_m3',
            'reference_collected_revenue', 'connection_revenue_delta',
            'connection_net_cash', 'additional_net_cash', 'applicable_tariff', 'applicable_collection_ratio',
            'billed_volume_million_m3', 'collected_revenue', 'collection_cash', 'tariff_cash',
            'nrw_net', 'eligible_nrw_link_cash',
          ];
          const annualField = (sec: any, key: string, index: number) => {
            const value = sec?.[key];
            if (Array.isArray(value)) return typeof value[index] === 'number' && Number.isFinite(value[index]) ? value[index] : null;
            if (typeof value === 'number') return value;
            return null;
          };
          const weightedRevenueRate = (kind: 'bau' | 'scenario', key: 'applicable_tariff' | 'applicable_collection_ratio', index: number) => {
            const rateKey = kind === 'bau' ? key : `scenario_${key}`;
            const volumeKey = kind === 'bau' ? 'billed_volume_million_m3' : 'scenario_billed_volume_million_m3';
            const tariffKey = kind === 'bau' ? 'applicable_tariff' : 'scenario_applicable_tariff';
            const values = resList.map(result => {
              const sec = secOf(result);
              const rate = annualField(sec, rateKey, index);
              const volume = annualField(sec, volumeKey, index);
              const tariff = annualField(sec, tariffKey, index);
              return { rate, volume, tariff };
            });
            return aggregateWeightedRevenueRate(values, key === 'applicable_tariff' ? 'volume' : 'tariff-volume');
          };
          const revenueRows = years.map((year: number, i: number) => {
            const row: any = { year };
            revenueFields.forEach(key => {
              (['bau', 'scenario'] as const).forEach(kind => {
                const resultKey = kind === 'bau' ? key : `scenario_${key}`;
                const available = resList.map(r => annualField(secOf(r), resultKey, i));
                if (key === 'applicable_tariff' || key === 'applicable_collection_ratio') {
                  row[`${kind}_${key}`] = weightedRevenueRate(kind, key, i);
                } else if ((key === 'connection_scale' || key === 'connection_aggregate_volume_proxy') && resList.length > 1) {
                  row[`${kind}_${key}`] = null;
                } else {
                  row[`${kind}_${key}`] = available.length && available.every(v => v != null)
                    ? available.reduce<number>((total, v) => total + (v as number), 0) : null;
                }
              });
            });
            return row;
          });
          const revenueModes = connectionRevenueAreaModes(resList, datasets, secKey === 'water_supply' ? 'water_supply' : 'sanitation', secKey === 'water_supply' ? 'water' : 'sanitation');
          const connectionMetadata = summarizeConnectionRevenueModes(revenueModes);
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
          const injectionMap = new Map<number, any>();
          debtAreas.forEach(area => (area.annual_injection || []).forEach((row: any) => {
            const year = Number(row.year);
            if (!Number.isFinite(year)) return;
            const fields = ['ordinary_before_debt_service', 'debt_service', 'ordinary_after_debt_service',
              'disbursement', 'opening_unspent_proceeds', 'investment_from_loan_proceeds', 'closing_unspent_proceeds'];
            const total = injectionMap.get(year) || { year, ...Object.fromEntries(fields.map(key => [key, 0])) };
            fields.forEach(key => {
              if (row[key] == null || !Number.isFinite(Number(row[key]))) total[key] = null;
              else if (total[key] != null) total[key] += Number(row[key]);
            });
            injectionMap.set(year, total);
          }));
          const repaymentMap = new Map<number, any>();
          debtAreas.forEach(area => (area.repayment_schedule || []).forEach((row: any) => {
            const year = Number(row.year);
            if (!Number.isFinite(year)) return;
            const fields = ['opening_principal', 'disbursement', 'principal_payment', 'interest_payment', 'debt_service', 'closing_principal'];
            const total = repaymentMap.get(year) || { year, ...Object.fromEntries(fields.map(key => [key, 0])) };
            fields.forEach(key => { total[key] += Number(row[key] || 0); });
            repaymentMap.set(year, total);
          }));
          const sumDebt = (key: string) => debtAreas.reduce((sum, a) => sum + Number(a[key] || 0), 0);
          const activeDebtAreas = debtAreas.filter(area => area.enabled);
          const firstRepayments = activeDebtAreas.map(area => Number(area.first_repayment_year)).filter(Number.isFinite);
          const maturities = activeDebtAreas.map(area => Number(area.maturity_year)).filter(Number.isFinite);
          const scheduleMetadataPresent = activeDebtAreas.length > 0 && activeDebtAreas.every(area => isModeledLoanSummary(area));
          const debt: DebtData = {
            areas: debtAreas,
            rows: [...injectionMap.values()].sort((a, b) => a.year - b.year),
            annualRows: [...injectionMap.values()].sort((a, b) => a.year - b.year),
            summary: {
              enabled: debtAreas.some(a => a.enabled),
              status: [...new Set(debtAreas.filter(a => a.enabled).map(a => a.status))].join(' · ') || 'disabled',
              indicative_principal: sumDebt('indicative_principal'),
              accepted_principal: sumDebt('indicative_principal'),
              summary_version: scheduleMetadataPresent ? LOAN_SUMMARY_VERSION
                : activeDebtAreas.length ? Math.min(...activeDebtAreas.map(area => Number(area.summary_version ?? area.schema_version) || 0)) : null,
              repayment_accounting: scheduleMetadataPresent ? LOAN_REPAYMENT_ACCOUNTING : 'legacy_or_mixed',
              fixed_annual_debt_service: sumDebt('fixed_annual_debt_service'),
              first_repayment_year: firstRepayments.length ? Math.min(...firstRepayments) : null,
              maturity_year: maturities.length ? Math.max(...maturities) : null,
              horizon_closing_principal: sumDebt('horizon_closing_principal'),
              remaining_contractual_payments: activeDebtAreas.reduce((sum, area) => sum + Number(area.remaining_contractual_payments || 0), 0),
              remaining_contractual_debt_service: sumDebt('remaining_contractual_debt_service'),
              repayment_schedule: [...repaymentMap.values()].sort((a, b) => a.year - b.year),
            },
          };
          const unit = { sm: secOf(resList[0]).cost_per_hh || 0, basic: secOf(resList[0]).cost_basic || 0 };
           return { inv, unit, ledgerBase: ledgerSnapshots(resList, secKey, baseYr, false),
            ledgerScenario: ledgerSnapshots(resList, secKey, baseYr),
            ledgerAreas: geoScope === 'national' ? [] : resList.map((result, index) => {
              const key: 'urban' | 'rural' = effScope === 'rural' || (effScope === 'national' &&
                (resList.length > 1 ? index === 1 : geoScope === 'rural')) ? 'rural' : 'urban';
              return { key, label: key === 'urban' ? 'Urban' : 'Rural',
                base: ledgerSnapshots([result], secKey, baseYr, false),
                scenario: ledgerSnapshots([result], secKey, baseYr) };
            }),
            coverageRows: years.map((year, i) => ({ year, __bau: bau[i], __scenario: scn[i], __total: totalHH[i], __target: tgt[i] })),
            financingRows: years.map((year, i) => ({ year,
              __bau_gap: resList.reduce((total, r) => total + secOf(r).endline_financing_requirement[i], 0) / 1000,
              __scenario_gap: resList.reduce((total, r) => total + secOf(r).scenario_endline_financing_requirement[i], 0) / 1000 })),
            basicRows, financeRows, debt, revenueRows, revenueModes, connectionMetadata, nrwResults: resList, accessRows: serviceAccessRows(resList, secKey, baseYr), sum: {
            endline: years[endIdx], curCov, bauCov: covPct(bau), scnCov: covPct(scn), tgtCov: covPct(tgt),
            addHH: Math.min(tEnd, scn[endIdx]) - Math.min(tEnd, bau[endIdx]),
            gapBauCum: endRequirement('endline_financing_requirement'), gapScnCum: endRequirement('scenario_endline_financing_requirement'),
          } };
        };
        setBoth({ water: build('water_supply'), sanitation: build('sanitation') });
        setError(null);
      }).catch(e => { if (!cancelled) { setBoth(null); setError(e instanceof Error ? e.message : String(e)); } });
    }, 350);
    return () => { cancelled = true; clearTimeout(h); };
  }, [depKey, attempt, effScope, geoScope]);

  // ── Per-intervention breakdown: cumulative passes over the ENABLED built-in toggles isolate each lever's
  //    marginal safely-managed households (Δ scenario_hh) and gap reduction (Δ scenario_financing_gap) per
  //    YEAR, plus its mobilised resources at the endline. Feeds both the endline table AND the stacked
  //    per-intervention charts. Enabled customs are folded into one final pass so the stack still tops out
  //    at the true with-interventions scenario (shown as a single "Custom interventions" band). ───────────
  useEffect(() => {
    if (!datasets.length || !datasets[0]) { setTable(null); setContrib(null); return; }
    let cancelled = false;
    setTable(null);
    setContrib(null);
    setContributionError(null);
    const enabled = GLOBAL_INTERVENTION_ORDER.filter(d => datasets.some(inp => interventionEnabled(inp, d.key)));
    const hasCustoms = datasets.some((inp: any) => (inp.custom_interventions || []).some((c: any) => c && c.enabled !== false));
    const hasUtilityDebt = datasets.some((inp: any) =>
      ['water', 'sanitation'].some((sector: string) => inp.utility_debt?.[sector]?.enabled && Number(inp.utility_debt?.[sector]?.allocation_share || 0) > 0));
    const h = setTimeout(() => {
      const off = Object.fromEntries([...new Set([...datasets.flatMap(inp => Object.keys(inp.toggles || {})),
        ...GLOBAL_INTERVENTION_ORDER.map(d => d.key)])].map(k => [k, false]));
      const sets: any[] = [{ ...off }];                            // pass 0 = BAU (all off)
      let acc: any = { ...off };
      enabled.forEach(d => { acc = { ...acc, [d.key]: true }; sets.push({ ...acc }); });   // +1 pass per lever
      const withoutDebt = (settings: any) => ({
        ...(settings || {}),
        water: { ...(settings?.water || {}), enabled: false },
        sanitation: { ...(settings?.sanitation || {}), enabled: false },
      });
      const fetchPass = (tg: any, useCustoms: boolean, debtEnabled = false) => Promise.all(datasets.map((inp: any) =>
        runCalculation({ ...comparisonInputs(inp, tg),
          custom_interventions: useCustoms ? (inp.custom_interventions || []) : [],
          utility_debt: debtEnabled ? inp.utility_debt : withoutDebt(inp.utility_debt) })));
      const specs = sets.map(tg => ({ tg, customs: false }));
      if (hasCustoms) specs.push({ tg: acc, customs: true });      // final pass = all built-ins on + real customs
      Promise.all(specs.map(s => fetchPass(s.tg, s.customs)).concat(hasUtilityDebt ? [fetchPass(acc, true, true)] : [])).then(allPasses => {
        if (cancelled) return;
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
          const own = new Set(defs.map(d => d.key));
          const en = enabled.filter(d => own.has(d.key) || years.some((_, i) => {
            const idx = idxOf(d);
            return Math.abs(smY(passes[idx + 1], sk, i) - smY(passes[idx], sk, i)) > 1e-12 ||
              Math.abs(gapY(passes[idx + 1], sk, i) - gapY(passes[idx], sk, i)) > 1e-12;
          }));
          const bandLabel = (d: IntvDef) => own.has(d.key) ? d.label :
            `${d.key.startsWith('ws_') ? 'Water' : 'Sanitation'}: ${d.label}`;
          const covRows: any[] = [], gapRows: any[] = [];
          years.forEach((y, i) => {
            const covRow: any = { year: y, __bau: +smY(passes[0], sk, i).toFixed(4), __total: +totY(i).toFixed(4), __target: +tgtY(sk, i).toFixed(4) };
            const bauGap = gapY(passes[0], sk, i);
            const gapRow: any = { year: y };
            let sumRed = 0;
            en.forEach(d => {
              const idx = idxOf(d);
              covRow[bandLabel(d)] = smY(passes[idx + 1], sk, i) - smY(passes[idx], sk, i);
              const red = gapY(passes[idx], sk, i) - gapY(passes[idx + 1], sk, i);
              gapRow[bandLabel(d)] = red / 1000;          // M → B
              sumRed += red;
            });
            if (hasCustoms) {
              covRow['Custom interventions'] = smY(passes[nBuiltin + 1], sk, i) - smY(passes[nBuiltin], sk, i);
              const redC = gapY(passes[nBuiltin], sk, i) - gapY(passes[nBuiltin + 1], sk, i);
              gapRow['Custom interventions'] = redC / 1000;
              sumRed += redC;
            }
            if (debtPass) {
              covRow['Indicative loan funding'] = smY(debtPass, sk, i) - smY(passes[fullNoDebtIdx], sk, i);
              const redDebt = gapY(passes[fullNoDebtIdx], sk, i) - gapY(debtPass, sk, i);
              gapRow['Indicative loan funding'] = redDebt / 1000;
              sumRed += redDebt;
            }
            gapRow.__remain = (bauGap - sumRed) / 1000;
            gapRow.__bau_gap = +(bauGap / 1000).toFixed(4);                        // total BAU gap → the target line to close
            covRows.push(covRow); gapRows.push(gapRow);
          });
          const all: ContribBand[] = en.map(d => ({ key: bandLabel(d), label: bandLabel(d), color: d.color, interventionKey: d.key }));
          if (hasCustoms) all.push({ key: 'Custom interventions', label: 'Custom interventions', color: P.custom, custom: true });
          if (debtPass) all.push({ key: 'Indicative loan funding', label: 'Indicative loan funding', color: P.utilityDebt, interventionKey: 'utility_debt_financing' });
          // keep only bands that actually move either chart (an enabled-but-unparameterised lever adds 0)
          const bands = all.filter(b => covRows.some(r => Math.abs(r[b.key] || 0) > 1e-12) || gapRows.some(r => Math.abs(r[b.key] || 0) > 1e-12));
          const snapshots = passes.map(pass => ledgerSnapshots(pass, sk as 'water_supply' | 'sanitation', baseYr));
          const ledgerContributions: LedgerContribution[] = enabled.map((d, index) => ({
            key: d.key, label: bandLabel(d), category: ledgerCategory(d.key), order: index + 1,
            before: snapshots[index], after: snapshots[index + 1],
          })).filter(edge => own.has(edge.key) || edge.after.some((row, i) =>
            Object.keys(row.values).some(key => row.values[key as keyof typeof row.values].some((value, rung) =>
              value != null && Math.abs(value - (edge.before[i].values[key as keyof typeof row.values][rung] ?? 0)) > 1e-12))));
          if (hasCustoms) ledgerContributions.push({
            key: 'custom', label: 'Custom interventions', category: ledgerCategory('custom', true), order: nBuiltin + 1,
            before: snapshots[nBuiltin], after: snapshots[nBuiltin + 1],
          });
          if (debtPass) ledgerContributions.push({
            key: 'utility_debt_financing', label: 'Indicative loan funding (conditional on reforms)',
            order: fullNoDebtIdx + 1,
            category: ledgerCategory('utility_debt_financing'), before: snapshots[fullNoDebtIdx],
            after: ledgerSnapshots(debtPass, sk as 'water_supply' | 'sanitation', baseYr),
          });
          return { covRows, gapRows, bands, ledgerContributions };
        };
        setContrib({ water: buildContrib(WATER_INTV, 'water_supply'), sanitation: buildContrib(SAN_INTV, 'sanitation') });

        // ── endline resources-and-households table (built-in levers only) ──
        if (!enabled.length && !debtPass) { setTable({ water: [], sanitation: [] }); return; }
        const smEnd = (rl: any[], sk: string) => smY(rl, sk, endIdx);
        const rowsFor = (defs: IntvDef[], sk: string): Row[] => {
          const rows = defs.filter(d => datasets.some(inp => interventionEnabled(inp, d.key))).map(d => {
          const idx = idxOf(d);
          const after = passes[idx + 1], before = passes[idx];
          const addHH = (smEnd(after, sk) - smEnd(before, sk)) * 1000;
          const resources = d.resourceKey
            ? (['ws_connections_enabled', 'san_connections_enabled', 'ws_collection_efficiency_enabled', 'san_collection_efficiency_enabled',
              'ws_tariff_enabled', 'san_tariff_enabled', 'ws_nrw_enabled', 'san_nrw_link_enabled'].includes(d.key)
              ? cashCum(debtPass || passes[fullNoDebtIdx], sk, d.resourceKey)
              : cashCum(after, sk, d.resourceKey) - cashCum(before, sk, d.resourceKey)) / 1000
            : null;
          return { key: d.key, label: d.label, addHH, resources };
          });
          if (debtPass) {
            const principal = debtPass.reduce((sum: number, r: any) =>
              sum + Number(r[sk].scenario_utility_debt?.accepted_principal || 0), 0) / 1000;
            const addHH = (smEnd(debtPass, sk) - smEnd(passes[fullNoDebtIdx], sk)) * 1000;
            if (Math.abs(principal) > 1e-12 || Math.abs(addHH) > 1e-12)
              rows.push({ key: 'utility_debt_financing', label: 'Indicative loan funding', addHH, resources: principal });
          }
          return rows;
        };
        setTable({ water: rowsFor(WATER_INTV, 'water_supply'), sanitation: rowsFor(SAN_INTV, 'sanitation') });
      }).catch(e => { if (!cancelled) setContributionError(e instanceof Error ? e.message : String(e)); });
    }, 400);
    return () => { cancelled = true; clearTimeout(h); };
  }, [depKey, JSON.stringify(toggles), attempt]);

  const isShare = unitMode === 'share';
  const chartWindow = resolveChartWindow(
    contrib?.water?.covRows?.map((r: any) => r.year) ?? [],
    datasets[0]?.period, chartStartOverride, chartEndOverride);
  const chartYears = chartWindow.years;
  const chartStart = chartWindow.start, chartEnd = chartWindow.end;
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
    const o: any = { ...r, year: r.year, __source_total: tot, __total: tot > 0 ? 1 : 0, __bau: d(r.__bau || 0), __target: d(r.__target || 0), __scenario: d(r.__scenario || 0) };
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

  const RevenueDetails = ({ series, sector }: { series: Series; sector: string }) => {
    const fields: { key: string; label: string; unit: string; currency: boolean }[] = [
      { key: 'baseline_billed_volume_million_m3', label: 'Baseline billed volume', unit: 'million m³/year', currency: false },
      { key: 'connection_raw_volume_million_m3', label: 'Coverage-expansion volume before overlap', unit: 'million m³/year', currency: false },
      { key: 'connection_overlap_volume_million_m3', label: 'Identified connection/NRW overlap', unit: 'million m³/year', currency: false },
      { key: 'connection_volume_million_m3', label: 'Reconciled connection volume', unit: 'million m³/year', currency: false },
      { key: 'nrw_avoided_sales_adjustment', label: 'Avoided-sales volume adjustment', unit: 'million m³/year', currency: false },
      { key: 'connection_scale', label: 'Aggregate coverage scale', unit: 'fraction', currency: false },
      { key: 'connection_aggregate_volume_proxy', label: 'Aggregate volume-scaling proxy', unit: 'm³/reference served-household equivalent', currency: false },
      { key: 'raw_billed_volume_million_m3', label: 'Raw billed volume', unit: 'million m³', currency: false },
      { key: 'non_nrw_billed_volume_million_m3', label: 'Reconciled non-NRW billed volume', unit: 'million m³', currency: false },
      { key: 'reference_billed_volume_million_m3', label: 'Funding reference billed volume', unit: 'million m³', currency: false },
      { key: 'billed_volume_million_m3', label: 'Total billed volume', unit: 'million m³', currency: false },
      { key: 'applicable_tariff', label: 'Applicable tariff', unit: `${displayCur}/m³`, currency: true },
      { key: 'applicable_collection_ratio', label: 'Applicable collection ratio', unit: 'fraction', currency: false },
      { key: 'reference_collected_revenue', label: 'Reference collected revenue', unit: `million ${displayCur}`, currency: true },
      { key: 'collected_revenue', label: 'Collected revenue', unit: `million ${displayCur}`, currency: true },
      { key: 'connection_net_cash', label: 'Revenue from new connections', unit: `million ${displayCur}`, currency: true },
      { key: 'collection_cash', label: 'Collection-efficiency cash', unit: `million ${displayCur}`, currency: true },
      { key: 'tariff_cash', label: 'Tariff-reform cash', unit: `million ${displayCur}`, currency: true },
      { key: 'nrw_net', label: 'Water NRW signed net cash after implementation cost', unit: `million ${displayCur}`, currency: true },
      { key: 'eligible_nrw_link_cash', label: 'Eligible NRW-linked sanitation signed net cash', unit: `million ${displayCur}`, currency: true },
      { key: 'additional_net_cash', label: 'Additional net cash', unit: `million ${displayCur}`, currency: true },
    ];
    const hasAny = series.revenueRows.some(row => fields.some(f => row[`bau_${f.key}`] != null || row[`scenario_${f.key}`] != null));
    const exportHeaders = ['Year', ...fields.flatMap(f => [`BAU — ${f.label} (${f.unit})`, `Scenario — ${f.label} (${f.unit})`])];
    const exportRows = series.revenueRows.map(row => [
      row.year,
      ...fields.flatMap(f => ['bau', 'scenario'].map(kind => {
        const value = row[`${kind}_${f.key}`];
        if (value == null) return '';
        return f.currency ? Number(value) * moneyFactor : value;
      })),
    ]);
    const fmt = (v: number | null, f: typeof fields[number]) => {
      if (v == null || !Number.isFinite(Number(v))) return '—';
      const converted = f.currency ? Number(v) * moneyFactor : Number(v);
      return converted.toLocaleString('en-US', { maximumFractionDigits: f.key === 'connection_billed_households' ? 0 : 3 });
    };
    const th: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 1, background: '#e8f0f4', borderBottom: '1px solid #cbd5e1', padding: '6px 8px', textAlign: 'right', fontSize: 10, whiteSpace: 'nowrap' };
    const td: React.CSSProperties = { borderBottom: '1px solid #edf1f3', padding: '5px 8px', textAlign: 'right', fontSize: 10.5, whiteSpace: 'nowrap' };
    return <section data-revenue-details={sector} aria-label={`${sector} annual revenue details`} style={{ marginTop: 10, border: '1px solid #cbd5e1', borderRadius: 6, background: '#fbfdfe', padding: '9px 10px' }}>
      <RevenueSourceChart inputs={datasets} results={series.nrwResults} sector={sector === 'water' ? 'water' : 'sanitation'} currencyDisplay={detailExportCurrency} />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 3 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#164e63' }}>Annual Revenue Details — BAU / scenario</div>
        {hasAny && <TableExport filename={`${sector}_annual_revenue_details`} sheetName="Revenue details" headers={exportHeaders} rows={exportRows} compact currencyDisplay={detailExportCurrency} />}
      </div>
      <p style={{ margin: '3px 0 7px', fontSize: 10.5, color: '#64748b' }}>
        Monetary results are native currency millions before display conversion. Gross collected revenue is distinct from net cash. Connection net cash is a funding flow, not a one-for-one financing-gap reduction.
      </p>
      {!hasAny ? <div style={{ padding: '10px 4px', color: '#64748b', fontSize: 11 }}>Annual revenue diagnostics are not present in the calculation response yet.</div> :
        <div style={{ overflow: 'auto', maxHeight: 360, border: '1px solid #e2e8f0', borderRadius: 4 }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 1360, width: '100%' }}>
            <thead><tr><th style={{ ...th, textAlign: 'left', left: 0 }}>Year</th>{fields.flatMap(f => [
              <th key={`b-${f.key}`} style={th}>BAU · {f.label}<br /><span style={{ fontWeight: 400 }}>{f.unit}</span></th>,
              <th key={`s-${f.key}`} style={th}>Scenario · {f.label}<br /><span style={{ fontWeight: 400 }}>{f.unit}</span></th>,
            ])}</tr></thead>
            <tbody>{series.revenueRows.map((row: any, i: number) => <tr key={row.year} style={{ background: i % 2 ? '#f6f9fa' : '#fff' }}>
              <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>{row.year}</td>
              {fields.flatMap(f => [
                <td key={`b-${f.key}`} style={td}>{fmt(row[`bau_${f.key}`], f)}</td>,
                <td key={`s-${f.key}`} style={td}>{fmt(row[`scenario_${f.key}`], f)}</td>,
              ])}
            </tr>)}</tbody>
          </table>
        </div>}
    </section>;
  };

  const sectorBlock = (secKey: 'water' | 'sanitation') => {
    if (!both) return null;
    const s = secKey === 'water' ? both.water : both.sanitation;
    const label = secKey === 'water' ? 'Water Supply' : 'Sanitation';
    const cs = secKey === 'water' ? contrib?.water : contrib?.sanitation;
    const groupedCov = cs && contributionView === 'category' ? aggregateContributionRows(cs.covRows, cs.bands) : { rows: cs?.covRows ?? s.coverageRows, bands: cs?.bands ?? [] };
    const groupedGap = cs && contributionView === 'category' ? aggregateContributionRows(cs.gapRows, cs.bands) : { rows: cs?.gapRows ?? s.financingRows, bands: cs?.bands ?? [] };
    const csBands = groupedCov.bands as ContribBand[];
    const gapBands = groupedGap.bands as ContribBand[];
    const allCovData = isShare ? asShareStack(groupedCov.rows, csBands) : groupedCov.rows;
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
    if (!cs) covLines.push({ key: '__scenario', name: 'Full scenario', color: C.bau, dash: '', width: 2 });
    // Gap chart: NO base area — the intervention gap-reduction bands stack UP from zero (what the levers close),
    // and a dashed line marks the total BAU financing gap. The vertical distance from the top of the stack up to
    // that line is the gap still remaining to reach the fully-financed target.
    const gapLines = [{ key: '__bau_gap', name: 'Total financing gap (BAU) — target to close', color: C.gap, dash: '6 3', width: 2 }];
    if (!cs) gapLines.push({ key: '__scenario_gap', name: 'Full scenario requirement', color: C.bau, dash: '', width: 2 });
    const noImpact = Math.abs(s.sum.addHH) < 1e-4 && Math.abs(s.sum.gapBauCum - s.sum.gapScnCum) < 1e-4;
    const rows = secKey === 'water' ? table?.water : table?.sanitation;
    const ledgerData: LedgerData = {
      years: s.ledgerScenario.map(row => row.year),
      baselineYear: datasets[0]?.period?.baseline_year ?? s.ledgerScenario[0].year,
      base: s.ledgerBase, scenario: s.ledgerScenario, areas: s.ledgerAreas,
      contributions: cs?.ledgerContributions ?? [], attributionComplete: !!cs,
      includesDebt: datasets.some(inp => Object.values(inp.utility_debt || {})
        .some((config: any) => config?.enabled && config.allocation_share > 0)),
    };
    const visibleLedgerYears = s.ledgerScenario.filter(row => (chartStart == null || row.year >= chartStart) &&
      (chartEnd == null || row.year <= chartEnd)).map(row => row.year);
    const chartService = ledgerSelection[secKey].service;
    const closingValues = (sourceKind: 'bau' | 'scenario') => ledgerRows(ledgerData, {
      metric: 'gap', service: chartService, basis: 'closing', years: visibleLedgerYears,
      isShare: false, moneyFactor, currency: displayCur, view: 'source', sourceKind,
    })[0]?.values ?? visibleLedgerYears.map(() => null);
    const needBAU = closingValues('bau');
    const needScenario = closingValues('scenario');
    const needChartRows = visibleLedgerYears.map((year, i) => ({ year, bau: needBAU[i], scenario: needScenario[i] }));
    const hhCol = secKey === 'water' ? "Added HHs with treated, piped (HHs '000)" : "Added safely-managed HHs (HHs '000)";
    const modes = s.revenueModes.map((mode: any) => {
      const effective = String(mode.effective ?? '').toLowerCase().replace(/[_ ]/g, '-');
      return {
        ...mode,
        label: effective.includes('aggregate') ? 'Aggregate coverage expansion' : effective.includes('legacy') ? 'Connection-based (legacy)'
          : effective === 'incomplete' ? 'Incomplete'
          : mode.effective === true || effective.includes('connection') || effective === 'dynamic' ? 'Legacy connection mode'
          : mode.effective === false || effective.includes('exogenous') ? 'Exogenous'
            : mode.requested ? 'Coverage expansion requested; effective status not reported' : 'Exogenous',
      };
    });
    const distinctModes = [...new Set(modes.map((mode: any) => mode.label))];
    return (
      <div key={secKey} data-results-sector={secKey} style={{ marginBottom: 26, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid #e2e8f0', paddingBottom: 4, marginBottom: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: '#1e3a5f' }}>{label}</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>· {scopeName}</span>
        </div>
        <details style={{ marginBottom: 10 }}><summary style={{ cursor: 'pointer', fontSize: 11, color: '#334155' }}>Coverage summary, service gaps and revenue assumptions</summary>
        <div style={{ marginBottom: 10, borderLeft: '3px solid #0f766e', background: '#f0fdfa', padding: '7px 10px', fontSize: 10.5, color: '#334155' }}>
          <b>Pure baseline: exogenous · New-connection revenue:</b> {s.connectionMetadata?.label || (distinctModes.length > 1 ? 'Mixed across areas' : (distinctModes[0] || 'Exogenous'))}
          {(modes.length > 1 || s.connectionMetadata?.mixed) ? <span> · Per area: {modes.map((mode: any) => `${mode.area}: ${mode.label}`).join(' · ')}</span> : null}
          {modes.some((mode: any) => mode.errors?.length) && <span> · Validation issues are reported for the affected area.</span>}
          <div style={{ marginTop: 3 }}>Connection cash can fund eligible work after replacement priority and service-pool limits; it is not itself a coverage intervention or a direct gap credit.</div>
        </div>
        <div style={{ fontSize: 11.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderLeft: '3px solid #0ea5e9', borderRadius: 6, padding: '8px 12px', lineHeight: 1.55, marginBottom: 12 }}>
          <b>By {s.sum.endline}</b>, safely-managed coverage increases from <b>{pct(s.sum.bauCov)}</b> (BAU) to <b>{pct(s.sum.scnCov)}</b> with the current interventions — <b>{sig3(s.sum.addHH)} M</b> more households — against a target of <b>{pct(s.sum.tgtCov)}</b>. The endline financing requirement changes from <b>{sigB(displayMoney(s.sum.gapBauCum))}</b> to <b>{sigB(displayMoney(s.sum.gapScnCum))} B {displayCur}</b>.
        </div>
        <ServiceAccessGaps rows={s.accessRows} filename={`${scopeName}_${secKey}_service_access`} />
        {noImpact && (
          <div style={{ fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '5px 9px', marginBottom: 10 }}>
            No interventions are active for {label.toLowerCase()}. Toggle some on above to break down the impact by intervention.
          </div>
        )}
        </details>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 8, marginBottom: 8 }}>
          <button type="button" aria-label={`${label} safely managed view table`}
            onClick={() => showLedger(secKey, { metric: 'coverage', service: 'sm', basis: 'annual' })}>View safely managed table</button>
          <button type="button" aria-label={`${label} basic view table`}
            onClick={() => showLedger(secKey, { metric: 'coverage', service: 'basic', basis: 'annual' })}>View basic table</button>
          <button type="button" aria-label={`${label} financing view table`}
            onClick={() => showLedger(secKey, { metric: 'gap', service: 'total', basis: 'closing' })}>View financing table</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 8 }}>
          <StackChart title={`${label} — safely-managed coverage`} subtitle={!cs ? 'BAU, full scenario, target and total households. Intervention breakdown is pending or unavailable.' : contributionView === 'category' ? 'Categories sum the existing intervention contributions. Model results and attribution order are unchanged.' : "BAU base + each intervention's added households (target & ceiling shown as lines)"}
            data={covData} yLabel={isShare ? '% of population' : '# households (millions)'}
            base={covBase} bands={csBands} lines={covLines} fmt={covFmt} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_coverage_${contributionView === 'category' ? 'categories' : 'individual'}`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_coverage`} currencyDisplay={detailExportCurrency} />
          <BasicCoverageChart title={`${label} — basic coverage`} rows={basicData} isShare={isShare} domain={coverageDomain}
            filename={`${scopeName}_${secKey}_basic_coverage`}
            captureKey={`${secKey === 'water' ? 'water' : 'san'}_basic_coverage`} />
          <StackChart title={`${label} — advanced intervention-effects bridge (reported endline requirement)`} subtitle={!cs ? 'Combined safely managed + exclusive Basic financing. Advanced marginal effects on the existing endline-financing measure; attribution is pending or unavailable.' : 'Combined safely managed + exclusive Basic financing. Advanced view of the existing reported endline measure. Bands are signed reductions from BAU: positive reduces need, negative increases it. This is not the remaining-need balance; use the companion line below.'}
            data={gapData} yLabel={`Year-end requirement (B ${displayCur})`}
            bands={gapBands} lines={gapLines} fmt={gapFmt}
            filename={`${scopeName}_${secKey}_financing_gap_${contributionView === 'category' ? 'categories' : 'individual'}`} captureKey={`${secKey === 'water' ? 'water' : 'san'}_gap`} currencyDisplay={detailExportCurrency} />
        </div>
        <ResultsLedgerPanel data={{ years: s.ledgerScenario.map(row => row.year),
          baselineYear: datasets[0]?.period?.baseline_year ?? s.ledgerScenario[0].year,
          base: s.ledgerBase, scenario: s.ledgerScenario, areas: s.ledgerAreas, contributions: cs?.ledgerContributions ?? [],
          attributionComplete: !!cs, includesDebt: datasets.some(inp => Object.values(inp.utility_debt || {})
            .some((config: any) => config?.enabled && config.allocation_share > 0)) }} sector={secKey} label={label} scope={scopeName}
          years={s.ledgerScenario.filter(row => (chartStart == null || row.year >= chartStart) &&
            (chartEnd == null || row.year <= chartEnd)).map(row => row.year)}
          isShare={isShare} currency={displayCur} moneyFactor={moneyFactor} currencyDisplay={detailExportCurrency}
          contributionView={contributionView}
          onRetry={() => setAttempt(value => value + 1)}
          selection={ledgerSelection[secKey]} onSelectionChange={selection =>
            setLedgerSelection(current => ({ ...current, [secKey]: selection }))} />
        <section className="remaining-need-chart" aria-label={`${label} remaining financing need chart`}>
          <div className="remaining-need-chart__heading">
            <div>
              <span>Closing balance · B {displayCur} / {scopeName} / {chartService === 'sm' ? 'Safely managed' : chartService === 'basic' ? 'Basic-only' : 'At least Basic'}</span>
              <h3>Remaining financing need—with interventions</h3>
              <p>BAU and combined scenario use the same closing source series as the year-end ledger. Effects show changes from BAU, not remaining need.</p>
            </div>
            <div className="remaining-need-chart__tools">
              <strong>{visibleLedgerYears.length ? `${visibleLedgerYears[0]}–${visibleLedgerYears[visibleLedgerYears.length - 1]}` : 'No years selected'}</strong>
              <TableExport filename={`${scopeName}_${secKey}_${chartService}_remaining_need_${displayCur}`}
                sheetName="Closing need" compact currencyDisplay={detailExportCurrency} freezeColumns={7}
                headers={['Year','Sector','Geography / scope','Service','Timing','Unit','BAU remaining need','Combined-scenario remaining need']}
                rows={needChartRows.map(row => [row.year, label, scopeName,
                  chartService === 'sm' ? 'Safely managed' : chartService === 'basic' ? 'Basic-only' : 'At least Basic',
                  'Year-end balance', `B ${displayCur}`, row.bau, row.scenario])} />
            </div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={needChartRows} margin={{ top: 12, right: 22, bottom: 8, left: 10 }}>
              <CartesianGrid strokeDasharray="3 4" stroke="#dce5e5" />
              <XAxis dataKey="year" tick={{ fontSize: 10 }} interval={yearAxisInterval(needChartRows)} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={v => sig3(Number(v))}>
                <Label value={`B ${displayCur}`} angle={-90} position="insideLeft" style={{ fontSize: 10, fill: '#64748b' }} />
              </YAxis>
              <Tooltip formatter={(value: any, name: any) => [
                value == null ? 'Not reported' : `${sig3(Number(value))} B ${displayCur}`, name,
              ]} />
              <Legend />
              <Line type="monotone" dataKey="bau" name="Remaining financing need — BAU" stroke="#78939a"
                strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="scenario" name="Remaining financing need—with interventions" stroke="#087f78"
                strokeWidth={2.8} dot={false} connectNulls={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
          {needChartRows.length > 0 && needChartRows.every(row => row.bau == null && row.scenario == null) &&
            <p className="remaining-need-chart__unavailable" role="status">
              Exact closing source fields are not present in this result set; balances are unavailable rather than inferred.
            </p>}
        </section>
        <details style={{ marginTop: 12, marginBottom: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, color: '#334155' }}>Full technical audit ledger and downloads</summary>
          <ScenarioGapTables rows={s.financeRows} sector={secKey} label={label} scope={scopeName} currency={displayCur}
            moneyFactor={moneyFactor} currencyDisplay={detailExportCurrency} />
        </details>
        <RevenueDetails series={s} sector={secKey} />
        <NRWDiagnostics results={s.nrwResults} sector={secKey === 'water' ? 'water_supply' : 'sanitation'}
          currency={cur} currencyDisplay={detailExportCurrency}
          title={secKey === 'water' ? 'Water NRW source audit' : 'Sanitation revenue and NRW-link source audit'} />
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
          const on = datasets.some(inp => interventionEnabled(inp, d.key));
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
    <div ref={dashboardRef} data-testid="results-dashboard" style={{ flex: 1, minWidth: 0, minHeight: 0, overflowY: 'auto', padding: '18px 26px' }}>
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

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 12, color: '#334155' }}>Loan funding
          <select aria-label="Results debt mode" value={hasConfiguredDebt && includeDebt ? 'with_debt' : 'without_debt'}
            onChange={event => setIncludeDebt(event.target.value === 'with_debt')} style={{ marginLeft: 8, padding: '5px 8px', fontSize: 12 }}>
            <option value="without_debt">Without loan funding — standard results</option>
            <option value="with_debt" disabled={!hasConfiguredDebt}>With indicative loan funding</option>
          </select>
        </label>
        <span style={{ fontSize: 11, color: '#64748b' }}>Results exclude loan funding by default. Include it here without changing saved terms.</span>
        {(['water', 'sanitation'] as const).map(sector => <button key={sector} type="button"
          onClick={() => dashboardRef.current?.querySelector(`[data-results-sector="${sector}"]`)?.scrollIntoView({ block: 'start' })}
          style={{ padding: '5px 8px', fontSize: 11 }}>{sector === 'water' ? 'Water supply graphs' : 'Sanitation graphs'}</button>)}
      </div>
      <p style={{ fontSize: 11, lineHeight: 1.5, color: '#64748b', margin: '-4px 0 12px' }}>{LOAN_FUNDING_QUALIFICATION}</p>
      {/* Optional edits stay available without pushing the standard graphs off-screen. */}
      <details style={{ border: '1px solid #c7d2fe', background: '#f5f7ff', borderRadius: 8, padding: '10px 14px', marginBottom: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#312e81' }}>Adjust intervention switches</summary>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#312e81' }}>Interventions</span>
          <span style={{ fontSize: 10.5, color: '#64748b' }}>Switch each on or off — set its parameters on the <b>Intervention Design</b> tab.</span>
        </div>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <ToggleColumn title="Water Supply" defs={WATER_INTV} />
          <ToggleColumn title="Sanitation" defs={SAN_INTV} />
        </div>
      </details>

      {error && <div role="alert" style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>Results unavailable — {error}
        <button type="button" onClick={() => setAttempt(value => value + 1)} style={{ marginLeft: 8 }}>Retry results</button>
      </div>}
      {contributionError && !error && <div role="alert" style={{ fontSize: 11, color: '#b91c1c', marginBottom: 8 }}>
        Intervention breakdown unavailable — {contributionError}. Full-scenario graphs and outputs are shown when available.
        <button type="button" onClick={() => setAttempt(value => value + 1)} style={{ marginLeft: 8 }}>Retry breakdown</button>
      </div>}
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
