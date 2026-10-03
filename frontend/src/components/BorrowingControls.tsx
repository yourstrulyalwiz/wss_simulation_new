import React from 'react';
import NumInput from './NumInput';

const STREAMS = [
  ['collection', 'Collection efficiency'],
  ['nrw', 'NRW recovery'],
  ['tariff', 'Tariff reform'],
  ['custom', 'Custom interventions'],
  ['nrw_link', 'NRW-linked sanitation revenue'],
] as const;

interface Props {
  section: any;
  onChange: (field: string, value: any) => void;
  currency: string;
  areaSectorFallback: string;
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11.5, color: '#3A4452', fontWeight: 600, marginBottom: 4,
};
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 9px', borderRadius: 4, fontSize: 12,
  border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452',
  boxSizing: 'border-box', fontFamily: 'inherit',
};
const fieldWrap: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 };

export default function BorrowingControls({ section, onChange, currency, areaSectorFallback }: Props) {
  const iv = section || {};
  const alpha = Number.isFinite(+iv.cash_allocation_alpha) ? Math.max(0, Math.min(1, +iv.cash_allocation_alpha)) : 0;
  const mode = alpha === 0 ? 'reinvest' : alpha === 1 ? 'all' : 'partial';
  const streams: string[] = Array.isArray(iv.borrow_cash_streams)
    ? iv.borrow_cash_streams
    : STREAMS.map(([key]) => key);
  const numeric = (key: string, value: number) => onChange(key, value);
  const selectStyle: React.CSSProperties = { ...inputStyle, background: '#FFF9E6' };

  return (
    <>
      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: '#475569', lineHeight: 1.5, padding: '7px 9px', background: '#f1f8fb', border: '1px solid #d7e8ee', borderRadius: 5 }}>
        One fixed-rate loan is modelled for this area and sector. Entity names identify pools; matching names do not combine or pool them. Loan proceeds are capital, not operating revenue.
      </div>

      <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
        <label htmlFor="borrow-entity-name" style={labelStyle}>Borrowing entity / pool name</label>
        <input id="borrow-entity-name" type="text" value={iv.borrow_entity_name ?? ''}
          placeholder={areaSectorFallback} onChange={e => onChange('borrow_entity_name', e.target.value)} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>Blank uses “{areaSectorFallback}”. Names are labels only and never pool separate areas or sectors.</span>
      </div>

      <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
        <label style={labelStyle}>Use of additional net utility cash</label>
        <select aria-label="Use of additional net utility cash" value={mode}
          onChange={e => onChange('cash_allocation_alpha', e.target.value === 'reinvest' ? 0 : e.target.value === 'all' ? 1 : alpha > 0 && alpha < 1 ? alpha : 0.5)}
          style={selectStyle}>
          <option value="reinvest">Reinvest all (α = 0%)</option>
          <option value="partial">Partially allocate to debt financing (0% &lt; α &lt; 100%)</option>
          <option value="all">Allocate all eligible cash to debt financing (α = 100%)</option>
        </select>
      </div>
      {mode === 'partial' && (
        <div style={fieldWrap}>
          <label htmlFor="borrow-alpha" style={labelStyle}>Share committed to debt (α)</label>
          <NumInput id="borrow-alpha" value={alpha * 100} onValue={v => numeric('cash_allocation_alpha', v === undefined ? 0.5 : Math.max(0.01, Math.min(99.99, v)) / 100)}
            style={inputStyle} />
          <span style={{ fontSize: 10, color: '#64748b' }}>Enter a value strictly between 0% and 100%.</span>
        </div>
      )}
      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '6px 8px', lineHeight: 1.45 }}>
        {mode === 'reinvest'
          ? 'α = 0%: all additional net cash after prior obligations remains for direct reinvestment. No new loan is sized; an explicitly fixed contract still has contractual repayments and can show shortfalls.'
          : mode === 'all'
            ? 'α = 100%: all eligible additional net cash is committed to debt financing while the loan is outstanding; scheduled repayments remain contractual.'
            : `α = ${(alpha * 100).toFixed(2)}%: this share is committed to debt financing; the remainder is available for direct reinvestment.`}
        {' '}Prior debt obligations are deducted before applying α. Negative effects, including from unselected streams, reduce borrowing eligibility and direct resources. If no loan is drawn, cash is not withheld for an undrawn proposal.
      </div>

      <div style={{ gridColumn: '1 / -1' }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: '#1e3a5f', margin: '2px 0 6px' }}>Eligible cash streams</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px, 1fr))', gap: 5 }}>
          {STREAMS.map(([key, label]) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 7px', border: '1px solid #dbeafe', borderRadius: 4, background: '#f8fbff', color: '#334155', fontSize: 10.5, cursor: 'pointer' }}>
              <input type="checkbox" checked={streams.includes(key)}
                onChange={e => onChange('borrow_cash_streams', e.target.checked ? [...new Set([...streams, key])] : streams.filter(s => s !== key))}
                style={{ accentColor: '#2563eb' }} />
              {label}
            </label>
          ))}
        </div>
        <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
          Choose which positive cash sources support debt service. Associated operating costs and existing obligations are netted first; excluded or negative stream effects still reduce direct resources.
        </div>
      </div>

      <div style={fieldWrap}>
        <label htmlFor="borrow-drawdown-year" style={labelStyle}>Loan drawdown year</label>
        <NumInput id="borrow-drawdown-year" value={iv.borrow_drawdown_year} onValue={v => numeric('borrow_drawdown_year', v ?? 0)} style={inputStyle} />
      </div>
      <div style={fieldWrap}>
        <label htmlFor="borrow-interest-rate" style={labelStyle}>Annual interest rate</label>
        <NumInput id="borrow-interest-rate" value={Number.isFinite(+iv.borrow_interest_rate) ? +iv.borrow_interest_rate * 100 : undefined}
          onValue={v => numeric('borrow_interest_rate', v === undefined ? 0 : Math.max(0, v / 100))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>%</span>
      </div>
      <div style={fieldWrap}>
        <label htmlFor="borrow-rate-basis" style={labelStyle}>Interest rate basis</label>
        <select id="borrow-rate-basis" value={iv.borrow_rate_basis || 'nominal'}
          onChange={e => onChange('borrow_rate_basis', e.target.value)} style={selectStyle}>
          <option value="nominal">Nominal — fixed annual nominal payments</option>
          <option value="real">Real — reported in real values</option>
        </select>
        <span style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>Nominal contractual payments are deflated for real-value reporting.</span>
      </div>
      <div style={fieldWrap}>
        <label htmlFor="borrow-term-years" style={labelStyle}>Repayment term</label>
        <NumInput id="borrow-term-years" value={iv.borrow_term_years} onValue={v => numeric('borrow_term_years', Math.max(1, Math.round(v ?? 1)))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>years</span>
      </div>
      <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: '#334155', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!iv.baseline_obligations_known}
            onChange={e => onChange('baseline_obligations_known', e.target.checked)} style={{ accentColor: '#2563eb' }} />
          Baseline financials and obligations are known
        </label>
      </div>
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: iv.baseline_obligations_known ? '#64748b' : '#92400e', lineHeight: 1.4 }}>
        This checkbox describes broader baseline financial-information availability, not whether the prior-debt amount below is applied. Any entered amount above zero is deducted regardless. When unchecked, capacity is a conditional incremental estimate assuming other baseline obligations are covered—not a full creditworthiness assessment.
      </div>
      <div style={{ ...fieldWrap, gridColumn: '1 / -1' }}>
        <label htmlFor="borrow-contract-principal" style={labelStyle}>Fixed contracted principal (optional)</label>
        <NumInput id="borrow-contract-principal" value={iv.borrow_contract_principal ?? 0} commas
          onValue={v => numeric('borrow_contract_principal', Math.max(0, v ?? 0))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b', lineHeight: 1.4 }}>
          {Number(iv.borrow_contract_principal) > 0
            ? 'Positive principal fixes the agreed loan amount and contractual repayments; changes in forecast cash do not resize the contract, so debt-service shortfalls may occur.'
            : '0 auto-sizes a newly proposed loan. Enter a positive amount to fix agreed principal and contractual repayments; later cash-flow revisions will not resize them and may create debt-service shortfalls.'}
        </span>
      </div>
      <div style={fieldWrap}>
        <label htmlFor="borrow-min-dscr" style={labelStyle}>Minimum debt-service coverage ratio</label>
        <NumInput id="borrow-min-dscr" value={iv.borrow_min_dscr} onValue={v => numeric('borrow_min_dscr', Math.max(1, v ?? 1))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>coverage cushion</span>
      </div>
      <div style={fieldWrap}>
        <label htmlFor="borrow-ceiling" style={labelStyle}>Borrowing ceiling ({currency} mn)</label>
        <NumInput id="borrow-ceiling" value={iv.borrow_ceiling} commas onValue={v => numeric('borrow_ceiling', Math.max(0, v ?? 0))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>0 = no separate ceiling</span>
      </div>
      <div style={fieldWrap}>
        <label htmlFor="existing-debt-service" style={labelStyle}>Known existing annual debt service ({currency} mn)</label>
        <NumInput id="existing-debt-service" value={iv.existing_debt_service ?? 0} commas onValue={v => numeric('existing_debt_service', Math.max(0, v ?? 0))} style={inputStyle} />
        <span style={{ fontSize: 10, color: '#64748b' }}>Deducted before α; enter 0 if none.</span>
      </div>
    </>
  );
}