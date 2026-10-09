import React, { useState, useEffect } from 'react';
import TableExport from './TableExport';
import { ledgerRows } from '../resultsLedger';
import type { LedgerBasis, LedgerData, LedgerMetric, LedgerRow, LedgerService, LedgerView } from '../resultsLedger';
import { validRate, type CurrencyDisplaySettings } from '../currencyDisplay';
import { fundingBalanceForDisplay } from '../fundingBalanceDisplay';
import type { ContributionView } from '../contributionView';
import './ResultsLedgerPanel.css';
import { LOAN_FUNDING_QUALIFICATION } from '../loanFunding';

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
const coverageServiceOptions: { value: LedgerService; label: string }[] = [
  { value: 'sm', label: 'Safely managed' },
  { value: 'basic', label: 'Basic only' },
  { value: 'total', label: 'At least basic' },
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

function description(metric: LedgerMetric, service: LedgerService, basis: LedgerBasis, isShare: boolean, currency: string, view: LedgerView) {
  if (metric === 'coverage') {
    return `${basis === 'annual' ? 'Annual delivered Basic entries / SM upgrades' : 'Year-end attributed source stocks'} in ${isShare ? '% of households' : 'million households'}. Sources report actual funding and physical delivery, not ordered marginal effects.`;
  }
  if (metric === 'funding') {
    return service === 'total'
      ? `Baseline effective ordinary funding plus signed source contributions equals ordinary available funding before debt in B ${currency}. Restricted loan proceeds and carryover are separate below.`
      : `Service views show actual ${service === 'sm' ? 'SM' : 'Basic'} capital paid by each source, not an invented split of shared receipts. Category and combined totals use the same capital-paid measure.`;
  }
  if (metric === 'requirements') {
    if (view === 'source') return 'Requirements before this year’s funding. Scheduled expansion is a reference flow; unpaid obligations are shown by source and are not inferred from available funding.';
    return basis === 'annual'
      ? 'Annual requirements are flows: planned expansion, replacement obligations and cash deficit.'
      : 'Catch-up requirements are the pre-funding need, including replacement and cash deficit. Year-end balances below are shown separately and are not summed across years.';
  }
  if (view === 'source') return 'Remaining financing need at year-end. This is a closing balance; do not sum balances across years or subtract available funding again.';
  return basis === 'annual'
    ? 'Current-year residual gap includes outstanding expansion and this year’s unpaid replacement and cash deficit. It is not a pure annual flow: do not add it across years.'
    : 'Year-end requirement is a closing balance, not an annual flow. Do not add year-end balances across years.';
}

function rowKindLabel(row: LedgerRow) {
  if (row.kind === 'category') return 'Category';
  if (row.kind === 'intervention') return 'Intervention';
  if (row.kind === 'baseline') return 'Baseline';
  if (row.kind === 'scenario') return 'Combined';
  if (row.kind === 'summary') return 'Net cash';
  if (row.kind === 'target') return 'Target';
  return 'Detail';
}

export default function ResultsLedgerPanel({
  data, sector, label, scope, years, isShare, currency, moneyFactor, currencyDisplay, selection, onSelectionChange, onRetry, contributionView,
}: ResultsLedgerPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reportingView, setReportingView] = useState<LedgerView>('source');
  const [sourceKind, setSourceKind] = useState<'scenario' | 'bau'>('scenario');
  useEffect(() => setExpanded({ 'source-total': true }), [contributionView, reportingView, sourceKind, selection.metric, selection.service, selection.basis, sector]);
  const isExpanded = (key: string) => expanded[key] ?? (
    reportingView === 'source' && (selection.metric === 'requirements' || selection.metric === 'gap')
      ? key === 'source-total' : contributionView === 'individual' && rows.some(row => row.key === key && row.kind === 'category')
  );
  const balanceRate = validRate(currencyDisplay, currency) ? currencyDisplay.localPerUsd : null;
  const canRoundBalance = currency.toUpperCase() === 'USD' || balanceRate != null;
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
      view: reportingView,
      sourceKind,
    });
  } catch (error) {
    ledgerError = error instanceof Error ? error.message : 'The ledger could not be calculated.';
  }

  const flatten = (items: LedgerRow[], depth = 0): (LedgerRow & { depth: number })[] =>
    items.flatMap(row => [{ ...row, depth: row.depth ?? depth },
      ...(row.children && isExpanded(row.key) ? flatten(row.children, depth + 1) : [])]);
  const visibleRows = flatten(rows);
  const exportHeaders = ['Scenario', 'Sector', 'Geography', 'Service', 'Component', 'Timing', 'Additive', 'Status / limitation', 'Hierarchy depth', 'Row', 'Unit', ...years.map(String), ...(data.includesDebt ? ['Loan funding qualification'] : [])];
  const exportRows = visibleRows.map(row => [
    reportingView === 'effects' ? 'BAU-to-scenario ordered attribution' : sourceKind === 'bau' ? 'BAU' : 'Combined scenario',
    sector, row.geography ?? scope, row.service ?? '', row.component ?? '', row.timing ?? '',
    row.kind === 'category' || row.kind === 'baseline' || row.kind === 'scenario' || row.kind === 'target' ||
      row.kind === 'section' || row.timing?.startsWith('Reference') || row.timing?.startsWith('Reporting diagnostic')
      ? 'No — subtotal/reference' : row.timing?.startsWith('Allocation stage') ? 'No — allocation stage'
        : row.kind === 'intervention' ? 'Yes — contribution to parent subtotal' : 'No — supporting detail',
    row.status ?? '', row.depth, `${'  '.repeat(row.depth)}${row.label}`, row.unit, ...row.values, ...(data.includesDebt ? [LOAN_FUNDING_QUALIFICATION] : []),
  ]);
  const metricLabel = metricOptions.find(option => option.value === selection.metric)?.label ?? 'Coverage';
  const selectedServiceOptions = selection.metric === 'coverage' ? coverageServiceOptions : serviceOptions;
  const serviceLabel = selectedServiceOptions.find(option => option.value === selection.service)?.label ?? 'Safely managed';
  const basisLabel = selection.metric === 'requirements'
    ? reportingView === 'source' ? 'before-funding' : selection.basis === 'annual' ? 'annual' : 'catch-up'
    : selection.metric === 'gap'
    ? reportingView === 'source' ? 'year-end-closing' : selection.basis === 'annual' ? 'annual-residual' : 'year-end'
      : 'not-applicable';
  const filename = [
    'service-ledger', sector, slug(scope), slug(metricLabel), slug(serviceLabel), slug(basisLabel), slug(currency),
    selection.metric === 'coverage' ? isShare ? 'percent-and-pp' : 'households' : 'billions',
    reportingView === 'source' ? sourceKind : 'intervention-effects',
    data.includesDebt ? 'with-indicative-loan-funding' : 'without-loan-funding', `${years[0]}-${years[years.length - 1]}`,
  ].join('-');

  const setMetric = (metric: LedgerMetric) => {
    onSelectionChange({
      metric,
      service: selection.service,
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
            freezeColumns={9}
          />
        </div>
      </div>
      {data.includesDebt && <p className="results-ledger__scope">{LOAN_FUNDING_QUALIFICATION}</p>}

      <div className="results-ledger__controls">
        {(selection.metric === 'requirements' || selection.metric === 'gap') && (
          <>
            <label className="results-ledger__control">
              <span>Financial view</span>
              <select aria-label={`${label} financial view`} value={reportingView}
                onChange={event => setReportingView(event.target.value as LedgerView)}>
                <option value="source">Where the requirement/gap comes from</option>
                <option value="effects">Effects of interventions</option>
              </select>
            </label>
            {reportingView === 'source' && <label className="results-ledger__control">
              <span>Reference scenario</span>
              <select aria-label={`${label} source scenario`} value={sourceKind}
                onChange={event => setSourceKind(event.target.value as 'scenario' | 'bau')}>
                <option value="scenario">Combined scenario</option>
                <option value="bau">BAU</option>
              </select>
            </label>}
          </>
        )}
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
            {selectedServiceOptions
              .map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        {(selection.metric === 'requirements' || selection.metric === 'gap') && reportingView === 'effects' && (
          <label className="results-ledger__control results-ledger__basis">
            <span>{selection.metric === 'requirements' ? 'Requirement basis' : 'Gap basis'}</span>
            <select
              aria-label={`${label} ledger basis`}
              value={selection.basis}
              onChange={event => onSelectionChange({ ...selection, basis: event.target.value as LedgerBasis })}
            >
              {selection.metric === 'requirements' ? (
                <>
                  <option value="annual">Annual requirement</option>
                  <option value="closing">Catch-up before funding</option>
                </>
              ) : (
                <>
                  <option value="annual">Closing expansion plus current-year financial shortfall</option>
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
        <p>{description(selection.metric, selection.service, selection.basis, isShare, currency, reportingView)}</p>
        {selection.metric === 'coverage' && selection.service === 'basic' && (
          <p>Coverage, target and gap are Basic-only, excluding Safely Managed. Basic-only coverage can fall when households upgrade to SM; a Basic-only category deficit does not by itself mean lost access or an unmet at-least-basic minimum.</p>
        )}
        {selection.metric === 'coverage' && selection.service === 'total' && (
          <p>At least basic = Safely Managed + Basic-only. Its net gap equals the SM gap plus the Basic-only gap; upgrading Basic households to SM does not reduce combined access.</p>
        )}
        {selection.metric === 'coverage' && (
          <p className="results-ledger__coverage-legend">
            Gap = Combined scenario − Original target; − red means shortfall/category deficit, + green means surplus/category excess, and neutral zero means no net difference.
          </p>
        )}
        {selection.metric === 'coverage' && !!data.areas?.length && (
          <p>Area gaps use scenario − target. {isShare
            ? 'Area gaps use the selected scope’s population denominator, so the Urban and Rural contributions add to the National net gap in percentage points.'
            : 'Urban and Rural gaps add to the National net gap; single-area views show only the selected area.'}</p>
        )}
        {selection.metric !== 'coverage' && <p>Financial reporting starts after baseline {data.baselineYear}. Earlier years are not applicable (—).</p>}
        {(selection.metric === 'requirements' || selection.metric === 'gap') && reportingView === 'source' && (
          <p>{selection.metric === 'requirements'
            ? 'Requirements before this year’s funding use the exact pre-funding household, ancillary, current replacement and current cash-shortfall reports. Scheduled expansion is a reference annual flow, not added to the unpaid subtotal.'
            : 'Remaining financing need at year-end is a closing balance, not a flow to sum over years. It uses the closing household, ancillary, accumulated legacy replacement and accumulated cash reports.'}
            {' '}Replacement shortfall remains the unchanged legacy measure and is not a verified settleable backlog. Ancillary allocations retain the engine’s first-committed-expansion weighting and are not independently validated. Advance delivery, repricing, cancellations and noncash credit are separately labelled diagnostics, not additional cash spending.</p>
        )}
        {selection.metric === 'requirements' && reportingView === 'effects' && (
          <p>Paid rows are positive recorded spending; household expansion separates sector cash from external finance. Noncash physical reuse and its credited value are reported separately; neither is cash spending.</p>
        )}
        <p>{selection.metric === 'coverage' ? 'Source rows report actual funded and physical delivery, not marginal effects. Annual values are delivered Basic entries / SM upgrades; closing values are surviving source stocks.'
          : selection.metric === 'funding' ? 'Funding reports actual allocations; due obligations and funded payments are distinct. Source-accounting components are not additional funding to sum together.'
            : 'Positive intervention effects mean a reduction in financial need; negative values mean need increased.'}</p>
        {selection.metric === 'coverage' || selection.metric === 'funding' ? null : data.attributionComplete ? (
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
                const isExpandable = !!row.children?.length;
                const isCategory = isExpandable;
                const isChild = row.kind === 'intervention';
                const isSignedGap = 'signedGap' in row && row.signedGap === true;
                const open = isExpanded(row.key);
                return (
                  <tr key={`${row.kind}:${row.key}`} data-ledger-row={row.key} data-row-kind={row.kind} data-row-depth={row.depth ?? 0} className={`results-ledger__row results-ledger__row--${row.kind}`}>
                    <th className={`results-ledger__rowhead ${isChild ? 'results-ledger__rowhead--child' : ''}`} style={row.depth ? { paddingLeft: 12 + row.depth * 16 } : undefined} scope="row">
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
                          <span className="results-ledger__row-tag">{row.timing ?? rowKindLabel(row)}</span>
                        </button>
                      ) : (
                        <span className="results-ledger__row-label">
                          {isChild && <span className="results-ledger__branch" aria-hidden="true" />}
                          {row.label}
                          {!isChild && <span className="results-ledger__row-tag">{row.timing ?? rowKindLabel(row)}</span>}
                        </span>
                      )}
                      {row.status && <span className="results-ledger__component-note">{row.status}</span>}
                      {(row.key === 'fundingShared' || row.component === 'fundingShared') && (
                        <span data-testid="funding-surplus-note" style={{ display: 'block', fontSize: 10, fontWeight: 400, color: '#475569', marginTop: 4 }}>
                          Surplus relative to this year's applied spending. It may include restricted funds and does not mean all remaining needs are funded.
                          {' '}{canRoundBalance
                            ? 'Unapplied and restricted balances below US$10,000 display as 0; exports retain exact amounts.'
                            : 'Rounding balances below US$10,000 requires a valid exchange rate.'}
                        </span>
                      )}
                    </th>
                    <td className="results-ledger__unit">{row.unit}</td>
                    {years.map((year, index) => {
                      const rawValue = row.values[index] ?? null;
                      const value = row.key === 'fundingShared' || row.key === 'fundingRestricted' ||
                        row.component === 'fundingShared' || row.component === 'fundingRestricted'
                        ? fundingBalanceForDisplay(rawValue, currency, balanceRate) : rawValue;
                      return (
                        <td
                          key={year}
                          data-ledger-year={year}
                          className={`results-ledger__value${isSignedGap && value != null
                            ? value < 0 ? ' results-ledger__value--shortfall' : value > 0 ? ' results-ledger__value--surplus' : ' results-ledger__value--neutral'
                            : value != null && value < 0 ? ' results-ledger__value--negative' : ''}`}
                          title={rawValue == null ? 'Not available' : String(rawValue)}
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
          <p><strong>Scenario reconciliation.</strong> {selection.metric === 'coverage'
            ? 'Opening/baseline-funded coverage plus attributed source stocks equals the combined scenario. Pure BAU is independent; the signed baseline-funded difference plus other source stocks explains gain over BAU. Cost-efficiency and technology benefits are included in funded additions.'
            : selection.metric === 'funding' ? 'Actual signed sources reconcile ordinary funding. Only funded service is charged to originally selected debt sources; unpaid obligations are reported separately.'
              : 'BAU is the baseline, intervention rows show ordered marginal changes, and Combined scenario is the modelled outcome. Category totals reconcile their visible children; individual effects can be zero or negative.'}</p>
          {selection.metric !== 'coverage' && selection.metric !== 'funding' && data.attributionComplete && <p><strong>Calculation order (not category display order).</strong>{' '}
            {data.contributions.map(c => `${c.order ? `${c.order}. ` : ''}${c.label}`).join(' → ') || 'No interventions enabled.'}
            {' '}Tariff effects include their interaction with earlier collection improvements. Borrowing, when included, follows all selected reforms and custom interventions.</p>}
          {selection.metric === 'funding' ? (
             <p><strong>Funding.</strong> Ordinary source receipts are signed, before debt payments. Restricted loan proceeds and carryover are separate, not recurring revenue. Service source rows, category subtotals and Combined scenario all use actual service capital paid, excluding unsplit replacement and ancillary amounts. Expand a source to inspect allocation stages; they are not additive funding.</p>
          ) : selection.metric === 'requirements' ? (
            <p><strong>Requirements.</strong> Annual requirement is a flow. Catch-up is the pre-funding expansion need with replacement and cash deficit. Paid rows show current-year cash spending: expansion includes sector and external household finance, including associated infrastructure, but excludes physical reuse without cash spending. Replacement paid maintains existing assets; it is not deducted from outstanding expansion. Closing expansion also reflects physical upgrades and changes in costs or targets. Outstanding expansion and accumulated shortfalls are end-of-year balances; do not sum them across years.</p>
          ) : selection.metric === 'gap' ? (
            <p><strong>Gap.</strong> Current-year residual gap = outstanding expansion + replacement obligation − capped replacement credit + cash deficit. Funded expansion receives no second credit; cash deficits are allocated once. Year-end requirement = outstanding expansion + accumulated unpaid replacement and deficits. National sums remaining local obligations; unused or restricted funds elsewhere are not assumed transferable. This is not generally annual requirements minus all available funding. Both include balances: do not sum across years.</p>
          ) : (
            <p><strong>Coverage.</strong> Safely Managed and Basic-only are exclusive; At least basic stock is their sum. Annual transitions report Basic entries and SM upgrades, not net Basic stock growth; entries plus upgrades are not unique households. Closing stocks carry funded origins forward and remove Basic households when upgraded. Signed gaps are Combined scenario minus Original target. Shares divide aggregated household counts by the selected scope’s households; gaps and the baseline difference are percentage points.</p>
          )}
          <p>Displayed values are rounded for readability. CSV and Excel retain unrounded values and include only the rows currently visible in the table.</p>
        </div>
      </details>
    </section>
  );
}
