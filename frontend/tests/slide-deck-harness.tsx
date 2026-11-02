import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import App from '../src/App';
import SlideDeckWorkspace from '../src/components/SlideDeckWorkspace';
import { ProjectScopeContext } from '../src/projectScope';
import '../src/theme.css';
import '../src/modern.css';

const host = window as any;
host.__requests = []; host.__blobs = []; host.__revoked = []; host.__downloads = [];
host.__response = { status: 200, body: host.__preview };
host.fetch = async (url: string, options: any = {}) => {
  host.__requests.push({ url, body: options.body ? JSON.parse(options.body) : null,
    credentials: options.credentials, headers: options.headers });
  if (url === '/api/export/deck/preview') {
    const response = host.__response;
    if (host.__hold) await new Promise(resolve => { host.__release = resolve; });
    return new Response(JSON.stringify(response.body), { status: response.status });
  }
  return new Response(JSON.stringify({ detail: 'Calculation deliberately unavailable in preview-only contract test' }), { status: 422 });
};
const createURL = URL.createObjectURL.bind(URL);
URL.createObjectURL = (blob: Blob) => { host.__blobs.push(blob); return createURL(blob); };
const revokeURL = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url: string) => { host.__revoked.push(url); revokeURL(url); };
HTMLAnchorElement.prototype.click = function () { host.__downloads.push({ filename: this.download, url: this.href }); };
function Harness() {
  const [areas, setAreas] = useState(host.__areas);
  const [geoScope, setGeoScope] = useState('urban_rural');
  const [sectors, setSectors] = useState<any>(['water', 'sanitation']);
  const [includeDebt, setIncludeDebt] = useState(true);
  const [contribution, setContribution] = useState<any>('individual');
  const [currency, setCurrency] = useState(host.__currency);
  const [active, setActive] = useState(true);
  const [app, setApp] = useState(false);
  host.__setAreas = setAreas; host.__setGeoScope = setGeoScope; host.__setSectors = setSectors;
  host.__setCurrency = setCurrency; host.__setActive = setActive; host.__setApp = setApp;
  if (app) return <App initialBundle={{ __wss_bundle: 1, inputs: areas.urban, altInputs: { rural: areas.rural },
    scope: { scopeMode: 'urban_rural', areaUrban: true, areaRural: true, sectors }, presentation: { currencyDisplay: currency } }}
    initialLocation={{ activeTab: 5 }} readOnly projectId="public-preview-project"
    onDraftChange={() => { host.__writes = (host.__writes || 0) + 1; }} onSetup={() => {}} />;
  return <ProjectScopeContext.Provider value={{ sectors, readOnly: true, projectMode: true, projectId: 'public-preview-project' }}>
    <div className="wb-app" style={{ display: 'flex' }}><SlideDeckWorkspace active={active} geoScope={geoScope}
      inputs={areas.urban} altInputs={{ rural: areas.rural, national: areas.national }} includeDebt={includeDebt} onIncludeDebtChange={setIncludeDebt}
      contributionView={contribution} onContributionViewChange={setContribution} currencyDisplay={currency}
      onCurrencyDisplayChange={setCurrency} onEditCurrencyRate={() => {}} /></div>
  </ProjectScopeContext.Provider>;
}
createRoot(document.getElementById('root')!).render(<Harness />);
