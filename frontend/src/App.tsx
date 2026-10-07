import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BUNDLE_KEY, isBundle, areasOf } from './areaBundle';
import InputPanel from './components/InputPanel';
import InterventionPanel from './components/InterventionPanel';
import DebtServicingPanel from './components/DebtServicingPanel';
import RevenueReconciliation from './components/RevenueBase';
import ResultsDashboard from './components/ResultsDashboard';
import LiveBAUChart from './components/LiveBAUChart';
import { fetchDefaults, runCalculation, runEconomicProjections } from './api';
import { type ContributionView } from './contributionView';
import { CurrencyDisplayControl, defaultCurrencyDisplay, type CurrencyDisplaySettings, validRate } from './currencyDisplay';
import { chooseDevelopmentPreview } from './developmentPreview';
import { migrateNrwRevenueInputs } from './nrwRevenue';

// The BAU view stacks two charts with identical elements: Safely managed (rung 0) then Basic (rung 1).
function BAUChartPair(props: { inputsList: any[]; sector: 'water' | 'sanitation'; scopeLabel?: string; currencyDisplay: CurrencyDisplaySettings }) {
  const currencies = [...new Set(props.inputsList.map(input => String(input?.country_config?.currency || 'LCU').toUpperCase()))];
  const mixedCurrencies = currencies.length > 1;
  const displaySettings = mixedCurrencies ? { ...props.currencyDisplay, mode: 'local' as const } : props.currencyDisplay;
  return (
    <>
      {mixedCurrencies && <div style={{ fontSize: 11, color: '#b45309', marginBottom: 10 }}>
        USD display is unavailable because this combined view contains different source currencies ({currencies.join(', ')}).
      </div>}
      <LiveBAUChart {...props} currencyDisplay={displaySettings} rung={0} />
      <div style={{ height: 1, background: '#e2e8f0', margin: '28px 0 20px' }} />
      <LiveBAUChart {...props} currencyDisplay={displaySettings} rung={1} />
    </>
  );
}
// Older saved sessions/profiles kept injection as an option under the financial master switch.
// Give each area an independent switch without altering settings that already use the new one.
function migrateInjectionToggle(area: any) {
  if (!area) return area;
  const toggles = { ...(area.toggles || {}) };
  for (const [prefix, section] of [['ws', 'water_interventions'], ['san', 'sanitation_interventions']]) {
    const key = `${prefix}_exogenous_injection_enabled`;
    if (!(key in toggles)) {
      toggles[key] = !!(toggles[`${prefix}_financial_commitment_enabled`] && area[section]?.fin_injection_enabled);
    }
  }
  return migrateNrwRevenueInputs({ ...area, toggles });
}

export default function App() {
  const [inputs, setInputs] = useState<any>(null);
  const [mockSetupError, setMockSetupError] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const [contributionView, setContributionView] = useState<ContributionView>('individual');
  const [currencyDisplay, setCurrencyDisplay] = useState<CurrencyDisplaySettings>(defaultCurrencyDisplay());
  const [focusCurrencyRequest, setFocusCurrencyRequest] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [profileList, setProfileList] = useState<string[]>([]);
  const [scenarios, setScenarios] = useState<{name: string, inputs: any}[]>([]);
  // Two data-entry modes: 'urban_rural' (toggle Urban and/or Rural) or 'national' (single national dataset)
  const [scopeMode, setScopeMode] = useState<'urban_rural' | 'national'>('urban_rural');
  const [areaUrban, setAreaUrban] = useState(true);
  const [areaRural, setAreaRural] = useState(true);
  const [subArea, setSubArea] = useState<'urban' | 'rural'>('urban'); // which dataset is being edited when both are on
  const [altInputs, setAltInputs] = useState<Record<string, any>>({});
  const [sectorTab, setSectorTab] = useState<'water' | 'sanitation'>('water');
  // Which area the BAU graph shows when both Urban & Rural are entered (toggle instead of 3 stacked charts).
  const [bauChartScope, setBauChartScope] = useState<'national' | 'urban' | 'rural'>('national');
  const [showGuide, setShowGuide] = useState(false);
  const [guideSection, setGuideSection] = useState<string | null>(null);
  // Focusing a section points the contextual Guide at that section. If the user has MANUALLY closed the
  // guide, re-clicking the SAME section must not reopen it — only moving to a DIFFERENT section reopens it.
  const focusGuideSection = (key: string) => {
    setShowGuide(prev => prev || key !== guideSection);
    setGuideSection(key);
  };

  const refreshProfiles = () => {
    fetch('/api/profiles').then(r => r.json()).then(setProfileList).catch(() => {});
  };

  // Restore the last working session (all areas + entry mode) before falling back to the defaults,
  // so a refresh no longer silently drops whatever was entered for Rural or National.
  useEffect(() => {
    let cancelled = false;
    const initialize = async () => {
    let session: any = null;
    try { session = JSON.parse(localStorage.getItem('wss_working_bundle') || 'null'); } catch { /* corrupt — ignore */ }
    let savedScenarios: any[] = [];
    try { savedScenarios = JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]'); } catch { /* corrupt — ignore */ }
    try {
      const response = await fetch('/api/development-preview');
      if (!response.ok) throw new Error('Could not check the development preview profile.');
      const preview = await response.json();
      if (cancelled) return;
      const selected = chooseDevelopmentPreview(session, savedScenarios, preview, localStorage.getItem('wss_development_preview_revision'));
      if (selected.switched) {
        // Back up work before switching. If storage fails, retain the original session.
        localStorage.setItem('wss_demo_scenarios', JSON.stringify(selected.scenarios));
        localStorage.setItem('wss_working_bundle', JSON.stringify(selected.session));
        localStorage.setItem('wss_development_preview_revision', preview.revision);
        session = selected.session;
        savedScenarios = selected.scenarios;
      }
      if (preview.mock_setup_revision &&
          localStorage.getItem('wss_mock_setup_revision') !== preview.mock_setup_revision &&
          session?.inputs?.profile_metadata?.status === 'data_preview') {
        const response = await fetch('/api/mock-drc-inputs', {
          method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(session),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || 'Mock inputs could not be applied.');
        if (cancelled) return;
        if (result.applied) {
          const backup = [...savedScenarios,
            {name: 'Original DRC inputs before mock setup', inputs: session},
            {name: 'DRC mock simulation (2,309.58 CDF/USD)', inputs: result.bundle}];
          // If the backup cannot be saved, do not replace the working inputs.
          localStorage.setItem('wss_demo_scenarios', JSON.stringify(backup));
          localStorage.setItem('wss_working_bundle', JSON.stringify(result.bundle));
          localStorage.setItem('wss_mock_setup_revision', preview.mock_setup_revision);
          session = result.bundle;
          savedScenarios = backup;
        }
      }
    } catch (error) {
      console.warn('Development setup not applied; retaining the working session.', error);
      if (!cancelled) setMockSetupError(error instanceof Error ? error.message : String(error));
    }
    if (cancelled) return;
    if (session?.inputs) {
      setAltInputs(Object.fromEntries(Object.entries(session.altInputs || {}).map(([key, area]) => [key, migrateInjectionToggle(area)])));
      const sc = session.scope || {};
      if (sc.scopeMode) setScopeMode(sc.scopeMode);
      if (typeof sc.areaUrban === 'boolean') setAreaUrban(sc.areaUrban);
      if (typeof sc.areaRural === 'boolean') setAreaRural(sc.areaRural);
      setInputs(migrateInjectionToggle(session.inputs));
      if (['data_preview', 'mock_simulation'].includes(session.inputs.profile_metadata?.status)) setShowOnboarding(false);
      if (session.presentation?.currencyDisplay) setCurrencyDisplay(session.presentation.currencyDisplay);
      if (session.presentation?.contributionView) setContributionView(session.presentation.contributionView);
    } else {
      const defaults = await fetchDefaults();
      if (!cancelled) setInputs(migrateInjectionToggle(defaults));
    }
    refreshProfiles();
    if (savedScenarios.length) {
      setScenarios(savedScenarios.map((sc: any) => ({
        ...sc, inputs: isBundle(sc.inputs) ? {
          ...sc.inputs, inputs: migrateInjectionToggle(sc.inputs.inputs),
          altInputs: Object.fromEntries(Object.entries(sc.inputs.altInputs || {}).map(([key, area]) => [key, migrateInjectionToggle(area)])),
        } : migrateInjectionToggle(sc.inputs),
      })));
    }
    };
    initialize().catch(error => console.error('Could not load the initial simulation.', error));
    return () => { cancelled = true; };
  }, []);

  const resizeMacroArrays = useCallback((inp: any) => {
    // Macro series are HARD VALUES ONLY (historical + any forecast years with data): the engine
    // fills the tail itself (ongoing inflation rates, GDP real-growth projection, FX from the
    // inflation differential). So arrays are only TRUNCATED if the model window shrinks — never
    // padded, or the ongoing/projection logic would be silently disabled.
    if (!inp?.period?.model_start_year || !inp?.period?.forecast_end_year || !inp?.macro) return inp;
    const needed = inp.period.forecast_end_year - inp.period.model_start_year + 1;
    const macroFields = ['gdp_real_local', 'gdp_growth', 'gdp_nominal_usd', 'inflation_nepal', 'inflation_us', 'exchange_rate'];
    let changed = false;
    const newMacro = { ...inp.macro };
    for (const field of macroFields) {
      const arr = newMacro[field];
      if (!arr || arr.length <= needed) continue;
      changed = true;
      newMacro[field] = arr.slice(0, needed);
    }
    return changed ? { ...inp, macro: newMacro } : inp;
  }, []);

  const handleSetInputs = useCallback((newInputs: any) => {
    setInputs(resizeMacroArrays(migrateInjectionToggle(newInputs)));
  }, [resizeMacroArrays]);

  // ── Area bundle ────────────────────────────────────────────────────────────────────────────────
  // `inputs` only ever holds the PRIMARY (urban, or the sole dataset); Rural and National live in
  // `altInputs`, and the entry mode lives in three more state flags. Persisting `inputs` alone —
  // which is what profiles, scenarios and reloads used to do — therefore threw away every area but
  // the first, so a two-area scenario could not survive a save or a refresh. Everything is packed
  // into one versioned envelope instead; bare-inputs payloads (old profiles, /api/defaults) still
  // load, they just carry no extra areas.
  const packBundle = useCallback(() => ({
    [BUNDLE_KEY]: 1,
    inputs,
    altInputs,
    scope: { scopeMode, areaUrban, areaRural },
    presentation: { contributionView, currencyDisplay },
  }), [inputs, altInputs, scopeMode, areaUrban, areaRural, contributionView, currencyDisplay]);

  const sourceCurrency = inputs?.country_config?.currency || 'LCU';
  useEffect(() => {
    setCurrencyDisplay(previous => previous.sourceCurrency === sourceCurrency
      ? previous
      : defaultCurrencyDisplay(sourceCurrency));
  }, [sourceCurrency]);

  const updateCurrencyDisplay = (next: CurrencyDisplaySettings) => {
    const source = inputs?.country_config?.currency || 'LCU';
    setCurrencyDisplay({ ...next, sourceCurrency: source,
      mode: source.toUpperCase() === 'USD' || validRate(next, source) ? next.mode : 'local' });
  };
  const editCurrencyRate = () => {
    setActiveTab(0);
    setFocusCurrencyRequest(request => request + 1);
  };

  // Autosave the working bundle (debounced) so a refresh keeps every area, not just the primary.
  useEffect(() => {
    if (!inputs) return;
    const h = setTimeout(() => {
      try { localStorage.setItem('wss_working_bundle', JSON.stringify(packBundle())); }
      catch { /* quota exceeded — the session just won't be restorable */ }
    }, 800);
    return () => clearTimeout(h);
  }, [packBundle, inputs]);

  const applyBundle = useCallback((obj: any) => {
    if (!obj) return;
    if ((isBundle(obj) ? obj.inputs : obj)?.profile_metadata?.status === 'data_preview') setActiveTab(0);
    if (!isBundle(obj)) {                       // legacy / defaults: a bare inputs object
      setAltInputs({});
      handleSetInputs(obj);
      setCurrencyDisplay(defaultCurrencyDisplay(obj?.country_config?.currency || 'LCU'));
      return;
    }
    setAltInputs(Object.fromEntries(Object.entries(obj.altInputs || {}).map(([key, area]) => [key, migrateInjectionToggle(area)])));
    const sc = obj.scope || {};
    if (sc.scopeMode) setScopeMode(sc.scopeMode);
    if (typeof sc.areaUrban === 'boolean') setAreaUrban(sc.areaUrban);
    if (typeof sc.areaRural === 'boolean') setAreaRural(sc.areaRural);
    if (sc.scopeMode === 'urban_rural' && sc.areaUrban === false) setSubArea('rural');
    const source = obj.inputs?.country_config?.currency || 'LCU';
    const savedCurrency = obj.presentation?.currencyDisplay;
    setCurrencyDisplay(savedCurrency?.sourceCurrency === source ? savedCurrency : defaultCurrencyDisplay(source));
    if (obj.presentation?.contributionView) setContributionView(obj.presentation.contributionView);
    handleSetInputs(obj.inputs);
  }, [handleSetInputs]);

  // Resolve the scope into the concrete area being edited and what the graphs/outputs should show.
  const both = scopeMode === 'urban_rural' && areaUrban && areaRural;
  const onlyRural = scopeMode === 'urban_rural' && !areaUrban && areaRural;
  // inputScope = which single dataset the input forms currently edit ('urban' | 'rural' | 'national')
  const inputScope = scopeMode === 'national' ? 'national'
    : both ? subArea
    : onlyRural ? 'rural'
    : 'urban';
  // chartScope = what graphs/outputs display: a single area, or the national aggregate when both areas are on
  const chartScope = scopeMode === 'national' ? 'national'
    : both ? 'urban_rural'
    : onlyRural ? 'rural'
    : 'urban';

  // Materialise a secondary area's dataset the moment the user opens it for entry.
  //
  // The input forms fall back to `altInputs[scope] ?? inputs`, so the Rural tab renders Urban's
  // numbers and reads as already filled — but until something is EDITED no rural dataset exists, and
  // everything downstream (the national roll-up, the slide deck) correctly treats rural as absent.
  // The result is an export that silently omits an area the user believes they entered. Seeding the
  // dataset on first visit makes what is on screen and what is exported the same thing. Seeded from
  // the primary, which is what the form was already showing, so nothing visibly changes.
  // Seeding on SELECTION, not on first visit to the tab: choosing "Urban + Rural (national total)"
  // is the statement that the analysis has two areas, and the deck has to match that choice whether
  // or not the Rural tab was ever opened. Tying it to the visit meant a user who selected both areas
  // and went straight to Results exported an urban-only deck.
  useEffect(() => {
    if (!inputs) return;
    const need = scopeMode === 'national' ? 'national' : (areaRural ? 'rural' : null);
    if (!need) return;
    setAltInputs(prev => prev[need] ? prev : { ...prev, [need]: JSON.parse(JSON.stringify(inputs)) });
  }, [scopeMode, areaRural, inputs]);

  // §2a start-year change re-anchors EVERY area's positional (index-by-year) series, so a SHARED
  // analysis period keeps urban & rural aligned. Mirrors InputPanel's shiftYearSeries.
  const shiftAreaArrays = useCallback((obj: any, delta: number) => {
    if (!obj || !delta) return obj;
    const shift = (arr: any) => !Array.isArray(arr) ? arr : delta > 0 ? arr.slice(delta) : [...Array(-delta).fill(0), ...arr];
    const g = (o: any, fields: string[]) => { if (!o) return o; const n = { ...o }; fields.forEach(f => { if (Array.isArray(n[f])) n[f] = shift(n[f]); }); return n; };
    return { ...obj,
      macro: g(obj.macro, ['gdp_real_local', 'gdp_nominal_usd', 'inflation_nepal', 'inflation_us', 'exchange_rate', 'gdp_growth']),
      population: g(obj.population, ['pop_ts', 'hh_ts']),
      water_service: g(obj.water_service, ['serv1_ts', 'serv2_ts', 'serv3_ts', 'serv4_ts', 'serv5_ts']),
      sanitation_service: g(obj.sanitation_service, ['sserv1_ts', 'sserv2_ts', 'sserv3_ts', 'sserv4_ts', 'sserv5_ts']),
      bau: g(obj.bau, ['ws_budget_ts', 'san_budget_ts', 'ws_expend_ts', 'san_expend_ts']) };
  }, []);
  // 'urban' is the primary dataset (held in `inputs`). §1 Country config and §2a Analysis Period are
  // SHARED across urban/rural: always sourced from the primary and overlaid onto the area being edited,
  // so editing them from either area keeps both in sync. (National is a separate single-dataset mode.)
  const activeInputsRaw = inputScope === 'urban' ? inputs : (altInputs[inputScope] ?? inputs);
  const activeInputs = React.useMemo(() =>
    (inputScope === 'rural' && inputs && activeInputsRaw)
      ? { ...activeInputsRaw, country_config: inputs.country_config, period: inputs.period }
      : activeInputsRaw,
    [inputScope, inputs, activeInputsRaw]);
  // Live engine results for the ACTIVE dataset (debounced), so the input table can show the engine's
  // computed forecast-year values (population, GDP, budget, allocated/actual capex, …).
  const [results, setResults] = useState<any>(null);
  const resultInputs = useRef<any>(null);
  const [economicProjections, setEconomicProjections] = useState<any>(null);
  const [projectionError, setProjectionError] = useState('');
  const [calculationError, setCalculationError] = useState('');
  const [calculationRevision, setCalculationRevision] = useState(0);
  useEffect(() => {
    if (!activeInputs) return;
    let cancelled = false;
    setResults(null);
    setEconomicProjections(null);
    setProjectionError('');
    const h = setTimeout(() => {
      runEconomicProjections(activeInputs).then(value => {
        if (!cancelled) setEconomicProjections(value);
      }).catch(error => {
        if (!cancelled) {
          setEconomicProjections(null);
          setProjectionError(error instanceof Error ? error.message : String(error));
        }
      });
      runCalculation(activeInputs).then(value => {
        if (!cancelled) { resultInputs.current = activeInputs; setResults(value); setCalculationError(''); }
      }).catch(error => {
        if (!cancelled) { setResults(null); setCalculationError(error.message); }
      });
    }, 350);
    return () => { cancelled = true; clearTimeout(h); };
  }, [activeInputs, calculationRevision]);
  const retryCalculation = useCallback(() => {
    setResults(null);
    setCalculationError('');
    setCalculationRevision(revision => revision + 1);
  }, []);
  const handleSetActiveInputs = useCallback((newInputs: any) => {
    const resized = resizeMacroArrays(newInputs);
    const oldStart = inputs?.period?.model_start_year, newStart = resized?.period?.model_start_year;
    const delta = (Number.isFinite(newStart) && Number.isFinite(oldStart)) ? newStart - oldStart : 0;
    if (inputScope === 'urban') {
      // Primary edit. If the (shared) start year moved, re-anchor the other areas' series too.
      if (delta) setAltInputs(prev => { const n: Record<string, any> = {}; for (const k of Object.keys(prev)) n[k] = shiftAreaArrays(prev[k], delta); return n; });
      setInputs(resized);
    } else if (inputScope === 'rural') {
      // Rural edit: area series stay in altInputs.rural; shared Country/Period propagate to the primary
      // (and a start-year change re-anchors the primary's series so both areas stay aligned).
      setAltInputs(prev => ({ ...prev, rural: resized }));
      setInputs((prev: any) => { let next = { ...prev, country_config: resized.country_config, period: resized.period }; if (delta) next = shiftAreaArrays(next, delta); return resizeMacroArrays(next); });
    } else {
      setAltInputs(prev => ({ ...prev, [inputScope]: resized }));   // national — isolated single dataset
    }
  }, [resizeMacroArrays, inputScope, inputs, shiftAreaArrays]);

  // Flip one intervention toggle on/off across EVERY area (interventions are on/off globally, applied per
  // area). Used by the Results dashboard's on/off toggles — the parameters still live on the Intervention tab.
  const setToggle = useCallback((key: string, value: boolean) => {
    setInputs((prev: any) => prev ? { ...prev, toggles: { ...prev.toggles, [key]: value } } : prev);
    setAltInputs(prev => {
      const n: Record<string, any> = {};
      for (const k of Object.keys(prev)) n[k] = { ...prev[k], toggles: { ...prev[k].toggles, [key]: value } };
      return n;
    });
  }, []);

  // Geographical scope as ONE dropdown value: 'both' (Urban + Rural), 'urban', 'rural', 'national'.
  const scopeValue = scopeMode === 'national' ? 'national' : (areaUrban && areaRural) ? 'both' : areaRural ? 'rural' : 'urban';
  const setScopeValue = (v: string) => {
    if (v === 'national') { setScopeMode('national'); return; }
    setScopeMode('urban_rural');
    if (v === 'both') { setAreaUrban(true); setAreaRural(true); }
    else if (v === 'urban') { setAreaUrban(true); setAreaRural(false); setSubArea('urban'); }
    else { setAreaUrban(false); setAreaRural(true); setSubArea('rural'); }
  };
  // First-visit attention sequence: after the Tool Overview (guide) closes, pulse the scope card and
  // point at the dropdown with a "Start here" nudge. Shown once (localStorage), dismissed on use.
  const [scopeHint, setScopeHint] = useState(false);
  const scopeHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerScopeHint = () => {
    if (localStorage.getItem('wss_scope_hint_seen')) return;
    localStorage.setItem('wss_scope_hint_seen', '1');
    setScopeHint(true);
    scopeHintTimer.current = setTimeout(() => setScopeHint(false), 10000);
  };
  const dismissScopeHint = () => {
    if (scopeHintTimer.current) clearTimeout(scopeHintTimer.current);
    setScopeHint(false);
  };

  const saveScenario = () => {
    const name = prompt('Name this scenario:');
    if (!name) return;
    // Store the whole area bundle so a saved scenario restores Rural/National too, not just urban.
    const updated = [...scenarios, { name, inputs: JSON.parse(JSON.stringify(packBundle())) }];
    setScenarios(updated);
    localStorage.setItem('wss_demo_scenarios', JSON.stringify(updated));
  };

  const deleteScenario = (idx: number) => {
    const updated = scenarios.filter((_, i) => i !== idx);
    setScenarios(updated);
    localStorage.setItem('wss_demo_scenarios', JSON.stringify(updated));
  };

  // Validation
  const warnings: string[] = [];
  if (inputs) {
    const p = inputs.period;
    // Year sequencing: model start < baseline < forecast end, with the as-is window inside it.
    if (p.model_start_year >= p.baseline_year) warnings.push('Model start year must be before the last year of historical data');
    else if (p.baseline_year - p.model_start_year < 3) warnings.push('Model start year should be at least 3 years before the last year of historical data');
    if (p.forecast_end_year <= p.baseline_year) warnings.push('Forecast end year must be after the last year of historical data');
    // Targets now live in the §2 table: any forecast year with a fully-entered service column (Σ 100%).
    // Warn about partially-filled columns and about a sector with no target at all.
    const checkTargets = (svc: any, prefix: string, label: string) => {
      const fields = [1, 2, 3, 4, 5].map(i => `${prefix}${i}_ts`);
      const maxLen = Math.max(0, ...fields.map(f => (svc?.[f] || []).length));
      let count = 0;
      for (let idx = 0; idx < maxLen; idx++) {
        const yr = p.model_start_year + idx;
        if (yr <= p.baseline_year || yr > p.forecast_end_year) continue;
        let sum = 0, any = false;
        for (const f of fields) { const v = (svc?.[f] || [])[idx]; if (v != null && v > 0) { sum += v; any = true; } }
        if (!any) continue;                                               // empty column — fine (not a target)
        if (Math.abs(sum - 1) < 0.02) { count++; continue; }              // valid target (zeros for some rungs OK)
        warnings.push(`${label} target column for ${yr} sums to ${Math.round(sum * 100)}% — a target column must total 100%.`);
      }
      return count;
    };
    if (checkTargets(inputs.water_service, 'serv', 'Water') === 0) warnings.push('No water target year set — fill a full forecast service-level column (Σ 100%) in the table.');
    if (checkTargets(inputs.sanitation_service, 'sserv', 'Sanitation') === 0) warnings.push('No sanitation target year set — fill a full forecast service-level column (Σ 100%) in the table.');
    // Technology-mix shares. A table summing to less than 100% quietly understates the unit cost, which
    // overstates how many households the budget reaches, so it is raised here rather than left to a
    // footnote under the table.
    const checkMix = (mix: any, label: string) => {
      const rows = (mix || []).filter((t: any) => t && typeof t === 'object');
      if (!rows.length) return;
      const sum = rows.reduce((a: number, t: any) => a + (+t.share || 0), 0);
      if (Math.abs(sum - 1) >= 0.001) {
        warnings.push(`${label} technology mix shares sum to ${(sum * 100).toFixed(1)}% — they must total 100%, or the unit cost will be wrong.`);
      }
    };
    checkMix(inputs.water_costs?.sm_tech_mix, 'Water safely-managed');
    checkMix(inputs.water_costs?.basic_tech_mix, 'Water basic');
    checkMix(inputs.sanitation_costs?.sm_tech_mix, 'Sanitation safely-managed');
    checkMix(inputs.sanitation_costs?.basic_tech_mix, 'Sanitation basic');
    // The optimised-technology lever's own mixes, checked only where that lever is switched on.
    if (inputs.toggles?.ws_techmix_enabled) {
      checkMix(inputs.water_interventions?.techmix_sm_tech_mix, 'Water optimised-technology safely-managed');
      checkMix(inputs.water_interventions?.techmix_basic_tech_mix, 'Water optimised-technology basic');
    }
    if (inputs.toggles?.san_techmix_enabled) {
      checkMix(inputs.sanitation_interventions?.techmix_sm_tech_mix, 'Sanitation optimised-technology safely-managed');
      checkMix(inputs.sanitation_interventions?.techmix_basic_tech_mix, 'Sanitation optimised-technology basic');
    }
  }

  // Exports now live throughout the tool (per-table, per-chart, and the whole-scenario Export buttons on
  // the Intervention Design and Results tabs), so there is no separate Export tab.
  const tabs = ['Data Inputs', 'BAU Scenario', 'Intervention Design', 'Loan funding', 'Results Dashboard'];
  const isDataPreview = inputs?.profile_metadata?.status === 'data_preview';
  const isMockSimulation = inputs?.profile_metadata?.status === 'mock_simulation';

  return (
    <div className="wb-app" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <RevenueReconciliation inputs={activeInputs} onChange={handleSetActiveInputs} area={inputScope} silent={true} />
      {mockSetupError && <div role="alert" style={{padding:'8px 16px',background:'#fff1f2',color:'#9f1239'}}>
        Mock setup could not be applied: {mockSetupError} Your original inputs were retained.
      </div>}
      {isMockSimulation && <div role="note" style={{padding:'8px 16px',background:'#fff8e7',color:'#714b10',fontSize:12}}>
        <strong>DRC mock simulation — illustrative assumptions.</strong> Blank unit costs and remaining technical/revenue fields have been filled for testing.
        {' '}Conversion: <strong>2,309.58 CDF per US$1</strong> (user supplied). These are not validated DRC estimates.
        {' '}Restore “Original DRC inputs before mock setup” from Saved scenarios to return to your prior inputs.
        <details><summary>View initial mock assumptions for this area (later field edits may differ)</summary>
          {(activeInputs?.profile_metadata?.mock_assumptions || []).map((item: any, index: number) =>
            <div key={`${item.field}-${index}`}><strong>{item.field}</strong>: {String(item.value)} — {item.basis}</div>)}
        </details>
      </div>}
      {isDataPreview && <div role="status" style={{ padding: '8px 16px', background: '#fff8e6', fontSize: 12 }}>
        <strong>DRC spreadsheet data preview — settings pending.</strong> Urban and rural data are loaded.
        {' '}All workflow tabs are available. Missing or invalid model settings may still prevent calculations.
        {' '}The differing GDP forecasts have been retained as uploaded.
      </div>}
      {/* Header */}
      <header className="wb-header">
        <div className="wb-brand-lockup">
          <span className="wb-brand-mark" aria-hidden="true">WSS</span>
          <span className="wb-brand-divider" aria-hidden="true" />
          <div className="wb-brand-copy">
            <h1 className="wb-brand-title">
              <span className="wb-heading-strong">WSS STRATEGIC SCENARIOS</span>
              <span className="wb-heading-light">SIMULATION TOOL</span>
            </h1>
            <span className="wb-brand-meta">{inputs?.country_config?.country || ''}{inputs?.country_config?.area ? ` — ${inputs.country_config.area}` : ''}</span>
          </div>
        </div>
        <div className="wb-header-actions">
          <select onChange={async (e) => {
            const val = e.target.value;
            if (val === '__blank') { const res = await fetch('/api/defaults/blank'); applyBundle(await res.json()); }
            else if (val === '__default') { const res = await fetch('/api/defaults'); applyBundle(await res.json()); }
            else if (val) { const res = await fetch(`/api/profiles/${val}`); applyBundle(await res.json()); }
            e.target.value = '';
          }} className="wb-profile-select">
            <option value="" style={{ background: '#fff', color: '#333' }}>Load Profile...</option>
            <option value="__default" style={{ background: '#fff', color: '#333' }}>Nepal KV (Default)</option>
            <option value="__blank" style={{ background: '#fff', color: '#333' }}>── New Blank Country ──</option>
            {profileList.length > 0 && <option disabled style={{ background: '#f1f5f9', color: '#94a3b8' }}>── Saved Profiles ──</option>}
            {profileList.map(name => (
              <option key={name} value={name} style={{ background: '#fff', color: '#333' }}>{name.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button onClick={async () => {
            const name = prompt('Save profile as:');
            if (!name) return;
            await fetch(`/api/profiles/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(packBundle()) });
            refreshProfiles(); alert(`Profile "${name}" saved!`);
          }} className="wb-header-action">Save Profile</button>
          <button onClick={saveScenario} className="wb-header-action">Save Scenario</button>
          <button id="tool-overview-btn" onClick={() => setShowOnboarding(true)} className="wb-header-action">Tool Overview</button>
        </div>
      </header>

      {/* Saved scenarios bar */}
      {scenarios.length > 0 && (
        <div className="wb-saved-scenarios" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span className="wb-saved-label">Saved scenarios:</span>
          {scenarios.map((s, i) => (
            <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button onClick={() => applyBundle(JSON.parse(JSON.stringify(s.inputs)))} className="wb-saved-scenario">
                {s.name}
              </button>
              <button onClick={() => {
                // Export this scenario as the branded deck, covering every area it was saved with.
                const presentation = s.inputs?.presentation;
                fetch('/api/export/deck', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ areas: areasOf(s.inputs), contribution_view: presentation?.contributionView || contributionView,
                    currency_display: presentation?.currencyDisplay || currencyDisplay }) })
                  .then(async r => {
                    if (!r.ok) { const payload = await r.json().catch(() => ({})); throw new Error(payload.detail || `Export failed (${r.status}).`); }
                    return r.blob();
                  }).then(b => { const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = `${s.name}_slides.pptx`; a.click(); URL.revokeObjectURL(u); })
                  .catch(error => alert(error.message));
              }} className="wb-scenario-export" aria-label={`Export ${s.name} slides`}>PPTX</button>
              <button onClick={() => deleteScenario(i)}
                className="wb-scenario-delete" aria-label={`Delete ${s.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* Tab Navigation */}
      <nav className="wb-tab-nav" aria-label="Scenario workflow">
        {tabs.map((tab, i) => {
          return (
          <button key={tab} onClick={() => setActiveTab(i)}
            className={`wb-tab${activeTab === i ? ' wb-tab-active' : ''}`}>
            <span className="wb-tab-step">{i + 1}</span>
            <span className="wb-tab-label">
              <span className="wb-tab-first">{tab.split(' ')[0]}</span>
              <span className="wb-tab-rest">{tab.slice(tab.indexOf(' ') + 1)}</span>
            </span>
          </button>
        );})}
      </nav>

      {warnings.length > 0 && (
        <div className="wb-warning-banner">
          {warnings.map((w, i) => <div key={i}>Warning: {w}</div>)}
        </div>
      )}

      {/* Main Content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Scope bar. Full controls (mode + include) only on Data Inputs; BAU & Intervention get just the Editing switch. The dashboard has its own scope dropdown. */}
        {activeTab <= 3 && (
          <div className="wb-scope-bar">
            {activeTab === 0 ? (
              <div onClickCapture={dismissScopeHint} className="wb-scope-card" style={{
                animation: scopeHint ? 'scopePulse 1.2s ease-in-out infinite' : undefined,
              }}>
                <style>{`
                  @keyframes scopePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(0,156,167,0.35); } 50% { box-shadow: 0 0 0 7px rgba(0,156,167,0.12); } }
                  @keyframes hintNudge { 0%,100% { transform: translateX(0); } 50% { transform: translateX(-9px); } }
                `}</style>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', display: 'inline-flex', alignItems: 'center' }}>
                    Select geographical scope
                  </span>
                  {/* Filled amber dropdown with an explicit ▼ so it's unmistakably a dropdown */}
                  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                    <select value={scopeValue} onChange={e => { setScopeValue(e.target.value); dismissScopeHint(); }} className="wb-scope-select" style={{
                      appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                      padding: '8px 38px 8px 14px', borderRadius: 6, border: '1px solid #94a3b8',
                      background: '#fff', color: '#1e293b', fontSize: 13, fontWeight: 600,
                      cursor: 'pointer', outline: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                    }}>
                      <option value="both" style={{ background: '#fff', color: '#333' }}>Urban + Rural (national total)</option>
                      <option value="urban" style={{ background: '#fff', color: '#333' }}>Urban only</option>
                      <option value="rural" style={{ background: '#fff', color: '#333' }}>Rural only</option>
                      <option value="national" style={{ background: '#fff', color: '#333' }}>National (no urban/rural breakdown)</option>
                    </select>
                    <span style={{ position: 'absolute', right: 10, pointerEvents: 'none', display: 'inline-flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
                      <span style={{ fontSize: 8, color: '#64748b' }}>▲</span>
                      <span style={{ fontSize: 8, color: '#64748b' }}>▼</span>
                    </span>
                  </span>
                  <span style={{ fontSize: 10.5, color: '#64748b', fontStyle: 'italic' }}>▲▼ click to choose</span>
                  {scopeHint && (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 6, background: '#2563eb', color: '#fff',
                      fontWeight: 700, fontSize: 12, padding: '6px 14px', borderRadius: 20, whiteSpace: 'nowrap',
                      boxShadow: '0 2px 12px rgba(37,99,235,0.5)', animation: 'hintNudge 0.7s ease-in-out infinite',
                    }}>Start here</span>
                  )}
                </div>
                {scopeValue === 'national' && (
                  <div style={{ fontSize: 10.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 4, padding: '4px 10px', marginTop: 8 }}>
                    National should only be used if you do not have — and cannot estimate — urban/rural breakdowns for WSS data and access.
                  </div>
                )}
                {(scopeValue === 'urban' || scopeValue === 'rural') && (
                  <div style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic', marginTop: 8 }}>
                    Graphs &amp; outputs show {scopeValue === 'rural' ? 'Rural' : 'Urban'} only.
                  </div>
                )}
                {scopeValue === 'both' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Entering data for:</span>
                    {(['urban', 'rural'] as const).map(a => (
                      <button key={a} onClick={() => setSubArea(a)}
                        className={`wb-scope-option${subArea === a ? ' wb-scope-option-active' : ''}`}>{a}</button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {both ? (
                  <>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b' }}>Entering data for:</span>
                    {(['urban', 'rural'] as const).map(a => (
                      <button key={a} onClick={() => setSubArea(a)}
                        className={`wb-scope-option${subArea === a ? ' wb-scope-option-active' : ''}`}>{a}</button>
                    ))}
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: '#64748b' }}>
                    Scope: <strong style={{ color: '#312e81' }}>{scopeMode === 'national' ? 'National' : onlyRural ? 'Rural' : 'Urban'}</strong>
                    <span style={{ fontStyle: 'italic', marginLeft: 6 }}>(set on the Data Inputs tab)</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
        {activeTab === 0 && inputs && (
          <InputPanel inputs={activeInputs} onChange={handleSetActiveInputs} results={results || economicProjections} calculationError={calculationError} projectionError={projectionError} geoScope={inputScope} showSection="inputs" onSectionFocus={focusGuideSection}
            currencyDisplay={currencyDisplay} onCurrencyDisplayChange={updateCurrencyDisplay} focusCurrencyRequest={focusCurrencyRequest} />
        )}
        {activeTab === 1 && inputs && (<>
          <div style={{ flex: '0 1 598px', display: 'flex', minWidth: 0 }}>
            <InputPanel inputs={activeInputs} onChange={handleSetActiveInputs} geoScope={inputScope} showSection="bau" bauSector={sectorTab} onBauSectorChange={setSectorTab} onSectionFocus={focusGuideSection}
              currencyDisplay={currencyDisplay} onCurrencyDisplayChange={updateCurrencyDisplay} onEditCurrencyRate={editCurrencyRate} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 28px', minWidth: 0, background: '#fff', borderLeft: '1px solid #e2e8f0' }}>
            {chartScope === 'urban_rural' ? (
              // Both areas entered: one chart at a time, switched via a scope toggle (Urban / Rural / National).
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginRight: 4 }}>View:</span>
                  {([['national', 'National (Urban + Rural)'], ['urban', 'Urban'], ['rural', 'Rural']] as const).map(([k, l]) => (
                    <button key={k} onClick={() => setBauChartScope(k)} style={{
                      padding: '6px 14px', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12,
                      fontWeight: bauChartScope === k ? 700 : 500,
                      background: bauChartScope === k ? '#2563eb' : '#e5e7eb',
                      color: bauChartScope === k ? '#fff' : '#374151',
                    }}>{l}</button>
                  ))}
                </div>
                {bauChartScope === 'national' ? (
                  <BAUChartPair inputsList={[inputs, altInputs['rural'] ?? inputs]} sector={sectorTab} scopeLabel="National" currencyDisplay={currencyDisplay} />
                ) : bauChartScope === 'urban' ? (
                  <BAUChartPair inputsList={[inputs]} sector={sectorTab} scopeLabel="Urban" currencyDisplay={currencyDisplay} />
                ) : (
                  <BAUChartPair inputsList={[altInputs['rural'] ?? inputs]} sector={sectorTab} scopeLabel="Rural" currencyDisplay={currencyDisplay} />
                )}
              </>
            ) : (
              <BAUChartPair inputsList={[activeInputs]} sector={sectorTab} currencyDisplay={currencyDisplay}
                scopeLabel={inputScope === 'national' ? 'National' : inputScope === 'rural' ? 'Rural' : 'Urban'} />
            )}
          </div>
        </>)}
        {activeTab === 2 && inputs && (
          <InterventionPanel inputs={activeInputs} onChange={handleSetActiveInputs} results={results} calculationError={calculationError} sectorTab={sectorTab} onSectorChange={setSectorTab} geoScope={inputScope} chartScope={chartScope} onSectionFocus={focusGuideSection} contributionView={contributionView} onContributionViewChange={setContributionView}
            currencyDisplay={currencyDisplay} onEditCurrencyRate={editCurrencyRate} onCurrencyDisplayChange={updateCurrencyDisplay} />
        )}
        {activeTab === 3 && inputs && (
          <DebtServicingPanel inputs={activeInputs} onChange={handleSetActiveInputs} results={resultInputs.current === activeInputs ? results : null} calculationError={calculationError}
            sectorTab={sectorTab} onSectorChange={setSectorTab} geoScope={inputScope} contributionView={contributionView}
            onContributionViewChange={setContributionView} currencyDisplay={currencyDisplay} onCurrencyDisplayChange={updateCurrencyDisplay}
            onEditCurrencyRate={editCurrencyRate} onSectionFocus={focusGuideSection} onRetry={retryCalculation} />
        )}
        {/* Guide panel — input, BAU, intervention and debt-servicing stages */}
        {activeTab <= 3 && (
          <>
            <button onClick={() => setShowGuide(!showGuide)} className="wb-guide-toggle" style={{
              position: 'absolute', right: showGuide ? 320 : 0, top: 12,
              padding: '8px 6px', border: '1px solid #cbd5e1', borderRight: showGuide ? 'none' : undefined,
              borderRadius: '6px 0 0 6px',
              background: showGuide ? '#eef2ff' : '#f8fafc', cursor: 'pointer',
              fontSize: 11, color: '#4338ca', fontWeight: 600, zIndex: 10,
              writingMode: 'vertical-rl', textOrientation: 'mixed', letterSpacing: 1,
              boxShadow: '-2px 0 6px rgba(0,0,0,0.06)', transition: 'right 0.2s',
            }}>
              {showGuide ? 'Close Guide' : 'Guide'}
            </button>
            {showGuide && <DataGuide tab={activeTab} activeSection={guideSection} onSelectSection={setGuideSection} sector={sectorTab} />}
          </>
        )}

        {activeTab === 4 && (
          <ResultsDashboard geoScope={chartScope} scenarios={scenarios} inputs={inputs} altInputs={altInputs} onToggle={setToggle} contributionView={contributionView} onContributionViewChange={setContributionView}
            currencyDisplay={currencyDisplay} onCurrencyDisplayChange={updateCurrencyDisplay} onEditCurrencyRate={editCurrencyRate} />
        )}

        </div>
      </div>

      {/* Onboarding. When the guide closes on a first visit, the scope card pulses with a
          "Start here" nudge pointing at the geographical-scope dropdown. */}
      {showOnboarding && <OnboardingModal onClose={() => { setShowOnboarding(false); triggerScopeHint(); }} />}
    </div>
  );
}
function OnboardingModal({ onClose }: { onClose: () => void }) {
  const [closing, setClosing] = React.useState(false);
  const [showArrow, setShowArrow] = React.useState(false);
  const [ovTab, setOvTab] = React.useState<'start' | 'saving'>('start');

  const handleGetStarted = () => {
    // Show arrow animation pointing to the Tool Overview button — only the first time
    const seen = localStorage.getItem('wss_overview_arrow_seen');
    setClosing(true);
    if (!seen) {
      setShowArrow(true);
      localStorage.setItem('wss_overview_arrow_seen', '1');
      setTimeout(() => { setShowArrow(false); onClose(); }, 1800);
    } else {
      setTimeout(() => { onClose(); }, 300);
    }
  };

  return (
    <div className={`wb-onboarding-overlay${closing ? ' wb-onboarding-overlay-closing' : ''}`} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.5s' }} onClick={closing ? undefined : onClose}>
      {/* Arrow animation pointing up at the Tool Overview button (top-right of header) */}
      {showArrow && (
        <div style={{
          position: 'fixed', top: 48, right: 24, zIndex: 1100,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
          animation: 'bounceArrow 0.7s ease-in-out infinite',
        }}>
          <span style={{ fontSize: 34, color: '#009CA7', lineHeight: 1 }}>↑</span>
          <span className="wb-onboarding-arrow-note" style={{ fontSize: 13, color: '#fff', background: '#2563eb', padding: '6px 14px', borderRadius: 20, fontWeight: 600, boxShadow: '0 2px 12px rgba(37,99,235,0.5)', whiteSpace: 'nowrap' }}>
            Reopen this anytime here
          </span>
        </div>
      )}
      <style>{`@keyframes bounceArrow { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }`}</style>

      {!closing && (
        <div className="wb-onboarding-card" style={{ background: '#fff', borderRadius: 12, maxWidth: 1040, width: '96%', maxHeight: '96vh', overflowY: 'auto', padding: '22px 40px' }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, margin: '0 0 10px' }}>
            <h2 className="wb-onboarding-title" style={{ fontSize: 20, margin: 0 }}><span className="wb-heading-strong">Tool</span> <span className="wb-heading-light">Overview</span></h2>
            <button onClick={handleGetStarted}
              style={{ padding: '9px 22px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Get Started
            </button>
          </div>

          {/* Tab bar */}
          <div className="wb-onboarding-tabs" style={{ display: 'flex', gap: 6, borderBottom: '1px solid #e2e8f0', marginBottom: 14 }}>
            {([{ k: 'start', l: 'How to use this tool' }, { k: 'saving', l: 'Saving your work' }] as const).map(t => (
              <button key={t.k} onClick={() => setOvTab(t.k)} className={`wb-onboarding-tab${ovTab === t.k ? ' wb-onboarding-tab-active' : ''}`} style={{
                padding: '8px 16px', border: 'none', borderBottom: ovTab === t.k ? '2px solid #2563eb' : '2px solid transparent',
                background: 'none', cursor: 'pointer', fontSize: 13, marginBottom: -1,
                fontWeight: ovTab === t.k ? 700 : 500,
              }}>{t.l}</button>
            ))}
          </div>

          {ovTab === 'start' && <>
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 8px', lineHeight: 1.5 }}>
            This tool helps you build water supply and sanitation (WSS) financing scenarios for a country or region. You enter recent historical data and policy targets, the tool projects a business-as-usual (BAU) outlook, and you test how interventions close the gap to those targets and what they cost.
          </p>
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.5 }}>
            Work through the steps in order. Tabs run left to right, and the <strong>Guide</strong> panel on the right of each input tab gives field-by-field help for whatever section you are editing.
          </p>

          <ol style={{ margin: 0, padding: '0 0 0 20px', fontSize: 13, color: '#334155', lineHeight: 1.45 }}>
            <li style={{ marginBottom: 6 }}>
              <strong>Make your selections first.</strong> At the top of the screen, use the <strong>Select geographical scope</strong> dropdown: <em>Urban + Rural</em> (enter each separately to produce a national total), <em>Urban only</em> / <em>Rural only</em> (analyse one area on its own), or <em>National</em> (no urban/rural breakdown — for when you cannot split the data by urban and rural). On the input tabs, also use the <strong>Water Supply / Sanitation</strong> toggle to choose which sector you are entering, and switch between the two to complete both.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Data Inputs</strong> — In <em>Country, Area of Focus &amp; Currency</em>, select your country and the currency fills in automatically. In <em>2. Analysis Period</em>, set the key dates; then complete the year-by-year sections — <em>3. Service levels</em> (water &amp; sanitation), <em>4. Economic &amp; demographic data</em> (real GDP, population, households) and <em>5. Budget</em>. <em>Country</em> and the <em>Analysis Period</em> are shared across Urban and Rural; the year-by-year sections are entered separately per area. Historical cells use a light neutral fill; forecast cells use a teal tint and are optional (leave them blank to fill in from the yearly growth rate, or type your own projection). To set a <strong>target</strong>, fill a whole future service-level column so it totals 100%; you can set as many target years as you like. The budget is derived from the cost of new service, and any cell can be overridden.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>BAU Scenario</strong> — Pick Water Supply or Sanitation, then work down the sections: <em>Unit Costs &amp; Technical Parameters</em> (enter technology prices as nominal, with a price index that converts them to real). These fields are shared with the Data Inputs tab. The BAU graph on the right updates live as you type.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Intervention Design</strong> — Pick Water Supply or Sanitation, switch each intervention on or off with its toggle, and set its parameters, which include collection efficiency, NRW reduction, budget execution improvement, capex efficiency (a unit-cost discount), optimised technology selection, tariff reform, and microfinance (with a self-finance carve-out and a means-based grant inside it). Add your own under <em>Custom Interventions</em> at the bottom. The impact graph updates live.
            </li>
            <li style={{ marginBottom: 6 }}>
              <strong>Loan funding</strong> — Carry the selected area’s intervention scenario into one indicative loan proceeds injection. Choose an eligible source, reference year, pooled allocation, real interest rate and term. Repayment accounting is deferred; compare coverage with and without indicative loan funding.
            </li>
            <li style={{ marginBottom: 0 }}>
              <strong>Results Dashboard</strong> — Compare BAU and intervention scenarios. Toggle interventions and adjust the target years to see the impact on coverage and the financing gap. Export the whole scenario as PowerPoint, Excel, or CSV — or download any individual chart (PNG / JPG / Excel) or table (CSV / Excel) from its own button.
            </li>
          </ol>

          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <div className="wb-onboarding-tip" style={{ flex: 1, padding: '8px 14px', background: '#f0f4ff', borderRadius: 8, fontSize: 12, color: '#312e81', border: '1px solid #c7d2fe', lineHeight: 1.45 }}>
              <strong>Tip:</strong> Reopen this anytime via <strong>"Tool Overview"</strong> in the top-right, and see <strong>Saving your work</strong> above for how to save and load.
            </div>
          </div>
          </>}

          {ovTab === 'saving' && <>
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 10px', lineHeight: 1.5 }}>
            Two save options sit in the top-right of the header. A <strong>Profile</strong> is a complete, reloadable dataset for a place; a <strong>Scenario</strong> is a lightweight snapshot you compare against others.
          </p>
          <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 12, lineHeight: 1.5 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#014972', marginBottom: 4 }}>Save Profile</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Stores everything you have entered — country settings, the year-by-year data, BAU inputs and interventions — under a name. Saved profiles reappear in the <strong>Load Profile…</strong> dropdown (top-left) so you can return later or keep several places side by side. Loading a profile replaces what is on screen, so save first if needed.
            </div>
          </div>
          <div style={{ padding: '12px 16px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', lineHeight: 1.5 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#014972', marginBottom: 4 }}>Save Scenario</div>
            <div style={{ fontSize: 13, color: '#475569' }}>
              Captures a snapshot of the current inputs for comparison — e.g. save "Ambitious 2040", change assumptions, save "Conservative 2040". Saved scenarios appear on the Results Dashboard, where each can be downloaded as its own PowerPoint slide.
            </div>
          </div>
          </>}

          <button onClick={handleGetStarted}
            style={{ marginTop: 12, width: '100%', padding: '11px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            Get Started
          </button>
        </div>
      )}
    </div>
  );
}

function SectorToggle({ value, onChange }: { value: 'water' | 'sanitation'; onChange: (v: 'water' | 'sanitation') => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
      {(['water', 'sanitation'] as const).map(s => (
        <button key={s} onClick={() => onChange(s)} style={{
          padding: '7px 18px', border: 'none', borderRadius: 5, cursor: 'pointer',
          background: value === s ? '#2563eb' : '#e5e7eb',
          color: value === s ? '#fff' : '#374151', fontWeight: 600, fontSize: 12,
        }}>{s === 'water' ? 'Water Supply' : 'Sanitation'}</button>
      ))}
    </div>
  );
}

// ── Guide content helpers ──
const gSub: React.CSSProperties = { fontWeight: 700, color: '#1e40af', fontSize: 11.5, margin: '12px 0 4px' };
const gFieldLbl: React.CSSProperties = { fontWeight: 700, color: '#334155' };
const gNote: React.CSSProperties = { display: 'block', fontStyle: 'italic', color: '#64748b', margin: '2px 0 0' };
const gFieldWrap: React.CSSProperties = { marginBottom: 8 };

// Turn bare domain/URL substrings (e.g. "data.worldbank.org/indicator/...") into clickable links
const URL_RE = /((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s()]*)?)/gi;
function linkify(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((m = URL_RE.exec(text)) !== null) {
    const url = m[0];
    // Require a path or at least a multi-part domain to avoid matching things like "e.g."
    if (!url.includes('/') && url.split('.').length < 2) continue;
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    const href = url.startsWith('http') ? url : `https://${url}`;
    parts.push(
      <a key={key++} href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#4338ca', wordBreak: 'break-all' }}>{url}</a>
    );
    lastIndex = m.index + url.length;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts.length ? parts : [text];
}

function GFind({ items }: { items: string[] }) {
  return (
    <div style={{ margin: '3px 0 0' }}>
      <div style={{ fontWeight: 600, color: '#475569' }}>How to find it:</div>
      <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{linkify(it)}</li>)}
      </ul>
    </div>
  );
}

// Contextual guide content keyed by sectionKey
const contextualGuide: Record<string, { title: string; content: React.ReactNode; sources?: { name: string; url: string }[] }> = {
  how_model_works: {
    title: 'How the model works',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>You enter recent history and one or more targets. From these the tool builds two paths for each service level and compares them.</p>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Business-as-usual (BAU):</span> The tool grows household counts at their historical yearly rate to project what happens if nothing changes. Any blank years you leave are filled in smoothly from the yearly growth rate, between the values you did enter.
        </div>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Targets:</span> Where you set a target year (a service-level column that adds up to 100%), the tool moves service levels toward that target and interpolates between consecutive targets.
        </div>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Financing gap:</span> The extra money needed each year to reach the target instead of BAU. It is based on the cost of connecting new households, and that unit cost comes from each rung's technology mix.
        </div>
      </div>
    ),
  },
  country: {
    title: 'Country & Area of focus',
    content: 'Select the country and the area of focus for the analysis. The currency code sets the unit for all monetary inputs. Choosing a country will auto-fill its currency, but you can change it manually if needed. This section applies to the whole analysis and is shared across the Urban and Rural datasets.',
    sources: [{ name: 'World Bank country classification', url: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/906519' }],
  },
  period: {
    title: '2. Analysis Period',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Define the analysis time frame for the tool. These dates apply to the whole analysis and are shared across the Urban and Rural datasets.</p>

        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Model Start Year:</span> The first year of the analysis period. The tool will compute information for every year from the Model Start Year up to the last year of historical data, building the historical record used to construct the Business-as-Usual (BAU) scenario.
          <span style={gNote}>Note: You must have data for at least two historical years from the model start year to the last year of historical data, with a gap of at least 2 years, for the tool to build the BAU scenario optimally. For example, if the last year of historical data is 2026, the model start year must be at least 2022, with data available for inputting the 2022 and 2024 numbers.</span>
        </div>

        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Last year of historical data:</span> The present year or the most recent year with complete data, marking the end of the historical analysis period.
          <span style={gNote}>Note: This must be within three years of the present.</span>
        </div>

        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Forecast End Year:</span> The last year of the tool's projection.
          <span style={gNote}>Note: Must be in the future.</span>
        </div>

        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Target years:</span> Targets are set directly in the <b>3. Service levels</b> section. Fill a service-level column (all 5 rungs add up to 100%) for any future year to make that year a target. You can set as many targets as you like, and the model interpolates between consecutive targets. There is no separate target-year field.
        </div>
      </div>
    ),
  },
  service_levels: {
    title: '3. Service levels',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>The share of households at each of the 5 JMP service levels, for water supply and sanitation. Historical cells use a neutral fill; grey in-between years follow the engine's path; a full teal-tinted forecast column is an optional target.</p>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Water / sanitation service levels (% HH):</span> Enter the start-year and baseline-year splits (each summing to 100%); in-between years follow the engine's historical path. Fill a FULL forecast column (Σ 100%) to set a target year — set as many as you like; the model interpolates between them.
          <GFind items={[
            'WHO/UNICEF JMP – washdata.org/data/household',
          ]} />
        </div>
      </div>
    ),
    sources: [{ name: 'WHO/UNICEF JMP', url: 'https://washdata.org/data/household' }],
  },
  econ_demo: {
    title: '4. Economic & demographic data',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Real GDP, population and households, year by year. Historical cells use a neutral fill; teal-tinted forecast cells are optional (blank = auto-fill at the mean historical growth); grey “→ used” rows show the values the model applies.</p>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Real GDP (local currency, millions):</span> Real GDP at constant (base-year) prices. Enter the historical years; leave forecast years blank to auto-fill at the mean historical growth, or type your own projection. This drives the forecast WSS budget.
          <GFind items={[
            'World Bank – data.worldbank.org/indicator/NY.GDP.MKTP.KN (GDP in constant local currency)',
            'IMF World Economic Outlook Database – imf.org/en/Publications/WEO',
            "Your country's central bank or national statistics office",
          ]} />
        </div>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Population:</span> The total number of people living in the selected area for each year of the analysis. This forms the baseline from which the model calculates growth and infrastructure demand.
          <GFind items={[
            'World Bank – data.worldbank.org/indicator/SP.URB.TOTL',
            'UN World Urbanization Prospects – population.un.org/wup',
            'Your country\'s national statistics office (for sub-national breakdowns, search "[country] national statistics population census")',
          ]} />
        </div>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Households (in millions):</span> The total number of occupied households in the selected area for each year of the analysis. Used to estimate residential demand for water and sanitation services — this series drives the model.
          <GFind items={[
            "Your country's national statistics office or census bureau (search \"[country] housing census households\")",
            'UN Statistics Division – unstats.un.org',
          ]} />
          <span style={gNote}>Note: If household data is unavailable, it can be estimated by dividing the population by the average household size.</span>
        </div>
      </div>
    ),
  },
  budget: {
    title: '5. Budget',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Two budgets per sector, year by year — computed for you, with per-year overrides.</p>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Executed budget (millions, real):</span> The capital that actually gets put to work building new service — households served × their unit cost (set by the technology mix). Historically from the cost of new service; for forecast years from the average historical budget-to-GDP ratio × real GDP. This is what drives the BAU. Override any year with your own figure.
        </div>
        <div style={gFieldWrap}>
          <span style={gFieldLbl}>Allocated budget (millions, real):</span> The capital budget on paper (e.g. the government's allocation) — a manual input, normally larger than what actually gets put to work. Its historical default implies ≈77% budget execution, and its forecast is the mean historical (allocated ÷ executed) ratio × the executed-budget forecast. The ratio <b>executed budget ÷ allocated</b> is the <b>budget execution</b> that the Budget-execution intervention improves toward 100%.
          <GFind items={[
            "Your country's Ministry of Finance (budget documents / execution reports) for the allocated budget",
            "Your country's Ministry of Water Supply / Sanitation or equivalent sector ministry",
          ]} />
        </div>
      </div>
    ),
  },
  ws_service_levels: {
    title: 'Water Supply Service Levels',
    content: 'Enter the percentage of households at each of the 5 JMP service levels for both the start year and baseline year. All 5 levels must sum to 100%. The model uses these to calculate historical CAGRs and project BAU service levels forward. Enter data for all historical years you have data for. If some are empty and data is unavailable, that is fine, but a minimum of 2 data points is required.',
    sources: [{ name: 'WHO/UNICEF JMP', url: 'https://washdata.org/data/household' }],
  },
  san_service_levels: {
    title: 'Sanitation Supply Service Levels',
    content: 'Enter the percentage of households at each of the 5 JMP service levels for both the start year and baseline year. All 5 levels must sum to 100%. The model uses these to calculate historical CAGRs and project BAU service levels forward. Enter data for all historical years you have data for. If some are empty and data is unavailable, that is fine, but a minimum of 2 data points is required.',
    sources: [{ name: 'WHO/UNICEF JMP', url: 'https://washdata.org/data/household' }],
  },
  ws_targets: {
    title: 'Water Supply Targets',
    content: 'Enter current national targets for water supply service levels at Target 1 and Target 2 years. These represent the government\'s policy targets. Playing with alternative targets is done on the Results Dashboard.',
    sources: [{ name: 'National WASH strategy document', url: '#' }],
  },
  san_targets: {
    title: 'Sanitation Targets',
    content: 'Enter current national targets for sanitation service levels. Include the on-site sanitation share separately.',
    sources: [{ name: 'National WASH strategy document', url: '#' }],
  },
  ws_unit_costs: {
    title: 'Water Supply — Unit Costs & Technical Parameters',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>The capital cost per household is built from <strong>two technology mixes</strong> — one for <strong>safely-managed</strong> and one for <strong>basic</strong>. For each technology set its share of the mix and its cost per household; the model uses each table's share-weighted total (Σ share × cost).</p>
        <p style={{ margin: '0 0 6px' }}>For water the two rungs use <strong>different</strong> technologies. Safely-managed is delivered by on-premises improved sources (piped into the dwelling, a tubewell or protected well on the plot, …) that are available when needed and free from contamination. Basic is delivered by shared or communal supplies — piped to the yard or a neighbour, a public tap/standpipe, a communal well or a water kiosk — which are improved but cannot meet the safely-managed criteria.</p>
        <p style={{ margin: 0 }}>Enter costs as nominal prices for the price-index year (real = nominal × index ÷ 100), in real terms at the base-year level. Use the utility's service costs and average technology prices.</p>
      </div>
    ),
    sources: [{ name: 'WHO/UNICEF JMP service ladders', url: 'https://washdata.org/monitoring/drinking-water' }, { name: 'IBNET benchmarks', url: 'https://www.ib-net.org/' }],
  },
  san_unit_costs: {
    title: 'Sanitation — Unit Costs & Technical Parameters',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>The cost per household is built from <strong>two technology mixes</strong> — safely-managed and basic. Unlike water, for sanitation both tables list the <strong>same</strong> technologies; the model uses each table's share-weighted total, and the two default to equal costs.</p>
        <p style={{ margin: '0 0 6px' }}>Sanitation can reach different service levels with the <strong>same technology</strong> because the level is set by service <em>attributes</em> — <strong>sharing</strong>, <strong>emptying</strong>, and <strong>treatment</strong> — not the hardware. An identical flush-to-septic-tank toilet is Limited if shared, Basic if emptied but discharged locally (or the fate is unknown), and Safely managed if contained and never emptied, buried on site, or emptied and treated off-site. That is why the two tables share the same technologies; the panel beneath them on the page walks through the four cases.</p>
        <p style={{ margin: 0 }}>Enter costs as nominal prices for the price-index year (real = nominal × index ÷ 100). Because the hardware is the same, the two tables often match; raise the safely-managed table to reflect containment, safe emptying and off-site treatment.</p>
      </div>
    ),
    sources: [{ name: 'WHO/UNICEF JMP service ladders', url: 'https://washdata.org/monitoring/sanitation' }, { name: 'IBNET benchmarks', url: 'https://www.ib-net.org/' }],
  },
  planned_investments: {
    title: 'Planned Investments',
    content: 'If there are programmed investments that are additional to historical spending trends — with financing secured and genuinely likely to proceed — enter them here by period. These represent a shift from BAU that we are confident will happen. Select the period length and enter planned water supply and sanitation investments per period.',
    sources: [{ name: 'Government budget documents / MTEF', url: '#' }],
  },
  ws_technical: {
    title: 'Water Supply Technical Parameters',
    content: 'Enter the water-supply infrastructure parameters that feed the calculation: the asset useful life (which drives the replacement/depreciation capex), the non-household share of water (which scales the total capex above the household capex), and the non-revenue-water factors that feed the BAU new-capex adder.',
    sources: [
      { name: 'WHO water requirements guideline', url: 'https://www.who.int/publications/i/item/9789241548151' },
      { name: 'IBNET', url: 'https://www.ib-net.org/' },
    ],
  },
  san_technical: {
    title: 'Sanitation Technical Parameters',
    content: 'Enter the sanitation infrastructure parameters that feed the calculation: the asset useful life (which drives the replacement/depreciation capex) and the non-household share of wastewater (which scales the total capex above the household capex).',
    sources: [
      { name: 'WHO water requirements guideline', url: 'https://www.who.int/publications/i/item/9789241548151' },
      { name: 'IBNET', url: 'https://www.ib-net.org/' },
    ],
  },
  // ── Water supply interventions — one guide card per intervention ──────────────────────────────
  ws_interventions: {
    title: 'Water Supply Interventions — overview',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>The five categories are Funding Mobilization; Operational Efficiency Improvements; Investment Planning and Delivery Improvements; Tariff Reform; and Household Financing and Affordability. Category headings only show or hide controls and do not enable interventions or change scenario values. Multiple categories can stay open.</p>
        <p style={{ margin: '0 0 6px' }}>Energy improvements and Subsidies are informational placeholders marked <strong>Coming soon</strong>, with no modeled effect. Means-based grants and the self-finance carve-out remain available within Microfinance. Custom Interventions remains a separate tool below the categories.</p>
        <p style={{ margin: '0 0 6px' }}>Each intervention has its own guide card below. Open an intervention on the left (▾ <strong>Show</strong>) or the sector toggle to jump to its guidance here.</p>
        <p style={{ margin: 0 }}><strong>How to use:</strong> tick an intervention's checkbox to switch it on (this adds it to the impact graph); click <strong>▾ Show</strong> to open its parameters and <strong>▴ Hide</strong> to collapse. The checkbox and the Show/Hide dropdown are independent — you can review parameters without enabling the intervention.</p>
      </div>
    ),
  },
  ws_ce: {
    title: 'Water · Collection efficiency',
    content: 'Raises the collection ratio (revenue collected ÷ revenue billed) from its current to its target level over the start→target years. The extra collected revenue — billed volume × tariff × the ratio uplift — funds new safely-managed service. Enter the current and target ratios, the volume sold at the start year and its growth rate (leave blank to grow with population), and the current tariff.',
  },
  ws_nrw: {
    title: 'Water · NRW reduction',
    content: "Cuts non-revenue water from its current level toward a target. Set the target at the economically optimal level of NRW — the point where the cost of further reduction outweighs the benefit; ~20% is a typical benchmark (chasing very low NRW rarely pays off). Allow a few years' lag before benefits appear. Only the physical (leak) share of NRW frees up deliverable water, which upgrades basic households to safely-managed service; the commercial share counts toward revenue only. Split NRW into commercial vs physical losses (they must total 100%). Value the recovered water either as tariff revenue from sales or as avoided production cost; the value net of the fixing capex flows into the budget.",
  },
  ws_budget_exec: {
    title: 'Water · Budget execution improvement',
    content: 'Budget execution = executed budget ÷ allocated budget — the share of the allocated capital budget actually spent on new service (unit cost × new households). The current value is auto-calculated from your budget history; the intervention raises it toward a target of up to 100%, so more of the allocated budget builds new service and the financing gap shrinks. Distinct from capex efficiency, which makes each unit of service cheaper.',
  },
  ws_capex_eff: {
    title: 'Water · Capex efficiency (unit cost)',
    content: 'Discounts the safely-managed service cost — e.g. through better procurement or standardised designs. Enter one capex-efficiency improvement figure (how much cheaper each new service becomes, e.g. 20%); the discount ramps from 0 at the start year to that level by the target year, then holds. Distinct from budget execution (which spends more of the allocated budget); this makes each unit of service cheaper.',
  },
  ws_techmix: {
    title: 'Water · Optimised technology selection',
    content: 'Re-model the safely-managed technology mix (pre-filled from the BAU mix). Re-weight the shares (they must total 100%) or re-cost the technologies; the new weighted service cost applies from the start year onward, so a cheaper mix stretches the budget further. Use “↺ Reset to current BAU mix” to start over; a mix identical to BAU has no effect.',
  },
  ws_tariff: {
    title: 'Water · Tariff reform',
    content: 'Raises the tariff linearly from current to target over the start→target years; the extra revenue (billed volume × tariff rise) funds new service.',
  },
  ws_microfinance: {
    title: 'Water · Microfinance',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Offers service loans once to eligible water-household cohorts during the configured intervention window. Eligibility is an income/service financing pool, not an annual target-gap enrollment calculation; crossing the service target does not cap or create another offer cohort. Enter the per-household service cost, income distribution (5 brackets), eligible-pool share by bracket, willingness-to-pay, and real loan rate/tenor.</p>
        <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
          <li><strong>Self-finance exclusion:</strong> the richest-first share able to pay upfront; excluded from loan offers and reported separately, rather than used to shrink an annual target gap.</li>
          <li><strong>Means-based grant:</strong> a one-time pool that buys down unaffordable principals for offered households (cheapest buy-downs funded first).</li>
        </ul>
      </div>
    ),
  },
  // ── Sanitation interventions — one guide card per intervention ────────────────────────────────
  san_interventions: {
    title: 'Sanitation Interventions — overview',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>The five categories are Funding Mobilization; Operational Efficiency Improvements; Investment Planning and Delivery Improvements; Tariff Reform; and Household Financing and Affordability. Category headings only show or hide controls and do not enable interventions or change scenario values. Multiple categories can stay open.</p>
        <p style={{ margin: '0 0 6px' }}>Energy improvements and Subsidies are informational placeholders marked <strong>Coming soon</strong>, with no modeled effect. Means-based grants and the self-finance carve-out remain available within Microfinance. Custom Interventions remains a separate tool below the categories.</p>
        <p style={{ margin: '0 0 6px' }}>Each intervention has its own guide card below. Open an intervention on the left (▾ <strong>Show</strong>) or the sector toggle to jump to its guidance here.</p>
        <p style={{ margin: 0 }}><strong>How to use:</strong> tick an intervention's checkbox to switch it on (this adds it to the impact graph); click <strong>▾ Show</strong> to open its parameters and <strong>▴ Hide</strong> to collapse. The checkbox and the Show/Hide dropdown are independent.</p>
      </div>
    ),
  },
  san_ce: {
    title: 'Sanitation · Collection efficiency',
    content: 'Inherits the collected ratios from Water Supply → collection efficiency; you enter the sanitation start/target years and the sewer tariff as a % of the water tariff. The recovered sanitation revenue funds new safely-managed sanitation service.',
  },
  san_budget_exec: {
    title: 'Sanitation · Budget execution improvement',
    content: 'Budget execution = executed budget ÷ allocated budget — the share of the allocated sanitation capital budget actually spent on new service. Auto-calculated from your budget history and raised toward a target of up to 100%, so more of the allocated budget builds new service.',
  },
  san_capex_eff: {
    title: 'Sanitation · Capex efficiency (unit cost)',
    content: 'Discounts the safely-managed sanitation service cost. Enter one capex-efficiency improvement figure (e.g. 20%); the discount ramps from 0 at the start year to that level by the target year, then holds, so the same budget provides more service. Distinct from budget execution, which spends more of the allocated budget.',
  },
  san_techmix: {
    title: 'Sanitation · Optimised technology selection',
    content: 'Re-model the safely-managed sanitation technology mix (pre-filled from the BAU mix). Re-weight the shares (they must total 100%) or re-cost the technologies; the new weighted service cost applies from the start year. A cheaper mix stretches the budget further; a mix identical to BAU has no effect.',
  },
  san_nrw_link: {
    title: 'Sanitation · NRW-linked revenue',
    content: 'Links sanitation revenue to physical water-loss recovery. Eligible linked volume = physical recovery × wastewater return ratio × explicit sewer-billable share. Enter overlap by year only when it is identified in raw sanitation connection billing; blank years remain unassigned—never infer overlap from all new connections. V2 uses the shared sanitation tariff and collection scenario rates. Legacy sewer charge/collection inputs remain saved for review, but do not replace those shared rates. Linked sanitation cash is signed and separate from water NRW net.',
  },
  san_tariff: {
    title: 'Sanitation · Tariff reform',
    content: 'Raises the sewer tariff linearly from current to target over the start→target years; the extra revenue (billed wastewater volume × tariff rise) funds new service.',
  },
  san_microfinance: {
    title: 'Sanitation · Microfinance',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Offers service loans once to eligible sanitation-household cohorts during the configured intervention window. Eligibility is an income/service financing pool, not an annual target-gap enrollment calculation; target coverage is not an enrollment cap. Sanitation keeps its own willingness-to-pay, loan terms, eligible-pool split, and grant pool.</p>
        <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
          <li><strong>Self-finance exclusion:</strong> the richest-first share able to pay upfront, excluded from loan offers and reported separately.</li>
          <li><strong>Means-based grant:</strong> a one-time pool that buys down unaffordable principals for offered households (cheapest buy-downs funded first).</li>
        </ul>
      </div>
    ),
  },
  custom_interventions: {
    title: 'Custom Interventions',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Add interventions not covered by the standard set — for example biogas/compost sales, resource recovery, or a technology that lowers service costs. Each one appears on the impact graph alongside the standard levers.</p>
        <p style={{ margin: '0 0 6px' }}>Click <strong>+ Add Custom Intervention</strong>, tick its box to switch it on, name it, then choose its <strong>Sector</strong> (Water, Sanitation or Both) and <strong>Type</strong> from the two dropdowns (▾). A new intervention defaults to the sector currently selected by the Water Supply / Sanitation toggle above. It is forced off in the BAU baseline, so it never moves the counterfactual.</p>
        <p style={{ margin: 0 }}>The <strong>Type</strong> dropdown sets which fields appear:</p>
        <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
          <li><strong>New revenue source</strong> — you invest a <em>cost to implement</em> (spread over a number of years from the start time) to produce an <em>output</em> (with its own unit, start year, yearly quantity and value per unit). The net of the output's value minus the cost is added to that sector's capex to provide more safely-managed service.</li>
          <li><strong>Cost reduction</strong> — from the start year it cuts the safely-managed service cost per household by a percentage or a flat amount, so the same budget reaches more households.</li>
        </ul>
      </div>
    ),
  },
  utility_debt: {
    title: 'Loan funding — indicative borrowing',
    content: (
      <div>
        <p style={{ margin: '0 0 6px' }}>Loan funding carries the intervention scenario forward without changing intervention settings. Select collection efficiency, tariff reform and/or NRW source cash for one selected reference year; selections do not switch on reforms. Water NRW net remains separate from eligible linked sanitation net cash, which is signed independently.</p>
        <p style={{ margin: '0 0 6px' }}>The allocation and annual real rate over an explicit positive whole-year term size one indicative proceeds amount using the selected year’s signed cash pool. Loan proceeds enter restricted investment cash once, with unused proceeds carried forward.</p>
        <p style={{ margin: '0 0 6px' }}>Indicative loan proceeds — repayment accounting deferred. Loan sizing uses the selected year’s additional net cash and assumes equal annual repayments. Principal and interest payments are not deducted from model funding in this version.</p>
        <p style={{ margin: 0 }}>Active connection-based billing can affect customer-driven collection and tariff reform growth. The separate connection net-cash stream is not debt eligible. The annual table distinguishes reference/no-debt borrowing-base values from financed-scenario cash and replacement obligations.</p>
      </div>
    ),
  },
};

// Which guide sections belong to each tab (only these show in that tab's Guide panel)
const guideKeysByTab: Record<number, string[]> = {
  // Data Inputs — includes the BAU data entry duplicated onto this tab. test2: targets & technical
  // params are folded into the table / the merged unit-cost section.
  0: ['how_model_works', 'country', 'period', 'service_levels', 'econ_demo', 'budget', 'ws_unit_costs', 'san_unit_costs'],
  // BAU Scenario
  1: ['how_model_works', 'ws_unit_costs', 'san_unit_costs'],
  // Intervention Design — one card per intervention, grouped by sector. DataGuide filters this list to
  // the active sector (ws_* on water, san_* on sanitation) plus the shared custom-interventions card.
  2: [
    'ws_interventions', 'ws_ce', 'ws_nrw', 'ws_budget_exec', 'ws_capex_eff', 'ws_techmix', 'ws_tariff', 'ws_microfinance',
    'san_interventions', 'san_ce', 'san_budget_exec', 'san_capex_eff', 'san_techmix', 'san_nrw_link', 'san_tariff', 'san_microfinance',
    'custom_interventions',
  ],
  3: ['utility_debt'],
};

function DataGuide({ tab, activeSection, onSelectSection, sector }: { tab: number; activeSection: string | null; onSelectSection?: (key: string) => void; sector?: 'water' | 'sanitation' }) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const activeRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [activeSection]);

  // Only show the guide sections relevant to the current tab, highlight the active one. On the
  // Intervention tab the cards are per-intervention, so filter them to the active sector (ws_* /
  // san_*) plus the shared custom-interventions card — the other sector's cards stay hidden.
  const prefix = sector === 'sanitation' ? 'san_' : 'ws_';
  const allKeys = (guideKeysByTab[tab] || Object.keys(contextualGuide))
    .filter(k => contextualGuide[k])
    .filter(k => tab !== 2 || k === 'custom_interventions' || k.startsWith(prefix));

  return (
    <div ref={scrollRef} className="wb-data-guide" style={{
      width: 320, borderLeft: '1px solid #e2e8f0', background: '#fafaff', overflowY: 'auto',
      padding: '16px 18px', fontSize: 11, flexShrink: 0,
    }}>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: '#312e81', margin: '0 0 6px', borderBottom: '2px solid #c7d2fe', paddingBottom: 6 }}>
        Guide
      </h3>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 12 }}>
        Click any input section on the left — or any card below — to see its guidance.
      </div>

      {allKeys.map(key => {
        const g = contextualGuide[key];
        const isActive = activeSection === key;
        const select = () => onSelectSection?.(isActive ? '' : key);   // click active card again to collapse
        return (
          <div key={key} ref={isActive ? activeRef : undefined}
            onClick={select} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); } }}
            title={isActive ? 'Click to collapse' : 'Click to read this guidance'}
            style={{
              marginBottom: 10, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
              background: isActive ? '#eef2ff' : '#fff',
              border: isActive ? '2px solid #2563eb' : '1px solid #e5e7eb',
              transition: 'all 0.3s',
            }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? '#1e40af' : '#475569', marginBottom: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{isActive && <span style={{ color: '#2563eb', marginRight: 4 }}>▶</span>}{g.title}</span>
              {!isActive && <span style={{ color: '#94a3b8', fontSize: 13, fontWeight: 400 }}>›</span>}
            </div>
            {isActive && (
              <>
                <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.5, marginBottom: 6 }}>
                  {g.content}
                </div>
                {g.sources && g.sources.length > 0 && (
                  <div style={{ fontSize: 10, color: '#64748b' }}>
                    <strong>Sources:</strong>
                    {g.sources.map((s, i) => (
                      <div key={i} style={{ marginTop: 2 }}>
                        {s.url !== '#' ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: '#4338ca' }}>{s.name}</a>
                        ) : (
                          <span style={{ color: '#475569' }}>{s.name}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
// Local guide components are kept with the planner so their field references stay aligned.
