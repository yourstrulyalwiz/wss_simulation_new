import React, { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { runCalculation } from '../api';
import { REVENUE_SOURCES } from '../revenueSources';
import { AVAILABLE_FUND_COLUMNS, MOBILIZED_SOURCES, sectorAvailableFundsRows } from '../sectorAvailableFunds';
import { convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { forecastCell } from '../forecastTablePresentation';
import TableExport from './TableExport';
import './RevenueSourceChart.css';

export default function RevenueSourceChart({ inputs, results, sector, currencyDisplay }: {
  inputs: any | any[]; results?: any | any[]; sector: 'water' | 'sanitation'; currencyDisplay: CurrencyDisplaySettings;
}) {
  const datasets = Array.isArray(inputs) ? inputs : [inputs];
  const key = JSON.stringify(datasets) + sector;
  const [loaded, setLoaded] = useState<{ key: string; results: any[]; error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState<'all' | 'mobilized' | 'additional'>('all');
  const views = [
    { key: 'all', label: 'All Funds' },
    { key: 'mobilized', label: 'Mobilized Funds' },
    { key: 'additional', label: 'Additional Revenues Generated' },
  ] as const;
  useEffect(() => {
    if (results) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      Promise.all(datasets.map(data => runCalculation(data, sector))).then(data => {
        if (!cancelled) setLoaded({ key, results: data, error: '' });
      }).catch(error => {
        if (!cancelled) setLoaded({ key, results: [], error: String(error?.message || error) });
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, !!results, attempt]);
  const current = loaded?.key === key ? loaded : null;
  const resultList = results ? (Array.isArray(results) ? results : [results]) : current?.results || [];
  const sectorKey = sector === 'water' ? 'water_supply' : 'sanitation';
  const currency = datasets[0]?.country_config?.currency || 'LCU';
  const baselines = resultList.map((_, index) => {
    const value = (datasets[index] ?? (datasets.length === 1 ? datasets[0] : null))?.period?.baseline_year;
    return value == null || value === '' ? NaN : Number(value);
  });
  const rows = sectorAvailableFundsRows(resultList, sectorKey, baselines);
  // Convert the engine's millions to billions exactly as InterventionScenarioTable.
  const money = (value: number | null) => {
    if (value == null) return null;
    const converted = convertMoney(value, currencyDisplay, currency);
    return converted == null ? null : converted / 1000;
  };
  const displayRows = rows.map(row => ({
    ...row, ...Object.fromEntries(AVAILABLE_FUND_COLUMNS.map(column => [column.key, money(row[column.key])])),
  }));
  const groups = [
    { key: 'mobilized', label: 'Mobilized Funds', sources: MOBILIZED_SOURCES },
    { key: 'additional', label: 'Additional Revenues Generated', sources: REVENUE_SOURCES },
  ].filter(group => view === 'all' || group.key === view);
  const series = groups.flatMap(group => [...group.sources]);
  const columns = AVAILABLE_FUND_COLUMNS.filter(column => view === 'all' ||
    column.key === view || series.some(source => source.key === column.key));
  const graphRows = displayRows.map(row => ({
    ...row, ...Object.fromEntries(series.map(source => [source.key, row.reconciled ? row[source.key] : null])),
  }));
  const unit = `${displayCurrency(currencyDisplay, currency)} billions/year`;
  const fmt = (value: any) => value == null ? '—' : Number(value).toLocaleString('en-US', { maximumFractionDigits: 3 });
  const headers = ['Year', ...columns.map(source => `${source.label} (${unit})`)];
  const exportRows = displayRows.map(row => [row.year, ...columns.map(source => row[source.key] ?? '')]);
  const errors = resultList.map(result => !result?.[sectorKey]
    ? result?.sector_errors?.[sectorKey] || `${sector === 'water' ? 'Water supply' : 'Sanitation'} results are unavailable.` : '').filter(Boolean);
  const warnings = rows.filter(row => !row.reconciled);
  return <section data-testid="revenue-source-chart" className="sector-funds" aria-label="Sector Available Funds">
    <div className="sector-funds__heading">
      <h3>Sector Available Funds</h3>
      {rows.length > 0 && <TableExport filename={`${sector}_sector_available_funds_${view}`} sheetName="Sector available funds"
        headers={headers} rows={exportRows} compact currencyDisplay={currencyDisplay} />}
    </div>
    <div className="modern-bau-service-switch" role="group" aria-label="Funding view" style={{ display: 'flex', flexWrap: 'wrap', marginTop: 12 }}>
      {views.map(item => <button key={item.key} type="button" aria-pressed={view === item.key}
        onClick={() => setView(item.key)}>{item.label}</button>)}
    </div>
    <p className="sector-funds__note">
      Forecast years only · {unit}. Mobilized Funds + Additional Revenues Generated = Sector Available Funds.
      Public Spending includes baseline capital, budget-execution changes and public-spending commitments.
      External Funding is the separate capital injection. Revenue sources retain signed net cash, including NRW costs.
      Loans, household financing and cost savings are not ordinary available funding. Losses are already signed;
      debt and replacement charges are not deducted again. Model estimates; uncertainty bounds are unavailable.
    </p>
    {current?.error && <div role="alert">{current.error} <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry calculation</button></div>}
    {errors.length > 0 && <p role="alert">{errors.join(' ')}</p>}
    {!resultList.length && !results && !current?.error && <div className="modern-intv-table-state" aria-label="Loading sector available funds">
      <span className="modern-skeleton" /><span className="modern-skeleton" /><span className="modern-skeleton" />
    </div>}
    {(!!resultList.length || !!results) && !rows.length && <p className="modern-intv-data-note" role="status">
      No forecast funding rows available. Check the baseline year and annual results; only years after the baseline are shown.
    </p>}
    {warnings.length > 0 && <details className="sector-funds__warnings" open>
      <summary>Funding reconciliation needs attention · {warnings.length} forecast {warnings.length === 1 ? 'year' : 'years'}</summary>
      <p>Missing values remain —, not zero. Unreconciled years are omitted from the graph; the table retains reported values and the engine total. Recalculate older results to load the signed source ledger.</p>
      <ul>{warnings.map(row => <li key={row.year}><strong>{row.year}</strong>: {row.issues.join(' ')}</li>)}</ul>
    </details>}
    {rows.length > 0 && <>
      <div className="sector-funds__legend" aria-label="Funding source groups">
        {groups.map(group =>
          <div key={group.label} className="sector-funds__legend-group"><strong>{group.label}</strong>
            {group.sources.map(source => <span key={source.key} className="sector-funds__legend-item">
              <span className="sector-funds__swatch" style={{ background: source.color }} />{source.label}
            </span>)}
          </div>)}
      </div>
      {rows.some(row => row.reconciled) && <ResponsiveContainer width="100%" height={390}>
        <BarChart data={graphRows} stackOffset="sign" accessibilityLayer>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" /><YAxis tickFormatter={value => fmt(value)} width={85} />
          <Tooltip filterNull formatter={(value: any, name: any) => [`${fmt(value)} ${unit}`, name]} />
          <ReferenceLine y={0} stroke="#647b85" />
          {series.map(source => <Bar key={source.key} dataKey={source.key} name={source.label}
            fill={source.color} stackId="funds" isAnimationActive={false} />)}
        </BarChart>
      </ResponsiveContainer>}
      <p className="sector-funds__note">Showing {views.find(item => item.key === view)?.label}. Signed stack: negative contributions extend below zero. The selected total is the net sum, not the height of the positive stack. All table amounts are in {unit}.</p>
      <div className="modern-intv-table-scroll"><table className="modern-intv-table">
        <thead><tr>{headers.map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{displayRows.map(row => <tr key={row.year}>
          <th scope="row">{row.year}</th>
          {columns.map((source, index) => {
            const value = row[source.key];
            const total = ['mobilized', 'additional', 'total'].includes(source.key);
            return <td key={source.key} data-label={headers[index + 1]} className={total ? 'sector-funds__total'
              : `forecast-value--${value == null || value === 0 ? 'neutral' : value > 0 ? 'surplus' : 'deficit'}`}>
              {forecastCell(value, !total)}
            </td>;
          })}
        </tr>)}</tbody>
      </table></div>
    </>}
  </section>;
}
