import React, { useState } from 'react';
import InputPanel from './InputPanel';
import LiveBAUChart, { type BauCoverage } from './LiveBAUChart';
import SectionWorkspace from './SectionWorkspace';
import type { CurrencyDisplaySettings } from '../currencyDisplay';

export default function BAUWorkspace({ inputs, onChange, geoScope, inputsList, scopeLabel, sector,
  onSectorChange, scopeChoices, onScopeChange, currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate, onSectionFocus }: {
  inputs: any; onChange: (inputs: any) => void; geoScope: string; inputsList: any[]; scopeLabel: string;
  sector: 'water' | 'sanitation'; onSectorChange: (sector: 'water' | 'sanitation') => void;
  scopeChoices: string[]; onScopeChange: (scope: string) => void;
  currencyDisplay: CurrencyDisplaySettings; onCurrencyDisplayChange: (settings: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void; onSectionFocus: (section: string) => void;
}) {
  const [managed, setManaged] = useState<BauCoverage | null>(null);
  const [basic, setBasic] = useState<BauCoverage | null>(null);
  const [managedTable, setManagedTable] = useState<HTMLDivElement | null>(null);
  const [basicTable, setBasicTable] = useState<HTMLDivElement | null>(null);
  const format = (value: number | null | undefined) => value == null ? '—' : `${value.toFixed(1)}%`;
  return <SectionWorkspace label="Business-as-usual sections" sections={[
    {key:'graph', label:'BAU Graph'}, {key:'table', label:'BAU Table'}, {key:'baseline', label:'Review Baseline Information'},
  ]}>
    <section className="modern-bau-section" data-section-key="graph">
      <header className="modern-page-intro"><span className="modern-page-intro__eyebrow">WORKFLOW 02 · BUSINESS-AS-USUAL</span>
        <h2 tabIndex={-1}>BAU Graph</h2><p>Review the status quo before designing interventions. Coverage is calculated from the selected area's live engine results.</p>
      </header>
      <div className="modern-bau-toggles" role="group" aria-label="BAU sector">
        {(['water', 'sanitation'] as const).map(value => <button key={value} aria-pressed={sector === value} onClick={() => onSectorChange(value)}>{value === 'water' ? 'Water Supply' : 'Sanitation'}</button>)}
      </div>
      <div className="modern-bau-toggles" role="group" aria-label="BAU graph area">
        {scopeChoices.map(value => <button key={value} aria-pressed={scopeLabel.toLowerCase() === value} onClick={() => onScopeChange(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div aria-label="Baseline and forecast-end service coverage">
        <p>{scopeLabel} · {sector === 'water' ? 'Water supply' : 'Sanitation'} · share of households</p>
        <div className="modern-bau-kpis" aria-live="polite">
          {(['baseline', 'bau', 'target'] as const).map(key => <div key={key} className="modern-bau-kpi" data-bau-kpi={key}>
            <span>{key === 'baseline' ? 'BASELINE · LAST HISTORICAL YEAR' : key === 'bau' ? 'BUSINESS-AS-USUAL · FORECAST END' : 'ENTERED SERVICE TARGET · FORECAST END'} {key === 'baseline' ? managed?.baselineYear : managed?.endYear}</span>
            <strong>SM {format(managed?.[key])}</strong><small>Basic {format(basic?.[key])}</small>
          </div>)}
        </div>
        {!managed && <p role="status">Coverage pending. Calculation errors, if any, appear below.</p>}
      </div>
      <LiveBAUChart inputsList={inputsList} sector={sector} scopeLabel={scopeLabel} currencyDisplay={currencyDisplay} rung={0} tableTarget={managedTable} onCoverage={setManaged} />
      <LiveBAUChart inputsList={inputsList} sector={sector} scopeLabel={scopeLabel} currencyDisplay={currencyDisplay} rung={1} tableTarget={basicTable} onCoverage={setBasic} />
    </section>
    <section className="modern-bau-section" data-section-key="table">
      <h2 className="modern-bau-heading" tabIndex={-1}>BAU Table</h2>
      <h3>Safely managed</h3><div ref={setManagedTable} />
      <h3>Basic</h3><div ref={setBasicTable} />
    </section>
    <section className="modern-bau-section" data-section-key="baseline">
      <h2 className="modern-bau-heading" tabIndex={-1}>Review Baseline Information</h2>
      <InputPanel inputs={inputs} onChange={onChange} geoScope={geoScope} showSection="bau"
        bauSector={sector} onBauSectorChange={onSectorChange} onSectionFocus={onSectionFocus}
        currencyDisplay={currencyDisplay} onCurrencyDisplayChange={onCurrencyDisplayChange} onEditCurrencyRate={onEditCurrencyRate} />
    </section>
  </SectionWorkspace>;
}
