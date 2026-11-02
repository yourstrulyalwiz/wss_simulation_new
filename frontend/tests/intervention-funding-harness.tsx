import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import InterventionPanel from '../src/components/InterventionPanel';
import { ProjectScopeContext } from '../src/projectScope';
import '../src/modern.css';

const testWindow = window as any;
const custom = [
  { name: 'Saved community fund', enabled: true, sector: 'both', intervention_type: 'new_revenue', output_quantity: 731 },
  { name: 'Saved unit-cost reform', enabled: true, sector: 'both', intervention_type: 'cost_reduction', cost_effect: .17 },
];
const initial = {
  period: { baseline_year: 2025, model_start_year: 2025, forecast_end_year: 2035 },
  country_config: { currency: 'LCU' }, water_interventions: {}, sanitation_interventions: {},
  water_service: {}, sanitation_service: {}, technical: {}, bau: {},
  toggles: { ws_connections_enabled: false, san_connections_enabled: true },
  custom_interventions: custom,
  connection_revenue: {
    water: { version: 5, enabled: true, new_billed_share_basic: .38, new_billed_share_sm: .76, shared_assumption_note: 'Water source' },
    sanitation: { version: 5, enabled: false, new_billed_share_basic: .29, new_billed_share_sm: .63, shared_assumption_note: 'Sanitation source' },
  },
};
testWindow.__initial = structuredClone(initial);
testWindow.__requests = [];
testWindow.fetch = async (url: string, options: any = {}) => {
  testWindow.__requests.push({ url, body: options.body && JSON.parse(options.body) });
  if (url.includes('intervention-validation')) return new Response(JSON.stringify({ issues: testWindow.__validationIssues || [] }));
  if (url.includes('revenue-bases')) {
    if (testWindow.__verificationError) throw new Error('Fixture verification unavailable');
    return new Response(JSON.stringify({ water: { connection: { effective: true, calibration: {} } },
      sanitation: { connection: { effective: true, calibration: {} } } }));
  }
  // Charts exercise their existing error states; no real API requests are made.
  return new Response(JSON.stringify({ detail: 'Fixture: no calculation result' }), { status: 422 });
};
function Harness() {
  const [inputs, setInputs] = useState<any>(initial);
  const [sector, setSector] = useState<'water' | 'sanitation'>('water');
  const [scope, setScope] = useState('Urban');
  const [readOnly, setReadOnly] = useState(false);
  const [sectors, setSectors] = useState<('water' | 'sanitation')[]>(['water', 'sanitation']);
  testWindow.__inputs = inputs;
  testWindow.__setReadOnly = setReadOnly;
  testWindow.__setSector = setSector;
  testWindow.__setScope = setScope;
  testWindow.__setInputs = setInputs;
  testWindow.__setSectors = setSectors;
  return <ProjectScopeContext.Provider value={{ sectors, readOnly, projectMode: true }}>
    <InterventionPanel inputs={inputs} onChange={setInputs} sectorTab={sector} onSectorChange={setSector}
      geoScope={scope.toLowerCase()} scopeLabel={scope} scopeChoices={['urban', 'rural', 'national']}
      onScopeChange={value => setScope(value[0].toUpperCase() + value.slice(1))}
      contributionView="individual" onContributionViewChange={() => {}}
      currencyDisplay={{ mode: 'local', sourceCurrency: 'LCU', localPerUsd: 1, rateReferenceYear: 2025 }}
      onCurrencyDisplayChange={() => {}} onEditCurrencyRate={() => {}} />
  </ProjectScopeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
