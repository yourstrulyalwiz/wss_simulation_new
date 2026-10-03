import React from 'react';
import TableExport from './TableExport';

export type RungFinance = {
  bau: number; scenario: number; target: number;
  newBau: number; replacementBau: number; fundedBau: number; gapBau: number;
  newScenario: number; replacementScenario: number; fundedScenario: number; gapScenario: number;
  deficitBau: number; deficitScenario: number;
};

export type FinanceYear = {
  year: number; total: number;
  bauAvailable: number; scenarioAvailable: number;
  offBudgetLoans: number; offBudgetGrants: number;
  bauGap: number; scenarioGap: number;
  planned: number; catchUp: number; outstanding: number; endlineRequirement: number; stock: number;
  replacementReserved: number; coverageReplacement: number;
  expansionAvailable: number; purchaseCapital: number; unallocatedCapital: number; cashDeficit: number;
  services: [RungFinance, RungFinance];  // Safely Managed, Basic (exclusive)
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
  const m = `${currency} M`, b = `B ${currency}`;
  // Monetary balances and within-year flows are explicitly distinguished.
  const summary: Column[] = [
    { title: `Planned expansion — annual flow (${b})`, value: r => r.planned, unit: 'money' },
    { title: `Catch-up before funding — snapshot (${b})`, value: r => r.catchUp, unit: 'money' },
    { title: `Outstanding expansion — closing balance (${b})`, value: r => r.outstanding, unit: 'money' },
    { title: `Endline requirement incl. accumulated shortfalls (${b})`, value: r => r.endlineRequirement, unit: 'money' },
    { title: `Gross funded asset stock — balance (${b})`, value: r => r.stock, unit: 'money' },
    { title: `BAU gap (${b})`, value: r => r.bauGap, unit: 'money' },
    { title: `SM residual new-service cost (${b})`, value: r => r.services[0].newScenario, unit: 'money' },
    { title: `SM replacement (${b})`, value: r => r.services[0].replacementScenario, unit: 'money' },
    { title: `Basic residual new-service cost (${b})`, value: r => r.services[1].newScenario, unit: 'money' },
    { title: `Basic replacement (${b})`, value: r => r.services[1].replacementScenario, unit: 'money' },
    { title: `Scenario residual-ledger subtotal (${b})`, value: r =>
      r.services.reduce((sum, s) => sum + s.newScenario + s.replacementScenario, 0), unit: 'money' },
    { title: `BAU sector capex available (${b})`, value: r => r.bauAvailable, unit: 'money' },
    { title: `Additional effective sector capex (${b})`, value: r => r.scenarioAvailable - r.bauAvailable, unit: 'money' },
    { title: `Scenario sector capex available (${b})`, value: r => r.scenarioAvailable, unit: 'money' },
    { title: `Coverage-stock replacement basis (${b})`, value: r => r.coverageReplacement, unit: 'money' },
    { title: `Replacement funding reserved (${b})`, value: r => r.replacementReserved, unit: 'money' },
    { title: `Replacement credit (${b})`, value: r =>
      r.services[0].fundedScenario + r.services[1].fundedScenario, unit: 'money' },
    { title: `Expansion capital available (${b})`, value: r => r.expansionAvailable, unit: 'money' },
    { title: `Actual funded connection purchases — flow (${b})`, value: r => r.purchaseCapital, unit: 'money' },
    { title: `Unallocated positive expansion capital (${b})`, value: r => r.unallocatedCapital, unit: 'money' },
    { title: `Cash deficit (${b})`, value: r => r.cashDeficit, unit: 'money' },
    { title: `Off-budget microfinance loans (${b})`, value: r => r.offBudgetLoans, unit: 'money' },
    { title: `Off-budget grants spent (${b})`, value: r => r.offBudgetGrants, unit: 'money' },
    { title: `SM remaining gap (${b})`, value: r => r.services[0].gapScenario, unit: 'money' },
    { title: `Basic remaining gap (${b})`, value: r => r.services[1].gapScenario, unit: 'money' },
    { title: `Total remaining gap (${b})`, value: r => r.scenarioGap, unit: 'money' },
    { title: `Gap change, BAU − scenario (${b})`, value: r => r.bauGap - r.scenarioGap, unit: 'money' },
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
      { title: 'Service Gap (M HH)', value: r => Math.max(0, r.services[rung].target - r.services[rung].bau), unit: 'hh' },
      { title: `${prefix} residual new-service cost (${m})`, value: r => r.services[rung].newBau, unit: 'money' },
      { title: `${prefix} replacement need (${m})`, value: r => r.services[rung].replacementBau, unit: 'money' },
      { title: `${prefix} replacement credit (${m})`, value: r => r.services[rung].fundedBau, unit: 'money' },
      { title: `${prefix} cash deficit (${m})`, value: r => r.services[rung].deficitBau, unit: 'money' },
      { title: `${prefix} financing gap (${m})`, value: r => r.services[rung].gapBau, unit: 'money' },
      { title: `Sector-wide financing gap (${m})`, value: r => r.bauGap, unit: 'money' },
      // Scenario obligations and attributed funding are computed in the scenario
      // model pass, not inferred by subtracting money from the BAU gap.
      { title: `${prefix} with interventions (M)`, value: r => r.services[rung].scenario, unit: 'hh' },
      { title: 'Scenario service gap (M HH)', value: r => Math.max(0, r.services[rung].target - r.services[rung].scenario), unit: 'hh' },
      { title: `${prefix} scenario residual new-service cost (${m})`, value: r => r.services[rung].newScenario, unit: 'money' },
      { title: `${prefix} scenario replacement need (${m})`, value: r => r.services[rung].replacementScenario, unit: 'money' },
      { title: `${prefix} scenario replacement credit (${m})`, value: r => r.services[rung].fundedScenario, unit: 'money' },
      { title: `${prefix} scenario cash deficit (${m})`, value: r => r.services[rung].deficitScenario, unit: 'money' },
      { title: `${prefix} remaining gap (${m})`, value: r => r.services[rung].gapScenario, unit: 'money' },
      { title: `${prefix} gap change, BAU − scenario (${m})`, value: r => r.services[rung].gapBau - r.services[rung].gapScenario, unit: 'money' },
      { title: `Sector additional effective capex (${m})`, value: r => r.scenarioAvailable - r.bauAvailable, unit: 'money' },
      { title: `Sector remaining gap (${m})`, value: r => r.scenarioGap, unit: 'money' },
      { title: `Sector gap change, BAU − scenario (${m})`, value: r => r.bauGap - r.scenarioGap, unit: 'money' },
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

  return <div style={{ marginTop: 12, marginBottom: 18 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
      <b style={{ fontSize: 12, color: '#1e3a5f' }}>{label} — annual spending-gap composition · {scope}</b>
      <TableExport filename={`${scope}_${sector}_spending_gap_composition`} sheetName="Gap composition"
        headers={summaryHeaders} rows={summaryExport} compact />
    </div>
    <div style={{ fontSize: 10.5, color: '#475569', lineHeight: 1.5, marginBottom: 7 }}>
      Remaining financing gap = residual new-service cost + replacement requirement − replacement credit + cash deficit.
      New-service costs already reflect funded connections and receive no second capital credit. Additional effective sector
      capex is scenario available minus BAU available (net of execution and cash effects); cost-saving interventions
      instead lower residual costs. Replacement reserved uses the coverage-stock basis; credit is capped at the
      reported replacement obligation and allocated by service replacement shares. Expansion purchases include
      associated non-household capital and are reported before existing target caps, not as actual delivery.
      Unallocated positive expansion capital is not credited against residual needs.
      Cash deficits are allocated once by original need shares (investment split if needs are zero). Off-budget microfinance loans and
      grants fund connections outside the sector capex pool: they can lower scenario need, but must not be added
      again to sector available capex. The two attributed remaining gaps add to the sector total. A negative gap
      change means the shortfall grew; unlike the chart’s positive-only bands, these changes use the full scenario.
      Money is shown in billions; detailed forecast downloads use millions, as in the BAU tables.
    </div>
    {table(summaryHeaders, rows.map(r => [r.year, ...summary.map(c => billions(c.value(r)))]))}
    {rungTable(0)}
    {rungTable(1)}
  </div>;
}