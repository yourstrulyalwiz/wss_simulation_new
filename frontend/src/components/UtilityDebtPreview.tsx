import React, { useMemo, useState } from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import TableExport from './TableExport';

type Props = {
  debt: any;
  result?: any;
  currency: string;
  currencyDisplay: CurrencyDisplaySettings;
  calculationError?: string;
  fresh?: boolean;
  onRetry?: () => void;
};

const columns: [string, string, string?][] = [
  ['Collection improvement · net', 'collection_net_cash'],
  ['Tariff improvement · net', 'tariff_net_cash'],
  ['NRW net cash', 'nrw_net_cash'],
  ['Total additional modeled net revenue', 'total_additional_net_revenue'],
  ['Selected eligible net pool', 'eligible_additional_revenue'],
  ['Allocation-based servicing capacity', 'annual_service_capacity'],
  ['Loan disbursement · restricted investment', 'loan_disbursement'],
  ['Scheduled principal', 'principal_payment'],
  ['Scheduled interest', 'interest_payment'],
  ['Debt service', 'total_debt_service'],
  ['Repayment headroom', 'repayment_headroom'],
  ['Funding-reference collections', 'funding_reference_collected_revenue'],
  ['Reference collected revenue · no debt', 'reference_collected_revenue', 'reference_baseline_collected_revenue'],
  ['Scenario collected revenue', 'collected_revenue'],
  ['NRW sales cash', 'nrw_sales_cash'],
  ['NRW implementation cost', 'nrw_implementation_cost'],
  ['Connection gross revenue · excluded', 'connection_gross_revenue'],
  ['Connection variable cost', 'connection_variable_cost_difference'],
  ['Connection net cash · excluded', 'connection_net_cash'],
  ['Reference total additional net revenue · no debt', 'reference_total_additional_net_revenue'],
  ['Reference eligible net pool · no debt', 'reference_eligible_additional_revenue'],
  ['Protected eligible amount', 'protected_eligible_revenue'],
  ['Reference protected eligible amount · no debt', 'reference_protected_eligible_revenue'],
  ['Replacement requirement', 'replacement_requirement'],
  ['Reference replacement requirement · no debt', 'reference_replacement_requirement'],
  ['Cash after replacement', 'available_after_replacement'],
  ['Reference cash after replacement · no debt', 'reference_available_after_replacement'],
  ['Reference servicing capacity · no debt', 'reference_annual_service_capacity'],
];

function amount(value: any, currency: string, settings: CurrencyDisplaySettings) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const converted = convertMoney(Number(value), settings, currency);
  return `${Number(converted || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${displayCurrency(settings, currency)} mn`;
}

function number(value: any) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export default function UtilityDebtPreview({ debt, result, currency, currencyDisplay, calculationError = '', fresh = true, onRetry }: Props) {
  const revenueRows: any[] = Array.isArray(result?.annual_revenue) ? result.annual_revenue : [];
  const schedule: any[] = Array.isArray(result?.schedule) ? result.schedule : [];
  const rows = useMemo(() => {
    const byYear = new Map<number, any>();
    revenueRows.forEach(row => byYear.set(Number(row.year), { ...row }));
    schedule.forEach(row => {
      const year = Number(row.year);
      byYear.set(year, { ...(byYear.get(year) || { year }), ...row });
    });
    return [...byYear.values()].filter(row => Number.isFinite(Number(row.year))).sort((a, b) => Number(a.year) - Number(b.year));
  }, [result]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const year = rows.some(row => Number(row.year) === selectedYear) ? selectedYear : (rows[0] ? Number(rows[0].year) : null);
  const selected = rows.find(row => Number(row.year) === year);
  const enabled = !!debt?.enabled;
  const startYear = Number(debt?.disbursement_year);
  const sourceKeys: string[] = Array.isArray(debt?.revenue_sources)
    ? debt.revenue_sources.filter((key: string) => ['collection', 'tariff', 'nrw'].includes(key))
    : ['collection', 'tariff', 'nrw'];
  const freshResult = !!result && !calculationError && fresh;
  const supported = freshResult ? Number(result?.accepted_principal ?? 0) : null;
  const startCapacity = result?.start_year_capacity;
  const startBound = result?.start_year_principal_bound;
  const limitingYear = result?.limiting_repayment_year;
  const metricAmount = (value: any) => freshResult ? amount(value, currency, currencyDisplay) : '—';
  const exportHeaders = ['Year', ...columns.map(([label]) => `${label} (${displayCurrency(currencyDisplay, currency)} M)`), 'Period'];
  const exportRows = rows.map(row => [
    row.year,
    ...columns.map(([, key, fallback]) => {
      const value = row[key] ?? (fallback ? row[fallback] : undefined);
      return value == null ? null : convertMoney(Number(value), currencyDisplay, currency);
    }),
    row.post_target ? 'Post-target repayment assumption' : 'Simulation year',
  ]);

  return (
    <section className="debt-preview" data-testid="utility-debt-preview">
      <div className="debt-metrics">
        {[
          ['Additional annual net revenue', metricAmount(selected?.total_additional_net_revenue)],
          ['Annual service capacity', metricAmount(selected?.annual_service_capacity)],
          ['Supportable borrowing', freshResult ? amount(supported, currency, currencyDisplay) : '—'],
        ].map(([label, value]) => (
          <div className="debt-metric" key={label} data-debt-metric={label}>
            <span>{label}</span><strong>{value}</strong>
          </div>
        ))}
      </div>

      {freshResult && <div className="debt-diagnostics">
        <div><span>Start-year protected revenue base</span><b>{amount(result?.start_year_protected_revenue, currency, currencyDisplay)}</b></div>
        <div><span>Start-year eligible revenue</span><b>{amount(result?.start_year_revenue, currency, currencyDisplay)}</b></div>
        <div><span>Start-year servicing limit</span><b>{amount(startCapacity, currency, currencyDisplay)}</b></div>
        <div><span>Start-year principal bound</span><b>{amount(startBound, currency, currencyDisplay)}</b></div>
        <div><span>Verified one-time loan</span><b>{amount(supported, currency, currencyDisplay)}</b></div>
        <div><span>Tightest repayment year</span><b>{limitingYear ?? '—'}</b></div>
        <div><span>Binding constraint</span><b>{result?.binding_constraint || result?.status || '—'}</b></div>
      </div>}

      {!enabled && <div className="debt-preview-state">Borrowing is off. Intervention-only revenues and the annual cash ledger remain visible.</div>}
      {calculationError && <div role="alert" className="debt-preview-error">
        Estimate unavailable — {calculationError}
        {onRetry && <button type="button" onClick={onRetry} className="debt-retry">Retry calculation</button>}
      </div>}
      {!calculationError && !freshResult && <div className="debt-preview-state">Updating the live estimate…</div>}
      {freshResult && enabled && <div className="debt-preview-state">
        {result.status === 'verified feasible'
          ? 'Repayments verified against allocation-based capacity through final maturity.'
          : result.status === 'zero allocation share' ? 'No borrowing: the selected revenue allocation is 0%.'
            : result.status === 'no positive capacity' ? 'No borrowing: the start year or a required payment year has no capacity, or the optional ceiling is zero.'
              : result.status === 'no verified feasible loan' ? 'No verified feasible principal. Review the start-year limit and later repayment capacity.'
                : result.status || 'Loan sizing is unavailable.'}
        {startBound != null && supported != null && Number(supported) < Number(startBound) &&
          <span> Verified borrowing is lower than the start-year bound because {result?.binding_constraint || 'a later repayment constraint'} binds.</span>}
      </div>}

      {rows.length > 0 && <div className="debt-annual">
        <div className="debt-annual-head">
          <div><span className="debt-eyebrow">MODEL OUTPUT · NOT A SECOND CASH-FLOW ENGINE</span><h3>Annual revenue &amp; debt-service detail</h3></div>
          <div className="debt-annual-actions">
            <label>Detail year
              <select aria-label="Utility debt detail year" value={year ?? ''} onChange={event => setSelectedYear(Number(event.target.value))}>
                {rows.map(row => <option key={row.year} value={row.year}>{row.year}</option>)}
              </select>
            </label>
            <TableExport filename="debt_servicing_annual_ledger" sheetName="Annual debt ledger" headers={exportHeaders} rows={exportRows} compact currencyDisplay={currencyDisplay} />
          </div>
        </div>
        <div className="debt-table-scroll">
          <table data-testid="debt-annual-table">
            <thead><tr><th>Year</th>{columns.map(([label]) => <th key={label}>{label}</th>)}<th>Period</th></tr></thead>
            <tbody>{rows.map(row => {
              const isStart = Number(row.year) === startYear;
              return <tr key={row.year} data-year={row.year} className={isStart ? 'is-start-year' : undefined} aria-current={isStart ? 'true' : undefined}>
                <th scope="row">{row.year}{isStart && <small>LOAN START</small>}</th>
                {columns.map(([label, key, fallback]) => {
                  const value = row[key] ?? (fallback ? row[fallback] : undefined);
                  const selectedSource = key === 'collection_net_cash' ? sourceKeys.includes('collection')
                    : key === 'tariff_net_cash' ? sourceKeys.includes('tariff')
                      : key === 'nrw_net_cash' ? sourceKeys.includes('nrw') : undefined;
                  return <td key={label} className={value < 0 ? 'is-negative' : undefined} title={selectedSource === undefined ? undefined : selectedSource ? 'Selected eligible source' : 'Not selected as debt source'}>
                    {value == null ? '—' : number(Number(convertMoney(Number(value), currencyDisplay, currency) || 0))}
                    {selectedSource !== undefined && <small>{selectedSource ? 'SELECTED' : 'NOT SELECTED'}</small>}
                  </td>;
                })}
                <td>{row.post_target ? 'Post-target assumption' : 'Simulation year'}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {selected && <p className="debt-reference-note">
          Detail year {selected.year} is display-only; actual disbursement starts in {Number.isFinite(startYear) ? startYear : 'the selected forecast year'}.
          The borrowing base uses reference/no-debt revenue and capacity; current scenario rows show financed revenues and replacement needs.
          Gross collections are not net revenue. Connection gross/cost/net cash are shown for reconciliation only and remain outside eligible sources.
        </p>}
      </div>}
      {freshResult && (result?.net_revenue_assumption || result?.tail_capacity_assumption) && <div className="debt-assumption-note">
        {result?.net_revenue_assumption}{result?.tail_capacity_assumption ? ` Post-target capacity: ${result.tail_capacity_assumption}` : ''}
      </div>}
      {freshResult && result?.sizing_assumption && <div className="debt-assumption-note">{result.sizing_assumption}</div>}
      <div className="debt-caveat">
        Eligible streams are the signed sum of selected collection, tariff and NRW net cash. Standalone connection net cash is excluded. Loan proceeds are investment cash, never repayment revenue; scheduled principal and interest reduce available cash once. Collection/tariff operating and administration costs are not independently modeled.
      </div>
    </section>
  );
}
