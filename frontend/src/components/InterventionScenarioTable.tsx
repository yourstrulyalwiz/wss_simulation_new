import React, { useEffect, useMemo, useState } from 'react';
import { runCalculation } from '../api';
import type { BauServiceLevel } from '../bauServiceView';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import TableExport from './TableExport';
import { interventionComparisonRows } from '../interventionReporting';
import { coverageIndicators } from '../coverageIndicators';
import CoverageKpis from './CoverageKpis';
import { forecastTableHeaders } from '../forecastTableColumns';
import { signedAccessBalance, signedFinancingBalance, forecastCell, forecastValueClass } from '../forecastTablePresentation';

type Props = { inputs: any; sector: 'water' | 'sanitation'; level: BauServiceLevel; showTable?: boolean; showKpis?: boolean; currencyDisplay: CurrencyDisplaySettings; scopeLabel: string; };
const sectionKey = (sector: 'water' | 'sanitation') => sector === 'water' ? 'water_supply' : 'sanitation';

/** A reporting-only view of the selected area's combined intervention calculation. */
export default function InterventionScenarioTable({ inputs, sector, level, showTable = true, showKpis = true, currencyDisplay, scopeLabel }: Props) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const dep = useMemo(() => JSON.stringify(inputs) + sector + level + revision, [inputs, sector, level, revision]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const timer = setTimeout(() => runCalculation(inputs, sector).then(value => {
      if (!cancelled) { setResult(value); setLoading(false); }
    }).catch(reason => {
      if (!cancelled) { setError(reason?.intervention_issues ? '' : String(reason)); setResult(null); setLoading(false); }
    }), 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [dep]);

  if (loading) return <div className="modern-intv-table-state" aria-label="Loading intervention results">
    <span className="modern-skeleton" /><span className="modern-skeleton" /><span className="modern-skeleton" />
  </div>;
  if (error) return <div className="modern-intv-table-state" role="alert">
    <p>Scenario results could not be loaded.</p><button type="button" onClick={() => setRevision(value => value + 1)}>Retry calculation</button>
  </div>;
  if (!result) return <div className="modern-intv-table-state" role="status">Complete active intervention inputs to see the combined scenario table.</div>;

  const key = sectionKey(sector);
  const currency = inputs?.country_config?.currency || 'LCU';
  const baseline = Number(inputs?.period?.baseline_year);
  const reportingRows = interventionComparisonRows(result, key, baseline, level);
  const kpiValues = coverageIndicators([result], key, baseline, inputs.period.forecast_end_year, level);
  const shownCurrency = displayCurrency(currencyDisplay, currency);
  const moneyColumns = new Set([5, 6, 7, 8, 9, 10, 11]);
  const columnOrder = [0, 1, 2, 12, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  const rows = reportingRows.map(row => row.map((raw, index) => {
    const value = index === 4 ? signedAccessBalance(raw, row[12], row[3])
      : [9, 10].includes(index) ? signedFinancingBalance(raw) : raw;
    if (value == null || !moneyColumns.has(index)) return value;
    const converted = convertMoney(value, currencyDisplay, currency);
    return converted == null ? null : converted / 1000;
  })).map(row => columnOrder.map(index => row[index]));
  const hasUnavailableValues = [kpiValues.baseline, kpiValues.forecast, kpiValues.target].some(kpi => kpi.percent == null) ||
    rows.some(row => row.some(value => value == null));
  const exportHeaders = [...forecastTableHeaders(level, shownCurrency), 'Intervention households (M)']
    .map((_, index, headers) => headers[columnOrder[index]]);
  const exportRows = rows;
  return <div className="modern-intv-table-wrap">
    {showKpis && <CoverageKpis values={kpiValues} scenarioLabel="Intervention"
      contextLabel="Intervention scenario coverage indicators" />}
    {hasUnavailableValues && <p className="modern-intv-data-note" role="status">One or more engine metrics are unavailable. Affected values are shown as — and are not treated as zero.</p>}
    {showTable && <><div className="modern-intv-table-caption">
      <div className="modern-intv-table-caption__title">
        <span>Intervention scenario · {scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'} · {level.replace(/_/g, ' ')}</span>
        <TableExport filename={`${scopeLabel}_${sector}_${level}_intervention_design`} sheetName="Intervention design"
          headers={exportHeaders} rows={exportRows} compact currencyDisplay={currencyDisplay} />
      </div>
      <small>BAU households is the comparison; targets and financial columns reflect the combined intervention scenario without loans. Households are in millions and money is in billions of {shownCurrency}. Gap columns show red − deficits, green + surpluses and dark-blue zero balances. Access surplus is coverage above target, shown only when no unmet access gap remains; Basic-only shortfall retains SM credit. Financing gaps show outstanding obligations, not available funding minus costs. Service costs and balances follow the selected service level; sector gaps and available funding cover both service levels. Replacement obligations can remain even when coverage exceeds target. Replacement need, credit and funding are annual flows. Residual replacement cost is the outstanding year-end balance already included in financing gaps; do not add it again or sum balances across years.</small>
    </div>
    <div className="modern-intv-table-scroll"><table className="modern-intv-table">
      <thead><tr>{exportHeaders.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row[0]}>
        <th scope="row">{row[0]}</th>
         {row.slice(1).map((value, index) => <td key={index} data-label={exportHeaders[index + 1]}
           className={forecastValueClass(value, columnOrder[index + 1])}>
           {forecastCell(value, [4, 9, 10].includes(columnOrder[index + 1]))}</td>)}
      </tr>)}</tbody>
    </table></div></>}
  </div>;
}
