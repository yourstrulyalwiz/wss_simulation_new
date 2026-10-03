import React from 'react';
import TableExport from './TableExport';

export type RungFinance = {
  bau: number; scenario: number; target: number;
  newBau: number; replacementBau: number; fundedBau: number; gapBau: number;
  newScenario: number; replacementScenario: number; fundedScenario: number; gapScenario: number;
};

export type FinanceYear = {
  year: number; total: number;
  bauAvailable: number; scenarioAvailable: number;
  scenarioNeed: number; implementationCapex: number;
  publicCapital: number; otherCapital: number; newFinancing: number;
  openingCash: number; closingCash: number; financingApplied: number; cashDeficit: number;
  cumulativeNeed: number; cumulativeShortfall: number;
  residualPublicBefore: number; additionalPublicCapital: number; residualPublicAfter: number;
  cumulativeResidualPublicBefore: number; cumulativeResidualPublicAfter: number;
  utilityCashDirect: number; utilityCashCommitted: number;
  loanDrawdown: number; loanDebtService: number; loanInterest: number; loanClosingDebt: number;
  loanDebtServiceShortfall: number;
  additionalNetOperatingCash: number | null;
  offBudgetLoans: number; offBudgetGrants: number;
  bauGap: number; scenarioGap: number;
  services: [RungFinance & { gapBauHH: number; gapScenarioHH: number }, RungFinance & { gapBauHH: number; gapScenarioHH: number }];  // Safely Managed, Basic (exclusive)
};

const round3 = (v: number) => Number(v.toPrecision(3));
const format = (v: number) => round3(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const billions = (v: number) => format(v / 1000);

type Column = { title: string; value: (r: FinanceYear) => number; unit: 'hh' | 'money' };

export default function ScenarioGapTables({ rows, sector, label, scope, currency }: {
  rows: FinanceYear[];
  sector: 'water' | 'sanitation';
  label: string;
  scope: string;
  currency: string;
}) {
  if (!rows.length) return null;
  const m = `${currency} M/yr`, b = `B ${currency}/yr`;
  // Show annual flows and the explicitly labelled closing debt balance.
  const summary: Column[] = [
    { title: `BAU gap (${b})`, value: r => r.bauGap, unit: 'money' },
    { title: `SM new-service need (${b})`, value: r => r.services[0].newScenario, unit: 'money' },
    { title: `SM replacement (${b})`, value: r => r.services[0].replacementScenario, unit: 'money' },
    { title: `Basic new-service need (${b})`, value: r => r.services[1].newScenario, unit: 'money' },
    { title: `Basic replacement (${b})`, value: r => r.services[1].replacementScenario, unit: 'money' },
    { title: `Implementation and programme costs (${b})`, value: r => r.implementationCapex, unit: 'money' },
    { title: `Scenario total investment need (${b})`, value: r => r.scenarioNeed, unit: 'money' },
    { title: `BAU sector capex available (${b})`, value: r => r.bauAvailable, unit: 'money' },
    { title: `Usable public capital (${b})`, value: r => r.publicCapital, unit: 'money' },
    { title: `Other eligible capital (${b})`, value: r => r.otherCapital, unit: 'money' },
    { title: `New financing received, excludes carry (${b})`, value: r => r.newFinancing, unit: 'money' },
    { title: `Opening carried investment cash (B ${currency})`, value: r => r.openingCash, unit: 'money' },
    { title: `Scenario total financing available (${b})`, value: r => r.scenarioAvailable, unit: 'money' },
    { title: `Utility cash reinvested (${b})`, value: r => r.utilityCashDirect, unit: 'money' },
    { title: `Utility cash committed to debt (${b})`, value: r => r.utilityCashCommitted, unit: 'money' },
    { title: `New loan proceeds (${b})`, value: r => r.loanDrawdown, unit: 'money' },
    { title: `New-loan debt service (${b})`, value: r => r.loanDebtService, unit: 'money' },
    { title: `New-loan debt-service shortfall (${b})`, value: r => r.loanDebtServiceShortfall, unit: 'money' },
    { title: `New-loan interest (${b})`, value: r => r.loanInterest, unit: 'money' },
    ...(rows.some(r => r.additionalNetOperatingCash !== null)
      ? [{ title: `Additional net operating cash (${b}; signed)`, value: (r: FinanceYear) => r.additionalNetOperatingCash ?? 0, unit: 'money' as const }]
      : []),
    { title: `Closing new-loan balance (B ${currency})`, value: r => r.loanClosingDebt, unit: 'money' },
    { title: `Financing applied to need (${b})`, value: r => r.financingApplied, unit: 'money' },
    { title: `Closing carried investment cash (B ${currency})`, value: r => r.closingCash, unit: 'money' },
    { title: `Unfunded net cash outflows (${b})`, value: r => r.cashDeficit, unit: 'money' },
    { title: `Off-budget microfinance loans (${b})`, value: r => r.offBudgetLoans, unit: 'money' },
    { title: `Off-budget grants spent (${b})`, value: r => r.offBudgetGrants, unit: 'money' },
    { title: `Residual public financing requirement before explicit contribution (${b})`, value: r => r.residualPublicBefore, unit: 'money' },
    { title: `Explicit additional public capital (${b})`, value: r => r.additionalPublicCapital, unit: 'money' },
    { title: `Residual public financing requirement after explicit contribution (${b})`, value: r => r.residualPublicAfter, unit: 'money' },
    { title: `Cumulative residual before explicit public capital (B ${currency})`, value: r => r.cumulativeResidualPublicBefore, unit: 'money' },
    { title: `Cumulative residual after explicit public capital (B ${currency})`, value: r => r.cumulativeResidualPublicAfter, unit: 'money' },
    { title: `SM remaining gap (${b})`, value: r => r.services[0].gapScenario, unit: 'money' },
    { title: `Basic remaining gap (${b})`, value: r => r.services[1].gapScenario, unit: 'money' },
    { title: `Total remaining gap (${b})`, value: r => r.scenarioGap, unit: 'money' },
    { title: `Cumulative programme requirement to year (B ${currency})`, value: r => r.cumulativeNeed, unit: 'money' },
    { title: `Cumulative annual shortfalls to year (B ${currency})`, value: r => r.cumulativeShortfall, unit: 'money' },
  ];
  const summaryHeaders = ['Year', ...summary.map(c => c.title)];
  const summaryExport = rows.map(r => [r.year, ...summary.map(c => Number((c.value(r) / 1000).toFixed(6)))]);
  const header: React.CSSProperties = { padding: '6px 10px', fontWeight: 700, whiteSpace: 'nowrap', textAlign: 'right',
    background: '#f1f5f9', color: '#334155' };
  const cell: React.CSSProperties = { padding: '5px 10px', textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #eef2f7' };
  const table = (headers: string[], values: (string | number)[][]) => (
    <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 11 }}>
        <thead><tr>{headers.map((h, i) => <th key={i} style={{ ...header, textAlign: i === 0 ? 'left' : 'right',
          position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined }}>{h}</th>)}</tr></thead>
        <tbody>{values.map((line, ri) => {
          const background = ri % 2 ? '#fafbfc' : '#fff';
          return <tr key={ri} style={{ background }}>
            {line.map((v, i) => <td key={i} style={{ ...cell, textAlign: i === 0 ? 'left' : 'right',
              position: i === 0 ? 'sticky' : undefined, left: i === 0 ? 0 : undefined,
              background: i === 0 ? background : undefined, color: i === 0 ? '#1e3a5f' : undefined }}>
              {v}</td>)}
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
  const rungTable = (rung: 0 | 1) => {
    const name = rung === 0 ? 'Safely Managed' : 'Basic';
    const prefix = rung === 0 ? 'Safely Managed' : 'Basic';
    const columns: Column[] = [
      // Keep the BAU forecast's original ten columns, in the same order.
      { title: 'Total households (M)', value: r => r.total, unit: 'hh' },
      { title: `${name} — BAU (M)`, value: r => r.services[rung].bau, unit: 'hh' },
      { title: `Target ${prefix} (M)`, value: r => r.services[rung].target, unit: 'hh' },
      { title: 'Service Gap (M HH)', value: r => r.services[rung].gapBauHH, unit: 'hh' },
      { title: `${prefix} new-service need (${m})`, value: r => r.services[rung].newBau, unit: 'money' },
      { title: `${prefix} replacement need (${m})`, value: r => r.services[rung].replacementBau, unit: 'money' },
      { title: `${prefix} attributed funding (${m})`, value: r => r.services[rung].fundedBau, unit: 'money' },
      { title: `${prefix} financing gap (${m})`, value: r => r.services[rung].gapBau, unit: 'money' },
      { title: `Sector-wide financing gap (${m})`, value: r => r.bauGap, unit: 'money' },
      // Scenario obligations and attributed funding are computed in the scenario
      // model pass, not inferred by subtracting money from the BAU gap.
      { title: `${prefix} with interventions (M)`, value: r => r.services[rung].scenario, unit: 'hh' },
      { title: 'Scenario service gap (M HH)', value: r => r.services[rung].gapScenarioHH, unit: 'hh' },
      { title: `${prefix} scenario new-service need (${m})`, value: r => r.services[rung].newScenario, unit: 'money' },
      { title: `${prefix} scenario replacement need (${m})`, value: r => r.services[rung].replacementScenario, unit: 'money' },
      { title: `${prefix} scenario attributed funding (${m})`, value: r => r.services[rung].fundedScenario, unit: 'money' },
      { title: `${prefix} remaining gap (${m})`, value: r => r.services[rung].gapScenario, unit: 'money' },
      { title: `Sector remaining gap (${m})`, value: r => r.scenarioGap, unit: 'money' },
    ];
    const headers = ['Year', ...columns.map(c => c.title)];
    const exportRows = rows.map(r => [r.year, ...columns.map(c => round3(c.value(r)))]);
    const shown = rows.map(r => [r.year, ...columns.map(c => c.unit === 'money' ? billions(c.value(r)) : format(c.value(r)))]);
    return <div key={rung} style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
        <b style={{ fontSize: 11.5, color: '#1e3a5f' }}>{name} — BAU vs interventions (per year)</b>
        <TableExport filename={`${scope}_${sector}_${rung === 0 ? 'safely_managed' : 'basic'}_results_forecast`}
          sheetName={`${name} forecast`} headers={headers} rows={exportRows} compact />
      </div>
      {table(headers.map(h => h.replace(`(${m})`, `(${b})`)), shown)}
    </div>;
  };
  const firstYear = rows[0].year;
  const lastYear = rows[rows.length - 1].year;
  const cut = Math.min(2030, lastYear);
  const periods = [
    { label: `${firstYear}–${cut}`, lo: firstYear, hi: cut },
    ...(lastYear > cut ? [{ label: `${cut + 1}–${lastYear}`, lo: cut + 1, hi: lastYear }] : []),
    { label: `Total ${firstYear}–${lastYear}`, lo: firstYear, hi: lastYear },
  ];
  const periodFields = [
    { label: `Residual before explicit public capital (B ${currency})`, value: (rs: FinanceYear[]) => rs.reduce((sum, r) => sum + r.residualPublicBefore, 0) },
    { label: `Explicit additional public capital (B ${currency})`, value: (rs: FinanceYear[]) => rs.reduce((sum, r) => sum + r.additionalPublicCapital, 0) },
    { label: `Residual after explicit public capital (B ${currency})`, value: (rs: FinanceYear[]) => rs.reduce((sum, r) => sum + r.residualPublicAfter, 0) },
    { label: `Period-end cumulative residual before (B ${currency})`, value: (rs: FinanceYear[]) => rs[rs.length - 1]?.cumulativeResidualPublicBefore || 0 },
    { label: `Period-end cumulative residual after (B ${currency})`, value: (rs: FinanceYear[]) => rs[rs.length - 1]?.cumulativeResidualPublicAfter || 0 },
  ];
  const periodHeaders = ['Period', ...periodFields.map(f => f.label)];
  const periodRows = periods.map(p => {
    const inPeriod = rows.filter(r => r.year >= p.lo && r.year <= p.hi);
    return [p.label, ...periodFields.map(f => billions(f.value(inPeriod)))];
  });
  const periodExportRows = periods.map(p => {
    const inPeriod = rows.filter(r => r.year >= p.lo && r.year <= p.hi);
    return [p.label, ...periodFields.map(f => Number((f.value(inPeriod) / 1000).toFixed(6)))];
  });

  // An annual reconciliation in the engine's native real currency millions. This is intentionally
  // a transparent readout of returned annual/cumulative arrays, not a frontend reconstruction of
  // financing accounting. It is useful alongside the wide per-year export table above.
  const reconciliationRows: { label: string; value: (r: FinanceYear) => number; signed?: boolean }[] = [
    { label: 'Annual programme requirement', value: r => r.scenarioNeed },
    { label: 'Implementation costs', value: r => r.implementationCapex },
    { label: 'Public capital source', value: r => r.publicCapital },
    { label: 'Other eligible capital source', value: r => r.otherCapital },
    { label: 'Direct utility-cash reinvestment', value: r => r.utilityCashDirect },
    { label: 'Borrowing proceeds', value: r => r.loanDrawdown },
    { label: 'New financing received (excludes opening carry)', value: r => r.newFinancing },
    { label: 'Opening carried investment cash', value: r => r.openingCash },
    { label: 'Financing applied to need', value: r => r.financingApplied },
    { label: 'Annual financing gap', value: r => r.scenarioGap },
    { label: 'Cumulative financing gaps to year', value: r => r.cumulativeShortfall },
    { label: 'Public residual before explicit contribution', value: r => r.residualPublicBefore },
    { label: 'Explicit additional public contribution', value: r => r.additionalPublicCapital },
    { label: 'Public residual after explicit contribution', value: r => r.residualPublicAfter },
    { label: 'New-loan debt service', value: r => r.loanDebtService },
    { label: 'New-loan debt-service shortfall', value: r => r.loanDebtServiceShortfall },
    { label: 'Closing new-loan outstanding balance', value: r => r.loanClosingDebt },
    { label: 'Unfunded net cash outflows / shortfall', value: r => r.cashDeficit },
  ];
  const hasSignedOperatingCash = rows.some(r => r.additionalNetOperatingCash !== null);
  if (hasSignedOperatingCash) reconciliationRows.splice(4, 0, {
    label: 'Additional net operating cash (signed; canonical engine output)',
    value: r => r.additionalNetOperatingCash ?? 0,
    signed: true,
  });
  const reconciliationHeaders = ['Annual reconciliation · real currency millions', ...rows.map(r => String(r.year))];
  const reconciliationExport = reconciliationRows.map(metric => [metric.label, ...rows.map(r => metric.value(r))]);

  return <div style={{ marginTop: 12, marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
      <b style={{ fontSize: 12, color: '#1e3a5f' }}>{label} — annual spending-gap composition · {scope}</b>
      <TableExport filename={`${scope}_${sector}_spending_gap_composition`} sheetName="Gap composition"
        headers={summaryHeaders} rows={summaryExport} compact />
    </div>
    <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.5, marginBottom: 7 }}>
      New-service and replacement needs are shown separately for both service levels, with programme costs
      included once in total need. Additional new financing compares current-year receipts with BAU capex;
      cost-saving interventions instead lower the need. Total financing includes public capital, directly reinvested utility
      cash, household microfinance and grants, loan proceeds, and opening carried cash, each counted once.
      Source breakdowns are components of total financing, not additional amounts to add again. Cash committed
       to debt is not also reinvested. Loan proceeds, debt service, interest, and the closing debt balance are
       itemized separately. Financing covers replacement first, then new service using the configured split,
       with unused allocations transferable. The two attributed remaining gaps add to the sector total. Marginal
       intervention changes are order-dependent and signed: positive values reduce the shortfall, negative values widen it.
      Money is shown in billions; detailed forecast downloads use millions, as in the BAU tables.
      Closing investment cash is unused available financing and becomes next year's opening cash without
      interest. It is a balance, not a new financing flow. Opening cash + new financing + unfunded net cash
      outflows = financing applied + closing cash. Cumulative requirements and shortfalls sum scheduled annual
      flows, never repeated cash balances or service backlogs. Later surpluses do not erase earlier shortfalls,
      and unmet requirements are not automatically rescheduled. The additional public requirement is an output:
      before/after residuals hold all other scenario financing (including loans and direct utility cash) fixed and
      reconcile with a separate zero-opening-carry calculation. Explicit public contributions are not assumed.
    </div>
    <div style={{ margin: '8px 0 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
        <b style={{ fontSize: 11.5, color: '#1e3a5f' }}>Annual financing reconciliation · real {currency} millions</b>
        <TableExport filename={`${scope}_${sector}_annual_financing_reconciliation`} sheetName="Annual reconciliation"
          headers={reconciliationHeaders} rows={reconciliationExport} compact />
      </div>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 5 }}>
        Forecast-year flows and balances are shown in real {currency} millions. Signed operating cash is preserved when the calculation returns its canonical array; cumulative shortfall is the engine's cumulative series.
      </div>
      <div style={{ overflowX: 'auto', border: '1px solid #e2e8f0', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: Math.max(720, rows.length * 82), fontSize: 10.5 }}>
          <thead><tr>{reconciliationHeaders.map((h, i) => <th key={h} style={{
            padding: '6px 8px', whiteSpace: 'nowrap', textAlign: i === 0 ? 'left' : 'right',
            background: '#f1f5f9', color: '#334155', position: i === 0 ? 'sticky' : undefined,
            left: i === 0 ? 0 : undefined, minWidth: i === 0 ? 260 : 76,
          }}>{h}</th>)}</tr></thead>
          <tbody>{reconciliationRows.map((metric, ri) => <tr key={metric.label} style={{ background: ri % 2 ? '#fafbfc' : '#fff' }}>
            <th scope="row" style={{ padding: '5px 8px', textAlign: 'left', whiteSpace: 'nowrap', color: '#1e3a5f',
              fontWeight: metric.label.includes('gap') || metric.label.includes('residual') ? 650 : 500,
              borderBottom: '1px solid #eef2f7', position: 'sticky', left: 0, background: ri % 2 ? '#fafbfc' : '#fff' }}>{metric.label}</th>
            {rows.map(r => <td key={r.year} style={{ padding: '5px 8px', textAlign: 'right', whiteSpace: 'nowrap',
              color: metric.signed && metric.value(r) < 0 ? '#b42318' : '#475569', borderBottom: '1px solid #eef2f7' }}>
              {format(metric.value(r))}
            </td>)}
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 4 }}>
      <b style={{ fontSize: 11.5, color: '#1e3a5f' }}>Additional public financing requirement — period totals</b>
      <TableExport filename={`${scope}_${sector}_public_financing_residual_periods`} sheetName="Public financing residuals"
        headers={periodHeaders} rows={periodExportRows} compact />
    </div>
    {table(periodHeaders, periodRows)}
    {table(summaryHeaders, rows.map(r => [r.year, ...summary.map(c => billions(c.value(r)))]))}
    {rungTable(0)}
    {rungTable(1)}
  </div>;
}