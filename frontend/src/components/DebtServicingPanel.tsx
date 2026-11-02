import React, { useRef, useState } from 'react';
import { useProjectScope } from '../projectScope';
import DebtServicingControls from './DebtServicingControls';
import LoanFundingCharts from './LoanFundingCharts';
import LoanCoverageComparison from './LoanCoverageComparison';
import LoanDetailTables from './LoanDetailTables';
import { ContributionViewToggle, type ContributionView } from '../contributionView';
import { CurrencyDisplayControl, convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { forecastCell } from '../forecastTablePresentation';
import { loanNumber } from '../loanFundingReporting';
import { BAU_SERVICE_LEVELS, type BauServiceLevel } from '../bauServiceView';
import { LOAN_FUNDING_QUALIFICATION } from '../loanFunding';
import ExportButtons from './ExportButtons';
import './debt-servicing.css';
import './loan-workspace.css';

type Props = {
  inputs: any; onChange: (inputs: any) => void; results?: any; calculationError?: string;
  sectorTab: 'water' | 'sanitation'; onSectorChange: (sector: 'water' | 'sanitation') => void;
  geoScope: string; scopeChoices?: string[]; scopeLabel?: string; onScopeChange?: (scope: string) => void;
  contributionView: ContributionView; onContributionViewChange: (view: ContributionView) => void;
  currencyDisplay: CurrencyDisplaySettings; onCurrencyDisplayChange: (settings: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void; onSectionFocus?: (key: string) => void; onRetry: () => void;
};
const scopeName = (scope: string) => scope === 'national' ? 'National' : scope === 'rural' ? 'Rural' : 'Urban';
const sections = [{ key: 'design', title: 'Loan Settings' }, { key: 'graph', title: 'Loan Graph' }, { key: 'table', title: 'Coverage Comparison' },
  { key: 'cash_flow', title: 'Loan Cash Flow & Repayment' }] as const;
type Section = typeof sections[number]['key'];

export default function DebtServicingPanel({
  inputs, onChange, results, calculationError = '', sectorTab, onSectorChange, geoScope,
  scopeChoices = [geoScope], scopeLabel, onScopeChange, contributionView, onContributionViewChange,
  currencyDisplay, onCurrencyDisplayChange, onEditCurrencyRate, onSectionFocus, onRetry,
}: Props) {
  const { sectors } = useProjectScope();
  const [activeSection, setActiveSection] = useState<Section>('design');
  const [level, setLevel] = useState<BauServiceLevel>('at_least_basic');
  const reading = useRef<HTMLDivElement>(null);
  const pending = useRef<(() => void) | null>(null);
  React.useEffect(() => () => pending.current?.(), []);
  const area = scopeLabel || scopeName(geoScope);
  const context = `${area} · ${sectorTab === 'water' ? 'Water Supply' : 'Sanitation'} · ${BAU_SERVICE_LEVELS.find(item => item.value === level)?.label}`;
  const currency = inputs.country_config?.currency || 'LCU';
  const key = sectorTab === 'water' ? 'water_supply' : 'sanitation';
  const debt = inputs.utility_debt?.[sectorTab] || { enabled: false };
  const detail = results?.[key]?.scenario_utility_debt;
  const money = (raw: unknown) => {
    const value = loanNumber(raw);
    return value === null ? '—' : `${forecastCell(convertMoney(value, currencyDisplay, currency) ?? null)} M ${displayCurrency(currencyDisplay, currency)}`;
  };
  const error = results?.sector_errors?.[key] || (!results ? calculationError : '');
  const navigate = (section: Section) => {
    pending.current?.();
    setActiveSection(section);
    if (section === 'design') return;
    requestAnimationFrame(() => {
      const host = reading.current, target = host?.querySelector<HTMLElement>(`[data-section-key="${section}"]`);
      if (!host || !target) return;
      const disclosure = target.querySelector('details');
      if (disclosure) disclosure.open = true;
      target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      const scroll = getComputedStyle(host).overflowY === 'visible' ? host.closest<HTMLElement>('.loan-workspace') || host : host;
      const align = () => scroll.scrollTo({ top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12 });
      align();
      const observer = new ResizeObserver(align);
      host.querySelectorAll('[data-section-key]').forEach(node => observer.observe(node));
      const stop = () => {
        observer.disconnect(); clearTimeout(timer);
        for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.removeEventListener(event, stop);
        pending.current = null;
      };
      const timer = setTimeout(stop, 2000);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.addEventListener(event, stop, { passive: true });
      pending.current = stop;
    });
  };
  const heading = (number: number, title: string) => <h2 className="modern-input-section-heading" tabIndex={-1}>
    <span className="modern-input-section-heading__index">{number}</span><span>{title} ({context})</span></h2>;
  const servicePicker = (label: string) => <div className="modern-bau-service-picker">
    <span>Service level</span><div className="modern-bau-service-switch" role="group" aria-label={label}>
      {BAU_SERVICE_LEVELS.map(item => <button type="button" key={item.value} aria-pressed={level === item.value}
        onClick={() => setLevel(item.value)}>{item.label}</button>)}
    </div></div>;
  return <div className={`loan-workspace intervention-section-workspace${activeSection === 'design' ? ' intervention-section-workspace--design' : ''}`} data-testid="debt-servicing-panel">
    <nav className="modern-inputs-nav intervention-section-nav" aria-label="Loan funding sections">
      <span className="modern-inputs-nav__eyebrow">Loan funding</span>
      <select className="modern-inputs-nav__select" aria-label="Loan funding section" value={activeSection} onChange={event => navigate(event.target.value as Section)}>
        {sections.map((section, index) => <option key={section.key} value={section.key}>{index + 1}. {section.title}</option>)}
      </select>
      <div className="modern-inputs-nav__items">{sections.map((section, index) => <button type="button" key={section.key}
        className="modern-inputs-nav__item" aria-current={activeSection === section.key ? 'location' : undefined} onClick={() => navigate(section.key)}>
        <span className="modern-inputs-nav__number">{index + 1}</span><span>{section.title}</span></button>)}</div>
    </nav>
    <aside className="loan-settings" hidden={activeSection !== 'design'} aria-label="Loan settings">
      <header className="intervention-input-drawer__header">{heading(1, 'Loan Settings')}</header>
      <DebtServicingControls inputs={inputs} sector={sectorTab} scopeLabel={area} onChange={onChange} onSectionFocus={onSectionFocus}
        referenceSourceCash={Number(detail?.reference_year) === Number(debt.disbursement_year) ? detail?.reference_source_cash : undefined} />
      <div className="loan-status" style={{ padding: 16 }} data-testid="loan-status">
        <strong>Frozen reference · {detail?.reference_year ?? '—'}</strong>
        <div>Indicative principal: <b data-testid="indicative-principal">{money(detail?.indicative_principal)}</b></div>
        <div>Selected signed pool: {money(detail?.selected_signed_pool)}</div>
        <div>Eligible pool (single zero floor): {money(detail?.eligible_pool)}</div>
        <div>Annual allocation / fixed service: {money(detail?.fixed_annual_debt_service)}</div>
        <div>Annuity factor: {forecastCell(loanNumber(detail?.annuity_factor))}</div>
        <div>Status: {detail?.status || 'awaiting calculation'}. First repayment: {detail?.first_repayment_year ?? '—'}; maturity: {detail?.maturity_year ?? '—'}.</div>
        <div>Feasibility not assessed; selected sources and fixed obligations are unchanged.</div>
      </div>
    </aside>
    <div className="modern-inputs-content intervention-reading-content" ref={reading}>
      <section className="modern-bau-section intervention-reading-section" data-section-key="graph">
        {heading(2, 'Loan Graph')}
          <div className="modern-bau-toggles" role="group" aria-label="Loan geography">
            {scopeChoices.map(scope => <button key={scope} type="button" aria-pressed={geoScope === scope}
              onClick={() => onScopeChange?.(scope)}>{scopeName(scope)}</button>)}
          </div>
          <div className="modern-bau-toggles" role="group" aria-label="Loan sector">{sectors.map(sector => <button type="button" key={sector}
            aria-pressed={sectorTab === sector} onClick={() => onSectorChange(sector)}>{sector === 'water' ? 'Water Supply' : 'Sanitation'}</button>)}</div>
        <div className="modern-intv-graph-controls">
          <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={currency}
            onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency: currency })} onEditRate={onEditCurrencyRate} />
          <ContributionViewToggle value={contributionView} onChange={onContributionViewChange} />
          <ExportButtons inputs={inputs} pptx={false} contributionView={contributionView} currencyDisplay={currencyDisplay} />
        </div>
        {servicePicker('Loan graph service level')}
        <p className="modern-bau-service-note">{LOAN_FUNDING_QUALIFICATION} {debt.enabled ? 'Borrowing enabled for this sector.' : 'Borrowing excluded; saved terms are retained.'}</p>
        {error ? <div className="modern-intv-table-state" role="alert"><p>Loan scenario unavailable — {error}</p><button type="button" onClick={onRetry}>Retry calculation</button></div>
          : !results?.[key] ? <div className="modern-intv-table-state" aria-label="Loading loan results"><span className="modern-skeleton" /><span className="modern-skeleton" /><span className="modern-skeleton" /></div>
          : <><LoanCoverageComparison result={results} inputs={inputs} sector={sectorTab} level={level} scopeLabel={area} currencyDisplay={currencyDisplay} kpisOnly />
            <LoanFundingCharts result={results} inputs={inputs} sector={sectorTab} level={level} scopeLabel={area} contributionView={contributionView} currencyDisplay={currencyDisplay} /></>}
      </section>
      <section className="modern-bau-section intervention-reading-section" data-section-key="table">
        {heading(3, 'Coverage Comparison')}
        {servicePicker('Loan comparison service level')}
        {results?.[key] && !error ? <LoanCoverageComparison result={results} inputs={inputs} sector={sectorTab} level={level} scopeLabel={area} currencyDisplay={currencyDisplay} /> :
          <p className="modern-intv-table-state">The comparison uses the same matched calculation as the graphs above.</p>}
      </section>
      <section className="modern-bau-section intervention-reading-section" data-section-key="cash_flow">
        {heading(4, 'Loan Cash Flow & Repayment')}
        <LoanDetailTables detail={!error ? detail : null} baseline={Number(inputs.period.baseline_year)}
          currency={currency} currencyDisplay={currencyDisplay} />
      </section>
    </div>
  </div>;
}
