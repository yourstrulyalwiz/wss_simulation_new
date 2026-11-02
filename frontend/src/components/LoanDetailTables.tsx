import React from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { loanCashFlowRows, LOAN_CASH_FLOW_FIELDS } from '../loanFundingReporting';
import { forecastCell } from '../forecastTablePresentation';
import TableExport from './TableExport';

type Props = { detail: any; baseline: number; currency: string; currencyDisplay: CurrencyDisplaySettings };
export default function LoanDetailTables({ detail, baseline, currency, currencyDisplay }: Props) {
  const unit = `M ${displayCurrency(currencyDisplay, currency)}`;
  const ledger = loanCashFlowRows(detail, baseline);
  const headers = ['Year', ...LOAN_CASH_FLOW_FIELDS.map(([, label]) => `${label} (${unit})`)];
  const rows = ledger.map(row => [row.year, ...LOAN_CASH_FLOW_FIELDS.map(([key]) =>
    row[key] === null ? null : convertMoney(row[key]!, currencyDisplay, currency) ?? null)]);
  return <details className="loan-optional" data-testid="loan-cash_flow">
    <summary>Show / hide table · {rows.length} years</summary>
    <div className="loan-optional__body">
      <p className="loan-report-note">Annual cash flow and contractual repayment, from the simulation start through loan maturity.
        Debt service is funded from the selected ordinary revenue sources; restricted proceeds are not used for repayment.
        Due amounts are contractual obligations, while funded amounts show actual modeled payments.
        Cash-flow values beyond the simulated period remain —. Hidden unfunded-payment columns do not change the model’s obligations.
        Opening and closing restricted proceeds are balances, not new funding. With borrowing disabled, the table covers the simulation period.</p>
      <TableExport filename="loan_cash_flow_repayment" sheetName="Loan cash flow and repayment"
        headers={headers} rows={rows} compact currencyDisplay={currencyDisplay} />
      {rows.length ? <div className="modern-intv-table-scroll"><table className="modern-intv-table">
        <thead><tr>{headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th>
          {row.slice(1).map((value, index) => <td key={index} data-label={headers[index + 1]}>{forecastCell(value)}</td>)}
        </tr>)}</tbody>
      </table></div> : <p className="modern-intv-table-state">This ledger is unavailable in the current calculation output.</p>}
    </div>
  </details>;
}
