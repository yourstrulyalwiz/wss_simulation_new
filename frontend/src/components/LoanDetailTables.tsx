import React from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { loanForecastLedger, loanNumber } from '../loanFundingReporting';
import { forecastCell } from '../forecastTablePresentation';
import { LOAN_FUNDING_QUALIFICATION } from '../loanFunding';
import TableExport from './TableExport';

type Props = { detail: any; baseline: number; currency: string; currencyDisplay: CurrencyDisplaySettings };
export default function LoanDetailTables({ detail, baseline, currency, currencyDisplay }: Props) {
  const unit = `M ${displayCurrency(currencyDisplay, currency)}`;
  const tables = [
    { title: 'Annual Proceeds Use', key: 'annual_injection', filename: 'loan_annual_proceeds_use',
      note: 'Forecast only. Opening unspent proceeds are carry, not new borrowing. Proceeds are restricted to expansion, never replacement or debt service. Only funded service is deducted from originally selected ordinary sources.',
      fields: [['ordinary_before_debt_service', 'Ordinary before debt service'], ['debt_service', 'Debt service due'],
        ['debt_service_paid', 'Debt service funded'], ['debt_service_unfunded', 'Debt service unfunded'],
        ['funded_interest', 'Funded interest'], ['funded_principal', 'Funded principal'], ['unfunded_interest', 'Unfunded interest'],
        ['unfunded_principal', 'Unfunded principal'], ['ordinary_after_debt_service', 'Ordinary after funded service'],
        ['disbursement', 'New injection'], ['opening_unspent_proceeds', 'Opening restricted proceeds'],
        ['investment_from_loan_proceeds', 'Investment from proceeds'], ['closing_unspent_proceeds', 'Closing restricted proceeds']] },
    { title: 'Repayment Schedule', key: 'repayment_schedule', filename: 'loan_full_repayment_schedule',
      note: 'Full contractual maturity, including years beyond the forecast. Post-horizon funded-payment cells remain unavailable unless reported. Scheduled amounts are obligations, not proof of payment; unpaid obligations are not forgiven.',
      fields: [['opening_principal', 'Opening contractual principal'], ['disbursement', 'Disbursement'],
        ['principal_payment', 'Principal due'], ['interest_payment', 'Interest due'], ['debt_service', 'Debt service due'],
        ['debt_service_paid', 'Debt service funded'], ['debt_service_unfunded', 'Debt service unfunded'],
        ['funded_interest', 'Funded interest'], ['funded_principal', 'Funded principal'], ['unfunded_interest', 'Unfunded interest'],
        ['unfunded_principal', 'Unfunded principal'], ['closing_principal', 'Closing contractual principal']] },
  ];
  return <>{tables.map(table => {
    const ledger = loanForecastLedger(detail?.[table.key], baseline);
    const headers = ['Year', ...table.fields.map(([, label]) => `${label} (${unit})`)];
    const rows = ledger.map(row => [row.year, ...table.fields.map(([key]) => {
      const value = loanNumber(row[key]);
      return value === null ? null : convertMoney(value, currencyDisplay, currency);
    })]);
    return <details className="loan-optional" key={table.key} data-testid={`loan-${table.key}`}>
      <summary>{table.title} · {rows.length} years</summary>
      <div className="loan-optional__body">
        <p className="loan-report-note">{table.note} {LOAN_FUNDING_QUALIFICATION}</p>
        <TableExport filename={table.filename} sheetName={table.title} headers={headers} rows={rows} compact currencyDisplay={currencyDisplay} />
        {rows.length ? <div className="modern-intv-table-scroll"><table className="modern-intv-table">
          <thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th>
            {row.slice(1).map((value: number | null, index: number) => <td key={index} data-label={headers[index + 1]}>{forecastCell(value)}</td>)}</tr>)}</tbody>
        </table></div> : <p className="modern-intv-table-state">This ledger is unavailable in the current calculation output.</p>}
      </div>
    </details>;
  })}</>;
}
