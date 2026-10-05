import React, { useState, useEffect } from 'react';
import TableExport from './TableExport';
import { ledgerRows } from '../resultsLedger';
import type { LedgerBasis, LedgerData, LedgerMetric, LedgerRow, LedgerService } from '../resultsLedger';
import type { CurrencyDisplaySettings } from '../currencyDisplay';
import type { ContributionView } from '../contributionView';
import './ResultsLedgerPanel.css';

type Selection = { metric: LedgerMetric; service: LedgerService; basis: LedgerBasis };

type ResultsLedgerPanelProps = {
  data: LedgerData;
  sector: 'water' | 'sanitation';
  label: string;
  scope: string;
  years: number[];
  isShare: boolean;
  currency: string;
  moneyFactor: number;
  currencyDisplay: CurrencyDisplaySettings;
  contributionView: ContributionView;
  selection: Selection;
  onSelectionChange: (selection: Selection) => void;
  onRetry: () => void;
};

const metricOptions: { value: LedgerMetric; label: string }[] = [
  { value: 'coverage', label: 'Coverage' },
  { value: 'funding', label: 'Available funding' },
  { value: 'requirements', label: 'Financing requirements' },
  { value: 'gap', label: 'Financing gap' },
];

const serviceOptions: { value: LedgerService; label: string }[] = [
  { value: 'sm', label: 'Safely managed' },
  { value: 'basic', label: 'Basic' },
  { value: 'total', label: 'Sector total' },
];

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'all';
}

function formatValue(value: number | null, unit: string, delta = false) {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatted = new Intl.NumberFormat(undefined, {
    maximumSignificantDigits: 3,
  }).format(value);
  if (delta || unit === 'pp') return `${value > 0 ? '+' : ''}${formatted}`;
  return formatted;
}

function description(metric: LedgerMetric, service: LedgerService, basis: LedgerBasis, isShare: boolean, currency: string) {
  if (metric === 'coverage') {
    return isShare
      ? 'Coverage is shown as a share of population. Intervention changes and SM net gap are percentage-point differences.'
      : 'Coverage is shown in million households. Intervention changes are marginal differences from the preceding scenario state.';
  }
  if (metric === 'funding') {
    return service === 'total'
      ? `Sector total is funding available in B ${currency}, including restricted loan cash carried forward. It is not the sum of service-level applied funding.`
      : `Service views show actual funds applied to ${service === 'sm' ? 'safely managed' : 'basic'} service, not all funds available to the sector.`;
  }
  if (metric === 'requirements') {
    return basis === 'annual'
      ? 'Annual requirements are flows: planned expansion, replacement obligations and cash deficit.'
      : 'Catch-up requirements are the pre-funding need, including replacement and cash deficit. Year-end balances below are shown separately and are not summed across years.';
  }
  return basis === 'annual'
    ? 'Current-year residual gap includes outstanding expansion and this year’s unpaid replacement and cash deficit. It is not a pure annual flow: do not add it across years.'
    : 'Year-end requirement is a closing balance, not an annual flow. Do not add year-end balances across years.';
}

function rowKindLabel(row: LedgerRow) {
  if (row.kind === 'category') return 'Category';
  if (row.kind === 'intervention') return 'Intervention';
  if (row.kind === 'baseline') return 'Baseline';
  if (row.kind === 'scenario') return 'Combined';
  if (row.kind === 'target') return 'Target';
  return 'Detail';
}

export default function ResultsLedgerPanel({
  data, sector, label, scope, years, isShare, currency, moneyFactor, currencyDisplay, selection, onSelectionChange, onRetry, contributionView,
}: ResultsLedgerPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  useEffect(() => setExpanded({}), [contributionView]);
  const isExpanded = (key: string) => expanded[key] ?? contributionView === 'individual';
  let rows: LedgerRow[] = [];
  let ledgerError = '';

  try {
    rows = ledgerRows(data, {
      metric: selection.metric,
      service: selection.service,
      basis: selection.basis,
      years,
      isShare,
      moneyFactor,
      currency,
    });
  } catch (error) {
    ledgerError = error instanceof Error ? error.message : 'The ledger could not be calculated.';
  }

  const visibleRows = rows.flatMap(row => [
    row,
    ...(row.children && isExpanded(row.key) ? row.children : []),
  ]);
  const exportHeaders = ['Row', 'Unit', ...years.map(String)];
  const exportRows = visibleRows.map(row => [row.label, row.unit, ...row.values]);
  const metricLabel = metricOptions.find(option => option.value === selection.metric)?.label ?? 'Coverage';
  const serviceLabel = serviceOptions.find(option => option.value === selection.service)?.label ?? 'Safely managed';
  const basisLabel = selection.metric === 'requirements'
    ? selection.basis === 'annual' ? 'annual' : 'catch-up'
    : selection.metric === 'gap'
      ? selection.basis === 'annual' ? 'annual-residual' : 'year-end'
      : 'not-applicable';
  const filename = [
    'service-ledger', sector, slug(scope), slug(metricLabel), slug(serviceLabel), slug(basisLabel), slug(currency),
    selection.metric === 'coverage' ? isShare ? 'percent-and-pp' : 'households' : 'billions',
    'reconciled', data.includesDebt ? 'with-debt' : 'without-debt', `${years[0]}-${years[years.length - 1]}`,
  ].join('-');

  const setMetric = (metric: LedgerMetric) => {
    onSelectionChange({
      metric,
      service: metric === 'coverage' && selection.service === 'total' ? 'sm' : selection.service,
      basis: selection.basis,
    });
  };

  const toggleCategory = (key: string) => {
    setExpanded(current => ({ ...current, [key]: !isExpanded(key) }));
  };

  return (
    <section className="results-ledger" data-results-ledger={sector} data-ledger-metric={selection.metric}
      data-ledger-service={selection.service} data-ledger-basis={selection.basis} aria-label={`${label} results ledger`}>
      <div className="results-ledger__topline">
        <div className="results-ledger__heading">
          <span className="results-ledger__eyebrow">Outcomes &amp; finance / {sector === 'water' ? 'Water' : 'Sanitation'}</span>
          <h2>{label} ledger</h2>
          <p className="results-ledger__scope">{scope}</p>
        </div>
        <div className="results-ledger__export">
          <span className="results-ledger__export-caption">Export visible rows</span>
          <TableExport
            filename={filename}
            sheetName={`${sector} ledger`}
            headers={exportHeaders}
            rows={exportRows}
            currencyDisplay={currencyDisplay}
            freezeColumns={2}
          />
        </div>
      </div>

      <div className="results-ledger__controls">
        <label className="results-ledger__control">
          <span>Measure</span>
          <select
            aria-label={`${label} ledger metric`}
            value={selection.metric}
            onChange={event => setMetric(event.target.value as LedgerMetric)}
          >
            {metricOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="results-ledger__control">
          <span>Service level</span>
          <select
            aria-label={`${label} ledger service`}
            value={selection.service}
            onChange={event => onSelectionChange({ ...selection, service: event.target.value as LedgerService })}
          >
            {serviceOptions
              .filter(option => selection.metric !== 'coverage' || option.value !== 'total')
              .map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {(selection.metric === 'requirements' || selection.metric === 'gap') && (
          <label className="results-ledger__control results-ledger__basis">
            <span>{selection.metric === 'requirements' ? 'Requirement basis' : 'Gap basis'}</span>
            <select
              aria-label={`${label} ledger basis`}
              value={selection.basis}
              onChange={event => onSelectionChange({ ...selection, basis: event.target.value as LedgerBasis })}
            >
              {selection.metric === 'requirements' ? (
                <>
                  <option value="annual">Annual flow</option>
                  <option value="closing">Catch-up before funding</option>
                </>
              ) : (
                <>
                  <option value="annual">Current-year residual gap</option>
                  <option value="closing">Year-end requirement</option>
                </>
              )}
            </select>
          </label>
        )}
        <div className="results-ledger__period">
          <span>Reporting years</span>
          <strong>{years.length ? `${years[0]}–${years[years.length - 1]}` : 'None selected'}</strong>
        </div>
      </div>

      <div className="results-ledger__notes">
        <p>{description(selection.metric, selection.service, selection.basis, isShare, currency)}</p>
        {selection.metric === 'coverage' && selection.service === 'basic' && (
          <p>Coverage and the original target are Basic-only (exclusive of Safely Managed). Basic coverage may fall after SM upgrades. The access-gap row instead assesses the at-least-basic minimum (SM + Basic), not the difference between the Basic-only rows.</p>
        )}
        {selection.metric === 'coverage' && selection.service === 'sm' && (
          <p className="results-ledger__coverage-legend">
            SM net gap = Combined scenario − Original target; − red means shortfall, + green means surplus, and neutral zero means no net difference. Local unmet-target diagnostics count each area without offsetting surpluses.
          </p>
        )}
        {selection.metric === 'coverage' && selection.service === 'sm' && !!data.areas?.length && (
          <p>Area SM gaps use scenario − target. {isShare
            ? 'Area gaps use the selected scope’s population denominator, so the Urban and Rural contributions add to the National net gap in percentage points.'
            : 'Urban and Rural gaps add to the National net gap; single-area views show only the selected area.'}</p>
        )}
        {selection.metric !== 'coverage' && <p>Financial reporting starts after baseline {data.baselineYear}. Earlier years are not applicable (—).</p>}
        <p>Signed effects are scenario changes: negative funding means less funding; negative requirements or gaps mean a reduction.</p>
        {data.attributionComplete ? (
          <p>Interventions are ordered marginal effects: each change is measured from the state immediately before it, not as an independent run.</p>
        ) : (
          <p className="results-ledger__notice" role="status">
            Full scenario results are shown. Ordered intervention breakdown is unavailable{data.contributions.length ? ' while attribution is incomplete or loading' : ''}; no categories are inferred.
          </p>
        )}
      </div>

      {ledgerError ? (
        <div className="results-ledger__error" role="alert">
          <div>
            <strong>Ledger values are temporarily unavailable.</strong>
            <span>{ledgerError}</span>
          </div>
          <button type="button" onClick={onRetry}>Retry results</button>
        </div>
      ) : (
        <div className="results-ledger__table-scroll" tabIndex={0} aria-label={`${label} ledger, scroll for years and rows`}>
          <table className="results-ledger__table" data-testid="results-ledger-table">
            <thead>
              <tr>
                <th className="results-ledger__rowhead" scope="col">Outcome / finance item</th>
                <th className="results-ledger__unit" scope="col">Unit</th>
                {years.map(year => <th key={year} scope="col" className="results-ledger__year">{year}</th>)}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map(row => {
                const isCategory = row.kind === 'category';
                const isChild = row.kind === 'intervention';
                const isSignedGap = 'signedGap' in row && row.signedGap === true;
                const open = isExpanded(row.key);
                return (
                  <tr key={row.key} data-ledger-row={row.key} data-row-kind={row.kind} className={`results-ledger__row results-ledger__row--${row.kind}`}>
                    <th className={`results-ledger__rowhead ${isChild ? 'results-ledger__rowhead--child' : ''}`} scope="row">
                      {isCategory ? (
                        <button
                          className="results-ledger__expand"
                          type="button"
                          aria-expanded={open}
                          aria-label={`${open ? 'Collapse' : 'Expand'} ${row.label}`}
                          onClick={() => toggleCategory(row.key)}
                        >
                          <span className="results-ledger__chevron" aria-hidden="true">{open ? '−' : '+'}</span>
                          <span>{row.label}</span>
                          <span className="results-ledger__row-tag">{rowKindLabel(row)}</span>
                        </button>
                      ) : (
                        <span className="results-ledger__row-label">
                          {isChild && <span className="results-ledger__branch" aria-hidden="true" />}
                          {row.label}
                          {!isChild && <span className="results-ledger__row-tag">{rowKindLabel(row)}</span>}
                        </span>
                      )}
                    </th>
                    <td className="results-ledger__unit">{row.unit}</td>
                    {years.map((year, index) => {
                      const value = row.values[index] ?? null;
                      return (
                        <td
                          key={year}
                          data-ledger-year={year}
                          className={`results-ledger__value${isSignedGap && value != null
                            ? value < 0 ? ' results-ledger__value--shortfall' : value > 0 ? ' results-ledger__value--surplus' : ' results-ledger__value--neutral'
                            : value != null && value < 0 ? ' results-ledger__value--negative' : ''}`}
                          title={value == null ? 'Not available' : String(value)}
                        >
                        {formatValue(value, row.unit, isSignedGap || row.kind === 'category' || row.kind === 'intervention')}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {!visibleRows.length && (
                <tr className="results-ledger__empty">
                  <td colSpan={years.length + 2}>No ledger rows are available for this selection.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <details className="results-ledger__reconciliation">
        <summary>Calculation notes &amp; reconciliation</summary>
        <div className="results-ledger__reconciliation-body">
          <p><strong>Scenario bridge.</strong> BAU is the baseline, intervention rows show ordered marginal changes, and Combined scenario is the modelled outcome. Category totals reconcile their visible children; individual effects can be zero or negative.</p>
          {data.attributionComplete && <p><strong>Calculation order (not category display order).</strong>{' '}
            {data.contributions.map(c => `${c.order ? `${c.order}. ` : ''}${c.label}`).join(' → ') || 'No interventions enabled.'}
            {' '}Tariff effects include their interaction with earlier collection improvements. Borrowing, when included, follows all selected reforms and custom interventions.</p>}
          {selection.metric === 'funding' ? (
            <p><strong>Funding.</strong> Service rows use allocations actually applied to safely managed or basic service. Sector total reports available funding, including restricted loan cash carried forward; available funding can differ from the amount applied.</p>
          ) : selection.metric === 'requirements' ? (
            <p><strong>Requirements.</strong> Annual requirement is a flow. Catch-up is the pre-funding expansion need with replacement and cash deficit. Outstanding expansion and accumulated shortfalls are end-of-year balances; do not sum them across years.</p>
          ) : selection.metric === 'gap' ? (
            <p><strong>Gap.</strong> Current-year residual gap = outstanding expansion + replacement obligation − capped replacement credit + cash deficit. Funded expansion receives no second credit; cash deficits are allocated once. Year-end requirement = outstanding expansion + accumulated unpaid replacement and deficits. National sums remaining local obligations; unused or restricted funds elsewhere are not assumed transferable. This is not generally annual requirements minus all available funding. Both include balances: do not sum across years.</p>
          ) : (
            <p><strong>Coverage.</strong> The signed SM net gap is Combined scenario coverage minus Original target, aggregated across areas; negative values are shortfalls and positive values are surpluses. Local access diagnostics assess each area against its service threshold before aggregation and do not offset surpluses against unmet targets. Share values use population as the denominator; intervention effects and SM net gap are in percentage points.</p>
          )}
          <p>Displayed values are rounded for readability. CSV and Excel retain unrounded values and include only the rows currently visible in the table.</p>
        </div>
      </details>
    </section>
  );
}
