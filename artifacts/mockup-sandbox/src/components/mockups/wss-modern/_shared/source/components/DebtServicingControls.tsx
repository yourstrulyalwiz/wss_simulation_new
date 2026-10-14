import React from 'react';
import { FUNDING_RECALCULATION_NOTICE, migrateLoanFundingConfig, validateLoanFundingConfig } from '../loanFunding';

const SOURCES = [
  ['collection', 'Collection efficiency'],
  ['tariff', 'Tariff reforms'],
  ['nrw', 'Water NRW / eligible sanitation link'],
  ['connections', 'Revenue from new connections'],
] as const;

type Props = {
  inputs: any;
  sector: 'water' | 'sanitation';
  scopeLabel: string;
  onChange: (next: any) => void;
  onSectionFocus?: (key: string) => void;
  referenceSourceCash?: Record<string, number | null | undefined>;
};

export default function DebtServicingControls({ inputs, sector, scopeLabel, onChange, onSectionFocus, referenceSourceCash }: Props) {
  const period = inputs.period || {};
  const start = Number(period.baseline_year || 2025) + 1;
  const end = Number(period.forecast_end_year || start);
  const years = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  const debt = migrateLoanFundingConfig(inputs.utility_debt?.[sector] || {
    schema_version: 3, mode: 'indicative_lump_sum', revenue_sources: [],
  });
  const sourceKeys = Array.isArray(debt.revenue_sources)
    ? debt.revenue_sources.filter((key: string) => SOURCES.some(([source]) => source === key))
    : [];
  const setDebt = (key: string, value: any) => {
    onSectionFocus?.('utility_debt');
    onChange({
      ...inputs,
      utility_debt: { ...(inputs.utility_debt || {}), [sector]: { ...debt, [key]: value, schema_version: 3, mode: 'indicative_lump_sum' } },
    });
  };
  const selectedStartYear = years.includes(Number(debt.disbursement_year)) ? Number(debt.disbursement_year) : '';
  const invalidStoredStartYear = debt.disbursement_year != null && !years.includes(Number(debt.disbursement_year));
  const intervention = inputs[sector === 'water' ? 'water_interventions' : 'sanitation_interventions'] || {};
  const basicShare = Number(intervention.basic_share);
  const validSplit = Number.isFinite(basicShare);
  const errors = validateLoanFundingConfig(debt, period);
  const currency = inputs?.country_config?.currency || 'LCU';

  const fieldStyle: React.CSSProperties = {
    width: '100%', minWidth: 0, padding: '8px 10px', border: '1px solid #d7d5c8',
    borderRadius: 5, background: '#fffdf6', color: '#263c3b', font: 'inherit', boxSizing: 'border-box',
  };
  const field = (label: string, value: any, setValue: (value: number | null) => void, options: {
    unit?: string; percent?: boolean; min?: number; step?: number; placeholder?: string;
  } = {}) => (
    <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#536563' }}>
      <span>{label}</span>
      <span style={{ position: 'relative' }}>
        <input type="number" value={value == null ? '' : options.percent ? Number(value) * 100 : value}
          min={options.min} step={options.step ?? 'any'} placeholder={options.placeholder}
          onChange={event => {
            if (event.target.value === '') { setValue(null); return; }
            const numeric = Number(event.target.value);
            if (Number.isFinite(numeric)) setValue(options.percent ? numeric / 100 : numeric);
          }}
          style={{ ...fieldStyle, paddingRight: options.unit ? 58 : 10 }} />
        {options.unit && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: '#778580' }}>{options.unit}</span>}
      </span>
    </label>
  );

  return (
    <aside className="debt-controls">
      <div className="debt-eyebrow">STEP 04 · LOAN FUNDING</div>
      <div className="debt-panel-heading">
        <div>
          <h2>Loan funding</h2>
          <p>Size a one-time proceeds injection from selected reference-year cash, then deduct fixed annual repayments from ordinary funds.</p>
        </div>
        <span className="debt-step-mark" aria-hidden="true">04</span>
      </div>
      <div className="debt-scope-note">
        <span className="debt-dot" />
        {scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'}
      </div>

      <section className="debt-control-card">
        <div className="debt-enable-row">
          <div>
            <h3>Indicative borrowing</h3>
            <p>A single proceeds injection supports infrastructure investment.</p>
          </div>
          <label className="debt-switch">
            <input type="checkbox" aria-label="Include indicative borrowing" checked={!!debt.enabled} onChange={event => setDebt('enabled', event.target.checked)} />
            <span>{debt.enabled ? 'On' : 'Off'}</span>
          </label>
        </div>

        <div className="debt-split">
          <div className="debt-split-top"><span>Inherited investment mix</span><span>from intervention plan</span></div>
          {validSplit ? <>
            <div className="debt-split-bar" aria-label={`Safely managed ${((1 - basicShare) * 100).toFixed(1)}%, Basic ${(basicShare * 100).toFixed(1)}%`}>
              <span style={{ width: `${Math.max(0, Math.min(100, (1 - basicShare) * 100))}%` }} />
              <i style={{ width: `${Math.max(0, Math.min(100, basicShare * 100))}%` }} />
            </div>
            <div className="debt-split-labels">
              <span>Safely managed <b>{((1 - basicShare) * 100).toFixed(1)}%</b></span>
              <span>Basic <b>{(basicShare * 100).toFixed(1)}%</b></span>
            </div>
          </> : <div className="debt-unavailable">Investment split is not configured in this area.</div>}
          <small>Loan proceeds follow the intervention plan’s existing investment mix.</small>
        </div>

        <div className="debt-source-block">
          <div className="debt-source-title">Eligible intervention cash · reference year</div>
          {SOURCES.map(([key, label]) => (
            <label key={key} className="debt-source-option">
              <input type="checkbox" aria-label={`Eligible source: ${label}`} checked={sourceKeys.includes(key)}
                onChange={event => setDebt('revenue_sources', event.target.checked
                  ? [...sourceKeys, key] : sourceKeys.filter((source: string) => source !== key))} />
              <span>{label}{referenceSourceCash?.[key] == null ? '' : <small className="debt-source-value">{Number(referenceSourceCash[key]).toLocaleString('en-US', { maximumFractionDigits: 2 })} {currency} mn</small>}</span>
            </label>
          ))}
          <p>Selection does not enable a reform. Water NRW and eligible sanitation-linked NRW cash are separate signed sources; water nrw_net never includes the sanitation link.</p>
        </div>

        <div className={`debt-terms${debt.enabled ? '' : ' debt-terms-disabled'}`}>
          {field('Pooled allocation', debt.allocation_share, value => setDebt('allocation_share', value), { percent: true, unit: '%', min: 0, step: 0.1 })}
          {field('Annual real interest rate', debt.annual_real_interest_rate, value => setDebt('annual_real_interest_rate', value), { percent: true, unit: '%', min: 0, placeholder: 'Required', step: 0.01 })}
          <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#536563' }}>
            <span>Reference / injection year</span>
            <select aria-label="Reference / injection year" value={selectedStartYear} onChange={event => setDebt('disbursement_year', Number(event.target.value))} style={fieldStyle} disabled={!years.length}>
              <option value="">Choose a year</option>{years.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          {field('Loan term', debt.loan_term_years, value => setDebt('loan_term_years', value), { min: 1, step: 1, unit: 'years', placeholder: 'Required' })}
        </div>
        {!debt.enabled && <div className="debt-disabled-note">Borrowing is excluded. Blank rate and term do not affect standard results.</div>}
        {Object.entries(errors).map(([key, message]) => <div className="debt-invalid-year" role="status" key={key}>{message}</div>)}
        {(debt.migration_notice ?? debt.migration_note) && <div className="debt-disabled-note">Preserved saved migration note: {debt.migration_notice ?? debt.migration_note}</div>}
        {invalidStoredStartYear && !debt.enabled && <div className="debt-invalid-year" role="status">
          Saved loan start year {String(debt.disbursement_year)} is outside the current forecast window. Choose a listed year to update it.
        </div>}

        <div className="debt-first-payment"><span>Repayment accounting</span><strong>Fixed annual</strong>
          <small>First scheduled payment is the year after injection and continues through the selected term. Affordability is not assessed.</small></div>
      </section>
      <div className="debt-control-footnote">
        {FUNDING_RECALCULATION_NOTICE} The model calculates the frozen reference pool, loan schedule and resulting funding ledger.
      </div>
    </aside>
  );
}
