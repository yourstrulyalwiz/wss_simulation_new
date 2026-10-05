import React, { useMemo, useState } from 'react';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';

const SOURCE_LABELS: Record<string, string> = {
  collection: 'Collection efficiency',
  tariff: 'Tariff reforms',
  nrw: 'NRW reductions',
};

type Props = {
  debt: any;
  result?: any;
  currency: string;
  currencyDisplay: CurrencyDisplaySettings;
  calculationError?: string;
  fresh?: boolean;
};

function amount(value: any, currency: string, settings: CurrencyDisplaySettings) {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  const converted = convertMoney(numeric, settings, currency);
  return `${Number(converted || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${displayCurrency(settings, currency)} mn`;
}

export default function UtilityDebtPreview({ debt, result, currency, currencyDisplay, calculationError = '', fresh = true }: Props) {
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
  const current = rows.find(row => Number(row.year) === year);
  const enabled = !!debt?.enabled;
  const sourceKeys: string[] = Array.isArray(debt?.revenue_sources)
    ? debt.revenue_sources.filter((key: string) => key in SOURCE_LABELS)
    : Object.keys(SOURCE_LABELS);
  const sourcesMatch = !Array.isArray(result?.revenue_sources) ||
    JSON.stringify([...result.revenue_sources].filter((key: string) => key in SOURCE_LABELS).sort()) === JSON.stringify([...sourceKeys].sort());
  const ready = enabled && !!result && !calculationError && fresh && sourcesMatch;
  const principal = ready ? Number(result?.accepted_principal ?? 0) : null;
  const selectedSum = current?.eligible_additional_revenue;
  const capacity = current?.annual_service_capacity;
  const selectedGrossRows = current ? [
    [`Collection net cash${sourceKeys.includes('collection') ? ' · selected' : ' · not selected'}`, current.collection_net_cash],
    [`Tariff net cash${sourceKeys.includes('tariff') ? ' · selected' : ' · not selected'}`, current.tariff_net_cash],
    [`NRW net cash${sourceKeys.includes('nrw') ? ' · selected' : ' · not selected'}`, current.nrw_net_cash],
  ] : [];
  const stateText = calculationError
    ? `Unavailable — ${calculationError}`
    : !enabled ? 'Enable financing to calculate a debt estimate.'
      : !fresh ? 'Updating estimate…'
      : !result ? 'Updating estimate…'
        : !sourcesMatch ? 'Updating estimate for selected sources…' : 'No annual detail is available for this scenario.';

  return (
    <div data-testid="utility-debt-preview" style={{ gridColumn: '1 / -1', border: '1px solid #dbe4ec', borderRadius: 6, background: '#f7fafc', padding: '10px 11px', marginTop: 2 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        {[
      ['Additional annual net revenue', ready && current ? amount(selectedSum, currency, currencyDisplay) : '—'],
      ['Annual service capacity', ready && current ? amount(capacity, currency, currencyDisplay) : '—'],
      ['Supportable borrowing', ready && result?.accepted_principal != null ? amount(principal, currency, currencyDisplay) : '—'],
        ].map(([label, value]) => (
          <div key={label} data-debt-metric={label} style={{ minWidth: 0 }}>
            <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.3 }}>{label}</div>
            <div style={{ fontSize: 12, color: '#1e3a5f', fontWeight: 700, marginTop: 3, overflowWrap: 'anywhere' }}>{value}</div>
          </div>
        ))}
      </div>
      {ready && <div style={{ marginTop: 7, fontSize: 10.5, color: '#475569' }}>
        {result.status === 'verified feasible'
          ? 'Repayments checked against capacity through final maturity.'
          : result.status === 'zero allocation share'
            ? 'No borrowing: allocation is 0%.'
            : result.status === 'no positive capacity'
              ? 'No borrowing: at least one required payment year has no capacity, or the loan ceiling is zero. Check revenue timing and loan dates.'
              : result.status === 'no verified feasible loan'
                ? 'No borrowing: a feasible repayment schedule could not be verified.'
                : result.status}
      </div>}
      {ready && rows.length > 0 ? <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 9, marginBottom: 5 }}>
          <span style={{ fontSize: 10.5, color: '#475569', fontWeight: 650 }}>Annual detail · {currencyDisplay.mode === 'usd' ? displayCurrency(currencyDisplay, currency) : currency} millions</span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10.5, color: '#475569' }}>
            Year
            <select aria-label="Utility debt detail year" value={year ?? ''} onChange={event => setSelectedYear(Number(event.target.value))}
              style={{ border: '1px solid #cbd5e1', background: '#fff', borderRadius: 4, padding: '3px 5px', color: '#334155', fontSize: 11 }}>
              {rows.map(row => <option key={row.year} value={row.year}>{row.year}</option>)}
            </select>
          </label>
        </div>
        {current && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '4px 12px', fontSize: 10.5, color: '#475569' }}>
          {selectedGrossRows.map(([label, value]) => <React.Fragment key={label}>
            <span>{label}</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(value, currency, currencyDisplay)}</b>
          </React.Fragment>)}
          <span>Selected eligible pool</span><b style={{ textAlign: 'right', fontWeight: 650 }}>{amount(current.eligible_additional_revenue, currency, currencyDisplay)}</b>
          <span>Protected eligible amount</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.protected_eligible_revenue, currency, currencyDisplay)}</b>
          <span>Available capital before debt</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.pre_debt_available_capital, currency, currencyDisplay)}</b>
          <span>Replacement requirement</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.replacement_requirement, currency, currencyDisplay)}</b>
          <span>NRW sales cash before works costs</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.nrw_sales_cash, currency, currencyDisplay)}</b>
          <span>NRW implementation costs</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.nrw_implementation_cost, currency, currencyDisplay)}</b>
          <span>Annual service capacity</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.annual_service_capacity, currency, currencyDisplay)}</b>
          {current.principal_payment != null && <>
            <span>Scheduled principal</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.principal_payment, currency, currencyDisplay)}</b>
          </>}
          {current.interest_payment != null && <>
            <span>Scheduled interest</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.interest_payment, currency, currencyDisplay)}</b>
          </>}
          {current.repayment_headroom != null && <>
            <span>Repayment headroom</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{amount(current.repayment_headroom, currency, currencyDisplay)}</b>
          </>}
          {current.post_target != null && <>
             <span>Period</span><b style={{ textAlign: 'right', fontWeight: 600 }}>{current.post_target ? 'Post-target repayment assumption' : 'Simulation year'}</b>
          </>}
        </div>}
      </> : <div style={{ marginTop: 7, fontSize: 10.5, color: calculationError ? '#9f3027' : '#64748b' }}>{stateText}</div>}
      <div style={{ marginTop: 8, borderTop: '1px solid #e2e8f0', paddingTop: 7, fontSize: 10, lineHeight: 1.45, color: '#64748b' }}>
        Inactive or unavailable interventions contribute zero. The source lines report actual net cash whether selected or not; the selected pool is their signed selected sum. The allocation limits annual principal plus interest payments; it is not an extra deduction from investment cash. Supportable borrowing is a loan principal, not a sum of annual revenues.
      </div>
      <div style={{ marginTop: 5, fontSize: 10, lineHeight: 1.45, color: '#64748b' }}>
        Baseline funding is assumed net of existing operating obligations and debt. Incremental collection and tariff operating/admin costs are not independently modeled; NRW includes modeled implementation costs. These are modeled cash estimates, not audited operating surplus.
      </div>
      {ready && result?.net_revenue_assumption && <div style={{ fontSize: 10, lineHeight: 1.4, color: '#64748b', marginTop: 4 }}>{result.net_revenue_assumption}</div>}
      {ready && result?.tail_capacity_assumption && <div style={{ fontSize: 10, lineHeight: 1.4, color: '#64748b', marginTop: 4 }}>Post-target capacity: {result.tail_capacity_assumption}</div>}
    </div>
  );
}
