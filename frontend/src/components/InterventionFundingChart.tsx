import React, { useEffect, useMemo, useState } from 'react';
import { runCalculation } from '../api';
import { validRate, type CurrencyDisplaySettings } from '../currencyDisplay';
import BAUSpendingChart from './BAUSpendingChart';
import { scenarioSpendingRows } from '../interventionReporting';

export default function InterventionFundingChart({ inputs, sector, scopeLabel, currencyDisplay, chartHeight = 360 }: {
  inputs: any; sector: 'water' | 'sanitation'; scopeLabel: string; currencyDisplay: CurrencyDisplaySettings; chartHeight?: number;
}) {
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const key = useMemo(() => JSON.stringify(inputs) + sector, [inputs, sector]);
  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setError('');
    const timer = setTimeout(() => runCalculation(inputs, sector).then(value => {
      if (!cancelled) setResult(value);
    }).catch(reason => {
      if (!cancelled) setError(reason?.intervention_issues ? '' : String(reason));
    }), 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, attempt]);
  const section = sector === 'water' ? 'water_supply' : 'sanitation';
  if (error) return <div role="alert" className="modern-intv-table-state">Funding results unavailable. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry calculation</button></div>;
  if (!result) return <div className="modern-intv-table-state" aria-label="Loading available funding chart"><span className="modern-skeleton" /><span className="modern-skeleton" /></div>;
  const source = inputs?.country_config?.currency || 'LCU';
  const factor = currencyDisplay.mode === 'usd' && validRate(currencyDisplay, source) && source.toUpperCase() !== 'USD'
    ? 1 / (currencyDisplay.localPerUsd as number) : 1;
  const displayCurrency = currencyDisplay.mode === 'usd' && validRate(currencyDisplay, source) ? 'USD' : source;
  let rows;
  try {
    rows = scenarioSpendingRows([result], section, Number(inputs?.period?.baseline_year));
  } catch (reason) {
    return <div role="status" className="modern-intv-data-note">{reason instanceof Error ? reason.message : 'Scenario funding metrics are unavailable.'}</div>;
  }
  return <BAUSpendingChart rows={rows} moneyFactor={factor} currency={displayCurrency}
    scopeLabel={scopeLabel} sectorLabel={sector === 'water' ? 'Water supply' : 'Sanitation'}
    currencyDisplay={currencyDisplay} titlePrefix="Intervention scenario" chartHeight={chartHeight} />;
}
