import React, { useEffect, useState } from 'react';
import LiveInterventionChart from './LiveInterventionChart';
import UtilityDebtPreview from './UtilityDebtPreview';
import DebtServicingControls from './DebtServicingControls';
import { ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import ExportButtons from './ExportButtons';
import TableExport from './TableExport';
import { runCalculation } from '../api';
import './debt-servicing.css';

type Props = {
  inputs: any;
  onChange: (inputs: any) => void;
  results?: any;
  calculationError?: string;
  sectorTab: 'water' | 'sanitation';
  onSectorChange: (sector: 'water' | 'sanitation') => void;
  geoScope: string;
  contributionView: ContributionView;
  onContributionViewChange: (view: ContributionView) => void;
  currencyDisplay: CurrencyDisplaySettings;
  onCurrencyDisplayChange: (settings: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void;
  onSectionFocus?: (key: string) => void;
  onRetry: () => void;
};

function scopeName(scope: string) {
  return scope === 'national' ? 'National' : scope === 'rural' ? 'Rural' : scope === 'urban_rural' ? 'Urban + Rural' : 'Urban';
}

export default function DebtServicingPanel({
  inputs, onChange, results, calculationError = '', sectorTab, onSectorChange, geoScope,
  contributionView, onContributionViewChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate, onSectionFocus, onRetry,
}: Props) {
  const currency = inputs?.country_config?.currency || 'LCU';
  const sectorKey = sectorTab === 'water' ? 'water_supply' : 'sanitation';
  const debt = inputs.utility_debt?.[sectorTab] || { enabled: false };
  const detail = results?.[sectorKey]?.scenario_utility_debt;
  const areaLabel = scopeName(geoScope);
  const chartRunKey = `${sectorTab}:${JSON.stringify(inputs)}`;
  return (
    <div className="debt-workspace" data-testid="debt-servicing-panel">
      <DebtServicingControls inputs={inputs} sector={sectorTab} scopeLabel={areaLabel} onChange={onChange} onSectionFocus={onSectionFocus} />
      <main className="debt-results-pane">
        <div className="debt-results-toolbar">
          <div className="debt-sector-tabs" role="group" aria-label="Debt servicing sector">
            {(['water', 'sanitation'] as const).map(sector => (
              <button key={sector} type="button" aria-pressed={sectorTab === sector} onClick={() => onSectorChange(sector)}>
                {sector === 'water' ? 'Water supply' : 'Sanitation'}
              </button>
            ))}
          </div>
          <div className="debt-view-tools">
            <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={currency}
              onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency: currency })}
              onEditRate={onEditCurrencyRate} />
            <ContributionViewToggle value={contributionView} onChange={onContributionViewChange} />
            <ExportButtons inputs={inputs} pptx={false} contributionView={contributionView} currencyDisplay={currencyDisplay} />
          </div>
        </div>
        <div className="debt-story-heading">
          <div>
            <span className="debt-eyebrow">FINANCING → SERVICE ACCESS</span>
            <h2>{areaLabel} {sectorTab === 'water' ? 'water supply' : 'sanitation'}</h2>
          </div>
          <p>Every colored band carries forward from the intervention plan. Debt is the final, signed comparison.</p>
        </div>
        <div className="debt-chart-stack">
          <LiveInterventionChart key={`${chartRunKey}:sm`} inputs={inputs} sector={sectorTab} scopeLabel={areaLabel} rung={0} contributionView={contributionView} currencyDisplay={currencyDisplay} />
          <LiveInterventionChart key={`${chartRunKey}:basic`} inputs={inputs} sector={sectorTab} scopeLabel={areaLabel} rung={1} contributionView={contributionView} currencyDisplay={currencyDisplay} />
        </div>
        <section className="debt-ledger-section">
          <div className="debt-section-heading">
            <div><span className="debt-eyebrow">YEAR-BY-YEAR · REAL {displayCurrency(currencyDisplay, currency).toUpperCase()} MILLIONS</span><h2>Revenue base &amp; repayment ledger</h2></div>
            <span className={`debt-status-pill${debt.enabled ? ' is-enabled' : ''}`}>{debt.enabled ? 'Borrowing enabled' : 'No debt scenario'}</span>
          </div>
          <UtilityDebtPreview debt={debt} result={detail} currency={currency} currencyDisplay={currencyDisplay}
            calculationError={calculationError} fresh={!!results && !calculationError} onRetry={onRetry} />
          <AccessGapComparison inputs={inputs} withDebt={results} sectorKey={sectorKey} />
        </section>
      </main>
    </div>
  );
}

function AccessGapComparison({ inputs, withDebt, sectorKey }: { inputs: any; withDebt: any; sectorKey: 'water_supply' | 'sanitation' }) {
  const [withoutDebt, setWithoutDebt] = useState<any>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const inputKey = JSON.stringify(inputs);
  useEffect(() => {
    let cancelled = false;
    const utilityDebt = Object.fromEntries(['water', 'sanitation'].map(key => [
      key, { ...(inputs.utility_debt?.[key] || {}), enabled: false },
    ]));
    setWithoutDebt(null);
    setError('');
    runCalculation({ ...inputs, utility_debt: utilityDebt })
      .then(value => { if (!cancelled) setWithoutDebt(value); })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { cancelled = true; };
    // View-only no-debt counterfactual; this never updates or saves shared inputs.
  }, [inputKey, attempt]);

  const financed = withDebt?.[sectorKey];
  const reference = withoutDebt?.[sectorKey];
   if (!withDebt?.years?.length) return null;
  if (error) return <div className="debt-preview-error" role="alert">
    Access comparison unavailable — {error}
    <button type="button" onClick={() => setAttempt(value => value + 1)} className="debt-retry">Retry comparison</button>
  </div>;
   if (!withoutDebt?.years?.length) return <div className="debt-preview-state">Calculating the no-debt service-access reference…</div>;

   const years: number[] = withDebt.years.filter((year: number) => year > Number(inputs.period.baseline_year));
  const totalHouseholds = withDebt?.hh_total || withDebt?.total_hh || financed.hh_total || financed.total_hh || [];
   const indexes = years.map(year => withDebt.years.indexOf(year));
   const rungValue = (data: any, rung: number, index: number) => Number(data?.scenario_hh?.[rung]?.[indexes[index]] ?? 0);
  const metricDefinitions = [
    { label: 'Safely-managed coverage', kind: 'coverage', values: years.map((year, index) => ({ year, before: rungValue(reference, 0, index), after: rungValue(financed, 0, index) })) },
    { label: 'Minimum Basic coverage · SM + Basic', kind: 'coverage', values: years.map((year, index) => ({ year, before: rungValue(reference, 0, index) + rungValue(reference, 1, index), after: rungValue(financed, 0, index) + rungValue(financed, 1, index) })) },
     { label: 'Safely-managed access gap', kind: 'gap', values: years.map((year, index) => ({ year, before: Number(reference.scenario_sm_access_gap?.[indexes[index]]), after: Number(financed.scenario_sm_access_gap?.[indexes[index]]) })) },
     { label: 'Minimum Basic access gap', kind: 'gap', values: years.map((year, index) => ({ year, before: Number(reference.scenario_at_least_basic_access_gap?.[indexes[index]]), after: Number(financed.scenario_at_least_basic_access_gap?.[indexes[index]]) })) },
  ].map(metric => ({
    ...metric,
    values: metric.values.map((value, index) => {
      const change = value.after - value.before;
       const households = Number(totalHouseholds[indexes[index]]);
      return { ...value, change, points: households > 0 ? change / households * 100 : null };
    }).filter(value => Number.isFinite(value.before) && Number.isFinite(value.after)),
  })).filter(metric => metric.values.length);
  if (!metricDefinitions.length) return null;
   const fmt = (value: number) => `${(value * 1e6).toLocaleString('en-US', { maximumFractionDigits: 2 })} HH`;
  const fmtSigned = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;
  const lastYear = years[years.length - 1];
  const favorable = (kind: string, change: number) => kind === 'coverage' ? change >= 0 : change <= 0;
  const exportRows = years.flatMap(year => metricDefinitions.map(metric => {
    const value = metric.values.find(item => item.year === year);
    return value ? [year, metric.label, value.before, value.after, value.change, value.points] : null;
  }).filter((row): row is any[] => !!row));

  return (
    <div className="debt-gap-comparison">
      <div className="debt-gap-heading">
        <div><span className="debt-eyebrow">SIGNED DIFFERENCE · HOUSEHOLDS</span><h3>Access &amp; coverage comparison</h3></div>
        <p>Financed scenario minus a view-only no-debt run. Coverage gains are positive; smaller access gaps are negative. Repayment-year effects stay in view.</p>
      </div>
      <div className="debt-gap-grid">
        {metricDefinitions.map(metric => {
          const final = metric.values.find(item => item.year === lastYear) || metric.values[metric.values.length - 1];
          return <div className="debt-gap-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong className={favorable(metric.kind, final.change) ? 'is-favorable' : 'is-adverse'}>{fmtSigned(final.change)}</strong>
            <small>{final.year} · {final.points == null ? 'percentage-point change unavailable' : `${final.points > 0 ? '+' : ''}${final.points.toFixed(3)} pp`}</small>
            <small>No debt {fmt(final.before)} → Financed {fmt(final.after)}</small>
          </div>;
        })}
      </div>
      <div className="debt-gap-table-scroll">
        <div className="debt-gap-export">
          <TableExport filename="debt_servicing_access_comparison" sheetName="Coverage and gaps"
            headers={['Year', 'Measure', 'No debt (M HH)', 'Financed (M HH)', 'Signed change (M HH)', 'Signed change (pp)']}
            rows={exportRows} compact />
        </div>
        <table>
          <thead><tr><th>Year</th><th>Measure</th><th>No debt</th><th>Financed</th><th>Signed HH change</th><th>Signed pp change</th></tr></thead>
          <tbody>{years.flatMap(year => metricDefinitions.map(metric => {
            const value = metric.values.find(item => item.year === year);
            if (!value) return null;
            return <tr key={`${year}-${metric.label}`}>
              <th>{year}</th><td>{metric.label}</td><td>{fmt(value.before)}</td><td>{fmt(value.after)}</td>
              <td className={favorable(metric.kind, value.change) ? 'is-favorable' : 'is-adverse'}>{fmtSigned(value.change)}</td>
              <td className={value.points == null ? '' : favorable(metric.kind, value.points) ? 'is-favorable' : 'is-adverse'}>
                {value.points == null ? '—' : `${value.points > 0 ? '+' : ''}${value.points.toFixed(3)} pp`}
              </td>
            </tr>;
          }))}</tbody>
        </table>
      </div>
    </div>
  );
}
