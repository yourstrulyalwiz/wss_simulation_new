import React from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { isModeledLoanSummary, LOAN_FUNDING_QUALIFICATION } from '../loanFunding';
import TableExport from './TableExport';
import NRWDiagnostics from './NRWDiagnostics';

type Props = {
  debt: any;
  result?: any;
  currency: string;
  currencyDisplay: CurrencyDisplaySettings;
  calculationError?: string;
  fresh?: boolean;
  onRetry?: () => void;
  scenarioResult?: any;
};

const sources = [
  ['collection', 'Collection efficiency'],
  ['tariff', 'Tariff reform'],
  ['nrw', 'NRW-related net cash'],
  ['connections', 'Revenue from new connections'],
] as const;

function formatMoney(value: any, currency: string, settings: CurrencyDisplaySettings) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const converted = convertMoney(Number(value), settings, currency);
  return `${Number(converted || 0).toLocaleString('en-US', { maximumFractionDigits: 3 })} ${displayCurrency(settings, currency)} mn`;
}
function formatNumber(value: any, digits = 6) {
  return value == null || !Number.isFinite(Number(value))
    ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

export default function UtilityDebtPreview({ debt, result, scenarioResult, currency, currencyDisplay, calculationError = '', fresh = true, onRetry }: Props) {
  const enabled = !!debt?.enabled;
  const ready = !!result && fresh && !calculationError;
  const metadata = ready ? result : null;
  const sourcesCash = metadata?.reference_source_cash || {};
  const selectedSources: string[] = Array.isArray(debt?.revenue_sources) ? debt.revenue_sources : [];
  const injection: any[] = Array.isArray(metadata?.annual_injection) ? metadata.annual_injection : [];
  const schedule: any[] = Array.isArray(metadata?.repayment_schedule) ? metadata.repayment_schedule : [];
  const modeled = isModeledLoanSummary(metadata);
  const year = debt?.disbursement_year;
  const amountOrDash = (value: any) => value == null || !Number.isFinite(Number(value))
    ? '—' : formatMoney(value, currency, currencyDisplay);
  const annualRows = injection.map(row => [
    row.year,
    amountOrDash(row.ordinary_before_debt_service),
    amountOrDash(row.debt_service),
    ...['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'funded_principal', 'unfunded_interest', 'unfunded_principal'].map(key => amountOrDash(row[key])),
    amountOrDash(row.ordinary_after_debt_service),
    convertMoney(Number(row.disbursement || 0), currencyDisplay, currency),
    convertMoney(Number(row.opening_unspent_proceeds || 0), currencyDisplay, currency),
    convertMoney(Number(row.investment_from_loan_proceeds || 0), currencyDisplay, currency),
    convertMoney(Number(row.closing_unspent_proceeds || 0), currencyDisplay, currency),
    LOAN_FUNDING_QUALIFICATION,
  ]);
  const headers = ['Year', `Ordinary funds before service (${displayCurrency(currencyDisplay, currency)} mn)`,
    `Debt service due (${displayCurrency(currencyDisplay, currency)} mn)`,
    ...['Debt service funded', 'Debt service unfunded', 'Funded interest', 'Funded principal', 'Unfunded interest', 'Unfunded principal']
      .map(label => `${label} (${displayCurrency(currencyDisplay, currency)} mn)`),
    `Ordinary funds after funded service (${displayCurrency(currencyDisplay, currency)} mn)`,
    `New injection (${displayCurrency(currencyDisplay, currency)} mn)`,
    `Opening unspent proceeds (${displayCurrency(currencyDisplay, currency)} mn)`,
    `Investment from proceeds (${displayCurrency(currencyDisplay, currency)} mn)`,
    `Closing unspent proceeds (${displayCurrency(currencyDisplay, currency)} mn)`, 'Qualification'];
  const scheduleHeaders = ['Year', 'Opening contractual principal', 'Disbursement', 'Principal due',
    'Interest due', 'Debt service due', 'Debt service funded', 'Debt service unfunded', 'Funded interest', 'Funded principal',
    'Unfunded interest', 'Unfunded principal', 'Closing contractual principal'];
  const scheduleRows = schedule.map(row => [row.year,
    amountOrDash(row.opening_principal), amountOrDash(row.disbursement), amountOrDash(row.principal_payment),
    amountOrDash(row.interest_payment), amountOrDash(row.debt_service),
    ...['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'funded_principal', 'unfunded_interest', 'unfunded_principal'].map(key => amountOrDash(row[key])),
    amountOrDash(row.closing_principal)]);
  const referenceCashRows = sources.map(([key, label]) => (
    <div className="debt-diagnostics-row" key={key}>
      <span>{label}{selectedSources.includes(key) ? ' · selected' : ''}</span>
      <b>{formatMoney(sourcesCash[key], currency, currencyDisplay)}</b>
    </div>
  ));

  return <section className="debt-preview" data-testid="utility-debt-preview">
    <div className="debt-loan-summary">
      <div className="debt-loan-summary-copy">
        <span className="debt-eyebrow">FROZEN REFERENCE · {year || 'YEAR NOT SELECTED'}</span>
       <h3>Fixed-annuity loan funding</h3>
        <p>{LOAN_FUNDING_QUALIFICATION}</p>
      </div>
      <strong data-testid="indicative-principal">{ready ? formatMoney(metadata.indicative_principal ?? metadata.accepted_principal, currency, currencyDisplay) : '—'}</strong>
    </div>

    {ready && <div className="debt-diagnostics">
      {referenceCashRows}
      <div className="debt-diagnostics-row"><span>Selected signed pool</span><b>{formatMoney(metadata.selected_signed_pool, currency, currencyDisplay)}</b></div>
      <div className="debt-diagnostics-row"><span>Eligible pool after zero floor</span><b>{formatMoney(metadata.eligible_pool, currency, currencyDisplay)}</b></div>
      <div className="debt-diagnostics-row"><span>Allocation · annual hypothetical commitment</span><b>{formatNumber(Number(metadata.allocation_share) * 100, 2)}% · {formatMoney(metadata.annual_allocation, currency, currencyDisplay)}</b></div>
      <div className="debt-diagnostics-row"><span>Annual real rate · term</span><b>{metadata.annual_real_interest_rate == null ? '—' : `${formatNumber(Number(metadata.annual_real_interest_rate) * 100, 3)}%`} · {metadata.loan_term_years ?? '—'} years</b></div>
      <div className="debt-diagnostics-row"><span>Annuity factor</span><b>{formatNumber(metadata.annuity_factor)}</b></div>
      <div className="debt-diagnostics-row"><span>Fixed annual debt service</span><b>{amountOrDash(metadata.fixed_annual_debt_service)}</b></div>
      <div className="debt-diagnostics-row"><span>First repayment year · maturity</span><b>{metadata.first_repayment_year ?? '—'} · {metadata.maturity_year ?? '—'}</b></div>
      <div className="debt-diagnostics-row"><span>Horizon closing principal</span><b>{amountOrDash(metadata.horizon_closing_principal)}</b></div>
      <div className="debt-diagnostics-row"><span>Remaining contractual payments · service</span><b>{metadata.remaining_contractual_payments ?? '—'} · {amountOrDash(metadata.remaining_contractual_debt_service)}</b></div>
      <div className="debt-diagnostics-row"><span>Repayment accounting · feasibility</span><b>{modeled ? 'Fixed annuity modeled · not assessed' : 'Legacy result · not verified'}</b></div>
      <div className="debt-diagnostics-row"><span>Source cash treatment</span><b>Selected signed sources are summed before a single zero floor</b></div>
    </div>}
    {ready && scenarioResult && <NRWDiagnostics results={scenarioResult} currency={currency} currencyDisplay={currencyDisplay} title="NRW source cash audit" />}

    {!enabled && <div className="debt-preview-state">Indicative borrowing is off. Saved assumptions are retained; ordinary results remain available.</div>}
    {calculationError && <div role="alert" className="debt-preview-error">Estimate unavailable — {calculationError}
      {onRetry && <button type="button" onClick={onRetry} className="debt-retry">Retry calculation</button>}
    </div>}
    {!calculationError && enabled && !ready && <div className="debt-preview-state">Updating the live estimate…</div>}
    {ready && <div className="debt-preview-state" data-testid="loan-status">
      Status: {metadata.status || 'unavailable'} · {modeled ? 'fixed annual obligations modeled' : 'historical repayment metadata; recalculate for the fixed-annuity model'} · feasibility not assessed.
      {metadata.status === 'no_selected_sources' && ' Select at least one eligible source to size proceeds.'}
      {metadata.status === 'zero_allocation' && ' Allocation is 0%; no proceeds are injected.'}
      {metadata.status === 'no_positive_pool' && ' The selected signed pool is not positive; no proceeds are injected.'}
    </div>}

    <div className="debt-annual">
      <div className="debt-annual-head">
        <div><span className="debt-eyebrow">ACTUAL SCENARIO CASH LEDGER</span><h3>Annual proceeds use</h3></div>
        <TableExport filename="indicative_loan_proceeds_ledger" sheetName="Proceeds use" headers={headers} rows={annualRows} compact currencyDisplay={currencyDisplay} />
      </div>
      {injection.length ? <div className="debt-table-scroll">
        <table data-testid="loan-injection-table">
           <thead><tr>{headers.slice(0, -1).map((header, i) => <th key={i}>{i === 0 ? 'Year' : header.split(' (')[0]}</th>)}</tr></thead>
          <tbody>{injection.map((row, i) => <tr key={`${row.year}-${i}`}>
            <th scope="row">{row.year}</th>
            {[row.ordinary_before_debt_service, row.debt_service,
              ...['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'funded_principal', 'unfunded_interest', 'unfunded_principal'].map(key => row[key]),
              row.ordinary_after_debt_service,
              row.disbursement, row.opening_unspent_proceeds, row.investment_from_loan_proceeds, row.closing_unspent_proceeds].map((value, j) =>
              <td key={j}>{amountOrDash(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : <div className="debt-preview-state">The proceeds-use ledger appears when calculation output is available.</div>}
      <p className="debt-reference-note">Opening unspent proceeds are carried balances, not new borrowing. A new injection is counted once in its selected year. Only funded debt service is deducted from originally selected sources after loss absorption; unfunded obligations are not forgiven. Proceeds remain restricted to expansion and cannot pay debt service or replacement. NRW enters the selected-source pool as signed net cash after implementation cost.</p>
    </div>
    {modeled && <div className="debt-annual" data-testid="loan-repayment-schedule">
      <div className="debt-annual-head">
        <div><span className="debt-eyebrow">CONTRACTUAL OBLIGATIONS · FULL TERM</span><h3>Repayment schedule</h3></div>
        <TableExport filename="utility_loan_repayment_schedule" sheetName="Repayment schedule" headers={scheduleHeaders} rows={scheduleRows} compact currencyDisplay={currencyDisplay} />
      </div>
      {schedule.length ? <div className="debt-table-scroll">
        <table>
          <thead><tr>{scheduleHeaders.map(header => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>{schedule.map((row, i) => <tr key={`${row.year}-${i}`}>
            <th scope="row">{row.year}</th>
            {[row.opening_principal, row.disbursement, row.principal_payment, row.interest_payment, row.debt_service,
              ...['debt_service_paid', 'debt_service_unfunded', 'funded_interest', 'funded_principal', 'unfunded_interest', 'unfunded_principal'].map(key => row[key]),
              row.closing_principal]
              .map((value, j) => <td key={j}>{amountOrDash(value)}</td>)}
          </tr>)}</tbody>
        </table>
      </div> : <div className="debt-preview-state">The full contractual schedule is unavailable in this calculation response.</div>}
      <p className="debt-reference-note">The schedule can extend beyond the model horizon. Scheduled amounts are obligations, not proof of payment; affordability is not assessed. Horizon principal and unspent proceeds are separate balances.</p>
    </div>}
    <div className="debt-caveat">{LOAN_FUNDING_QUALIFICATION}</div>
  </section>;
}
