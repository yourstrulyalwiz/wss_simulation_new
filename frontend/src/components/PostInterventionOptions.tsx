import React, { useEffect, useRef, useState } from 'react';
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PostArea, PostBucket, PostCoverage, PostInterventionSettings, PostSector, PostTargets } from '../postIntervention';
import { emptyPostSettings, POST_COMPONENTS, postCoverage, postCsv, postFinite, postStatus, postSum, postTargetError, usablePostBucket, verifiedPostBucket } from '../postInterventionPresentation';
import { usePostIntervention } from '../hooks/use-post-intervention';
import { useProjectScope } from '../projectScope';
import { CurrencyDisplayControl, convertMoney, displayCurrency, type CurrencyDisplaySettings } from '../currencyDisplay';
import { SANITATION_INTERVENTIONS, WATER_INTERVENTIONS, interventionEnabled } from '../interventionRegistry';
import { BAU_SERVICE_LEVELS, type BauServiceLevel } from '../bauServiceView';
import { C, INTV_PALETTE } from '../chartColors';
import { yearAxisInterval } from '../chartAxis';
import CoverageKpis, { useCoverageKpiUnits } from './CoverageKpis';
import ChartExport from './ChartExport';
import './loan-workspace.css';
import './post-intervention.css';

type Props = {
  bundle: any;
  settings?: PostInterventionSettings;
  onSettingsChange: (settings: PostInterventionSettings | undefined) => void;
  includeDebt: boolean;
  onIncludeDebtChange: (value: boolean) => void;
  currencyDisplay: CurrencyDisplaySettings;
  onCurrencyDisplayChange: (value: CurrencyDisplaySettings) => void;
  onEditCurrencyRate: () => void;
  sector: PostSector;
  onSectorChange: (sector: PostSector) => void;
  initialArea?: PostArea;
};
const sections = [
  { key: 'settings', title: 'Target & scenario settings' },
  { key: 'coverage', title: 'Coverage graphs' },
  { key: 'gap', title: 'Remaining financing gap' },
  { key: 'gdp', title: 'GDP spending equivalent' },
] as const;
type Section = typeof sections[number]['key'];
const areaName = (area: string) => area === 'national' ? 'National' : area === 'rural' ? 'Rural' : 'Urban';
const sectorName = (sector: PostSector) => sector === 'water' ? 'Water Supply' : 'Sanitation';
const number = (value: number | null | undefined, digits = 3) => !postFinite(value) ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits });
// Upward display rounding must never imply a share below the backend's tested feasible value.
const envelope = (fraction: number | null | undefined) => !postFinite(fraction) ? 'Unavailable'
  : `${(Math.ceil(fraction * 100 * 1e6) / 1e6).toLocaleString('en-US', { maximumFractionDigits: 6 })}%`;
const coverageLevel = (level: BauServiceLevel): keyof PostCoverage => level === 'safely_managed' ? 'sm' : level;

export default function PostInterventionOptions({
  bundle, settings, onSettingsChange, includeDebt, onIncludeDebtChange, currencyDisplay,
  onCurrencyDisplayChange, onEditCurrencyRate, sector, onSectorChange, initialArea,
}: Props) {
  const { sectors, readOnly, projectId } = useProjectScope();
  const [activeSection, setActiveSection] = useState<Section>('settings');
  const [view, setView] = useState<PostArea>(initialArea || 'urban');
  const [level, setLevel] = useState<BauServiceLevel>('at_least_basic');
  const [localUnits, setLocalUnits] = useState<'percent' | 'households'>('percent');
  const sharedUnits = useCoverageKpiUnits();
  const unit = sharedUnits?.unit ?? localUnits;
  const reading = useRef<HTMLDivElement>(null);
  const workspace = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const navigationCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => navigationCleanup.current?.(), []);

  // A split scope is never collapsed into a fabricated third national input.
  const areaKeys: PostArea[] = bundle.scope?.scopeMode === 'national' ? ['national'] :
    [...(bundle.scope?.areaUrban ? ['urban' as const] : []), ...(bundle.scope?.areaRural ? ['rural' as const] : [])];
  const choices: PostArea[] = areaKeys.length === 2 ? [...areaKeys, 'national'] : areaKeys;
  const effectiveView = choices.includes(view) ? view : areaKeys[0];
  const shownAreas = effectiveView === 'national' && areaKeys.length === 2 ? areaKeys : [effectiveView];
  const inputsFor = (area: PostArea) => area === 'urban' ? bundle.inputs : bundle.altInputs?.[area];
  const primary = inputsFor(areaKeys[0]) || bundle.inputs;
  const baseline = Number(primary?.period?.baseline_year);
  const endYear = Number(primary?.period?.forecast_end_year);
  const targetYear = settings?.targetYear ?? endYear;
  const activeSector = sectors.includes(sector) ? sector : sectors[0];
  const context = `${areaName(effectiveView)} · ${sectorName(activeSector)} · ${BAU_SERVICE_LEVELS.find(item => item.value === level)?.label}`;
  const viewLabel = `${areaName(effectiveView)} · ${sectorName(activeSector)}`;
  const validationErrors: string[] = [];
  if (!Number.isInteger(targetYear) || targetYear <= baseline || targetYear > endYear)
    validationErrors.push('Select a target year after baseline and within the existing forecast horizon.');
  for (const area of areaKeys) for (const active of sectors) {
    const override = settings?.targetOverrides?.[area]?.[active];
    if (override && postTargetError(override)) validationErrors.push(`${areaName(area)} · ${sectorName(active)}: ${postTargetError(override)}`);
  }
  const { data, error, loading, retry } = usePostIntervention(bundle, settings, includeDebt, projectId, validationErrors.join(' '));
  const buckets = shownAreas.map(area => data?.per_area_sector?.[area]?.[activeSector]);
  const allBuckets = areaKeys.flatMap(area => sectors.map(active => data?.per_area_sector?.[area]?.[active]));
  const viewUsable = !!data && buckets.length > 0 && buckets.every(usablePostBucket);
  const viewVerified = viewUsable && buckets.every(verifiedPostBucket);
  const fullVerified = !!data?.combined.complete && allBuckets.length > 0 && allBuckets.every(verifiedPostBucket);
  const currency = data?.currency || primary?.country_config?.currency || 'LCU';
  const shownCurrency = displayCurrency(currencyDisplay, currency);
  const moneyValue = (value: number | null | undefined) => convertMoney(value, currencyDisplay, currency) ?? null;
  const money = (value: number | null | undefined) => `${number(moneyValue(value))} M ${shownCurrency}`;
  const index = data?.years.indexOf(data.selected_year) ?? -1;
  const baselineIndex = data?.years.indexOf(baseline) ?? -1;
  const levelKey = coverageLevel(level);
  const coverageValue = (field: Parameters<typeof postCoverage>[1], at: number) => {
    const households = postCoverage(buckets, field, at, levelKey);
    const total = postCoverage(buckets, field, at, 'total');
    return { households, percent: households !== null && total !== null && total > 0 ? households / total * 100 : null };
  };
  const kpis = viewUsable ? {
    baselineYear: baseline, endYear: data!.selected_year,
    baseline: coverageValue('reference_coverage', baselineIndex),
    forecast: coverageValue('adjusted_existing_funding_coverage', index),
    target: coverageValue('target_coverage', index),
  } : null;
  const chartRows = (data?.years || []).map((year, at) => ({
    year,
    reference: coverageValue('reference_coverage', at)[unit],
    adjusted: coverageValue('adjusted_existing_funding_coverage', at)[unit],
    target: coverageValue('target_coverage', at)[unit],
    funded: viewVerified ? coverageValue('verified_funded_coverage', at)[unit] : null,
  }));
  const adjustedDiffers = chartRows.some(row => row.reference !== row.adjusted);
  const viewResidual = viewUsable ? postSum(buckets.map(bucket => bucket?.target_year_residual_total)) : null;
  const viewFraction = viewVerified ? postSum(buckets.map(bucket => bucket?.funding_fraction)) : null;
  const chartUnit = unit === 'percent' ? '% of households' : 'Households (millions)';
  const coverageHeaders = ['Year', `Selected-scenario reference (${chartUnit})`, `Revised targets, existing funding (${chartUnit})`, `Revised target pathway (${chartUnit})`, `Verified additional funding (${chartUnit})`];
  const statusText = buckets.filter(Boolean).map(bucket => postStatus(bucket!.solver_status)).filter((value, at, values) => values.indexOf(value) === at).join(' · ');
  const update = (next: PostInterventionSettings | undefined) => { if (!readOnly) onSettingsChange(next); };
  const editTarget = (area: PostArea, active: PostSector, field: keyof PostTargets, raw: string) => {
    const current = settings || emptyPostSettings();
    const bucket = data?.per_area_sector?.[area]?.[active];
    const original = usablePostBucket(bucket) ? bucket.original_target_coverage : null;
    const total = original?.total[index];
    const share = (key: 'at_least_basic' | 'sm') => postFinite(total) && total > 0 && postFinite(original?.[key]?.[index])
      ? original![key][index] / total : null;
    const inherited = { atLeastBasicShare: share('at_least_basic'), safelyManagedShare: share('sm') };
    update({ ...current, targetOverrides: { ...current.targetOverrides, [area]: {
      ...current.targetOverrides[area], [active]: { ...(current.targetOverrides[area]?.[active] || inherited),
        [field]: raw.trim() === '' ? null : Number(raw) / 100 },
    } } });
  };
  const downloadCsv = (filename: string, headers: string[], rows: unknown[][]) => {
    const blob = new Blob(['\uFEFF', postCsv(headers, rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `${filename}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const csvMetadata = (scope: string, rows: unknown[][]) => rows.map(row => [
    scope, shownCurrency, data?.real_price_year, data?.selected_year, includeDebt ? 'Included (enabled loans only)' : 'Excluded',
    data?.method_version, data?.input_signature, ...row,
  ]);
  const metadataHeaders = ['Scope', 'Display currency', 'Real price year', 'Target year', 'Loan inclusion', 'Method version', 'Input signature'];
  const navigate = (section: Section) => {
    navigationCleanup.current?.();
    setActiveSection(section);
    requestAnimationFrame(() => {
      const host = reading.current;
      const target = workspace.current?.querySelector<HTMLElement>(`[data-section-key="${section}"]`);
      if (!host || !target) return;
      target.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
      const scroll = getComputedStyle(host).overflowY === 'visible' ? workspace.current! : host;
      if (section === 'settings') { target.scrollTop = 0; scroll.scrollTop = 0; return; }
      const align = () => scroll.scrollTo({ top: scroll.scrollTop + target.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 12 });
      align();
      const observer = new ResizeObserver(align);
      host.querySelectorAll('[data-section-key]').forEach(node => observer.observe(node));
      const stop = () => {
        observer.disconnect(); clearTimeout(timer);
        for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.removeEventListener(event, stop);
        navigationCleanup.current = null;
      };
      const timer = setTimeout(stop, 2000);
      for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroll.addEventListener(event, stop, { passive: true });
      navigationCleanup.current = stop;
    });
  };
  const heading = (n: number, title: string) => <h2 className="modern-input-section-heading" tabIndex={-1}>
    <span className="modern-input-section-heading__index">{n}</span><span>{title} ({context})</span>
  </h2>;
  const annualRows = (scope: 'view' | 'full') => {
    const valid = scope === 'view' ? viewVerified : fullVerified;
    if (!data || !valid) return [];
    return data.years.flatMap((year, at) => {
      if (year < data.funding_window.start || year > data.funding_window.end) return [];
      const value = (field: 'funding_available_by_year' | 'funding_used_by_year' | 'unused_by_year') =>
        scope === 'full' ? data.combined[field]?.[at] ?? null : postSum(buckets.map(bucket => bucket?.[field]?.[at]));
      const gdp = data.national_gdp?.[at];
      const used = value('funding_used_by_year');
      const available = value('funding_available_by_year');
      return [[year, moneyValue(gdp), moneyValue(available), moneyValue(used), moneyValue(value('unused_by_year')),
        postFinite(gdp) && gdp > 0 && postFinite(available) ? available / gdp * 100 : null,
        postFinite(gdp) && gdp > 0 && postFinite(used) ? used / gdp * 100 : null]];
    });
  };
  const annualHeaders = ['Year', `National GDP (M ${shownCurrency})`, `Available (M ${shownCurrency})`,
    `Used (M ${shownCurrency})`, `Unused (M ${shownCurrency})`, 'Annual funding envelope (% GDP)', 'Additional spending used (% GDP)'];
  const renderAnnual = (scope: 'view' | 'full') => {
    const rows = annualRows(scope), label = scope === 'view' ? `Displayed view: ${viewLabel}` : 'Full project · all active areas and sectors';
    return <div className="post-card" data-testid={`post-annual-${scope}`}>
      <div className="post-tools"><h3>{label}</h3>
        <button type="button" className="post-button" disabled={!rows.length} onClick={() => downloadCsv(`post_intervention_${scope}_annual`, [...metadataHeaders, ...annualHeaders], csvMetadata(label, rows))}>CSV</button></div>
      {!rows.length ? <p className="post-note">{loading ? 'Calculating…' : `Verified funding schedule unavailable for ${scope === 'full' ? 'the full project. Every active area/sector must be verified; partial results are not project totals.' : 'this view. See the affected bucket status below.'}`}</p> :
        <div className="post-table-frame"><table className="post-table post-annual">
          <thead><tr>{annualHeaders.map(header => <th scope="col" key={header}>{header}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th>
            {row.slice(1).map((value, at) => <td key={at}>{at === 4 && postFinite(value) ? envelope(value / 100) : number(value, at >= 4 ? 6 : 3)}</td>)}</tr>)}</tbody>
        </table></div>}
    </div>;
  };
  const compositionRows = POST_COMPONENTS.map(component => [
    component.label,
    viewUsable ? postSum(buckets.map(bucket => bucket?.target_year_residual_components?.[component.key])) : null,
    viewVerified ? postSum(buckets.map(bucket => bucket?.remaining_financial_components?.[component.key])) : null,
  ] as const);

  return <div ref={workspace} className={`post-intervention-workspace loan-workspace intervention-section-workspace${activeSection === 'settings' ? ' intervention-section-workspace--design' : ''}`} data-testid="post-intervention-options">
    <nav className="modern-inputs-nav intervention-section-nav" aria-label="Post-intervention sections">
      <span className="modern-inputs-nav__eyebrow">Post-intervention options</span>
      <select className="modern-inputs-nav__select" aria-label="Post-intervention section" value={activeSection} onChange={event => navigate(event.target.value as Section)}>
        {sections.map((section, at) => <option key={section.key} value={section.key}>{at + 1}. {section.title}</option>)}
      </select>
      <div className="modern-inputs-nav__items">{sections.map((section, at) => <button type="button" key={section.key}
        className="modern-inputs-nav__item" aria-current={activeSection === section.key ? 'location' : undefined} onClick={() => navigate(section.key)}>
        <span className="modern-inputs-nav__number">{at + 1}</span><span>{section.title}</span></button>)}</div>
    </nav>
    <aside className="post-settings" hidden={activeSection !== 'settings'} data-section-key="settings" aria-label="Target and scenario settings">
      <header className="intervention-input-drawer__header">{heading(1, 'Target & scenario settings')}</header>
      <div className="post-settings-body">
        <div className="post-intro"><h3>Post-Intervention Options</h3><p>Adjust targets and estimate the remaining financing gap</p></div>
        <div className="post-card">
          <h3>Analysis horizon</h3>
          <label className="post-field">Target year
            <select disabled={readOnly || !Number.isFinite(endYear - baseline)} value={targetYear} onChange={event => update({ ...(settings || emptyPostSettings()), targetYear: Number(event.target.value) })}>
              {Number.isInteger(endYear - baseline) && endYear > baseline && endYear - baseline < 501 &&
                Array.from({ length: endYear - baseline }, (_, at) => baseline + at + 1).map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </label>
          <p className="post-note">Funding window: <strong>{baseline + 1}–{targetYear}</strong>, inclusive. The existing forecast horizon is unchanged.</p>
          <p className="post-note">Unedited targets inherit the complete original target schedule, including intermediate targets. Changing the year alone does not replace that schedule.</p>
        </div>
        {areaKeys.map(area => sectors.map(active => {
          const override = settings?.targetOverrides?.[area]?.[active];
          const bucket = data?.per_area_sector?.[area]?.[active];
          const original = usablePostBucket(bucket) ? bucket.original_target_coverage : null;
          const actual = usablePostBucket(bucket) ? bucket.reference_coverage : null;
          const pct = (coverage: PostCoverage | null, key: 'at_least_basic' | 'sm') =>
            postFinite(coverage?.total[index]) && coverage!.total[index] > 0 && postFinite(coverage?.[key]?.[index])
              ? coverage![key][index] / coverage!.total[index] * 100 : null;
          const targetError = override ? postTargetError(override) : '';
          const cardId = `post-target-${area}-${active}`;
          return <div className="post-card" key={cardId}>
            <h3>{areaName(area)} · {sectorName(active)}</h3>
            {([['atLeastBasicShare', 'at_least_basic', 'At least basic target'], ['safelyManagedShare', 'sm', 'Safely managed target']] as const).map(([field, key, label]) => {
              const inherited = pct(original, key);
              const value = override ? (override[field] === null ? '' : number((override[field] as number) * 100, 8).replace(/,/g, ''))
                : inherited === null ? '' : Number(inherited.toFixed(8));
              return <label className="post-field" key={field} htmlFor={`${cardId}-${field}`}>{label} (%)
                <input type="number" id={`${cardId}-${field}`} min={0} max={100} step="any" value={value} disabled={readOnly}
                  placeholder="Inherited original target" aria-invalid={!!targetError || undefined}
                  aria-describedby={`${cardId}-context ${cardId}-error`}
                  onChange={event => editTarget(area, active, field, event.target.value)} />
                <small className="post-target-context">Original: {number(pct(original, key))}% · Selected scenario: {number(pct(actual, key))}% · {targetYear}</small>
              </label>;
            })}
            <p id={`${cardId}-context`} className="post-note">{override ? 'Local endpoint override; baseline observations stay unchanged.' : 'Inherited original pathway; no local target override.'}</p>
            <p className="post-error" id={`${cardId}-error`} role={targetError ? 'alert' : undefined}>{targetError}</p>
            {bucket?.solver_status === 'invalid_inputs' && <p className="post-error" role="alert">{bucket.error || 'Complete the active inputs for this area and sector.'}</p>}
            {override && <button type="button" className="post-button" disabled={readOnly} onClick={() => {
              const current = settings || emptyPostSettings();
              const next = { ...current.targetOverrides[area] }; delete next[active];
              update({ ...current, targetOverrides: { ...current.targetOverrides, [area]: next } });
            }}>Use original target schedule</button>}
          </div>;
        }))}
        <div className="post-card"><h3>Local scenario comparison</h3>
          <p className="post-note">Inherited intervention parameters; switches affect this analysis only. Edit parameters in Intervention Design. Paused or unavailable features cannot be activated here.</p>
          {areaKeys.map(area => sectors.map(active => <details className="loan-optional" key={`${area}-${active}`}>
            <summary>{areaName(area)} · {sectorName(active)}</summary>
            <div className="loan-optional__body">{(active === 'water' ? WATER_INTERVENTIONS : SANITATION_INTERVENTIONS).map(item => {
              const unavailable = item.key === 'san_nrw_link_enabled' && !sectors.includes('water');
              const inherited = interventionEnabled(inputsFor(area), item.key);
              const local = settings?.toggleOverrides?.[area]?.[item.key];
              return <label className="post-toggle" key={item.key}><input type="checkbox" disabled={readOnly || unavailable}
                checked={!unavailable && (local ?? inherited)} onChange={event => {
                  const current = settings || emptyPostSettings();
                  const toggles = { ...current.toggleOverrides[area] };
                  if (event.target.checked === inherited) delete toggles[item.key]; else toggles[item.key] = event.target.checked;
                  update({ ...current, toggleOverrides: { ...current.toggleOverrides, [area]: toggles } });
                }} /><span>{item.controlLabel || item.label}<small>{unavailable ? 'Unavailable without Water Supply' : local === undefined ? 'Inherited' : 'Local override'}</small></span></label>;
            })}</div></details>))}
        </div>
        <button type="button" className="post-button" disabled={readOnly || !settings} onClick={() => update(undefined)}>Reset analysis</button>
        <p className="post-note">Reset clears local targets, selected year and toggle overrides. The shared loan-inclusion choice is retained; no intervention parameters are changed.</p>
        {readOnly && <p className="post-note">Read-only view. Settings cannot be changed; display controls and exports remain available.</p>}
      </div>
    </aside>
    <div className="modern-inputs-content intervention-reading-content" ref={reading} aria-busy={loading}>
      <div className="post-intro"><h3>Post-Intervention Options</h3><p>Adjust targets and estimate the remaining financing gap</p></div>
      <div className="modern-bau-toggles" role="group" aria-label="Post-intervention geography">
        {choices.map(area => <button type="button" key={area} aria-pressed={effectiveView === area} onClick={() => setView(area)}>{areaName(area)}</button>)}
      </div>
      <div className="modern-bau-toggles" role="group" aria-label="Post-intervention sector">
        {sectors.map(active => <button type="button" key={active} aria-pressed={activeSector === active} onClick={() => onSectorChange(active)}>{sectorName(active)}</button>)}
      </div>
      <div className="post-tools">
        <CurrencyDisplayControl settings={currencyDisplay} sourceCurrency={currency}
          onModeChange={mode => onCurrencyDisplayChange({ ...currencyDisplay, mode, sourceCurrency: currency })} onEditRate={onEditCurrencyRate} />
        <label className="post-field">Loan funding
          <select value={includeDebt ? 'include' : 'exclude'} disabled={readOnly} onChange={event => onIncludeDebtChange(event.target.value === 'include')}>
            <option value="include">Include saved indicative loans</option><option value="exclude">Exclude loans</option>
          </select>
        </label>
      </div>
      <p className="post-note">Loan inclusion is shared with Results Dashboard and Slide Deck. Disabled loans stay disabled. Reference principal and repayment schedules are fixed across target/funding trials; feasibility is not assessed.</p>
      <div className="modern-bau-service-picker"><span>Service level</span>
        <div className="modern-bau-service-switch" role="group" aria-label="Post-intervention service level">
          {BAU_SERVICE_LEVELS.map(item => <button type="button" key={item.value} aria-pressed={level === item.value} onClick={() => setLevel(item.value)}>{item.label}</button>)}
        </div>
      </div>
      <p className="post-note"><strong>Displayed view: {viewLabel}</strong>. National split-area coverage sums household counts, not percentages. Full-project funding is shown separately for all active areas and sectors.</p>
      <div className="post-status" role="status" aria-live="polite" data-error={!!error}>
        {loading ? 'Calculating… Inputs changed; previous results are not shown.' : error || `Target year ${data?.selected_year ?? targetYear} · Funding window ${data?.funding_window.start ?? baseline + 1}–${data?.funding_window.end ?? targetYear} · ${statusText || 'No results for this view'}`}
        {error && <div><button type="button" className="post-button" onClick={retry}>Retry analysis</button></div>}
      </div>
      {data?.warnings?.map((warning, at) => <p className="post-note" role="status" key={at}>{warning}</p>)}
      {shownAreas.map(area => {
        const bucket = data?.per_area_sector?.[area]?.[activeSector];
        return bucket?.solver_status === 'invalid_inputs' ? <div className="post-status" data-error="true" role="alert" key={area}>
          <strong>{areaName(area)} · {sectorName(activeSector)} — invalid inputs</strong><br />{bucket.error || 'Complete the active inputs for this area and sector.'}
        </div> : null;
      })}
      <section className="modern-bau-section intervention-reading-section" data-section-key="coverage">
        {heading(2, 'Coverage graphs')}
        {loading ? <div className="modern-intv-table-state" aria-label="Calculating coverage"><span className="modern-skeleton" /><span className="modern-skeleton" /><span className="modern-skeleton" /></div> :
          !viewUsable ? <p className="modern-intv-table-state">Coverage unavailable for this complete view. Resolve the affected area/sector inputs below; missing constituents are never treated as zero.</p> :
          <>
            <CoverageKpis values={kpis} scenarioLabel="Revised targets · existing funding" contextLabel={`${viewLabel} · ${BAU_SERVICE_LEVELS.find(item => item.value === level)?.label}`} />
            {!sharedUnits && <div className="post-tools" role="group" aria-label="Coverage chart units">
              <button className="post-button" aria-pressed={unit === 'percent'} onClick={() => setLocalUnits('percent')}>% coverage</button>
              <button className="post-button" aria-pressed={unit === 'households'} onClick={() => setLocalUnits('households')}>Households (millions)</button>
            </div>}
            <div className="loan-chart">
              <div className="post-tools"><h3>{sectorName(activeSector)} — {BAU_SERVICE_LEVELS.find(item => item.value === level)?.label}</h3>
                <ChartExport chartRef={chartRef} filename={`post_${effectiveView}_${activeSector}_${level}`} title={`Post-intervention coverage · ${context}`}
                  sheets={[{ name: 'Coverage', headers: coverageHeaders, rows: chartRows.map(row => [row.year, row.reference, row.adjusted, row.target, row.funded]) }]}
                  chartSpec={{ category: 'Year', yTitle: chartUnit, lines: [
                    { name: coverageHeaders[1], color: C.scenario }, { name: coverageHeaders[2], color: C.bau, dash: true },
                    { name: coverageHeaders[3], color: C.target, dash: true }, { name: coverageHeaders[4], color: INTV_PALETTE.financial },
                  ] }} compact />
              </div>
              <p className="post-note">Household coverage, not people. Reference and revised-existing-funding lines may coincide. Basic only is diagnostic; SM and at-least-basic thresholds define success.</p>
              <div ref={chartRef} className="loan-chart__canvas">
                <ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartRows} margin={{ top: 12, right: 15, bottom: 24, left: 4 }}>
                  <CartesianGrid stroke="#dce4e8" strokeDasharray="3 3" />
                  <XAxis dataKey="year" interval={yearAxisInterval(chartRows)} tick={{ fontSize: 10 }} />
                  <YAxis domain={unit === 'percent' ? [0, 100] : [0, 'auto']} tick={{ fontSize: 10 }}
                    tickFormatter={value => number(value)} width={52} label={{ value: chartUnit, angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#596b73' } }} />
                  <Tooltip formatter={(value: any) => `${number(value)}${unit === 'percent' ? '%' : ' M HH'}`} contentStyle={{ fontSize: 11 }} />
                  <Legend wrapperStyle={{ fontSize: 10, lineHeight: '18px' }} />
                  <ReferenceLine x={targetYear} stroke={C.total} strokeDasharray="2 4" />
                  <Line dataKey="reference" name="Selected-scenario reference" stroke={C.scenario} dot={false} strokeWidth={2} isAnimationActive={false} />
                  {adjustedDiffers && <Line dataKey="adjusted" name="Revised targets · existing funding" stroke={C.bau} strokeDasharray="4 3" dot={false} strokeWidth={2} isAnimationActive={false} />}
                  <Line dataKey="target" name="Revised target pathway" stroke={C.target} strokeDasharray="6 3" dot={false} strokeWidth={2} isAnimationActive={false} />
                  {viewVerified && <Line dataKey="funded" name="With verified additional funding" stroke={INTV_PALETTE.financial} dot={false} strokeWidth={2.5} isAnimationActive={false} />}
                </ComposedChart></ResponsiveContainer>
              </div>
              {!viewVerified && <p className="post-note">No verified full-gap solution for this view. A candidate is not shown as achieved coverage.</p>}
            </div>
          </>}
      </section>
      <section className="modern-bau-section intervention-reading-section" data-section-key="gap">
        {heading(3, 'Remaining financing gap')}
        <p className="post-note">{viewLabel} · Target year {targetYear}. Money in millions of {shownCurrency}, real {data?.real_price_year ?? 'model price year'}. These are closing balances, not annual flows.</p>
        <div className="post-summary">
          <div className="post-kpi"><span>Safely managed shortfall · this view</span><strong>{number(viewUsable ? postSum(buckets.map(bucket => bucket?.sm_gap)) : null)} M HH</strong><small>Assessed locally before aggregation</small></div>
          <div className="post-kpi"><span>At least basic shortfall · this view</span><strong>{number(viewUsable ? postSum(buckets.map(bucket => bucket?.at_least_basic_gap)) : null)} M HH</strong><small>Threshold gaps can overlap; do not add them as beneficiaries</small></div>
          <div className="post-kpi"><span>Remaining financing requirement · no additional funding · this view</span><strong>{money(viewResidual)}</strong><small>Expansion + ancillary + replacement backlog + modeled cash shortfalls</small></div>
          <div className="post-kpi"><span>Additional annual funding required (% of GDP) · this view</span><strong>{envelope(viewFraction)}</strong><small>{viewVerified ? 'Smallest verified share under this schedule and tolerance; not a globally optimal strategy' : statusText || 'Awaiting valid calculation'}</small></div>
        </div>
        <details className="loan-optional" open>
          <summary>Target-year financing composition · {viewLabel}</summary>
          <div className="loan-optional__body">
            <div className="post-tools"><span className="post-note">No new funding added versus verified funded run</span>
              <button className="post-button" type="button" disabled={!viewUsable} onClick={() => downloadCsv('post_financing_composition',
                [...metadataHeaders, 'Component', `No new funding (M ${shownCurrency})`, `After verified funding (M ${shownCurrency})`],
                csvMetadata(viewLabel, [...compositionRows, ['Total remaining requirement', viewResidual,
                  viewVerified ? postSum(buckets.map(bucket => bucket?.remaining_financial_components?.total)) : null] as const]
                  .map(row => [row[0], moneyValue(row[1]), moneyValue(row[2])])))}>CSV</button>
            </div>
            <div className="post-table-frame"><table className="post-table">
              <thead><tr><th scope="col">Closing requirement</th><th scope="col">No new funding</th><th scope="col">After verified funding</th></tr></thead>
              <tbody>{compositionRows.map(row => <tr key={row[0]}><th scope="row">{row[0]}</th><td>{money(row[1])}</td><td>{money(row[2])}</td></tr>)}</tbody>
              <tfoot><tr><th scope="row">Total remaining requirement</th><td>{money(viewResidual)}</td><td>{money(viewVerified ? postSum(buckets.map(bucket => bucket?.remaining_financial_components?.total)) : null)}</td></tr></tfoot>
            </table></div>
            <p className="post-note">Funding already applied by the engine is not subtracted again. Closing balances are never summed across years. This is the model-defined requirement, not a new comprehensive lifecycle/O&amp;M estimate.</p>
          </div>
        </details>
        <details className="loan-optional"><summary>Calculation status · all active area/sector buckets</summary>
          <div className="loan-optional__body">{areaKeys.map(area => sectors.map(active => {
            const bucket: PostBucket | undefined = data?.per_area_sector?.[area]?.[active];
            const verified = verifiedPostBucket(bucket);
            return <div className="post-status" key={`${area}-${active}`} data-error={bucket?.solver_status === 'invalid_inputs'}>
              <strong>{areaName(area)} · {sectorName(active)}: {bucket ? postStatus(bucket.solver_status) : loading ? 'Calculating…' : 'Unavailable'}</strong>
              {bucket?.error && <p>{bucket.error}</p>}
              {bucket && usablePostBucket(bucket) && <>
                <p>Annual envelope: {verified ? envelope(bucket.funding_fraction) : 'Not verified'}.
                  {!verified && postFinite(bucket.candidate_fraction) ? ` Tested candidate only: ${envelope(bucket.candidate_fraction)}; not a full-gap solution.` : ''}</p>
                {!verified && bucket.remaining_financial_components && <p>Candidate closing financial obligations: {money(bucket.remaining_financial_components.total)}. No new repayment policy is assumed.</p>}
                {bucket.warnings?.map((warning, at) => <p key={at}>{warning}</p>)}
                <details><summary>Convergence diagnostics</summary><dl>{Object.entries(bucket.convergence_diagnostics || {}).map(([key, value]) =>
                  <React.Fragment key={key}><dt>{key.replace(/_/g, ' ')}</dt><dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></React.Fragment>)}</dl></details>
              </>}
            </div>;
          }))}</div>
        </details>
      </section>
      <section className="modern-bau-section intervention-reading-section" data-section-key="gdp">
        {heading(4, 'GDP spending equivalent')}
        <p className="post-note">Execution-adjusted funding is made available each year at a constant share of national real GDP. Actual use can be smaller: unused funding is not executed spending. This financing equivalent is not an allocated government budget or a fiscal-policy recommendation.</p>
        <div className="post-status"><strong>Full project · all active areas and sectors</strong><br />
          Additional annual funding required (% of GDP): <strong>{envelope(fullVerified ? data?.combined.funding_fraction : null)}</strong><br />
          Target-year remaining financing requirement, no new funding: <strong>{money(data?.combined.target_year_residual_total)}</strong>
          {!fullVerified && <p>Full-project funding unavailable until every active area/sector has a verified schedule and the combined replay succeeds. View-level results above are not a substitute.</p>}
        </div>
        <p className="post-note">One common national GDP path is used, never the sum of urban and rural copies. Funding window: {data?.funding_window.start ?? baseline + 1}–{data?.funding_window.end ?? targetYear}. Money: M {shownCurrency}, real {data?.real_price_year ?? 'model price year'}. Historical years are excluded from this funding table.</p>
        {renderAnnual('view')}
        {renderAnnual('full')}
        <p className="post-note">The target-year residual and the sum of available funding are different measures. Timing changes delivery, revenues, replacement and unused amounts. Available = used + unused; percentages are calculated from the same national GDP denominator. Missing/invalid GDP is unavailable, never zero.</p>
      </section>
    </div>
  </div>;
}
