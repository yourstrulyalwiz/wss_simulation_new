import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import DebtServicingPanel from '../src/components/DebtServicingPanel';
import { ProjectScopeContext } from '../src/projectScope';
import { validateLoanFundingConfig } from '../src/loanFunding';
import type { ContributionView } from '../src/contributionView';
import '../src/modern.css';

const host = window as any;
host.__requests = [];
host.__csv = [];
host.fetch = async (url: string, options: any = {}) => {
  host.__requests.push({ url, body: options.body && JSON.parse(options.body) });
  if (url.includes('intervention-validation')) return new Response(JSON.stringify({ issues: [] }));
  return new Response(new Blob(['test workbook response'], { type: 'application/octet-stream' }));
};
const createURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => {
  if (blob.type.startsWith('text/csv')) blob.text().then(text => host.__csv.push(text));
  return createURL(blob);
};
function Harness() {
  const [area, setArea] = useState('urban');
  const [areas, setAreas] = useState<any>({ urban: host.__fixture.urban.inputs, rural: host.__fixture.rural.inputs });
  const [sector, setSector] = useState<'water' | 'sanitation'>('water');
  const [readOnly, setReadOnly] = useState(false);
  const [contribution, setContribution] = useState<ContributionView>('individual');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<any>({ mode: 'local', sourceCurrency: host.__fixture.urban.inputs.country_config.currency, localPerUsd: 132.7, rateReferenceYear: 2025 });
  const inputs = areas[area];
  const errors = validateLoanFundingConfig(inputs.utility_debt[sector], inputs.period);
  const result = loading ? null : structuredClone(host.__fixture[area][inputs.utility_debt[sector].enabled ? 'enabled' : 'disabled']);
  if (result && host.__missingReference) delete result[sector === 'water' ? 'water_supply' : 'sanitation'].scenario_without_utility_debt_hh;
  host.__inputs = areas;
  host.__setReadOnly = setReadOnly;
  host.__setLoading = setLoading;
  host.__setError = setError;
  host.__editRate = () => setSettings((old: any) => ({ ...old, mode: 'usd' }));
  host.__setInputs = (next: any) => setAreas((old: any) => ({ ...old, [area]: next }));
  return <ProjectScopeContext.Provider value={{ sectors: ['water', 'sanitation'], readOnly, projectMode: true, validationInputs: { [area]: inputs } }}>
    <div className="wb-app" style={{ display: 'flex', width: '100%', height: '100dvh' }}>
      <DebtServicingPanel inputs={inputs} onChange={next => { if (!readOnly) setAreas((old: any) => ({ ...old, [area]: next })); }}
        results={Object.keys(errors).length || error ? null : result}
        calculationError={error || Object.values(errors).join(' ')} onRetry={() => { setError(''); setLoading(false); }}
        sectorTab={sector} onSectorChange={setSector} geoScope={area} scopeChoices={['urban', 'rural']}
        onScopeChange={setArea} contributionView={contribution} onContributionViewChange={setContribution}
        currencyDisplay={settings} onCurrencyDisplayChange={setSettings} onEditCurrencyRate={host.__editRate} />
    </div>
  </ProjectScopeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
