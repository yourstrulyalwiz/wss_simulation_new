import React, { useEffect, useMemo, useState } from 'react';
import { runCalculation } from '../api';
import type { BauServiceLevel } from '../bauServiceView';
import { convertMoney, currencyUnit, type CurrencyDisplaySettings } from '../currencyDisplay';
import TableExport from './TableExport';
import { interventionCoverageKpis, interventionTableRows } from '../interventionReporting';

type Props = { inputs: any; sector: 'water' | 'sanitation'; level: BauServiceLevel; showTable?: boolean; currencyDisplay: CurrencyDisplaySettings; scopeLabel: string; };
const sectionKey = (sector: 'water' | 'sanitation') => sector === 'water' ? 'water_supply' : 'sanitation';

/** A reporting-only view of the selected area's combined intervention calculation. */
export default function InterventionScenarioTable({ inputs, sector, level, showTable = true, currencyDisplay, scopeLabel }: Props) {
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
  const reportingRows = interventionTableRows(result, key, baseline, level);
  const kpiValues = interventionCoverageKpis(result, key, baseline, level);
  const rows = reportingRows.map(row => ({ ...row, expansion: row.expansion == null ? null : convertMoney(row.expansion, currencyDisplay, currency) ?? null,
    replacement: row.replacement == null ? null : convertMoney(row.replacement, currencyDisplay, currency) ?? null,
    available: row.available == null ? null : convertMoney(row.available, currencyDisplay, currency) ?? null,
    gap: row.gap == null ? null : convertMoney(row.gap, currencyDisplay, currency) ?? null }));
  const fmt = (value: number) => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }) : '—';
  const cell = (value: number | null) => value == null ? '—' : fmt(value);
  const kpis = [
    { label: `Baseline · ${kpiValues.baselineYear}`, value: kpiValues.baseline },
    { label: `Intervention · ${kpiValues.endYear ?? 'forecast end'}`, value: kpiValues.scenario },
    { label: `Entered target · ${kpiValues.endYear ?? 'forecast end'}`, value: kpiValues.target },
  ];
  const hasUnavailableValues = kpis.some(kpi => kpi.value == null) ||
    rows.some(row => [row.bau, row.scenario, row.target, row.expansion, row.replacement, row.available, row.gap].some(value => value == null));
  const columns = [
    ['year', 'Year'], ['bau', 'BAU coverage (M HH)'], ['scenario', 'Intervention coverage (M HH)'],
    ['target', 'Entered target (M HH)'], ['expansion', `Expansion capital (${currencyUnit(currencyDisplay, currency, 'million')})`], ['replacement', `Replacement capital (${currencyUnit(currencyDisplay, currency, 'million')})`],
    ['available', `Available funding (${currencyUnit(currencyDisplay, currency, 'million')})`], ['gap', `Financing requirement (${currencyUnit(currencyDisplay, currency, 'million')})`],
  ];
  const exportHeaders = columns.map(([, label]) => label);
  const exportRows = rows.map(row => [row.year, row.bau, row.scenario, row.target, row.expansion,
    row.replacement, row.available, row.gap]);
  return <div className="modern-intv-table-wrap">
    <div className="modern-intv-kpis" aria-label="Intervention scenario coverage indicators">
      {kpis.map(card => <div className="modern-intv-kpi" key={card.label}>
        <span>{card.label}</span><strong>{card.value == null ? '—' : `${fmt(card.value)}%`}</strong><small>household coverage · live engine</small>
      </div>)}
    </div>
    {hasUnavailableValues && <p className="modern-intv-data-note" role="status">One or more engine metrics are unavailable. Affected values are shown as — and are not treated as zero.</p>}
    {showTable && <><div className="modern-intv-table-caption">
      <div className="modern-intv-table-caption__title">
        <span>Combined intervention scenario · {scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'} · {level.replace(/_/g, ' ')}</span>
        <TableExport filename={`${scopeLabel}_${sector}_${level}_intervention_design`} sheetName="Intervention design"
          headers={exportHeaders} rows={exportRows} compact currencyDisplay={currencyDisplay} />
      </div>
      <small>Annual flows and coverage from the live engine for the selected geography; monetary values are {currencyUnit(currencyDisplay, currency, 'million')}.</small>
    </div>
    <div className="modern-intv-table-scroll"><table className="modern-intv-table">
      <thead><tr>{columns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.year}>
        <th scope="row">{row.year}</th>
        <td>{cell(row.bau)}</td><td>{cell(row.scenario)}</td><td>{cell(row.target)}</td>
        <td>{cell(row.expansion)}</td><td>{cell(row.replacement)}</td>
        <td>{cell(row.available)}</td><td>{cell(row.gap)}</td>
      </tr>)}</tbody>
    </table></div></>}
  </div>;
}
