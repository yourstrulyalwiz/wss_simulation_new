import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import PostInterventionOptions from '../src/components/PostInterventionOptions';
import { CoverageKpiProvider } from '../src/components/CoverageKpis';
import { ProjectScopeContext } from '../src/projectScope';
import type { PostInterventionSettings } from '../src/postIntervention';
import '../src/theme.css';
import '../src/modern.css';
const host = window as any;
host.__requests = [];
host.__writes = 0;
host.fetch = async (url: string, options: any = {}) => {
  if (!url.includes('/api/post-intervention')) return new Response(JSON.stringify({ issues: [] }));
  const body = JSON.parse(options.body);
  host.__requests.push({ body, headers: options.headers, credentials: options.credentials });
  const captured = structuredClone(host.__response);
  const delay = host.__delay || 0;
  const mode = host.__mode;
  await new Promise(resolve => setTimeout(resolve, delay));
  // Deliberately ignore AbortSignal: the hook must also ignore late results.
  if (mode === 'error') return new Response(JSON.stringify({ detail: { code: 'invalid_inputs', message: 'Synthetic GDP conflict; correct the shared macro assumptions.' } }), { status: 422 });
  if (mode === 'busy') return new Response(JSON.stringify({ detail: { code: 'busy', message: 'Analysis capacity is busy.' } }), { status: 503, headers: { 'Retry-After': '3' } });
  captured.selected_year = body.settings?.targetYear ?? 2028;
  captured.funding_window.end = captured.selected_year;
  captured.input_signature = JSON.stringify(body.settings || {});
  if (mode === 'invalid') {
    captured.per_area_sector.urban.water = { solver_status: 'invalid_inputs', error: 'Synthetic missing unit cost' };
    captured.combined.complete = false;
    captured.combined.funding_fraction = null;
  }
  if (mode === 'partial') {
    captured.per_area_sector.rural.sanitation.solver_status = 'coverage_met_finance_unresolved';
    captured.per_area_sector.rural.sanitation.funding_fraction = null;
    captured.per_area_sector.rural.sanitation.candidate_fraction = .11;
    captured.combined.complete = false;
    captured.combined.funding_fraction = null;
  }
  return new Response(JSON.stringify(captured), { headers: { 'Content-Type': 'application/json' } });
};
function Harness() {
  const [settings, setSettings] = useState<PostInterventionSettings | undefined>();
  const [readOnly, setReadOnly] = useState(false);
  const [bundle, setBundle] = useState(host.__bundle);
  const [sector, setSector] = useState<'water' | 'sanitation'>('water');
  const [includeDebt, setIncludeDebt] = useState(true);
  const [currency, setCurrency] = useState<any>({ mode: 'local', sourceCurrency: 'LCU', localPerUsd: 137.42, rateReferenceYear: 2025 });
  host.__settings = settings;
  host.__includeDebt = includeDebt;
  host.__setReadOnly = setReadOnly;
  host.__setSettings = setSettings;
  host.__setBundle = setBundle;
  return <CoverageKpiProvider><ProjectScopeContext.Provider value={{
    sectors: bundle.scope.sectors, readOnly, projectMode: true, projectId: 'synthetic-test', validationInputs: {},
  }}>
    <div className="wb-app" style={{ display: 'flex', width: '100%', height: '100dvh' }}>
      <PostInterventionOptions bundle={bundle} settings={settings} onSettingsChange={next => { host.__writes++; setSettings(next); }}
        includeDebt={includeDebt} onIncludeDebtChange={setIncludeDebt} sector={sector} onSectorChange={setSector}
        currencyDisplay={currency} onCurrencyDisplayChange={setCurrency} onEditCurrencyRate={() => setCurrency({ ...currency, mode: 'usd' })} />
    </div>
  </ProjectScopeContext.Provider></CoverageKpiProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
