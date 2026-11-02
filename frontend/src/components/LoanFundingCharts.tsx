import React, { useRef, useState } from 'react';
import { Area, Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { aggregateCoverage, sourceCoverageRows, BASELINE_COVERAGE_LABEL } from '../sourceAttribution';
import { aggregateContributionRows, type ContributionView, type ViewBand } from '../contributionView';
import type { BauServiceLevel } from '../bauServiceView';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { loanCoverageRows, loanFundsRows } from '../loanFundingReporting';
import { AVAILABLE_FUND_COLUMNS, MOBILIZED_SOURCES } from '../sectorAvailableFunds';
import { REVENUE_SOURCES } from '../revenueSources';
import { forecastCell } from '../forecastTablePresentation';
import ChartExport from './ChartExport';
import TableExport from './TableExport';

type Props = { result: any; inputs: any; sector: 'water' | 'sanitation'; level: BauServiceLevel; contributionView: ContributionView; currencyDisplay: CurrencyDisplaySettings; scopeLabel: string };
const coverageLines = [
  { key: 'before', label: 'Intervention without loan', color: '#657b85', dash: '6 3' },
  { key: 'after', label: 'Scenario with loan', color: '#014972' },
  { key: 'marginal', label: 'Marginal loan effect (with − without)', color: '#a65b20', dash: '3 3' },
  { key: 'target', label: 'Entered target', color: '#258260', dash: '8 3' },
];

export default function LoanFundingCharts({ result, inputs, sector, level, contributionView, currencyDisplay, scopeLabel }: Props) {
  const coverageRef = useRef<HTMLDivElement>(null), fundsRef = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState<'count' | 'share'>('count');
  const [start, setStart] = useState<number | null>(null), [end, setEnd] = useState<number | null>(null);
  const key = sector === 'water' ? 'water_supply' : 'sanitation';
  const baseline = Number(inputs.period.baseline_year);
  const coverage = loanCoverageRows(result, key, baseline, level);
  const years = coverage.map(row => row.year);
  const lo = start !== null && years.includes(start) ? start : years[0];
  const hi = end !== null && years.includes(end) ? end : years[years.length - 1];
  const visible = (year: number) => year >= lo && year <= hi;
  let attributed: { rows: any[]; bands: ViewBand[] } = { rows: [], bands: [] };
  let attributionError = '';
  try {
    const data = sourceCoverageRows(result.years, result.total_hh, aggregateCoverage([result], key), sector,
      level === 'safely_managed' ? 'sm' : level);
    // The stack is actual source-funded coverage, never an added "marginal" stock.
    attributed = contributionView === 'category' ? aggregateContributionRows(data.rows, data.bands) : data;
  } catch (error) { attributionError = error instanceof Error ? error.message : String(error); }
  const coverageData = coverage.filter(row => visible(row.year)).map(row => {
    const stock = attributed.rows.find(item => item.year === row.year);
    const convert = (value: any) => typeof value !== 'number' || !Number.isFinite(value) ? null
      : unit === 'share' ? row.total !== null && row.total > 0 ? value / row.total * 100 : null : value;
    return { year: row.year, ...Object.fromEntries([
      ...['before', 'after', 'marginal', 'target'].map(name => [name, convert((row as any)[name])]),
      ['opening', convert(stock?.__baseline)],
      ...attributed.bands.map(band => [band.key, convert(stock?.[band.key])]),
    ]) };
  });
  const coverageUnit = unit === 'share' ? '% households / marginal pp' : 'M households';
  const coverageHeaders = ['Year', `${BASELINE_COVERAGE_LABEL} (${coverageUnit})`,
    ...attributed.bands.map(band => `${band.label} (${coverageUnit})`),
    ...coverageLines.map(line => `${line.label} (${line.key === 'marginal' && unit === 'share' ? 'pp' : coverageUnit})`)];
  const coverageExport = coverageData.map(row => [row.year, (row as any).opening,
    ...attributed.bands.map(band => (row as any)[band.key]), ...coverageLines.map(line => (row as any)[line.key])]);
  const currency = inputs.country_config?.currency || 'LCU';
  const moneyUnit = `B ${displayCurrency(currencyDisplay, currency)}/yr`;
  const money = (value: number | null) => {
    const converted = value === null ? null : convertMoney(value, currencyDisplay, currency);
    return converted == null ? null : converted / 1000;
  };
  const funds = loanFundsRows(result, key, baseline).filter(row => visible(row.year));
  const fundColumns = [
    ...AVAILABLE_FUND_COLUMNS,
    { key: 'injection', label: 'New loan injection' }, { key: 'newFunds', label: 'Gross ordinary + new loan' },
    { key: 'paid', label: 'Actual debt payment (deduction)' }, { key: 'net', label: 'Net new funds after actual debt payment' },
    { key: 'ordinaryBefore', label: 'Signed ordinary before debt payment' },
    { key: 'ordinaryAfter', label: 'Eligible ordinary capital after losses and funded payment' },
    { key: 'openingCarry', label: 'Opening restricted carry (balance, not new funds)' },
    { key: 'closingCarry', label: 'Closing restricted carry (balance, not new funds)' },
  ];
  const fundsData = funds.map(row => ({ ...row, ...Object.fromEntries([
    ...fundColumns.map(column => [column.key, money((row as any)[column.key])]), ['payment', money(row.payment)],
  ]) }));
  const fundHeaders = ['Year', ...fundColumns.map(column => `${column.label} (${['openingCarry', 'closingCarry'].includes(column.key) ? `B ${displayCurrency(currencyDisplay, currency)}` : moneyUnit})`)];
  const fundsExport = fundsData.map(row => [row.year, ...fundColumns.map(column => (row as any)[column.key])]);
  const sources = [...MOBILIZED_SOURCES, ...REVENUE_SOURCES,
    { key: 'injection', label: 'New loan injection', color: '#bd873a' },
    { key: 'payment', label: 'Actual funded debt service (−)', color: '#a9443b' }];
  const filename = `${scopeLabel}_${sector}_${level}_loan`;
  return <>
    <div className="loan-chart" data-testid="loan-coverage-chart">
      <h3>Service coverage · without loan vs with loan</h3>
      <p>Actual source-funded coverage is stacked once. The matched intervention without loan, scenario with loan and signed marginal difference are independent lines, not additional households. Negative marginal effects are retained. Basic only is exclusive; at least basic adds SM and Basic only once.</p>
      <div className="loan-chart__tools">
        <div className="modern-bau-service-switch" role="group" aria-label="Loan coverage units">
          <button type="button" aria-pressed={unit === 'count'} onClick={() => setUnit('count')}>Households (M)</button>
          <button type="button" aria-pressed={unit === 'share'} onClick={() => setUnit('share')}>Coverage (%) / marginal (pp)</button>
        </div>
        <label>Years <select aria-label="Loan chart start year" value={lo ?? ''} onChange={event => { const year = Number(event.target.value); setStart(year); if (year > hi) setEnd(year); }}>
          {years.map(year => <option key={year}>{year}</option>)}</select> to
          <select aria-label="Loan chart end year" value={hi ?? ''} onChange={event => { const year = Number(event.target.value); setEnd(year); if (year < lo) setStart(year); }}>
            {years.map(year => <option key={year}>{year}</option>)}</select></label>
        <ChartExport chartRef={coverageRef} filename={`${filename}_coverage`} title="Loan coverage comparison"
          sheets={[{ name: 'Coverage', headers: coverageHeaders, rows: coverageExport }]}
          chartSpec={{ stacked: true, areas: [{ name: coverageHeaders[1], color: '#b4cfd9' },
            ...attributed.bands.map((band, index) => ({ name: coverageHeaders[index + 2], color: band.color }))],
            lines: coverageLines.map((line, index) => ({ name: coverageHeaders[2 + attributed.bands.length + index], color: line.color, dash: !!line.dash })),
            yTitle: coverageUnit }} compact />
      </div>
      {attributionError && <p className="modern-intv-data-note" role="status">{attributionError} Matched scenario lines remain available where reported.</p>}
      {coverage.some(row => row.before === null || row.after === null) && <p className="modern-intv-data-note">Matched coverage is incomplete. Missing values remain unavailable, not BAU or zero.</p>}
      <div ref={coverageRef} className="loan-chart__canvas">
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={coverageData} accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="year" />
          <YAxis width={62} tickFormatter={value => forecastCell(value)} />
          <Tooltip formatter={(value: any, name: any) => [`${forecastCell(value)} ${unit === 'share' ? name.includes('Marginal') ? 'pp' : '%' : 'M HH'}`, name]} />
          <Legend wrapperStyle={{ fontSize: 10 }} /><ReferenceLine y={0} stroke="#758e98" />
          {!attributionError && <Area dataKey="opening" name={BASELINE_COVERAGE_LABEL} stackId="coverage" fill="#b4cfd9" stroke="#b4cfd9" isAnimationActive={false} />}
          {attributed.bands.map(band => <Area key={band.key} dataKey={band.key} name={band.label} stackId="coverage" fill={band.color} stroke={band.color} isAnimationActive={false} />)}
          {coverageLines.map(line => <Line key={line.key} dataKey={line.key} name={line.label} stroke={line.color} strokeDasharray={line.dash} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />)}
        </ComposedChart></ResponsiveContainer>
      </div>
      <TableExport filename={`${filename}_coverage`} sheetName="Coverage" headers={coverageHeaders} rows={coverageExport} compact />
    </div>
    <div className="loan-chart" data-testid="loan-funds-chart">
      <h3>Sector Available Funds · new loan and actual payment effects</h3>
      <p>Mobilized Funds + Additional Revenues Generated = gross ordinary funding. Add only the new loan injection, then deduct actual funded debt service to obtain signed net new funds. Opening/closing unspent proceeds are restricted balances, excluded from new funds. Signed source losses are already included. Replacement charges are not deducted again. The separate engine eligible-capital ledger reconciles max(0, ordinary before service) − funded service = eligible ordinary capital after service; this is not an additional cash source. {moneyUnit}.</p>
      <div className="loan-chart__tools">
        <TableExport filename={`${filename}_funds`} sheetName="Sector available funds" headers={fundHeaders} rows={fundsExport} compact currencyDisplay={currencyDisplay} />
        <ChartExport chartRef={fundsRef} filename={`${filename}_funds`} title="Sector Available Funds"
          sheets={[{ name: 'Available funds', headers: fundHeaders, rows: fundsExport }]} currencyDisplay={currencyDisplay} compact />
      </div>
      {funds.some(row => !row.reconciled || !row.paymentReconciled) && <p className="modern-intv-data-note" role="status">
        Some source or payment-ledger values are unavailable or do not reconcile. Unreconciled source stacks are omitted; reported totals remain separate. Missing data is never zero.
        {[...new Set(funds.flatMap(row => row.issues))].join(' ')}
      </p>}
      <div ref={fundsRef} className="loan-chart__canvas">
        <ResponsiveContainer width="100%" height="100%"><ComposedChart data={fundsData.map((row, index) => ({
          ...row, ...Object.fromEntries(sources.map(source => [source.key,
            funds[index].reconciled ? (row as any)[source.key] : null])),
        }))} stackOffset="sign" accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="year" />
          <YAxis width={66} tickFormatter={value => forecastCell(value)} />
          <Tooltip formatter={(value: any, name: any) => [`${forecastCell(value)} ${moneyUnit}`, name]} />
          <Legend wrapperStyle={{ fontSize: 10 }} /><ReferenceLine y={0} stroke="#758e98" />
          {sources.map(source => <Bar key={source.key} dataKey={source.key} name={source.label} stackId="new-funds" fill={source.color} isAnimationActive={false} />)}
          <Line dataKey="total" name="Gross ordinary available funding" stroke="#657b85" dot={false} strokeDasharray="5 3" isAnimationActive={false} />
          <Line dataKey="net" name="Net new funds after actual debt payment" stroke="#014972" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart></ResponsiveContainer>
      </div>
    </div>
  </>;
}
