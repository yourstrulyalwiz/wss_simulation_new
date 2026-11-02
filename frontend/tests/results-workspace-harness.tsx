import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ResultsDashboard from '../src/components/ResultsDashboard';
import { ProjectScopeContext } from '../src/projectScope';
import type { ContributionView } from '../src/contributionView';
import '../src/modern.css';

const host = window as any;
host.__requests = [];
host.__calculations = [];
host.__csv = [];
host.__fail = false;
host.fetch = async (url: string, options: any = {}) => {
  const body = options.body && JSON.parse(options.body);
  if (url.includes('/calculate')) {
    host.__calculations.push(body);
    if (host.__fail) return new Response(JSON.stringify({ detail: 'Temporary Results failure' }), { status: 503 });
    const response = await host.__calculate(body);
    return new Response(JSON.stringify(response.body), { status: response.status, headers: { 'Content-Type': 'application/json' } });
  }
  host.__requests.push({ url, body });
  if (url.includes('intervention-validation')) return new Response(JSON.stringify({ issues: [] }));
  return new Response(new Blob(['test workbook response'], { type: 'application/octet-stream' }));
};
const createURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => {
  if (blob.type.startsWith('text/csv')) blob.text().then(text => host.__csv.push(text));
  return createURL(blob);
};
function Harness() {
  const [areas, setAreas] = useState<any>({ urban: host.__fixture.urban.inputs, rural: host.__fixture.rural.inputs });
  const [contribution, setContribution] = useState<ContributionView>('individual');
  const [currency, setCurrency] = useState<any>({ mode: 'local', sourceCurrency: areas.urban.country_config.currency,
    localPerUsd: 132.7, rateReferenceYear: 2025 });
  const [sectors, setSectors] = useState<any>(['water', 'sanitation']);
  host.__inputs = areas;
  host.__setAreas = setAreas;
  host.__setSectors = setSectors;
  return <ProjectScopeContext.Provider value={{ sectors, readOnly: true, projectMode: true, validationInputs: areas }}>
    <div className="wb-app" style={{ display: 'flex', width: '100%', height: '100dvh' }}>
      <ResultsDashboard geoScope="urban_rural" inputs={areas.urban} altInputs={{ rural: areas.rural }} scenarios={[]}
        contributionView={contribution} onContributionViewChange={setContribution} currencyDisplay={currency}
        onCurrencyDisplayChange={setCurrency} onEditCurrencyRate={() => setCurrency((current: any) => ({ ...current, mode: 'usd' }))} />
    </div>
  </ProjectScopeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
