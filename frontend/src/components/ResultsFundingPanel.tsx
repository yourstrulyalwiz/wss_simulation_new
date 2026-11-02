import { useRef } from 'react';
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { aggregateLoanFundsRows } from '../loanFundingReporting';
import { AVAILABLE_FUND_COLUMNS, MOBILIZED_SOURCES } from '../sectorAvailableFunds';
import { REVENUE_SOURCES } from '../revenueSources';
import { scenarioSpendingRows } from '../interventionReporting';
import { forecastCell } from '../forecastTablePresentation';
import { yearAxisInterval } from '../chartAxis';
import type { CurrencyDisplaySettings } from '../currencyDisplay';
import ChartExport from './ChartExport';
import TableExport from './TableExport';

type Props = {
  results: any[]; inputs: any[]; sector: 'water' | 'sanitation'; scope: string;
  years: number[]; currency: string; moneyFactor: number; currencyDisplay: CurrencyDisplaySettings;
  mode: 'capital' | 'funds';
};
export default function ResultsFundingPanel({ results, inputs, sector, scope, years, currency, moneyFactor, currencyDisplay, mode }: Props) {
  const chart = useRef<HTMLDivElement>(null);
  const key = sector === 'water' ? 'water_supply' : 'sanitation';
  const baseline = inputs.map(input => Number(input.period.baseline_year));
  const funds = aggregateLoanFundsRows(results, key, baseline).filter(row => years.includes(row.year));
  const units = `B ${currency}/yr`;
  const money = (value: number | null) => value === null ? null : value * moneyFactor / 1000;
  const columns = [...AVAILABLE_FUND_COLUMNS.map(column => ({ ...column,
    label: column.key === 'total' ? 'Gross ordinary funding (before loan / service)' : column.label })),
    { key: 'injection', label: 'New loan proceeds' },
    { key: 'newFunds', label: 'Ordinary funding + new loan proceeds' },
    { key: 'paid', label: 'Actual funded debt service (deduction)' },
    { key: 'net', label: 'Net new available funds — sector total' },
  ] as const;
  const sources = [...MOBILIZED_SOURCES, ...REVENUE_SOURCES,
    { key: 'injection', label: 'New loan proceeds', color: '#bd873a' },
    { key: 'payment', label: 'Actual funded debt service (−)', color: '#a9443b' }];
  let capital: ReturnType<typeof scenarioSpendingRows> = [];
  let error = '';
  if (mode === 'capital') {
    try { capital = scenarioSpendingRows(results, key, Math.max(...baseline)).filter(row => years.includes(row.year)); }
    catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
  }
  const data = funds.map(row => {
    const annual = capital.find(item => item.year === row.year);
    return { ...row, ...Object.fromEntries([...columns, { key: 'payment' }].map(column =>
      [column.key, money(row[column.key as keyof typeof row] as number | null)])),
      expansion: annual ? money(annual.expansion) : null, replacement: annual ? money(annual.replacement) : null };
  });
  const capitalHeaders = ['Year', `Planned expansion (${units})`, `Current replacement requirement (${units})`,
    `Ordinary funds (${units})`, `New loan proceeds (${units})`, `Actual funded debt service — deduction (${units})`, `Net new available funds (${units})`];
  const headers = mode === 'capital' ? capitalHeaders : ['Year', ...columns.map(column => `${column.label} (${units})`)];
  const rows = data.map(row => mode === 'capital'
    ? [row.year, row.expansion, row.replacement, row.total, row.injection, row.paid, row.net]
    : [row.year, ...columns.map(column => row[column.key])]);
  const title = mode === 'capital' ? 'Final intervention scenario capital requirements and available funding' : 'Sector available funds';
  const filename = `${scope}_${sector}_results_${mode}_${currency}`;
  if (error) return <p role="alert" className="modern-intv-data-note">{error}</p>;
  if (!data.length) return <div className="modern-intv-table-state">No forecast years in the selected range. Choose a forecast year to view this report.</div>;
  return <div className="loan-chart" data-testid={`results-${mode}-report`}>
    <h3>{title}</h3>
    <p>{scope} · {sector === 'water' ? 'Water Supply' : 'Sanitation'} · Both service levels · {units}.
      {mode === 'capital' ? ' Annual planned expansion and current replacement requirements exclude opening backlog; closing obligations remain in the ledger.' : ' Public spending and external funding form mobilized funds; signed revenues form the additional-revenues subtotal.'}
      {' '}Available funds = ordinary funding + new loan proceeds − actual funded debt service. Restricted opening and closing carry are balances, not new funding. Losses are already signed; replacement is not deducted again. Loan amounts follow the Results borrowing display mode; saved disabled loans are never enabled.</p>
    <div className="loan-chart__tools">
      <ChartExport chartRef={chart} filename={filename} title={title} compact currencyDisplay={currencyDisplay}
        sheets={[{ name: title.slice(0, 31), headers, rows }]} />
      <TableExport filename={filename} sheetName="Available funding" headers={headers} rows={rows} compact currencyDisplay={currencyDisplay} />
    </div>
    {funds.some(row => !row.reconciled || !row.paymentReconciled) && <p role="status" className="modern-intv-data-note">
      Some source or payment values are unavailable or do not reconcile. Missing amounts remain unavailable, not zero.
      {[...new Set(funds.flatMap(row => row.issues))].join(' ')}
    </p>}
    <div ref={chart} className="loan-chart__canvas">
      <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} stackOffset="sign" accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="year" interval={yearAxisInterval(data)} tick={{ fontSize: 11 }} />
        <YAxis width={66} tick={{ fontSize: 11 }} tickFormatter={value => forecastCell(value)} />
        <Tooltip formatter={(value: any, name: any) => [`${forecastCell(value)} ${units}`, name]} />
        <Legend wrapperStyle={{ fontSize: 11 }} /><ReferenceLine y={0} stroke="#758e98" />
        {mode === 'capital' ? <>
          <Bar dataKey="expansion" name="Planned expansion" stackId="requirements" fill="#347fa9" isAnimationActive={false} />
          <Bar dataKey="replacement" name="Current replacement requirement" stackId="requirements" fill="#a8cfe5" isAnimationActive={false} />
        </> : sources.map(source => <Bar key={source.key} dataKey={(row: any) => row.reconciled ? row[source.key] : null}
          name={source.label} stackId="funds" fill={source.color} isAnimationActive={false} />)}
        <Line dataKey="total" name="Gross ordinary funding" stroke="#657b85" strokeDasharray="5 3" dot={false} connectNulls={false} isAnimationActive={false} />
        <Line dataKey="net" name="Net new available funds" stroke="#014972" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
      </ComposedChart></ResponsiveContainer>
    </div>
    {mode === 'funds' && <div className="results-funds-table-frame">
      <table className="results-funds-table" aria-label="Sector available funds including loan effects">
        <colgroup><col style={{ width: 64 }} />{columns.map(column => <col key={column.key} />)}</colgroup>
        <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th>
          {row.slice(1).map((value, index) => <td key={index} data-label={headers[index + 1]}
            data-funds-total={['total', 'net', 'mobilized', 'additional'].includes(columns[index].key) || undefined}>{forecastCell(value)}</td>)}</tr>)}</tbody>
      </table>
    </div>}
  </div>;
}
