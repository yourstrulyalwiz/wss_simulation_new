import React from 'react';
import TableExport from './TableExport';

const COLUMNS: { key: string; label: string; nominal?: boolean }[] = [
  { key: 'drawdowns', label: 'Drawdowns' },
  { key: 'opening_debt', label: 'Opening debt' },
  { key: 'closing_debt', label: 'Closing debt' },
  { key: 'interest', label: 'Interest' },
  { key: 'principal', label: 'Principal repaid' },
  { key: 'debt_service', label: 'Scheduled debt service' },
  { key: 'debt_service_paid', label: 'Debt service paid' },
  { key: 'cash_committed_to_debt', label: 'Cash committed to debt' },
  { key: 'cash_allocated_to_direct_investment', label: 'Cash to direct investment' },
  { key: 'retained_cash_reserve', label: 'Retained cash reserve' },
  { key: 'reserve_used', label: 'Reserve used' },
  { key: 'reserve_release', label: 'Reserve released' },
  { key: 'debt_service_shortfall', label: 'Debt-service shortfall' },
  { key: 'eligible_net_cash', label: 'Eligible net cash' },
  { key: 'existing_debt_service_paid', label: 'Existing debt service paid' },
  { key: 'nominal_debt_service', label: 'Nominal debt service', nominal: true },
  { key: 'nominal_closing_debt', label: 'Nominal closing debt', nominal: true },
];

type Pool = {
  entity_name?: string;
  sector?: string;
  area?: string;
  eligible_streams?: string[];
  baseline_obligations_known?: boolean;
  capacity_label?: string;
  rate_basis?: string;
  loan_principal?: number;
  is_fixed_contract?: boolean;
  automatic_capacity?: number | string;
  loan_end_year?: number;
  projection_end_year?: number;
  outstanding_at_projection_end?: number;
  post_horizon_assumption?: string;
  reserve_policy?: string;
  schedule?: Record<string, any[]>;
  _areaLabel?: string;
};

const format = (value: any, digits = 3) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('en-US', { maximumFractionDigits: digits }) : '—';
};
const normalizeSector = (sector: any) => String(sector || '').toLowerCase().replace(/[_\s-]+/g, '');
const selectedForSector = (pool: Pool, sector: 'water' | 'sanitation') => {
  const value = normalizeSector(pool.sector);
  return sector === 'water' ? value.includes('water') : value.includes('sanitation') || value === 'san';
};
const streamName = (s: string) => ({
  collection: 'Collection efficiency',
  nrw: 'NRW recovery',
  tariff: 'Tariff reform',
  custom: 'Custom interventions',
  nrw_link: 'NRW-linked revenue',
}[s] || s);

export default function BorrowingPoolsTable({ pools, sector, currency, scope }: {
  pools: Pool[] | null; sector: 'water' | 'sanitation'; currency: string; scope: string;
}) {
  if (pools === null) return (
    <div style={{ margin: '10px 0 16px', padding: '8px 10px', background: '#f8fafc', border: '1px solid #dbe3ec', borderRadius: 5, color: '#64748b', fontSize: 10.5 }}>
      Loading area-specific borrowing pool schedules…
    </div>
  );
  const selected = pools.filter(pool => selectedForSector(pool, sector));
  if (!selected.length) return (
    <div style={{ margin: '10px 0 16px', padding: '8px 10px', background: '#f8fbff', border: '1px solid #dbeafe', borderRadius: 5, color: '#475569', fontSize: 10.5 }}>
      No borrowing-pool schedule was returned for this sector. If borrowing is enabled, the calculation response should include its pool metadata, including when principal is zero.
    </div>
  );

  return (
    <section aria-label={`${sector} borrowing pool schedules`} style={{ margin: '10px 0 16px' }}>
      <h4 style={{ fontSize: 13, margin: '0 0 4px', color: '#1e3a5f' }}>Borrowing pools · {sector === 'water' ? 'Water Supply' : 'Sanitation'}</h4>
      <p style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.5, margin: '0 0 8px' }}>
        Each area/sector pool is shown separately; records are never added together as one loan, even when names match. Schedule amounts are real {currency} millions unless explicitly marked nominal. The schedule extends through loan maturity; contractual payments do not fall when cash is short.
      </p>
      {selected.map((pool, index) => {
        const schedule = pool.schedule || {};
        const years = Array.isArray(schedule.years) ? schedule.years : [];
        const rawRows = years.map((year, i) => [
          year,
          ...COLUMNS.map(column => (schedule[column.key] || [])[i] ?? 0),
        ]);
        const shownRows = rawRows.map(row => row.map((value, i) => i === 0 ? value : format(value)));
        const poolName = pool.entity_name?.trim() || `${pool.area || pool._areaLabel || scope} / ${sector}`;
        const suffix = `${pool._areaLabel || pool.area || scope}_${sector}_${poolName}_${index+1}`.replace(/[^a-zA-Z0-9_-]+/g, '_');
        const capacityText = pool.capacity_label || (pool.baseline_obligations_known
          ? 'Incremental capacity against reported obligations'
          : 'Conditional incremental estimate; baseline obligations assumed covered');
        return (
          <details key={`${pool.area || pool._areaLabel || ''}-${pool.sector}-${pool.entity_name}-${index}`}
            open={selected.length === 1}
            style={{ margin: '7px 0', border: '1px solid #dbe3ec', borderRadius: 6, background: '#fff' }}>
            <summary style={{ cursor: 'pointer', padding: '8px 10px', background: '#f1f8fb', color: '#1e3a5f', fontSize: 11.5, fontWeight: 700 }}>
              {poolName} <span style={{ fontWeight: 500, color: '#64748b' }}>· {pool.area || pool._areaLabel || scope} · principal {format(pool.loan_principal)} {currency} mn</span>
            </summary>
            <div style={{ padding: '9px 10px 11px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(165px, 1fr))', gap: '5px 12px', padding: '7px 8px', background: '#f8fbff', border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 10.5, color: '#334155' }}>
                <div><b>Entity / pool:</b> {poolName}</div>
                <div><b>Sector:</b> {pool.sector || (sector === 'water' ? 'Water Supply' : 'Sanitation')}</div>
                <div><b>Eligible streams:</b> {Array.isArray(pool.eligible_streams) && pool.eligible_streams.length ? pool.eligible_streams.map(streamName).join(', ') : 'None selected'}</div>
                <div><b>Baseline obligations known:</b> {pool.baseline_obligations_known ? 'Yes' : 'No'}</div>
                <div><b>Capacity basis:</b> {capacityText}</div>
                <div><b>Rate basis:</b> {pool.rate_basis || 'Not reported'}</div>
                <div><b>Principal mode:</b> {pool.is_fixed_contract ? 'Fixed contractual principal' : 'Automatically sized proposed loan'}</div>
                <div><b>Automatic capacity:</b> {typeof pool.automatic_capacity === 'number' ? `${format(pool.automatic_capacity)} ${currency} mn` : pool.automatic_capacity ?? 'Not reported'}</div>
                <div><b>Loan principal:</b> {format(pool.loan_principal)} {currency} mn</div>
                <div><b>Loan maturity:</b> {pool.loan_end_year ?? 'Not drawn'}</div>
                <div><b>Projection end:</b> {pool.projection_end_year ?? 'Not reported'}</div>
                <div><b>Outstanding at projection end:</b> {format(pool.outstanding_at_projection_end)} {currency} mn</div>
                <div><b>Post-horizon cash-flow assumption:</b> {pool.post_horizon_assumption || 'Not reported'}</div>
                <div><b>Reserve policy:</b> {pool.reserve_policy || 'Not reported'}</div>
              </div>
              <div style={{ fontSize: 10, color: '#64748b', lineHeight: 1.45, margin: '7px 0' }}>
                Reserves and any post-horizon release follow the backend reserve policy shown above; released reserves are visible separately from cash allocated to investment. Negative eligible cash remains in the direct-resource account.
              </div>
              {years.length ? <>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 4 }}>
                  <TableExport filename={`borrowing_schedule_${suffix}`} sheetName="Maturity schedule"
                    headers={['Year', ...COLUMNS.map(column => `${column.label} (${currency} mn${column.nominal ? ', nominal' : ', real'})`)]}
                    rows={rawRows} compact />
                </div>
                <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 5 }}>
                  <table style={{ borderCollapse: 'collapse', minWidth: Math.max(1380, years.length * 68), width: '100%', fontSize: 10 }}>
                    <thead>
                      <tr>{['Year', ...COLUMNS.map(column => `${column.label}${column.nominal ? ' · nominal' : ''}`)].map((heading, i) => (
                        <th key={heading} style={{ position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined, zIndex: i === 0 ? 1 : undefined, padding: '6px 7px', background: '#eaf2f8', color: '#1e3a5f', textAlign: i === 0 ? 'left' : 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #dbe3ec' }}>{heading}</th>
                      ))}</tr>
                    </thead>
                    <tbody>
                      {shownRows.map((row, ri) => (
                        <tr key={String(row[0])} style={{ background: ri % 2 ? '#f8fbfd' : '#fff' }}>
                          {row.map((value, ci) => <td key={ci} style={{ position: ci === 0 ? 'sticky' : undefined, left: ci === 0 ? 0 : undefined, padding: '5px 7px', textAlign: ci === 0 ? 'left' : 'right', whiteSpace: 'nowrap', color: ci === 0 ? '#1e3a5f' : '#475569', background: ci === 0 ? (ri % 2 ? '#f8fbfd' : '#fff') : undefined, borderBottom: '1px solid #eef2f7' }}>{value}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </> : <div style={{ padding: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, color: '#92400e', fontSize: 10.5 }}>Pool inputs are available, but the response contains no maturity schedule rows.</div>}
            </div>
          </details>
        );
      })}
    </section>
  );
}