import React from 'react';

const SOURCES = [
  ['collection', 'Collection efficiency'],
  ['tariff', 'Tariff reforms'],
  ['nrw', 'NRW reductions'],
] as const;

type Props = {
  inputs: any;
  sector: 'water' | 'sanitation';
  scopeLabel: string;
  onChange: (next: any) => void;
  onSectionFocus?: (key: string) => void;
};

export default function DebtServicingControls({ inputs, sector, scopeLabel, onChange, onSectionFocus }: Props) {
  const period = inputs.period || {};
  const start = Number(period.baseline_year || 2025) + 1;
  const end = Number(period.forecast_end_year || start);
  const years = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  const defaults = {
    enabled: false,
    allocation_share: 0,
    annual_real_interest_rate: null,
    disbursement_year: years[0] ?? start,
    principal_grace_years: 0,
    maturity_year: end,
    repayment_structure: 'annuity',
    loan_ceiling: null,
  };
  const debt = { ...defaults, ...(inputs.utility_debt?.[sector] || {}) };
  const sourceKeys = Array.isArray(debt.revenue_sources)
    ? debt.revenue_sources.filter((key: string) => SOURCES.some(([source]) => source === key))
    : SOURCES.map(([key]) => key);
  const setDebt = (key: string, value: any) => {
    onSectionFocus?.('utility_debt');
    onChange({
      ...inputs,
      utility_debt: { ...(inputs.utility_debt || {}), [sector]: { ...debt, [key]: value } },
    });
  };
  const selectedStartYear = years.includes(Number(debt.disbursement_year))
    ? Number(debt.disbursement_year)
    : (years[0] ?? start);
  const invalidStoredStartYear = debt.disbursement_year != null && !years.includes(Number(debt.disbursement_year));
  const intervention = inputs[sector === 'water' ? 'water_interventions' : 'sanitation_interventions'] || {};
  const basicShare = Number(intervention.basic_share);
  const validSplit = Number.isFinite(basicShare);
  const firstPrincipalYear = Number(debt.disbursement_year || selectedStartYear)
    + Number(debt.principal_grace_years || 0) + 1;

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
      <div className="debt-eyebrow">STEP 04 · CAPITAL &amp; REPAYMENT</div>
      <div className="debt-panel-heading">
        <div>
          <h2>Debt servicing</h2>
          <p>Trace a single utility loan from its revenue base through repayments to service access.</p>
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
            <h3>Utility borrowing</h3>
            <p>One disbursement, invested through the existing intervention scenario.</p>
          </div>
          <label className="debt-switch">
            <input type="checkbox" aria-label="Enable utility borrowing" checked={!!debt.enabled} onChange={event => setDebt('enabled', event.target.checked)} />
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
          <small>Debt does not add a separate split or bypass existing upgrade rules.</small>
        </div>

        <div className="debt-source-block">
          <div className="debt-source-title">Independent eligible revenue sources</div>
          {SOURCES.map(([key, label]) => (
            <label key={key} className="debt-source-option">
              <input type="checkbox" aria-label={`Debt source: ${label}`} checked={sourceKeys.includes(key)}
                onChange={event => setDebt('revenue_sources', event.target.checked
                  ? [...sourceKeys, key] : sourceKeys.filter((source: string) => source !== key))} />
              <span>{label}</span>
            </label>
          ))}
          <p>Selections do not switch on reforms. Active connection-based billing can grow customer-based collection and tariff reform revenue; standalone connection net cash is excluded.</p>
        </div>

        <div className={`debt-terms${debt.enabled ? '' : ' debt-terms-disabled'}`}>
          {field('Revenue allocation', debt.allocation_share ?? 0, value => setDebt('allocation_share', value ?? 0), { percent: true, unit: '%' })}
          {field('Real interest rate', debt.annual_real_interest_rate, value => setDebt('annual_real_interest_rate', value), { percent: true, unit: '%', min: 0, placeholder: 'Required' })}
          <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#536563' }}>
            <span>Loan start year</span>
            <select aria-label="Loan start year" value={selectedStartYear} onChange={event => setDebt('disbursement_year', Number(event.target.value))} style={fieldStyle} disabled={!years.length}>
              {years.map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          {field('Principal grace', debt.principal_grace_years ?? 0, value => setDebt('principal_grace_years', value ?? 0), { min: 0, step: 1, unit: 'years' })}
          {field('Final payment year', debt.maturity_year ?? end, value => setDebt('maturity_year', value ?? end), { step: 1 })}
          <label style={{ display: 'grid', gap: 5, fontSize: 11, color: '#536563' }}>
            <span>Repayment structure</span>
            <select value={debt.repayment_structure || 'annuity'} onChange={event => setDebt('repayment_structure', event.target.value)} style={fieldStyle}>
              <option value="annuity">Annuity</option>
              <option value="equal_principal">Equal principal</option>
            </select>
          </label>
          {field('Optional principal ceiling', debt.loan_ceiling, value => setDebt('loan_ceiling', value), { min: 0, unit: 'mn', placeholder: 'No ceiling' })}
        </div>
        {!debt.enabled && <div className="debt-disabled-note">Turn borrowing on to edit repayment assumptions. The annual revenue ledger remains available below.</div>}
        {invalidStoredStartYear && <div className="debt-invalid-year" role="status">
          Saved loan start year {String(debt.disbursement_year)} is outside the current forecast window. Choose a listed year to update it.
        </div>}

        <div className="debt-first-payment">
          <span>First principal payment</span><strong>{firstPrincipalYear}</strong>
          <small>Interest is due during grace. Proceeds are restricted to investment and never count as revenue.</small>
        </div>
      </section>
      <div className="debt-control-footnote">
        Sizing, cash protection, replacement and full-maturity verification are calculated by the model. This view does not recreate loan formulas.
      </div>
    </aside>
  );
}
