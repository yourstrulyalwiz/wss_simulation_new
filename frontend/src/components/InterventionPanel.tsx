import React, { useState } from 'react';
import InterventionCategories from './InterventionCategories';
import LiveInterventionChart from './LiveInterventionChart';
import NumInput from './NumInput';
import ExportButtons from './ExportButtons';
import { RevenueBaseEditor, REVENUE_ATTRIBUTION } from './RevenueBase';
import { ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, type CurrencyDisplaySettings } from '../currencyDisplay';
import UtilityDebtPreview from './UtilityDebtPreview';

function Section({ title, children, defaultOpen = false, sectionKey, onFocus }: { title: string; children: React.ReactNode; defaultOpen?: boolean; sectionKey?: string; onFocus?: (key: string) => void }) {
  const [open, setOpen] = useState(defaultOpen);
  const handleClick = () => { const willOpen = !open; setOpen(willOpen); if (willOpen && sectionKey && onFocus) onFocus(sectionKey); };
  return (
    <div style={{ marginBottom: 8, border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>
      <button onClick={handleClick} style={{
        width: '100%', padding: '10px 14px', textAlign: 'left', cursor: 'pointer',
        border: 'none', background: open ? '#e8f0fe' : '#fff', fontWeight: 600,
        fontSize: 14, borderRadius: 8, display: 'flex', justifyContent: 'space-between',
      }}>
        {title}<span>{open ? '▴' : '▾'}</span>
      </button>
      {open && <div style={{ padding: '10px 14px 12px' }}>{children}</div>}
    </div>
  );
}

function SubHead({ text }: { text: string }) {
  return <div style={{ fontSize: 13, fontWeight: 700, color: '#1e3a5f', margin: '10px 0 6px', borderBottom: '1px solid #e5e7eb', paddingBottom: 3 }}>{text}</div>;
}

function F({ label, value, onChange, unit, step, isPercent, tip, fieldType, placeholder }: {
  label: string; value?: number; onChange: (v: number) => void; unit?: string; step?: number; isPercent?: boolean; tip?: string; fieldType?: 'input' | 'linked' | 'computed'; placeholder?: string;
}) {
  const hasVal = typeof value === 'number' && !Number.isNaN(value);
  const rawPct = hasVal ? Math.round((value as number) * 1e4) / 1e2 : NaN;
  const displayVal = !hasVal ? NaN : (isPercent ? (fieldType === 'computed' ? Math.round(rawPct * 100) / 100 : rawPct) : Math.round((value as number) * 100) / 100);
  const isDerived = fieldType === 'computed' || fieldType === 'linked';
  // Show thousands separators for large amounts, but never for years or percentages
  const looksLikeYear = hasVal && !unit && !isPercent && Number.isInteger(value) && (value as number) >= 1900 && (value as number) <= 2100;
  const useCommas = !isPercent && !looksLikeYear && Math.abs(displayVal) >= 1000;
  const commaStr = useCommas ? displayVal.toLocaleString('en-US') : '';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#3A4452', lineHeight: 1.3, fontWeight: 500, minHeight: 32 }} title={tip || undefined}>
        {label}
        {tip && <span style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          background: '#C2CBD6', color: '#fff', fontSize: 10, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'help',
          fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700,
        }} title={tip}>i</span>}
      </label>
      {isDerived ? (
        <input type={useCommas ? 'text' : 'number'} inputMode="decimal"
          value={useCommas ? commaStr : (Number.isNaN(displayVal) ? '' : displayVal)}
          placeholder={placeholder} readOnly
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, textAlign: 'left',
            border: '1px solid #DDE3EA', background: '#F1F3F5', color: '#6B7785',
            cursor: 'not-allowed', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
          }} />
      ) : (
        <NumInput
          value={Number.isNaN(displayVal) ? undefined : displayVal} commas={useCommas}
          placeholder={placeholder}
          // Empty cell → NaN in the model (JSON-serialises to null → engine reads 0 / uses the placeholder).
          onValue={v => onChange(v === undefined ? (NaN as number) : (isPercent ? v / 100 : v))}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, textAlign: 'left',
            border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452',
            cursor: 'text', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit',
          }} />
      )}
      {unit && <span style={{ fontSize: 11, color: '#6B7785' }}>{unit}</span>}
    </div>
  );
}

// Toggle with a parameter panel that is opened/closed only by its own Show/Hide button.
// The checkbox just enables/disables the intervention (drives the graph) and never opens or closes the panel.
function InterventionToggle({ label, checked, onChange, children, onFocus }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode; onFocus?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
        background: checked ? '#eef2ff' : '#fafbfc', borderBottom: expanded ? '1px solid #c7d2fe' : 'none',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer' }}>
          <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: '#2563eb' }} />
          <span style={{ fontSize: 13, color: checked ? '#1e3a5f' : '#475569', fontWeight: checked ? 600 : 400 }}>{label}</span>
        </label>
        <button onClick={() => { const e = !expanded; setExpanded(e); if (e && onFocus) onFocus(); }}
          style={{ border: '1px solid #c7d2fe', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#2563eb', fontWeight: 600, padding: '3px 10px', borderRadius: 12 }}>
          {expanded ? '▴ Hide' : '▾ Show'}
        </button>
      </div>
      {expanded && (
        <div style={{ padding: '10px 14px', background: '#fff', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px 16px', alignItems: 'start' }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Optimised-technology-selection editor: re-weight / re-cost the SAFELY-MANAGED technology mix (pre-filled
// from the BAU mix). Its weighted cost becomes the new SM service cost from the start year onward. Only
// the SM cost drives new service in the engine, so this is the SM mix only. The mix lives in the payload
// (techmix_sm_tech_mix); the adapter collapses it to techmix_sm_cost. Equal to the BAU mix ⇒ zero effect.
function MixTable({ mix, bauMix, setMix, CUR, rungLabel }: {
  mix: any[]; bauMix: any[]; setMix: (m: any[]) => void; CUR: string; rungLabel: string;
}) {
  const weighted = (m: any[]) => m.reduce((a: number, t: any) => a + (+t.share || 0) * (+t.cost || 0), 0);
  const bauCost = weighted(bauMix), newCost = weighted(mix);
  const shareSum = mix.reduce((a: number, t: any) => a + (+t.share || 0), 0);
  const okShare = Math.abs(shareSum - 1) < 0.001;
  const pct = bauCost > 0 ? (newCost / bauCost - 1) * 100 : 0;
  const upd = (i: number, patch: any) => setMix(mix.map((x: any, j: number) => j === i ? { ...x, ...patch } : x));
  const cellStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 3, fontSize: 11, color: '#3A4452', outline: 'none' };
  // Shares that do not total 100% make the weighted cost wrong, so the share cells turn red until fixed.
  const shareCell: React.CSSProperties = okShare ? cellStyle : { ...cellStyle, border: '1px solid #dc2626', background: '#fef2f2' };
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, color: '#475569', marginBottom: 4 }}>
        Re-weight or re-cost the <b>{rungLabel}</b> technology mix (pre-filled from your BAU mix). Its weighted
        cost becomes the new {rungLabel} service cost from the start year.
      </div>
      <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
        <thead><tr style={{ color: '#64748b' }}><th style={{ textAlign: 'left', padding: '2px 6px' }}>technology</th><th>share %</th><th>cost/HH</th><th></th></tr></thead>
        <tbody>
          {mix.map((t: any, i: number) => (
            <tr key={i}>
              <td><input type="text" style={{ ...cellStyle, width: 180 }} value={t.name || ''} onChange={e => upd(i, { name: e.target.value })} /></td>
              <td><NumInput style={{ ...shareCell, width: 60 }}
                    value={(t.share == null || Number.isNaN(+t.share)) ? undefined : Math.round((+t.share) * 1e6) / 1e4}
                    onValue={v => upd(i, { share: v === undefined ? undefined : v / 100 })} /></td>
              <td><NumInput style={{ ...cellStyle, width: 92 }} commas
                    value={(t.cost == null || Number.isNaN(+t.cost)) ? undefined : Math.round(+t.cost)}
                    onValue={v => upd(i, { cost: v })} /></td>
              <td><button onClick={() => { if (mix.length > 1) setMix(mix.filter((_: any, j: number) => j !== i)); }} style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: 10 }}>✕</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, margin: '4px 0' }}>
        <button onClick={() => setMix([...mix, { name: 'New technology', share: 0, cost: 0 }])}
          style={{ padding: '3px 9px', fontSize: 11, border: '1px dashed #0073A8', background: '#fff', color: '#0073A8', borderRadius: 5, cursor: 'pointer' }}>+ Add technology</button>
        <button onClick={() => setMix(bauMix.map((t: any) => ({ ...t })))}
          style={{ padding: '3px 9px', fontSize: 11, border: '1px solid #cbd5e1', background: '#f8fafc', color: '#475569', borderRadius: 5, cursor: 'pointer' }}>↺ Reset to current BAU mix</button>
      </div>
      <div style={{ fontSize: 10.5, color: okShare ? '#0073A8' : '#b91c1c' }}>
        Shares total {(shareSum * 100).toFixed(2)}%{okShare ? '' : ' (they must total 100%)'}.
      </div>
      <div style={{ fontSize: 11, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '5px 9px', marginTop: 4 }}>
        New {rungLabel} service cost: <b>{Math.round(newCost).toLocaleString()} {CUR}</b> vs BAU <b>{Math.round(bauCost).toLocaleString()} {CUR}</b>{' '}
        (<b style={{ color: pct < 0 ? '#16a34a' : pct > 0 ? '#b45309' : '#64748b' }}>{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</b>).
      </div>
    </div>
  );
}

// Both rungs are purchased once investment can be split between them, so the lever re-costs BOTH mixes.
function TechMixEditor({ inputs, onChange, section, CUR }: {
  inputs: any; onChange: (i: any) => void; section: 'water_interventions' | 'sanitation_interventions'; CUR: string;
}) {
  const iv = inputs[section] || {};
  const costsSection = section === 'water_interventions' ? 'water_costs' : 'sanitation_costs';
  const clean = (a: any) => (a || []).filter((t: any) => t && typeof t === 'object');
  const set = (key: string) => (m: any[]) => onChange({ ...inputs, [section]: { ...iv, [key]: m } });
  return (
    <div style={{ gridColumn: '1 / -1' }}>
      <div style={{ maxWidth: 160 }}>
        <F label="Improvement start year" value={iv.techmix_start_year} onChange={v => onChange({ ...inputs, [section]: { ...iv, techmix_start_year: v } })}
          tip="Year the re-modelled technology mixes take effect. From this year on, new service uses the mixes below; earlier years keep the BAU mixes." />
      </div>
      <MixTable rungLabel="safely-managed" CUR={CUR}
        mix={clean(iv.techmix_sm_tech_mix)} bauMix={clean(inputs[costsSection]?.sm_tech_mix)} setMix={set('techmix_sm_tech_mix')} />
      <MixTable rungLabel="basic" CUR={CUR}
        mix={clean(iv.techmix_basic_tech_mix)} bauMix={clean(inputs[costsSection]?.basic_tech_mix)} setMix={set('techmix_basic_tech_mix')} />
    </div>
  );
}

interface Props { inputs: any; onChange: (i: any) => void; results?: any; calculationError?: string; sectorTab?: 'water' | 'sanitation'; onSectorChange?: (v: 'water' | 'sanitation') => void; onSectionFocus?: (key: string) => void; geoScope?: string; chartScope?: string; contributionView: ContributionView; onContributionViewChange: (v: ContributionView) => void; currencyDisplay: CurrencyDisplaySettings; onCurrencyDisplayChange: (v: CurrencyDisplaySettings) => void; onEditCurrencyRate: () => void; }

export default function InterventionPanel({ inputs, onChange, results, calculationError = '', sectorTab = 'water', onSectorChange, onSectionFocus, geoScope = 'urban', chartScope, contributionView, onContributionViewChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate }: Props) {
  const debtResultFreshness = React.useRef({ inputs, result: results, waiting: false, sawEmpty: !results });
  if (debtResultFreshness.current.inputs !== inputs) {
    debtResultFreshness.current = { inputs, result: results, waiting: true, sawEmpty: !results };
  } else if (debtResultFreshness.current.waiting) {
    if (!results) debtResultFreshness.current.sawEmpty = true;
    else if (debtResultFreshness.current.sawEmpty && results !== debtResultFreshness.current.result) {
      debtResultFreshness.current.waiting = false;
    }
    if (results !== debtResultFreshness.current.result) debtResultFreshness.current.result = results;
  }
  const debtResultsFresh = !debtResultFreshness.current.waiting;
  // Budget execution (executed budget ÷ allocated budget) is COMPUTED by the live engine from the
  // historical budget rows — it is shown read-only as the current value in the Budget-execution
  // intervention (no user override). NB: internally still keyed capeff_*/ws_capital_efficiency_enabled
  // (the same ratio, renamed in the UI).
  const wsCurEff = results?.water_supply?.capex_efficiency_baseline ?? 1;
  const sanCurEff = results?.sanitation?.capex_efficiency_baseline ?? 1;
  const u = (section: string, field: string, value: number | string) => {
    onChange({ ...inputs, [section]: { ...inputs[section], [field]: value } });
  };
  const toggleIntv = (field: string, value: boolean) => {
    onChange({ ...inputs, toggles: { ...inputs.toggles, [field]: value } });
  };
  const CUR = inputs?.country_config?.currency || 'LCU';
  const scopeLabel = geoScope === 'national' ? 'National' : geoScope === 'rural' ? 'Rural' : 'Urban';
  const scopeLower = scopeLabel.toLowerCase();
  const scheduleYear = (iv: any, field: string, end = false) =>
    Number.isFinite(iv[field]) ? iv[field] : (end ? inputs.period.forecast_end_year : inputs.period.baseline_year + 1);

  // ── Affordability lever (microfinance + means-based grant) helpers ──────────────────────────────
  const miniInput: React.CSSProperties = { width: '100%', padding: '5px 7px', borderRadius: 4, fontSize: 12,
    border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const uArr = (section: string, field: string, idx: number, value: number | undefined) => {
    const arr = [...((inputs[section]?.[field]) || [])];
    arr[idx] = value;
    onChange({ ...inputs, [section]: { ...inputs[section], [field]: arr } });
  };
  const uBracket = (idx: number, field: string, value: number | undefined) => {
    const brackets = ((inputs.income_distribution?.brackets) || []).map((b: any, i: number) => i === idx ? { ...b, [field]: value } : b);
    onChange({ ...inputs, income_distribution: { ...(inputs.income_distribution || {}), brackets } });
  };
  const bracketLabel = (i: number, n: number) => i === 0 ? 'Poorest' : i === n - 1 ? 'Richest' : `Q${i + 1}`;
  const microfinanceFields = (section: 'water_interventions' | 'sanitation_interventions') => {
    const iv = inputs[section] || {};
    const gaps: number[] = iv.mf_gap_shares || [0, 0, 0, 0, 0];
    const brackets: any[] = inputs.income_distribution?.brackets || [];
    const gapSum = gaps.reduce((s: number, g: number) => s + (+g || 0), 0);
    const shareSum = brackets.reduce((s: number, b: any) => s + (+b.hh_share || 0), 0);
    const svc = section === 'water_interventions' ? 'water' : 'sanitation';
    return (<>
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b', marginBottom: 2 }}>
        A loan lets <b>gap households</b> — those without safely-managed {svc} service — finance the cost of gaining service and repay it over time.
      </div>
      <F label="Connection fee" value={iv.mf_connection_fee || undefined} onChange={v => u(section, 'mf_connection_fee', v)} step={1000} unit={CUR}
         placeholder="per-household service cost"
         tip="Connection fee per household — the capital cost of providing one household with safely-managed service, financed by the loan. Starts blank; enter the amount." />
      <F label="Improvement start year" value={iv.mf_start_year} onChange={v => u(section, 'mf_start_year', v)} tip="Year the microfinance scheme begins." />
      <F label="End year" value={iv.mf_end_year} onChange={v => u(section, 'mf_end_year', v)} tip="Last year new microfinance-financed service is added." />
      {/* Self-finance carve-out — isolates the BAU-anyway service so microfinance isn't credited for it */}
      <div style={{ gridColumn: '1 / -1' }}><SubHead text="Self-finance carve-out" /></div>
      <F label="Can pay upfront (share of gap)" value={iv.mf_selffinance_share} onChange={v => u(section, 'mf_selffinance_share', v)} isPercent unit="%" tip="Share of the service gap that can pay for service upfront from savings. Taken richest-bracket-first, they're treated as gaining service anyway (BAU) — ISOLATED out and excluded from the microfinance impact, so it isn't credited for service that would happen without it." />
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
        These households don't need a loan, so they're carved out of the microfinance gap and don't count toward its impact — isolating the business-as-usual service and leaving the BAU baseline unchanged.
      </div>
      <div style={{ gridColumn: '1 / -1' }}><SubHead text="Loan terms" /></div>
      <F label={`Willingness to pay (${svc})`} value={iv.mf_pct_income} onChange={v => u(section, 'mf_pct_income', v)} isPercent unit="%" tip={`Maximum share of monthly household income a household will devote to its ${svc} service-loan repayment. Income × this = how much loan it can service.`} />
      <F label="Loan interest rate (real)" value={iv.mf_interest_rate} onChange={v => u(section, 'mf_interest_rate', v)} isPercent unit="%" tip="Real annual interest rate on the service loan." />
      <F label="Loan tenor" value={iv.mf_tenor} onChange={v => u(section, 'mf_tenor', v)} unit="yrs" tip="Loan repayment period, in years." />
      <F label="Take-up rate" value={iv.mf_takeup_rate} onChange={v => u(section, 'mf_takeup_rate', v)} isPercent unit="%" tip="Share of eligible (loan-needing) gap households who take up the loan." />
      <F label="Partial upfront payers" value={iv.mf_partial_share} onChange={v => u(section, 'mf_partial_share', v)} isPercent unit="%" tip="Share of gap households who can pay part of the upfront service cost themselves, reducing their loan principal. The rest finance the whole service cost." />
      <F label="Upfront fee they cover" value={iv.mf_upfront_payable_ratio} onChange={v => u(section, 'mf_upfront_payable_ratio', v)} isPercent unit="%" tip="For those partial payers, the fraction of the upfront fee they pay themselves; the remainder is financed by the loan." />
      <div style={{ gridColumn: '1 / -1' }}>
        <SubHead text={`Income distribution — ${brackets.length} brackets (shared by both sectors)`} />
        <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr 1fr', gap: '4px 8px', alignItems: 'center', fontSize: 11 }}>
          <span />
          <span style={{ color: '#64748b', fontWeight: 600 }}>Monthly income ({CUR})</span>
          <span style={{ color: '#64748b', fontWeight: 600 }}>% of households</span>
          {brackets.map((b: any, i: number) => (
            <React.Fragment key={i}>
              <span style={{ color: '#475569' }}>{bracketLabel(i, brackets.length)}</span>
              <NumInput commas value={b.income_monthly ?? undefined} onValue={v => uBracket(i, 'income_monthly', v)} style={miniInput} />
              <NumInput value={Number.isFinite(b.hh_share) ? Math.round((b.hh_share) * 1e4) / 1e2 : undefined} onValue={v => uBracket(i, 'hh_share', v === undefined ? undefined : v / 100)} style={miniInput} />
            </React.Fragment>
          ))}
        </div>
        <div style={{ fontSize: 10, color: Math.abs(shareSum - 1) > 0.005 ? '#dc2626' : '#16a34a', marginTop: 4 }}>
          Household shares total {Math.round(shareSum * 1000) / 10}%{Math.abs(shareSum - 1) > 0.005 ? ' — should be 100%' : ' ✓'}
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1' }}>
        <SubHead text="Service gap by income bracket (typically skewed to the poor)" />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {gaps.map((g: number, i: number) => (
            <F key={i} label={bracketLabel(i, gaps.length)} value={g} onChange={v => uArr(section, 'mf_gap_shares', i, v)} isPercent unit="%" tip={`Share of the ${svc} safely-managed service gap that sits in this income bracket.`} />
          ))}
        </div>
        <div style={{ fontSize: 10, color: Math.abs(gapSum - 1) > 0.005 ? '#dc2626' : '#16a34a', marginTop: 4 }}>
          Gap shares total {Math.round(gapSum * 1000) / 10}%{Math.abs(gapSum - 1) > 0.005 ? ' — should be 100%' : ' ✓'}
        </div>
      </div>
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
        Of the residual gap, households whose income can service the loan gain safely-managed service; those who can't are resized by the <b>means-based grant</b> below.
      </div>
      <div style={{ gridColumn: '1 / -1' }}><SubHead text="Means-based grant" /></div>
      <F label="Grant budget (one-time pool)" value={iv.grant_total} onChange={v => u(section, 'grant_total', v)} step={1000} unit={`${CUR} mn`} tip="Total means-based grant pool, in local-currency millions. It buys down loan principals for gap households who can't service a full loan; the cheapest buy-downs are funded first, so the pool maximises new service. Leave 0 for no grant." />
      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
        For a household that can service only a smaller loan, the grant covers the shortfall (in present value) so its resized repayment matches what it can afford — providing it with safely-managed service.
      </div>
    </>);
  };

  const financialFields = (section: 'water_interventions' | 'sanitation_interventions') => {
    const iv = inputs[section] || {};
    const sectorResult = section === 'water_interventions' ? results?.water_supply : results?.sanitation;
    const baselineShare = sectorResult?.baseline_bau_total_spending_share;
    const baselineYear = inputs?.period?.baseline_year;
    const estimated = sectorResult?.baseline_spending_reference_source === 'cost_derived_equivalent';
    const addedCapital = sectorResult?.scenario_financial_commitment_cash?.reduce((sum: number, value: number) => sum + value, 0);
    const option = (field: string, label: string, fields: React.ReactNode) => (
      <div style={{ gridColumn: '1 / -1', border: '1px solid #dbeafe', borderRadius: 6, padding: 10, background: '#f8fbff' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 650, color: '#1e3a5f' }}>
          <input type="checkbox" checked={!!iv[field]} onChange={e => u(section, field, e.target.checked ? 1 : 0)}
            style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
          {label}
        </label>
        {!!iv[field] && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px', marginTop: 10 }}>{fields}</div>}
      </div>
    );
    return (<>
      <div data-financial-reference={section} style={{ gridColumn: '1 / -1', border: '1px solid #dbeafe', background: '#f8fbff',
        borderRadius: 6, padding: '10px 12px', fontSize: 12, color: '#1e3a5f' }}>
        <span style={{ fontWeight: 700 }}>Baseline BAU total spending share{estimated ? ' (estimated)' : ''}{baselineYear ? ` (${baselineYear})` : ''}: </span>
        <strong>{typeof baselineShare === 'number' && Number.isFinite(baselineShare)
          ? `${(baselineShare * 100).toFixed(4)}% of GDP`
          : !results && !calculationError ? 'Calculating baseline spending…'
          : calculationError ? `Unavailable — ${calculationError}`
          : 'Unavailable — check baseline real GDP, capital share and execution rate'}</strong>
        {estimated && <div style={{fontSize:10.5, marginTop:4}}>
          No total spending input was supplied. This is the cost-derived BAU investment divided by the capital share and execution rate, expressed as a share of GDP—not observed public expenditure.
        </div>}
        {baselineShare === 0 && !!iv.fin_growth_enabled && <div style={{fontSize:10.5,marginTop:4}}>
          A percentage increase on zero spending adds no funds. Enter a spending baseline in Data Inputs or use a GDP spending target.
        </div>}
        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
          Reference only: baseline BAU total sector spending ÷ baseline real GDP, before the capex share and
          execution rate. The target is compared with each forecast year’s BAU total spending, not this fixed share.
        </div>
      </div>
      {Number.isFinite(addedCapital) && <div data-financial-capital={section} style={{gridColumn:'1 / -1',fontSize:12,color:'#1e3a5f'}}>
        Added effective capital over the forecast: <strong>{addedCapital.toLocaleString('en-US', {maximumFractionDigits:2})} {CUR} million (real)</strong>.
        <div style={{fontSize:10.5,color:'#64748b',marginTop:4}}>
          After the capital share and execution rate. Funds may first cover operating deficits and replacement before expanding service.
        </div>
      </div>}
      <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: '#64748b' }}>
        Select either or both options. Enabled options overlap additively and apply only to the intervention scenario.
      </div>
      {option('fin_gdp_enabled', 'Target spending as a share of GDP', <>
        <F label="Target total spending share" value={iv.fin_gdp_target_share} onChange={v => u(section, 'fin_gdp_target_share', Math.max(0, v))} isPercent unit="% of GDP"
          tip="Enter the target total sector-spending share, not the percentage increase. Only the positive difference above BAU is added." />
        <F label="Start year" value={scheduleYear(iv, 'fin_gdp_start_year')} onChange={v => u(section, 'fin_gdp_start_year', v)}
          tip="The target total spending share applies from this year onward." />
      </>)}
      {option('fin_growth_enabled', 'Annual percentage increase in spending', <>
        <F label="Annual spending increase" value={iv.fin_growth_rate} onChange={v => u(section, 'fin_growth_rate', Math.max(0, v))} isPercent unit="% per year"
          tip="The increase compounds annually from the start year through the end year." />
        <F label="Start year" value={scheduleYear(iv, 'fin_growth_start_year')} onChange={v => u(section, 'fin_growth_start_year', v)} />
        <F label="End year" value={scheduleYear(iv, 'fin_growth_end_year', true)} onChange={v => u(section, 'fin_growth_end_year', v)} />
      </>)}
    </>);
  };

  const injectionFields = (section: 'water_interventions' | 'sanitation_interventions') => {
    const iv = inputs[section] || {};
    return (<>
        <div style={{ gridColumn: '1 / -1', fontSize: 10.5, color: '#64748b' }}>
          Add a one-time or recurring amount independently of the GDP target and annual growth.
        </div>
        <F label="Funding amount" value={iv.fin_injection_amount} onChange={v => u(section, 'fin_injection_amount', Math.max(0, v))}
          unit={`${CUR} mn`} tip="Absolute additional funding in local-currency millions." />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Schedule</label>
          <select value={iv.fin_injection_mode || 'one_time'} onChange={e => u(section, 'fin_injection_mode', e.target.value)}
            style={{ padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4, fontSize: 13 }}>
            <option value="one_time">One-time</option>
            <option value="recurring">Recurring annually</option>
          </select>
        </div>
        <F label={iv.fin_injection_mode === 'recurring' ? 'Start year' : 'Injection year'} value={scheduleYear(iv, 'fin_injection_start_year')}
          onChange={v => u(section, 'fin_injection_start_year', v)} />
        {iv.fin_injection_mode === 'recurring' &&
          <F label="End year" value={scheduleYear(iv, 'fin_injection_end_year', true)} onChange={v => u(section, 'fin_injection_end_year', v)} />}
    </>);
  };

  // Which intervention layers are switched on for the active sector — drives the impact graph
  const t = inputs.toggles || {};
  const chartActive = sectorTab === 'water'
    ? {
        collectionNrw: !!(t.ws_collection_efficiency_enabled || t.ws_nrw_enabled),
        capital: !!t.ws_capital_efficiency_enabled,
        tariff: !!t.ws_tariff_enabled,
      }
    : {
        collectionNrw: !!t.san_collection_efficiency_enabled,
        capital: !!t.san_capital_efficiency_enabled,
        tariff: !!t.san_tariff_enabled,
      };

  // Keep custom interventions on the sector selected by the top toggle (leave any set to "Both" alone)
  const prevSector = React.useRef(sectorTab);
  React.useEffect(() => {
    if (prevSector.current === sectorTab) return;
    prevSector.current = sectorTab;
    const ci = inputs.custom_interventions || [];
    if (ci.some((c: any) => c.sector !== 'both' && c.sector !== sectorTab)) {
      onChange({ ...inputs, custom_interventions: ci.map((c: any) => c.sector === 'both' ? c : { ...c, sector: sectorTab }) });
    }
  }, [sectorTab]);

  return (
    <div style={{ display: 'flex', flex: 1, minWidth: 0, overflow: 'hidden' }}>
      {/* Left: intervention controls */}
      <div style={{ flex: '0 1 598px', minWidth: 0, overflowY: 'auto', padding: '16px 24px', background: '#fafbfc', borderRight: '1px solid #e0e0e0', fontSize: 12 }}>

        {/* Area-scope banner */}
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12, textAlign: 'left',
          padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 600,
          background: '#EBF6FB', border: '1px solid #b6e0f0', color: '#0073A8',
        }}>
          <span>Configuring <span style={{ textTransform: 'capitalize' }}>{scopeLabel}</span> interventions — every field below is {scopeLower}-specific.</span>
        </div>

        {/* Sector toggle */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
          {(['water', 'sanitation'] as const).map(s => (
            <button key={s} onClick={() => { onSectorChange?.(s); onSectionFocus?.(s === 'water' ? 'ws_interventions' : 'san_interventions'); }} style={{
              flex: 1, padding: '8px 16px', border: 'none', borderRadius: 6, cursor: 'pointer',
              background: sectorTab === s ? '#2563eb' : '#e5e7eb',
              color: sectorTab === s ? '#fff' : '#374151', fontWeight: 600, fontSize: 13,
            }}>{s === 'water' ? 'Water Supply' : 'Sanitation'}</button>
          ))}
        </div>

        {/* ===== WATER SUPPLY INTERVENTIONS ===== */}
        {sectorTab === 'water' && <>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', marginBottom: 10 }}>{scopeLabel} Water Supply Interventions</h3>

          <InterventionCategories sector="water">
          <InterventionToggle label="Increase in Financial Commitments" checked={inputs.toggles?.ws_financial_commitment_enabled ?? false} onChange={v => toggleIntv('ws_financial_commitment_enabled', v)} onFocus={() => onSectionFocus?.('ws_financial_commitment')}>
            {financialFields('water_interventions')}
          </InterventionToggle>
          <InterventionToggle label="Exogenous Injection of Funds" checked={inputs.toggles?.ws_exogenous_injection_enabled ?? false} onChange={v => toggleIntv('ws_exogenous_injection_enabled', v)} onFocus={() => onSectionFocus?.('ws_exogenous_injection')}>
            {injectionFields('water_interventions')}
          </InterventionToggle>

          <InterventionToggle label="Collection efficiency" checked={inputs.toggles?.ws_collection_efficiency_enabled ?? false} onChange={v => toggleIntv('ws_collection_efficiency_enabled', v)} onFocus={() => onSectionFocus?.('ws_ce')}>
            <F label="Improvement start year" value={inputs.water_interventions.ce_start_year} onChange={v => u('water_interventions','ce_start_year',v)} tip="Year the collection efficiency improvement begins" />
            <F label="Target year" value={inputs.water_interventions.ce_target_year} onChange={v => u('water_interventions','ce_target_year',v)} tip="Year the target collection ratio is achieved" />
            <RevenueBaseEditor inputs={inputs} onChange={onChange} sector="water" />
            <F label="Target collection ratio" value={inputs.water_interventions.ce_target_ratio} onChange={v => u('water_interventions','ce_target_ratio',v)} isPercent unit="%" tip="Target collection ratio for the model end year" />
            <p title={REVENUE_ATTRIBUTION}>{REVENUE_ATTRIBUTION}</p>
          </InterventionToggle>

          <InterventionToggle label="NRW reduction" checked={inputs.toggles?.ws_nrw_enabled ?? false} onChange={v => toggleIntv('ws_nrw_enabled', v)} onFocus={() => onSectionFocus?.('ws_nrw')}>
            <F label="Start year" value={inputs.water_interventions.nrw_start_year} onChange={v => u('water_interventions','nrw_start_year',v)} tip="Year the NRW-reduction works begin and spending starts. Unlike the other levers — where the start year is when the improvement shows up — the recovered-water benefit here only appears after the lag below." />
            <F label="Target year" value={inputs.water_interventions.nrw_target_year} onChange={v => u('water_interventions','nrw_target_year',v)} tip="Year the target NRW level is reached by the works (spending schedule); the benefit reaches it the lag below afterwards." />
            <F label="Benefit lag" value={inputs.water_interventions.nrw_lag_years} onChange={v => u('water_interventions','nrw_lag_years',v)} step={1} unit="yrs" tip="Years between spending on the fixes and the recovered water (and its value) materialising. Other levers bake this delay into their start year; NRW needs it because there is a real gap between the works and the water coming back. Set 0 for no delay." />
            <F label="Current NRW %" value={inputs.water_interventions.nrw_current_pct} onChange={v => u('water_interventions','nrw_current_pct',v)} isPercent unit="%" tip="Current non-revenue water: share of water produced that is not billed (physical leaks + commercial losses)" />
            <F label="Target NRW %" value={inputs.water_interventions.nrw_target_pct} onChange={v => u('water_interventions','nrw_target_pct',v)} isPercent unit="%" tip="Target non-revenue water for the model end year. Aim for the economically optimal level — where the cost of further reduction outweighs the benefit; ~20% is a typical benchmark." />
            {(() => {
              const t = inputs.water_interventions.nrw_target_pct || 0;
              if (t > 0 && t < 0.15) return <div style={{ gridColumn: '1 / -1', fontSize: 10, fontWeight: 600, color: '#92400e', padding: '3px 8px', background: '#fef3c7', borderRadius: 4, marginBottom: 4 }}>Warning: Below ~15% is rarely economically optimal — reducing NRW further usually costs more than it saves (~20% is a typical benchmark).</div>;
              return null;
            })()}
            <F label="Commercial losses % of NRW" value={inputs.water_interventions.nrw_commercial_loss_pct || 0} onChange={v => u('water_interventions','nrw_commercial_loss_pct',v)} isPercent unit="%" tip="Share of NRW from commercial losses (metering errors, theft, unbilled use). Commercial + physical must sum to 100%." />
            <F label="Physical losses % of NRW" value={inputs.water_interventions.nrw_physical_loss_pct || 0} onChange={v => u('water_interventions','nrw_physical_loss_pct',v)} isPercent unit="%" tip="Share of NRW from physical leaks in the network. Only this physical (leak) portion frees up deliverable water for basic→SM upgrades; the commercial portion counts only toward revenue. Commercial + physical must sum to 100%." />
            {(() => {
              const s = (inputs.water_interventions.nrw_commercial_loss_pct || 0) + (inputs.water_interventions.nrw_physical_loss_pct || 0);
              const bad = Math.abs(s - 1) > 0.005;
              return <div style={{ gridColumn: '1 / -1', fontSize: 10, fontWeight: 600, color: bad ? '#dc2626' : '#16a34a', padding: '3px 8px', background: bad ? '#fef2f2' : '#f0fdf4', borderRadius: 4, marginBottom: 4 }}>{bad ? `Commercial and physical losses add up to ${Math.round(s * 10000) / 100}% — they should total 100%.` : 'Commercial and physical losses add up to 100%. ✓'}</div>;
            })()}
            <F label="System input volume (at start year)" value={inputs.water_interventions.nrw_system_input_vol || 0} onChange={v => u('water_interventions','nrw_system_input_vol',v)} step={1} unit="MLD" tip="Total water produced / put into the system at the start year, in million litres per day. It grows each forecast year — with population by default, or at the growth rate below if you set one." />
            <F label="Volume growth rate" value={inputs.water_interventions.nrw_vol_growth} onChange={v => u('water_interventions','nrw_vol_growth',v)} isPercent unit="%" placeholder="population" tip="Annual real growth of the system input volume from the start year. Leave blank to scale with population; enter a rate to override (e.g. 3%)." />
            <F label="Water per basic→SM upgrade" value={inputs.water_interventions.nrw_water_per_upgrade || 0} onChange={v => u('water_interventions','nrw_water_per_upgrade',v)} step={5} unit="m³/HH/yr" tip="Extra water a basic household needs each year to become safely managed. Recovered physical water ÷ this = households upgraded." />
            <F label="Cost of fixing" value={inputs.water_interventions.nrw_capex_unit_cost_local || 0} onChange={v => u('water_interventions','nrw_capex_unit_cost_local',v)} step={1000} unit={`${CUR}/m³/day`} tip="Capital cost to recover one cubic metre per day of lost water — leak detection, pipe and meter replacement. Charged as the losses are cut." />
            <div style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }} title="How to value the recovered water: as tariff revenue from sales, or as the production cost you no longer have to spend.">Value recovered water at</label>
              <select value={inputs.water_interventions.nrw_value_basis || 'tariff'} onChange={e => u('water_interventions','nrw_value_basis', e.target.value)}
                style={{ width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}>
                <option value="tariff">Water tariff — revenue from sales</option>
                <option value="production">Cost of production — cost avoided</option>
              </select>
            </div>
            {(inputs.water_interventions.nrw_value_basis || 'tariff') === 'production'
              ? <F label="Production cost" value={inputs.water_interventions.nrw_production_cost || 0} onChange={v => u('water_interventions','nrw_production_cost',v)} step={0.5} unit={`${CUR}/m³`} tip="Recovering water avoids producing this much fresh water, per cubic metre." />
              : <F label="Water tariff" value={inputs.water_interventions.nrw_tariff || 0} onChange={v => u('water_interventions','nrw_tariff',v)} step={0.5} unit={`${CUR}/m³`} tip="The recovered water is sold at this price, per cubic metre." />}
          </InterventionToggle>

          <InterventionToggle label="Budget execution improvement" checked={inputs.toggles?.ws_capital_efficiency_enabled ?? false} onChange={v => toggleIntv('ws_capital_efficiency_enabled', v)} onFocus={() => onSectionFocus?.('ws_budget_exec')}>
            <F label="Current budget execution" value={wsCurEff} onChange={() => {}} fieldType="computed" isPercent unit="%" tip="Executed budget ÷ allocated budget: the share of the allocated capital budget that actually gets spent on new service (unit cost × new households). Computed from your historical budget rows in Data Inputs → Budget — not editable here." />
            <F label="Target budget execution" value={inputs.water_interventions.capeff_target_pct ?? 1} onChange={v => u('water_interventions','capeff_target_pct',v)} isPercent unit="%" tip="The budget execution rate to reach — at most 100% (spend the whole allocated budget). Raising it lets the same allocated budget build more service and shrinks the financing gap." />
            <F label="Improvement start year" value={inputs.water_interventions.capeff_start_year} onChange={v => u('water_interventions','capeff_start_year',v)} tip="Year the budget-execution improvement begins" />
            <F label="Target year" value={inputs.water_interventions.capeff_target_year} onChange={v => u('water_interventions','capeff_target_year',v)} tip="Year the target execution rate is reached; it ramps linearly from the start year to here." />
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
              Current is <b>{Math.round(wsCurEff * 100)}%</b> (auto-calculated from your budget data) — improving it toward the target spends more of the allocated budget on new service.
            </div>
          </InterventionToggle>

          <InterventionToggle label="Capex efficiency (unit cost)" checked={inputs.toggles?.ws_costeff_enabled ?? false} onChange={v => toggleIntv('ws_costeff_enabled', v)} onFocus={() => onSectionFocus?.('ws_capex_eff')}>
            <F label="Improvement start year" value={inputs.water_interventions.costeff_start_year} onChange={v => u('water_interventions','costeff_start_year',v)} tip="Year the capex-efficiency programme begins. At this year the service cost still equals BAU; the discount then grows toward the improvement level." />
            <F label="Target year" value={inputs.water_interventions.costeff_target_year} onChange={v => u('water_interventions','costeff_target_year',v)} tip="Year the full improvement is reached; the discount ramps linearly from the start year to here, then holds." />
            <F label="Capex efficiency improvement" value={inputs.water_interventions.costeff_target_pct} onChange={v => u('water_interventions','costeff_target_pct',v)} isPercent unit="%" tip="How much cheaper each new safely-managed service becomes by the target year — e.g. 20% means a 20% discount on the service capex. The discount ramps from 0 at the start year to this level, then holds. Cheaper service lets the same budget serve more households." />
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
              Discounts the safely-managed service cost, ramping up from 0 at the start year to <b>{Math.max(0, Math.round((inputs.water_interventions.costeff_target_pct||0)*1000)/10)}%</b> by the target year.
            </div>
          </InterventionToggle>

          <InterventionToggle label="Optimised technology selection" checked={inputs.toggles?.ws_techmix_enabled ?? false} onChange={v => toggleIntv('ws_techmix_enabled', v)} onFocus={() => onSectionFocus?.('ws_techmix')}>
            <TechMixEditor inputs={inputs} onChange={onChange} section="water_interventions" CUR={CUR} />
          </InterventionToggle>

          <InterventionToggle label="Tariff reform" checked={inputs.toggles?.ws_tariff_enabled ?? false} onChange={v => toggleIntv('ws_tariff_enabled', v)} onFocus={() => onSectionFocus?.('ws_tariff')}>
            <F label="Improvement start year" value={inputs.water_interventions.tariff_start_year} onChange={v => u('water_interventions','tariff_start_year',v)} tip="Year the tariff starts rising" />
            <F label="Target year" value={inputs.water_interventions.tariff_target_year} onChange={v => u('water_interventions','tariff_target_year',v)} tip="Year the target tariff is reached; it rises linearly from the start year to here, then holds." />
            <RevenueBaseEditor inputs={inputs} onChange={onChange} sector="water" />
            <F label="Target tariff" value={inputs.water_interventions.tariff_target} onChange={v => u('water_interventions','tariff_target',v)} step={0.5} unit={`${CUR}/m3`} tip={`Additional cash = billed volume × tariff rise × applicable collection ratio. ${REVENUE_ATTRIBUTION}`} />
          </InterventionToggle>

          <InterventionToggle label="Microfinance" checked={inputs.toggles?.ws_microfinance_enabled ?? false} onChange={v => toggleIntv('ws_microfinance_enabled', v)} onFocus={() => onSectionFocus?.('ws_microfinance')}>
            {microfinanceFields('water_interventions')}
          </InterventionToggle>
          </InterventionCategories>

        </>}

        {/* ===== SANITATION INTERVENTIONS ===== */}
        {sectorTab === 'sanitation' && <>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', marginBottom: 10 }}>{scopeLabel} Sanitation Interventions</h3>

          <InterventionCategories sector="sanitation">
          <InterventionToggle label="Increase in Financial Commitments" checked={inputs.toggles?.san_financial_commitment_enabled ?? false} onChange={v => toggleIntv('san_financial_commitment_enabled', v)} onFocus={() => onSectionFocus?.('san_financial_commitment')}>
            {financialFields('sanitation_interventions')}
          </InterventionToggle>
          <InterventionToggle label="Exogenous Injection of Funds" checked={inputs.toggles?.san_exogenous_injection_enabled ?? false} onChange={v => toggleIntv('san_exogenous_injection_enabled', v)} onFocus={() => onSectionFocus?.('san_exogenous_injection')}>
            {injectionFields('sanitation_interventions')}
          </InterventionToggle>

          <InterventionToggle label="Collection efficiency" checked={inputs.toggles?.san_collection_efficiency_enabled ?? false} onChange={v => toggleIntv('san_collection_efficiency_enabled', v)} onFocus={() => onSectionFocus?.('san_ce')}>
            <F label="Improvement start year" value={inputs.sanitation_interventions.ce_start_year} onChange={v => u('sanitation_interventions','ce_start_year',v)} tip="Year the collection efficiency improvement begins" />
            <F label="Target year" value={inputs.sanitation_interventions.ce_target_year} onChange={v => u('sanitation_interventions','ce_target_year',v)} tip="Year the target is achieved" />
            <RevenueBaseEditor inputs={inputs} onChange={onChange} sector="sanitation" />
            <F label="Target collection ratio" value={inputs.sanitation_interventions.ce_target_ratio ?? inputs.water_interventions.ce_target_ratio} onChange={v => u('sanitation_interventions','ce_target_ratio',v)} isPercent unit="%" tip="Sanitation's own collection target. Its legacy water-linked value is materialized when the revenue base is resolved." />
          </InterventionToggle>

          <InterventionToggle label="Budget execution improvement" checked={inputs.toggles?.san_capital_efficiency_enabled ?? false} onChange={v => toggleIntv('san_capital_efficiency_enabled', v)} onFocus={() => onSectionFocus?.('san_budget_exec')}>
            <F label="Current budget execution" value={sanCurEff} onChange={() => {}} fieldType="computed" isPercent unit="%" tip="Executed budget ÷ allocated budget: the share of the allocated capital budget that actually gets spent on new service. Computed from your historical budget rows in Data Inputs → Budget — not editable here." />
            <F label="Target budget execution" value={inputs.sanitation_interventions.capeff_target_pct ?? 1} onChange={v => u('sanitation_interventions','capeff_target_pct',v)} isPercent unit="%" tip="The budget execution rate to reach — at most 100% (spend the whole allocated budget). Raising it lets the same allocated budget build more service." />
            <F label="Improvement start year" value={inputs.sanitation_interventions.capeff_start_year} onChange={v => u('sanitation_interventions','capeff_start_year',v)} tip="Year the budget-execution improvement begins" />
            <F label="Target year" value={inputs.sanitation_interventions.capeff_target_year} onChange={v => u('sanitation_interventions','capeff_target_year',v)} tip="Year the target execution rate is reached; it ramps linearly from the start year to here." />
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
              Current is <b>{Math.round(sanCurEff * 100)}%</b> (auto-calculated from your budget data) — improving it toward the target spends more of the allocated budget on new service.
            </div>
          </InterventionToggle>

          <InterventionToggle label="Capex efficiency (unit cost)" checked={inputs.toggles?.san_costeff_enabled ?? false} onChange={v => toggleIntv('san_costeff_enabled', v)} onFocus={() => onSectionFocus?.('san_capex_eff')}>
            <F label="Improvement start year" value={inputs.sanitation_interventions.costeff_start_year} onChange={v => u('sanitation_interventions','costeff_start_year',v)} tip="Year the capex-efficiency programme begins. At this year the service cost still equals BAU; the discount then grows toward the improvement level." />
            <F label="Target year" value={inputs.sanitation_interventions.costeff_target_year} onChange={v => u('sanitation_interventions','costeff_target_year',v)} tip="Year the full improvement is reached; the discount ramps linearly from the start year to here, then holds." />
            <F label="Capex efficiency improvement" value={inputs.sanitation_interventions.costeff_target_pct} onChange={v => u('sanitation_interventions','costeff_target_pct',v)} isPercent unit="%" tip="How much cheaper each new safely-managed service becomes by the target year — e.g. 20% means a 20% discount on the service capex. The discount ramps from 0 at the start year to this level, then holds. Cheaper service lets the same budget serve more households." />
            <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
              Discounts the safely-managed service cost, ramping up from 0 at the start year to <b>{Math.max(0, Math.round((inputs.sanitation_interventions.costeff_target_pct||0)*1000)/10)}%</b> by the target year.
            </div>
          </InterventionToggle>

          <InterventionToggle label="Optimised technology selection" checked={inputs.toggles?.san_techmix_enabled ?? false} onChange={v => toggleIntv('san_techmix_enabled', v)} onFocus={() => onSectionFocus?.('san_techmix')}>
            <TechMixEditor inputs={inputs} onChange={onChange} section="sanitation_interventions" CUR={CUR} />
          </InterventionToggle>

          <InterventionToggle label="NRW-linked sanitation revenue" checked={inputs.toggles?.san_nrw_link_enabled ?? false} onChange={v => toggleIntv('san_nrw_link_enabled', v)} onFocus={() => onSectionFocus?.('san_nrw_link')}>
            {(() => {
              const vols: number[] = results?.water_supply?.scenario_nrw_recovered_phys_vol || [];
              const yrs: number[] = results?.years || [];
              const nrwOn = !!inputs.toggles?.ws_nrw_enabled;
              const endVol = vols.length ? +vols[vols.length - 1] : 0;
              const endYr = yrs.length ? yrs[yrs.length - 1] : 'the end year';
              const iv = inputs.sanitation_interventions || {};
              const ret = +iv.nrw_link_return_ratio || 0, charge = +iv.nrw_link_sewer_charge || 0, coll = +iv.nrw_link_collection_rate || 0;
              const endRev = endVol * ret * charge * coll;   // LC millions/yr at the end year
              return (<>
                <div style={{ gridColumn: '1 / -1', fontSize: 11, lineHeight: 1.5, borderRadius: 6, padding: '7px 10px',
                  background: nrwOn ? '#ecfeff' : '#fef3c7', border: `1px solid ${nrwOn ? '#a5f3fc' : '#fde68a'}`, color: nrwOn ? '#155e75' : '#92400e' }}>
                  {nrwOn
                    ? <>Linked to <b>Water Supply → NRW reduction</b>. That lever recovers <b>{endVol.toFixed(2)} M m³/yr</b> of physical water by {endYr}; the share returning to the sewer is charged for and the revenue funds new safely-managed sanitation service.</>
                    : <>Warning: This lever needs <b>NRW reduction</b> switched on under the <b>Water Supply</b> interventions — that is what recovers the water. While it is off there is no recovered volume, so this lever has no effect.</>}
                </div>
                <F label="Wastewater return ratio" value={iv.nrw_link_return_ratio} onChange={v => u('sanitation_interventions','nrw_link_return_ratio',v)} isPercent unit="%" tip="Share of the recovered water that returns to the sewer as wastewater the utility can charge for (the rest is consumptive use or not sewer-connected)." />
                <F label="Sewer charge" value={iv.nrw_link_sewer_charge} onChange={v => u('sanitation_interventions','nrw_link_sewer_charge',v)} step={0.5} unit={`${CUR}/m³`} tip="Sanitation charge per cubic metre of returned wastewater — the revenue earned on it. (Separate from the water tariff the water utility earns.)" />
                <F label="Collection rate" value={iv.nrw_link_collection_rate} onChange={v => u('sanitation_interventions','nrw_link_collection_rate',v)} isPercent unit="%" tip="Share of that billed sanitation revenue actually collected." />
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#334155', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 4, padding: '5px 9px' }}>
                  Collected sanitation revenue at {endYr}: <b>{endVol.toFixed(2)}</b> M m³ × {Math.round(ret * 100)}% × {charge.toLocaleString()} {CUR} × {Math.round(coll * 100)}% ≈ <b>{Math.round(endRev).toLocaleString()} {CUR} mn/yr</b>, spent on new safely-managed sanitation service.
                </div>
              </>);
            })()}
          </InterventionToggle>

          <InterventionToggle label="Tariff reform" checked={inputs.toggles?.san_tariff_enabled ?? false} onChange={v => toggleIntv('san_tariff_enabled', v)} onFocus={() => onSectionFocus?.('san_tariff')}>
            <F label="Improvement start year" value={inputs.sanitation_interventions.tariff_start_year} onChange={v => u('sanitation_interventions','tariff_start_year',v)} tip="Year the sewer tariff starts rising" />
            <F label="Target year" value={inputs.sanitation_interventions.tariff_target_year} onChange={v => u('sanitation_interventions','tariff_target_year',v)} tip="Year the target sewer tariff is reached; it rises linearly from the start year to here, then holds." />
            <RevenueBaseEditor inputs={inputs} onChange={onChange} sector="sanitation" />
            <F label="Target sewer tariff" value={inputs.sanitation_interventions.tariff_target} onChange={v => u('sanitation_interventions','tariff_target',v)} step={0.5} unit={`${CUR}/m3`} tip={`Additional cash = billed volume × tariff rise × applicable collection ratio. ${REVENUE_ATTRIBUTION}`} />
          </InterventionToggle>

          <InterventionToggle label="Microfinance" checked={inputs.toggles?.san_microfinance_enabled ?? false} onChange={v => toggleIntv('san_microfinance_enabled', v)} onFocus={() => onSectionFocus?.('san_microfinance')}>
            {microfinanceFields('sanitation_interventions')}
          </InterventionToggle>
          </InterventionCategories>
        </>}

        {(() => {
          const period = inputs.period || {};
          const fallback = {
            enabled: false, allocation_share: 0, annual_real_interest_rate: null,
            disbursement_year: (period.baseline_year || 2025) + 1,
            principal_grace_years: 0, maturity_year: period.forecast_end_year || 2040,
            repayment_structure: 'annuity', loan_ceiling: null,
          };
          const debt = inputs.utility_debt?.[sectorTab] || fallback;
          const debtSourceOptions = [
            ['collection', 'Collection efficiency'],
            ['tariff', 'Tariff reforms'],
            ['nrw', 'NRW reductions'],
          ] as const;
          const selectedDebtSources: string[] = Array.isArray(debt.revenue_sources)
            ? debt.revenue_sources.filter((source: string) => debtSourceOptions.some(([key]) => key === source))
            : debtSourceOptions.map(([key]) => key);
          const updateDebt = (key: string, value: any) => onChange({
            ...inputs,
            utility_debt: {
              ...(inputs.utility_debt || {}),
              [sectorTab]: { ...debt, [key]: value },
            },
          });
          const firstPrincipalYear = Number(debt.disbursement_year || fallback.disbursement_year)
            + Number(debt.principal_grace_years || 0) + 1;
          return (
            <section style={{ marginTop: 12, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', margin: '0 0 4px' }}>Utility debt financing</h3>
                  <div style={{ fontSize: 11, lineHeight: 1.45, color: '#64748b' }}>
                    The utility borrows for {sectorTab === 'water' ? 'water' : 'sanitation'} infrastructure. Select which incremental net cash streams may support debt service; loan proceeds cannot repay the loan.
                  </div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0, fontSize: 12, fontWeight: 600, color: '#334155' }}>
                  <input type="checkbox" checked={!!debt.enabled} onChange={e => updateDebt('enabled', e.target.checked)} />
                  Enable
                </label>
              </div>
              <div style={{ marginTop: 10, border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 9px', background: '#fbfcfd' }}>
                <div style={{ fontSize: 11, fontWeight: 650, color: '#334155', marginBottom: 6 }}>Eligible revenue sources</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }}>
                  {debtSourceOptions.map(([key, label]) => (
                    <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#475569', cursor: 'pointer' }}>
                      <input type="checkbox" aria-label={`Debt source: ${label}`} checked={selectedDebtSources.includes(key)}
                        onChange={event => {
                          const next = event.target.checked
                            ? [...selectedDebtSources, key]
                            : selectedDebtSources.filter(source => source !== key);
                          updateDebt('revenue_sources', next);
                        }}
                        style={{ width: 15, height: 15, accentColor: '#2563eb' }} />
                      {label}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 10, lineHeight: 1.4, color: '#718096', marginTop: 5 }}>
                  Choices are independent and do not switch on interventions. New connections are not eligible. Leaving this unset preserves all three sources for older saved scenarios.
                </div>
              </div>
              {debt.enabled && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
                <F label="Eligible-revenue allocation" value={debt.allocation_share ?? 0} onChange={v => updateDebt('allocation_share', v)} isPercent unit="%" tip="Share of positive eligible additional revenue, capped by available capital after replacement, that may support annual utility debt service." />
                <F label="Annual real interest rate" value={debt.annual_real_interest_rate ?? undefined} onChange={v => updateDebt('annual_real_interest_rate', v)} isPercent unit="%" placeholder="Required" tip="Fixed annual interest rate in real terms. Enter the assumption used to size and schedule this loan." />
                <F label="Disbursement year" value={debt.disbursement_year ?? fallback.disbursement_year} onChange={v => updateDebt('disbursement_year', v)} step={1} tip="One-time disbursement in a forecast year no later than the simulation end." />
                <F label="Principal grace period" value={debt.principal_grace_years ?? 0} onChange={v => updateDebt('principal_grace_years', v)} step={1} unit="years" tip="Interest remains due during grace. Principal payments begin after the grace period." />
                <F label="Final principal-payment year" value={debt.maturity_year ?? fallback.maturity_year} onChange={v => updateDebt('maturity_year', v)} step={1} tip="The last principal payment may fall after the simulation end; all such payments are included in loan sizing." />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500, minHeight: 32 }}>Repayment structure</label>
                  <select value={debt.repayment_structure || 'annuity'} onChange={e => updateDebt('repayment_structure', e.target.value)}
                    style={{ width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452', boxSizing: 'border-box', fontFamily: 'inherit' }}>
                    <option value="annuity">Annuity</option>
                    <option value="equal_principal">Equal principal</option>
                  </select>
                </div>
                <F label="Optional maximum principal" value={debt.loan_ceiling ?? undefined} onChange={v => updateDebt('loan_ceiling', v)} step={100} unit={`${CUR} millions`} placeholder="No ceiling" tip="Optional cap on the single loan principal. Leave blank to size only from verified annual debt-service capacity." />
                <div style={{ gridColumn: '1 / -1', fontSize: 11, lineHeight: 1.45, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 5, padding: '7px 9px' }}>
                  First principal payment: <b>{firstPrincipalYear}</b>. Grace-period interest is still payable. Unspent proceeds remain restricted to sector investment and are not treated as revenue.
                </div>
              </div>}
              <UtilityDebtPreview debt={debt} result={results?.[sectorTab === 'water' ? 'water_supply' : 'sanitation']?.scenario_utility_debt}
                currency={CUR} currencyDisplay={currencyDisplay} calculationError={calculationError} fresh={debtResultsFresh} />
            </section>
          );
        })()}

        {/* ===== CUSTOM INTERVENTIONS (always visible, no dropdown) ===== */}
        <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, background: '#fff', padding: '12px 14px' }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#1e3a5f', margin: '0 0 8px' }}>Custom Interventions</h3>
          <div onClick={() => onSectionFocus?.('custom_interventions')}>
            <div style={{ fontSize: 11, color: '#155e75', background: '#ecfeff', border: '1px solid #a5f3fc', padding: '6px 8px', borderRadius: 4, marginBottom: 8, lineHeight: 1.5 }}>
              You can add interventions not covered above as custom interventions. Two types are supported: <b>New revenue source</b> — invest to produce an output whose net value funds new safely-managed service — and <b>Cost reduction</b> — lower the per-household service cost. Pick each one's sector and tick its box to switch it on.
            </div>
            {(inputs.custom_interventions || []).map((ci: any, idx: number) => {
              const updateCI = (field: string, val: any) => {
                const arr = [...inputs.custom_interventions];
                arr[idx] = { ...arr[idx], [field]: val };
                onChange({ ...inputs, custom_interventions: arr });
              };
              return (
                <div key={idx} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', marginBottom: 8, background: '#faf5ff' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <input type="checkbox" checked={ci.enabled !== false} onChange={e => updateCI('enabled', e.target.checked)}
                      title="Switch this custom intervention on/off" style={{ width: 16, height: 16, accentColor: '#2563eb', cursor: 'pointer' }} />
                    <input type="color" value={ci.color || '#ae4f0e'} onChange={e => updateCI('color', e.target.value)}
                      style={{ width: 20, height: 20, border: 'none', cursor: 'pointer', borderRadius: 3 }} />
                    <input type="text" value={ci.name} onChange={e => updateCI('name', e.target.value)}
                      style={{ flex: 1, border: '1px solid #ccc', borderRadius: 3, padding: '3px 6px', fontSize: 12, fontWeight: 600 }} />
                    <button onClick={() => {
                      const arr = inputs.custom_interventions.filter((_: any, i: number) => i !== idx);
                      onChange({ ...inputs, custom_interventions: arr });
                    }} style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>✕</button>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: '#64748b' }}>Sector ▾</label>
                      <select value={ci.sector} onChange={e => updateCI('sector', e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: 11, background: '#fff', cursor: 'pointer' }}>
                        <option value="water">Water Supply</option>
                        <option value="sanitation">Sanitation</option>
                        <option value="both">Both</option>
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <label style={{ fontSize: 10, color: '#64748b' }}>Type ▾</label>
                      <select value={ci.intervention_type} onChange={e => updateCI('intervention_type', e.target.value)}
                        style={{ width: '100%', padding: '4px 6px', border: '1px solid #94a3b8', borderRadius: 3, fontSize: 11, background: '#fff', cursor: 'pointer' }}>
                        <option value="new_revenue">New revenue source</option>
                        <option value="cost_reduction">Cost reduction</option>
                      </select>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '10px 14px', alignItems: 'start' }}>
                    {ci.intervention_type === 'cost_reduction' ? (<>
                      <F label="Start year" value={ci.start_year} onChange={v => updateCI('start_year', v)} tip="Year the cost reduction takes effect; the lower cost is held from then on." />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Outputs affected</label>
                        <select value={ci.outputs_affected || 'sm'} onChange={e => updateCI('outputs_affected', e.target.value)} style={{ ...miniInput, cursor: 'pointer' }}>
                          <option value="sm">Safely-managed service</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Cost effect type</label>
                        <select value={ci.cost_effect_mode || 'pct'} onChange={e => updateCI('cost_effect_mode', e.target.value)} style={{ ...miniInput, cursor: 'pointer' }}>
                          <option value="pct">Percentage off</option>
                          <option value="flat">Flat amount off</option>
                        </select>
                      </div>
                      {(ci.cost_effect_mode || 'pct') === 'pct'
                        ? <F label="Cost effect" value={ci.cost_effect} onChange={v => updateCI('cost_effect', v)} isPercent unit="%" tip="Percentage cut in the safely-managed service cost per household, from the start year." />
                        : <F label="Cost effect" value={ci.cost_effect} onChange={v => updateCI('cost_effect', v)} step={1000} unit={CUR} tip="Flat amount taken off the safely-managed service cost per household, from the start year." />}
                      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
                        Cuts the per-household safely-managed service cost from {ci.start_year || 'the start year'} — the same budget then provides more service and the financing gap shrinks.
                      </div>
                    </>) : (<>
                      <F label="Start time" value={ci.start_year} onChange={v => updateCI('start_year', v)} tip="Year the intervention begins — when the implementation cost starts." />
                      <F label="Cost to implement" value={ci.implement_cost} onChange={v => updateCI('implement_cost', v)} step={100000} unit={CUR} tip="Total cost to implement, in local currency. Spread evenly over the 'Years cost occurs' below, starting at the start time." />
                      <F label="Years cost occurs" value={ci.cost_years} onChange={v => updateCI('cost_years', v)} unit="yrs" tip="Number of years the implementation cost is spread over, from the start time." />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Unit of output</label>
                        <input type="text" value={ci.output_unit || ''} onChange={e => updateCI('output_unit', e.target.value)} placeholder="e.g. m³, kWh, tonnes" style={{ ...miniInput }} />
                      </div>
                      <F label="When output happens" value={ci.output_start_year} onChange={v => updateCI('output_start_year', v)} tip="Year output (and its revenue) starts, continuing through the forecast end." />
                      <F label={`Output quantity (per yr)`} value={ci.output_quantity} onChange={v => updateCI('output_quantity', v)} step={1000} unit={ci.output_unit || 'units'} tip="Output produced each year, in the unit above." />
                      <F label="Output value" value={ci.output_value} onChange={v => updateCI('output_value', v)} step={1} unit={`${CUR}/${ci.output_unit || 'unit'}`} tip="Value per unit of output. Quantity × value = annual revenue; the net (revenue − implementation cost) funds new safely-managed service." />
                      <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
                        Net cash each year = output quantity × value (from {ci.output_start_year || 'the output year'}) − cost spread over {ci.cost_years || 0} yr{(ci.cost_years === 1) ? '' : 's'} → folded into {ci.sector === 'both' ? "each sector's" : ci.sector} capex for new service.
                      </div>
                    </>)}
                  </div>
                </div>
              );
            })}
            <button onClick={() => {
              const existing = inputs.custom_interventions || [];
              // Custom bands stack alongside the built-in intervention bands, so these presets are
              // chosen to stay distinct from the built-in palette (see chartColors INTV_PALETTE) and
              // from each other, and to avoid the reserved blue (BAU) / green (target) — the old set
              // had a lime-green and a cyan that clashed. Users can still fine-tune via the picker.
              const colors = ['#9e17bf','#fb46a2','#c11632','#b6157d','#f23dd3'];
              onChange({ ...inputs, custom_interventions: [...existing, {
                name: 'New revenue source', enabled: true, sector: sectorTab, intervention_type: 'new_revenue',
                start_year: 2028, end_year: 2040,
                implement_cost: 0, cost_years: 3, output_unit: 'm³', output_start_year: 2028, output_quantity: 0, output_value: 0,
                outputs_affected: 'sm', cost_effect_mode: 'pct', cost_effect: 0.1,
                color: colors[existing.length % colors.length],
              }] });
            }} style={{ width: '100%', padding: '8px', border: '1px dashed #9333ea', borderRadius: 6, background: 'none', cursor: 'pointer', fontSize: 12, color: '#9333ea', fontWeight: 500 }}>
              + Add Custom Intervention
            </button>
          </div>
        </div>
      </div>

      {/* Right: LIVE intervention impact chart (two-pass BAU vs intervention) for the area being edited. */}
      <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 28px', background: '#fff', borderLeft: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={CUR}
            onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency: CUR })}
            onEditRate={onEditCurrencyRate} />
          {/* Excel / CSV only — the slide deck belongs to the finished scenario, so it lives on Results. */}
          <ContributionViewToggle value={contributionView} onChange={onContributionViewChange} />
          <ExportButtons inputs={inputs} pptx={false} contributionView={contributionView} currencyDisplay={currencyDisplay} />
        </div>
        <LiveInterventionChart inputs={inputs} sector={sectorTab} scopeLabel={scopeLabel} rung={0} contributionView={contributionView} currencyDisplay={currencyDisplay} />
        <div style={{ height: 18 }} />
        <LiveInterventionChart inputs={inputs} sector={sectorTab} scopeLabel={scopeLabel} rung={1} contributionView={contributionView} currencyDisplay={currencyDisplay} />
      </div>
    </div>
  );
}
