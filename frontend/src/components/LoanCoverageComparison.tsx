import React from 'react';
import type { BauServiceLevel } from '../bauServiceView';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { interventionCoverageKpis } from '../interventionReporting';
import { loanComparisonRows } from '../loanFundingReporting';
import { forecastTableHeaders } from '../forecastTableColumns';
import { forecastCell, forecastValueClass } from '../forecastTablePresentation';
import TableExport from './TableExport';

type Props = { result: any; inputs: any; sector: 'water' | 'sanitation'; level: BauServiceLevel; scopeLabel: string; currencyDisplay: CurrencyDisplaySettings; kpisOnly?: boolean };
export default function LoanCoverageComparison({ result, inputs, sector, level, scopeLabel, currencyDisplay, kpisOnly = false }: Props) {
  const key = sector === 'water' ? 'water_supply' : 'sanitation';
  const baseline = Number(inputs.period.baseline_year);
  const currency = inputs.country_config?.currency || 'LCU', shown = displayCurrency(currencyDisplay, currency);
  const values = interventionCoverageKpis(result, key, baseline, level);
  if (kpisOnly) return <div className="modern-intv-kpis" aria-label="Loan scenario coverage indicators">
    {[{ label: `Baseline · ${baseline}`, value: values.baseline },
      { label: `With loan · ${values.endYear ?? 'forecast end'}`, value: values.scenario },
      { label: `Entered target · ${values.endYear ?? 'forecast end'}`, value: values.target }].map(card =>
      <div key={card.label} className="modern-intv-kpi"><span>{card.label}</span>
        <strong>{card.value === null ? '—' : `${forecastCell(card.value)}%`}</strong><small>household coverage · live engine</small></div>)}
  </div>;
  const standard = forecastTableHeaders(level, shown);
  const headers = ['Year', 'Total households (M)', 'BAU households (M)', 'Intervention without loan households (M)',
    'With loan households (M)', 'Target households (M)', 'Marginal loan effect (M HH)',
    standard[4].replace('gap', 'signed balance'), ...standard.slice(5),
    `New loan injection (B ${shown}/yr)`, `Actual funded debt service (B ${shown}/yr)`,
    `Without-loan ordinary available funding (B ${shown}/yr)`];
  const rows = loanComparisonRows(result, key, baseline, level).map(row => row.map((value, index) => {
    if (index < 8 || value === null) return value;
    const converted = convertMoney(value, currencyDisplay, currency);
    return converted == null ? null : converted / 1000;
  }));
  const sourceColumn = [0, 1, 2, 12, 12, 3, -1, 4, 5, 6, 7, 8, 9, 10, 11, 11, 5, 11];
  return <div className="modern-intv-table-wrap" data-testid="loan-coverage-comparison">
    <div className="modern-intv-table-caption">
      <div className="modern-intv-table-caption__title"><span>Coverage Comparison · {scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'}</span>
        <TableExport filename={`${scopeLabel}_${sector}_${level}_loan_comparison`} sheetName="Coverage comparison"
          headers={headers} rows={rows} currencyDisplay={currencyDisplay} compact /></div>
      <small>BAU is a separate household comparison, never the no-loan proxy. Marginal loan effect = with loan − exact frozen intervention without loan. Positive and negative effects are retained. All costs, replacement credit, closing backlog, financing gaps and available funding are the with-loan scenario. Households in millions; money in billions of {shown}. Access deficits are negative, true overachievement positive; Basic-only shortfall retains SM credit. Residual costs and financing gaps are outstanding year-end balances, not additive flows. Replacement credit is current-year only; backlog is already in financing gaps. Ordinary available funding excludes restricted loan proceeds and is before debt and replacement charges; the explicit loan/payment columns are not added to it twice. Use the funds graph for gross/net reconciliation.</small>
    </div>
    {rows.some(row => row.some(value => value === null)) && <p className="modern-intv-data-note" role="status">Some engine metrics are unavailable (—). Exports retain blank cells, never fabricated zeros.</p>}
    {!rows.length ? <p className="modern-intv-table-state">No forecast comparison rows available after the baseline.</p> :
      <div className="modern-intv-table-scroll loan-comparison-frame"><table className="modern-intv-table">
        <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th>
          {row.slice(1).map((value, index) => <td key={index} data-label={headers[index + 1]}
            className={forecastValueClass(value, index + 1 === 6 ? 4 : sourceColumn[index + 1])}>
            {forecastCell(value, [6, 7, 12, 13].includes(index + 1))}</td>)}</tr>)}</tbody>
      </table></div>}
  </div>;
}
