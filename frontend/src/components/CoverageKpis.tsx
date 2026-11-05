import React, { createContext, useContext, useState } from 'react';
import type { CoverageIndicators, CoverageUnit } from '../coverageIndicators';
import { coverageNumber, coverageTargetDifference } from '../coverageIndicators';
import './coverage-kpis.css';

type CoverageUnitContextValue = {
  unit: CoverageUnit;
  setUnit: (unit: CoverageUnit) => void;
};

const CoverageUnitContext = createContext<CoverageUnitContextValue | null>(null);

/** Mount above the workspace tabs so all coverage displays share their units. */
export function CoverageKpiProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<CoverageUnit>('percent');
  return (
    <CoverageUnitContext.Provider value={{ unit, setUnit }}>
      {children}
    </CoverageUnitContext.Provider>
  );
}

type CoverageKpisProps = {
  values: CoverageIndicators | null;
  scenarioLabel: string;
  contextLabel: string;
  variant?: 'bau' | 'scenario';
};

function comparisonText(
  forecast: number | null,
  target: number | null,
  unit: CoverageUnit,
): string {
  const difference = coverageTargetDifference(forecast, target);
  if (difference === null) return 'Comparison unavailable';

  // Only absorb floating-point arithmetic noise, never display rounding.
  const tolerance = Number.EPSILON * 8 * Math.max(1, Math.abs(forecast!), Math.abs(target!));
  const onTarget = Math.abs(difference) <= tolerance;
  const magnitude = onTarget ? 0 : Math.abs(difference);
  const formatted = magnitude.toLocaleString('en-US', {
    maximumFractionDigits: unit === 'percent' ? 3 : 6,
  });
  // A genuine small gap must not appear as a signed zero.
  const visibleMagnitude = magnitude !== 0 && Number(formatted.replace(/,/g, '')) === 0
    ? magnitude.toExponential(2)
    : formatted;
  const status = onTarget ? 'On target' : difference > 0 ? 'Above target' : 'Below target';
  const sign = onTarget ? '' : difference > 0 ? '+' : '−';
  const units = unit === 'percent' ? 'percentage points' : 'million people';
  return `${status} · ${sign}${visibleMagnitude} ${units}`;
}

export default function CoverageKpis({
  values,
  scenarioLabel,
  contextLabel,
  variant = 'scenario',
}: CoverageKpisProps) {
  const sharedUnits = useContext(CoverageUnitContext);
  // Standalone usage remains interactive; the provider coordinates workspace tabs.
  const [localUnit, setLocalUnit] = useState<CoverageUnit>('percent');
  const { unit, setUnit } = sharedUnits ?? { unit: localUnit, setUnit: setLocalUnit };
  const isBau = variant === 'bau';
  const prefix = isBau ? 'modern-bau' : 'modern-intv';
  const subtitle = unit === 'percent' ? '% coverage · share of households' : 'People served · millions';
  const comparison = comparisonText(
    values?.forecast[unit] ?? null,
    values?.target[unit] ?? null,
    unit,
  );
  const cards = [
    {
      key: 'baseline',
      bauKey: 'baseline',
      label: isBau ? 'BASELINE · LAST HISTORICAL YEAR' : 'Baseline',
      year: values?.baselineYear,
      value: values?.baseline[unit] ?? null,
    },
    {
      key: 'forecast',
      bauKey: 'bau',
      label: isBau ? 'BUSINESS-AS-USUAL · FORECAST END' : scenarioLabel,
      year: values?.endYear,
      value: values?.forecast[unit] ?? null,
    },
    {
      key: 'target',
      bauKey: 'target',
      label: isBau ? 'ENTERED SERVICE TARGET · FORECAST END' : 'Entered target',
      year: values?.endYear,
      value: values?.target[unit] ?? null,
    },
  ];

  return (
    <div className={`coverage-kpis coverage-kpis--${variant}`} role="group" aria-label={contextLabel}>
      <div className="coverage-kpis__toolbar">
        <p className="coverage-kpis__context">{contextLabel}</p>
        <div className="coverage-kpis__units" role="group" aria-label="Coverage KPI units">
          <button type="button" aria-pressed={unit === 'percent'} onClick={() => setUnit('percent')}>
            % coverage
          </button>
          <button type="button" aria-pressed={unit === 'people'} onClick={() => setUnit('people')}>
            People (millions)
          </button>
        </div>
      </div>
      <div className={`${prefix}-kpis coverage-kpis__cards`} aria-live="polite" aria-atomic="true">
        {cards.map(card => (
          <div
            key={card.key}
            className={`${prefix}-kpi coverage-kpis__card`}
            data-bau-kpi={isBau ? card.bauKey : undefined}
          >
            <span>{card.label} · {card.year ?? '—'}</span>
            <strong>{coverageNumber(card.value, unit)}</strong>
            <small>{subtitle}</small>
            {card.key === 'forecast' && <p className="coverage-kpis__comparison">{comparison}</p>}
          </div>
        ))}
      </div>
      {!values && (
        <p className="coverage-kpis__pending" role="status">
          Coverage unavailable. Run the simulation to calculate baseline and forecast coverage.
        </p>
      )}
    </div>
  );
}
