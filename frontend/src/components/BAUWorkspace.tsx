import React, { useState } from 'react';
import { useProjectScope } from '../projectScope';
import LiveBAUChart, { type BauCoverage } from './LiveBAUChart';
import SectionWorkspace from './SectionWorkspace';
import { BAU_SERVICE_LEVELS, type BauServiceLevel } from '../bauServiceView';
import type { CurrencyDisplaySettings } from '../currencyDisplay';

export default function BAUWorkspace({ inputsList, scopeLabel, sector,
  onSectorChange, scopeChoices, onScopeChange, currencyDisplay }: {
  inputsList: any[]; scopeLabel: string;
  sector: 'water' | 'sanitation'; onSectorChange: (sector: 'water' | 'sanitation') => void;
  scopeChoices: string[]; onScopeChange: (scope: string) => void;
  currencyDisplay: CurrencyDisplaySettings;
}) {
  const { sectors } = useProjectScope();
  const [serviceLevel, setServiceLevel] = useState<BauServiceLevel>('safely_managed');
  const [coverage, setCoverage] = useState<BauCoverage | null>(null);
  const [tableTarget, setTableTarget] = useState<HTMLDivElement | null>(null);
  const [expandedChart, setExpandedChart] = useState(false);
  const serviceLabel = BAU_SERVICE_LEVELS.find(level => level.value === serviceLevel)!.label;
  const format = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
  const serviceSelector = (location: string) => <div className="modern-bau-service-picker">
    <span>Service level</span>
    <div className="modern-bau-service-switch" role="group" aria-label={`BAU ${location} service level`}>
      {BAU_SERVICE_LEVELS.map(level => <button key={level.value} type="button"
        data-service-level={level.value} aria-pressed={serviceLevel === level.value}
        onClick={() => { if (serviceLevel !== level.value) { setCoverage(null); setServiceLevel(level.value); } }}>
        {level.label}
      </button>)}
    </div>
  </div>;

  const coverageSummary = (<div aria-label="Baseline and forecast-end service coverage">
        <p>{scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'} · {serviceLabel} · share of households</p>
        <div className="modern-bau-kpis" aria-live="polite">
          {(['baseline', 'bau', 'target'] as const).map(key => <div key={key} className="modern-bau-kpi" data-bau-kpi={key}>
            <span>{key === 'baseline' ? 'BASELINE · LAST HISTORICAL YEAR' : key === 'bau' ? 'BUSINESS-AS-USUAL · FORECAST END' : 'ENTERED SERVICE TARGET · FORECAST END'} {key === 'baseline' ? coverage?.baselineYear : coverage?.endYear}</span>
            <strong>{format(coverage?.[key])}</strong><small>{serviceLabel}</small>
          </div>)}
        </div>
        {!coverage && <p role="status">Coverage pending. Calculation errors, if any, appear below.</p>}
      </div>);

  return <SectionWorkspace label="Business-as-usual sections" sections={[
    {key:'graph', label:'BAU Graph'}, {key:'table', label:'BAU Table'},
  ]}>
    <section className="modern-bau-section" data-section-key="graph">
      <header className="modern-page-intro"><span className="modern-page-intro__eyebrow">WORKFLOW 02 · BUSINESS-AS-USUAL</span>
        <h2 tabIndex={-1}>BAU Graph</h2><p>Review the status quo before designing interventions. Coverage is calculated from the selected area's live engine results.</p>
      </header>
      <div className="modern-bau-toggles" role="group" aria-label="BAU sector">
        {sectors.map(value => <button key={value} aria-pressed={sector === value} onClick={() => { if (sector !== value) { setCoverage(null); onSectorChange(value); } }}>{value === 'water' ? 'Water Supply' : 'Sanitation'}</button>)}
      </div>
      <div className="modern-bau-toggles" role="group" aria-label="BAU graph area">
        {scopeChoices.map(value => <button key={value} aria-pressed={scopeLabel.toLowerCase() === value} onClick={() => { if (scopeLabel.toLowerCase() !== value) { setCoverage(null); onScopeChange(value); } }}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      {serviceSelector('graph')}
      <p className="modern-bau-service-note">At least basic combines safely managed and basic-only households. Changing either selector updates both the graph and table.</p>

      {coverageSummary}
      <div className="modern-bau-chart-card modern-bau-analysis-container">
        <div className="modern-bau-chart-actions">
          <button type="button" aria-pressed={expandedChart} onClick={() => setExpandedChart(current => !current)}>
            {expandedChart ? 'Restore chart size' : 'Expand chart'}
          </button>
        </div>
        <LiveBAUChart key={`${sector}-${scopeLabel}-${serviceLevel}`} inputsList={inputsList}
          sector={sector} scopeLabel={scopeLabel} currencyDisplay={currencyDisplay}
          serviceLevel={serviceLevel} chartHeight={expandedChart ? 500 : 360}
          tableTarget={tableTarget} onCoverage={setCoverage} expanded={expandedChart} />
      </div>
    </section>
    <section className="modern-bau-section" data-section-key="table">
      <h2 className="modern-bau-heading" tabIndex={-1}>BAU Table</h2>
      {serviceSelector('table')}
      <p className="modern-bau-service-note">{scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'} · {serviceLabel}.
        {serviceLevel === 'at_least_basic' && ' Financing combines both service levels, including safely managed upgrades; it is not the cost of basic access alone.'}
      </p>
      <div ref={setTableTarget} />
    </section>
  </SectionWorkspace>;
}
