import { useEffect, useState, type ReactNode } from 'react';
import { useClerk, useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { geography, normalizeScope, scopeWithGeography, type ProjectScope, type Sector } from './projectScope';
import { projectMutation, projectRequest, type CountryMetadata, type Identity, type Simulation, type SimulationCard as SimulationCardData } from './projectApi';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
export function Brand() {
  return <Link href="/" className="portal-brand"><img src={`${basePath}/logo.svg`} alt="WSS" /><span><b>WSS STRATEGIC SCENARIOS</b><small>Simulation tool</small></span></Link>;
}
export function PortalLayout({ children, identity }: { children: ReactNode; identity?: Identity | null }) {
  const { user } = useUser();
  const { signOut } = useClerk();
  return <div className="portal"><header className="portal-header"><Brand /><nav className="portal-nav" aria-label="Main navigation">
    {user ? <><Link href="/user-portal">My workspace</Link><button className="portal-text-btn" onClick={() => {
      if (window.confirm('Sign out? Any unsaved recovery drafts will remain protected under your account on this browser.')) void signOut({ redirectUrl: basePath || '/' });
    }}>Sign out</button></> : <><a href="#examples">Explore examples</a><Link href="/sign-in" className="portal-btn">Sign in <span aria-hidden="true">↗</span></Link></>}
  </nav></header>{identity && <div className="portal-wrap" style={{ paddingTop: 14, fontSize: 10, color: '#66828f' }}>{identity.email}{identity.is_admin ? ' · Administrator · Read access to all simulations' : ' · Verified World Bank account'}</div>}{children}
    <footer className="portal-footer"><span>WSS STRATEGIC SCENARIOS · WATER GLOBAL PRACTICE</span><span>A planning model. Evidence and professional judgement remain essential.</span></footer></div>;
}
export function Skeletons() { return <div className="gallery-grid" aria-label="Loading simulations" aria-busy="true"><div className="portal-skeleton" /><div className="portal-skeleton" /></div>; }
export function ErrorMessage({ message, retry }: { message: string; retry?: () => void }) {
  return <div role="alert" className="portal-message portal-message--error">{message}{retry && <> <button className="portal-text-btn" onClick={retry}>Try again</button></>}</div>;
}
function periodLabel(period: any) {
  if (!period) return 'Model period not set';
  if (typeof period === 'string') return period;
  return `${period.model_start_year ?? '—'}–${period.forecast_end_year ?? '—'}`;
}
export function SimulationCard({ item }: { item: SimulationCardData }) {
  const scope = normalizeScope(item.scope);
  return <article className={`simulation-card${item.is_seed ? ' is-seed' : ''}`}>
    <div className="card-status"><span>{item.is_seed ? 'Featured example · Read only' : item.status === 'calculated' ? 'Calculated' : 'Working draft'}</span><span>{item.visibility}</span></div>
    <h3>{item.name}</h3><div className="card-country">{item.country_name || item.country_code}{item.area_label ? ` / ${item.area_label}` : ''}</div>
    <div className="card-badges">{scope.sectors.map(sector => <span key={sector}>{sector === 'water' ? 'Water supply' : 'Sanitation'}</span>)}<span>{geography(scope)}</span></div>
    {item.notice && <p className="card-notice">{item.notice}</p>}
    <div className="card-meta"><span>{periodLabel(item.period)}</span><span>Saved {new Date(item.updated_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    <div className="card-actions"><Link className="portal-btn portal-btn--secondary" href={`/simulations/${item.id}`}>{item.is_owner && !item.read_only ? 'Resume simulation' : 'View simulation'} <span aria-hidden="true">↗</span></Link>
      {item.is_owner && <Link className="portal-text-btn" href={`/simulations/${item.id}?history=1`}>Version history</Link>}{item.is_seed && <span style={{ color: '#68838d', fontSize: 10 }}>Duplicate to make it your own</span>}</div>
  </article>;
}
export function Home() {
  const [items, setItems] = useState<SimulationCardData[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    projectRequest<{ items: SimulationCardData[] }>('/simulations?collection=examples').then(data => { if (live) setItems(data.items); })
      .catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [retry]);
  return <PortalLayout><main>
    <div className="portal-wrap"><section className="portal-hero"><div><span className="portal-eyebrow">Water & sanitation · Strategic planning</span>
      <h1>Different choices.<br />A clearer path<br />to universal access.</h1>
      <p>Connect service ambitions with the financing behind them. Explore what business as usual delivers—and what a different set of decisions could change.</p>
      <div className="portal-hero-actions"><Link href="/sign-in" className="portal-btn">Open your workspace <span aria-hidden="true">↗</span></Link><a href="#examples" className="portal-btn portal-btn--secondary">Explore the model</a></div>
      <span className="portal-hero-note">For World Bank practitioners · Save drafts with your verified account</span>
    </div><div className="planning-figure" aria-label="Conceptual illustration comparing a designed service-access pathway with business as usual. Not calculated results.">
      <div className="planning-figure-title"><span>FROM BASELINE TO POSSIBILITY</span><span>01 / SCENARIO DESIGN</span></div>
      <svg viewBox="0 0 460 290" role="img" aria-label="Illustrative pathways, not simulation data"><defs><linearGradient id="path-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#009ca7" stopOpacity=".23" /><stop offset="1" stopColor="#009ca7" stopOpacity=".02" /></linearGradient></defs>
        {[60,110,160,210,260].map(y => <line key={y} x1="28" x2="440" y1={y} y2={y} stroke="#c5d9df" strokeDasharray="3 4" />)}
        <path d="M30 245C110 234 105 210 173 189S240 130 296 115S370 45 435 29V260H30Z" fill="url(#path-fill)" />
        <path d="M30 245C110 234 105 210 173 189S240 130 296 115S370 45 435 29" fill="none" stroke="#008d98" strokeWidth="4" />
        <path d="M30 245C130 235 151 222 233 213S353 191 435 176" fill="none" stroke="#7896a4" strokeWidth="2.5" strokeDasharray="6 6" />
        <circle cx="173" cy="189" r="5" fill="#014972" stroke="#e6f0f2" strokeWidth="3" /><circle cx="296" cy="115" r="5" fill="#014972" stroke="#e6f0f2" strokeWidth="3" />
        <text x="136" y="164" fill="#014972" fontSize="10" fontFamily="sans-serif">DESIGN</text><text x="270" y="90" fill="#014972" fontSize="10" fontFamily="sans-serif">FINANCE</text>
        <text x="28" y="284" fill="#648391" fontSize="10" fontFamily="sans-serif">BASELINE</text><text x="353" y="284" fill="#648391" fontSize="10" fontFamily="sans-serif">PLANNING HORIZON</text>
      </svg><div className="planning-legend"><span>Designed pathway</span><span>Business as usual</span></div><div className="planning-foot"><span>Your evidence. Your assumptions.</span><span>Conceptual illustration</span></div>
    </div></section><div className="portal-trust"><span>WATER + SANITATION</span><span>URBAN · RURAL · NATIONAL</span><span>REAL MODEL · EXPLICIT ASSUMPTIONS</span><span>PRIVATE BY DEFAULT</span></div></div>
    <section id="examples" className="portal-section portal-wrap"><div className="portal-section-heading"><div><span className="portal-eyebrow">Start with a worked example</span><h2>A model you can explore.</h2></div><p>Open the preserved DRC Oct 12, DRC Oct 13 and Nepal Kathmandu Valley simulations. The originals stay read only; a private copy is yours to develop.</p></div>
      {loading ? <Skeletons /> : error ? <ErrorMessage message={error} retry={() => setRetry(value => value + 1)} /> : items.length ? <div className="portal-examples">{items.map(item => <SimulationCard key={item.id} item={item} />)}</div> : <div className="portal-empty"><h3>Examples are being prepared</h3><p>Try again shortly. No sample assumptions have been substituted.</p><button className="portal-text-btn" onClick={() => setRetry(value => value + 1)}>Check again</button></div>}
    </section>
    <section className="portal-method portal-section"><div className="portal-wrap portal-method-grid"><div><span className="portal-eyebrow">A connected planning workflow</span><h2>See the decision.<br />Trace the consequence.</h2><p>Move from an evidence base to an investment conversation, without losing sight of the assumptions in between.</p></div><ol>
      <li><div><b>Set the evidence base</b><p>Choose your country, sectors and geography. Enter service levels, economic data, budgets, revenue and technical parameters.</p></div></li>
      <li><div><b>Understand business as usual</b><p>Review the baseline trajectory and the distance to your service targets before designing interventions.</p></div></li>
      <li><div><b>Test decisions together</b><p>Explore operational reforms, public spending and loan funding. Compare their implications for service access and financial sustainability.</p></div></li>
      <li><div><b>Keep the planning record</b><p>Save progress, mark meaningful versions and share one selected checkpoint for others to view.</p></div></li>
    </ol></div></section>
    <section className="portal-section portal-wrap portal-principles"><div><span className="portal-eyebrow">Evidence, not automatic answers</span><h3>Country selection is not calibration.</h3><p>New simulations start with blank area-specific assumptions. The tool does not invent local costs, exchange rates, demand or service data. Incomplete work can still be saved.</p></div><div><span className="portal-eyebrow">Your work stays yours</span><h3>A draft is not a publication.</h3><p>Working simulations are private by default and tied to a verified World Bank identity. Public viewing uses an explicitly selected saved version—not your unfinished edits.</p></div></section>
    <div className="portal-wrap"><section className="portal-cta"><div><h2>Make room for a better scenario.</h2><p>Start a country simulation, or pick up where you left off.</p></div><Link href="/sign-in" className="portal-btn">Sign in to start <span aria-hidden="true">↗</span></Link></section></div>
  </main></PortalLayout>;
}
export function useCountryMetadata() {
  const [metadata, setMetadata] = useState<CountryMetadata | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; setError(''); projectRequest<CountryMetadata>('/country-metadata').then(data => { if (live) setMetadata(data); }).catch(err => { if (live) setError(err.message); }); return () => { live = false; }; }, [attempt]);
  return { metadata, error, retry: () => setAttempt(value => value + 1) };
}
export function Gallery({ identity }: { identity: Identity }) {
  const [collection, setCollection] = useState('mine');
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(1);
  const [data, setData] = useState<{ items: SimulationCardData[]; total: number; page: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [legacy, setLegacy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, navigate] = useLocation();
  const { metadata, error: metadataError, retry: retryMetadata } = useCountryMetadata();
  useEffect(() => { try { setLegacy(!!localStorage.getItem('wss_working_bundle')); } catch { /* unavailable */ } }, []);
  useEffect(() => {
    let live = true; setLoading(true); setError('');
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ collection, q, page: String(page), ...filters });
      projectRequest<{ items: SimulationCardData[]; total: number; page: number }>(`/simulations?${query}`).then(value => { if (live) { setData(value); if (page === 1) setPageSize(Math.max(1, value.items.length)); } })
        .catch(err => { if (live) setError(err.message); }).finally(() => { if (live) setLoading(false); });
    }, 250);
    return () => { live = false; clearTimeout(timer); };
  }, [collection, q, filters, page, attempt]);
  const fields = [
    ['country', 'Country', metadata?.countries.map(country => [country.id, country.name]) || []],
    ['region', 'Region', unique('region')], ['income', 'Income group', unique('incomeLevel')], ['lending', 'Lending group', unique('lendingType')],
    ['sector', 'Sector', [['water', 'Water supply'], ['sanitation', 'Sanitation']]],
    ['geography', 'Geography', [['urban', 'Urban'], ['rural', 'Rural'], ['both', 'Urban + Rural'], ['national', 'National']]],
    ['visibility', 'Visibility', [['private', 'Private'], ['public', 'Public']]], ['status', 'Status', [['draft', 'Draft'], ['calculated', 'Calculated']]],
  ] as [string, string, string[][]][];
  function unique(field: 'region' | 'incomeLevel' | 'lendingType') { return Array.from(new Map(metadata?.countries.map(country => [country[field].id, [country[field].id, country[field].value]])).values()).sort((a, b) => a[1].localeCompare(b[1])); }
  const importLegacy = async () => {
    if (!window.confirm('Import this browser’s legacy workspace and comparison scenarios into your verified account? Original browser data will not be deleted. Only import data you have permission to use.')) return;
    setImporting(true); setError('');
    try {
      const bundle = JSON.parse(localStorage.getItem('wss_working_bundle') || 'null');
      const scenarios = JSON.parse(localStorage.getItem('wss_demo_scenarios') || '[]');
      const result = await projectMutation<Simulation>('/simulations/import', { name: 'Recovered browser workspace', bundle, scenarios });
      navigate(`/simulations/${result.id}`);
    } catch (err) { setError((err as Error).message); } finally { setImporting(false); }
  };
  return <PortalLayout identity={identity}><main className="portal-wrap">
    <div className="gallery-intro"><div><span className="portal-eyebrow">Your planning workspace</span><h1>Simulations</h1><p>Keep the evidence. Explore the alternatives. Return to your work.</p></div><Link href="/simulations/new" className="portal-btn">+ New simulation</Link></div>
    {legacy && <div className="portal-message">A legacy workspace was found on this browser. Import it only if it belongs to you. Your original data will be retained. <button disabled={importing} className="portal-text-btn" onClick={() => void importLegacy()}>{importing ? 'Importing…' : 'Review and import'}</button> <button className="portal-text-btn" onClick={() => setLegacy(false)}>Not now</button></div>}
    <div className="gallery-tabs" role="tablist" aria-label="Simulation collections">{[['mine', 'My simulations'], ['public', 'Public simulations'], ['examples', 'Featured examples'], ['archived', 'Archived'], ...(identity.is_admin ? [['all', 'All simulations']] : [])].map(([key, label]) => <button key={key} role="tab" aria-selected={collection === key} onClick={() => { setCollection(key); setPage(1); }}>{label}</button>)}</div>
    <div className="gallery-search"><input aria-label="Search simulations" placeholder="Search by name, country, code or area…" value={q} onChange={event => { setQ(event.target.value); setPage(1); }} /><button className="portal-btn portal-btn--secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>Filters{Object.values(filters).filter(Boolean).length ? ` · ${Object.values(filters).filter(Boolean).length}` : ''}</button></div>
    {expanded && <><div className="gallery-filters">{fields.map(([key, label, options]) => <label key={key}>{label}<select value={filters[key] || ''} onChange={event => { setFilters(previous => ({ ...previous, [key]: event.target.value })); setPage(1); }}><option value="">All {label.toLowerCase()}s</option>{options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}<button className="portal-text-btn" onClick={() => { setFilters({}); setQ(''); setPage(1); }}>Clear filters</button></div>{metadataError && <ErrorMessage message={`Country filter metadata is unavailable: ${metadataError}`} retry={retryMetadata} />}{metadata?.stale && <p className="gallery-count">{metadata.retrieved_at ? `Using cached World Bank classifications · retrieved ${new Date(metadata.retrieved_at).toLocaleDateString()}` : 'Country classifications are temporarily unavailable; no cached retrieval exists.'}</p>}</>}
    {loading ? <Skeletons /> : error ? <ErrorMessage message={error} retry={() => setAttempt(value => value + 1)} /> : <><div className="gallery-count">{data?.total || 0} simulations · Most recently saved first</div>{data?.items.length ? <div className="gallery-grid">{data.items.map(item => <SimulationCard key={item.id} item={item} />)}</div> : <div className="portal-empty"><span className="portal-eyebrow">A clear starting point</span><h2>{q || Object.values(filters).some(Boolean) ? 'No simulations match this view.' : 'Your next scenario starts here.'}</h2><p>{collection === 'mine' ? 'Create a blank simulation or make a private copy of a featured example.' : 'Try another collection or adjust your search.'}</p><Link className="portal-btn" href="/simulations/new">New simulation</Link></div>}<div className="portal-pagination"><button disabled={page <= 1} className="portal-btn portal-btn--secondary" onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page}</span><button disabled={!data || !data.items.length || pageSize * page >= data.total} className="portal-btn portal-btn--secondary" onClick={() => setPage(value => value + 1)}>Next</button></div></>}
  </main></PortalLayout>;
}
export function ScopeFields({ scope, onChange }: { scope: ProjectScope; onChange: (value: ProjectScope) => void }) {
  return <><div className="setup-field setup-divider"><span>Sectors</span><div className="setup-choices">{(['water', 'sanitation'] as Sector[]).map(sector => <label className="setup-choice" key={sector}><input type="checkbox" checked={scope.sectors.includes(sector)} onChange={event => {
    const sectors = event.target.checked ? [...scope.sectors, sector] : scope.sectors.filter(value => value !== sector);
    if (sectors.length) onChange({ ...scope, sectors });
  }} />{sector === 'water' ? 'Water supply' : 'Sanitation'}</label>)}</div><small>At least one sector is required. Excluded data stays dormant and can be restored.</small></div>
    <label className="setup-field"><span>Geographic scope</span><select value={geography(scope)} onChange={event => onChange(scopeWithGeography(scope, event.target.value))}>{['Urban', 'Rural', 'Urban + Rural', 'National'].map(value => <option key={value}>{value}</option>)}</select><small>National is an independently entered dataset. Urban + Rural derives its combined overview from two areas.</small></label>
    {!scope.sectors.includes('water') && <div className="portal-message">Add Water supply to use the sanitation NRW linkage. Any previously configured linkage is retained but inactive in this scope.</div>}</>;
}
export function NewSimulation({ identity }: { identity: Identity }) {
  const [name, setName] = useState('');
  const [countrySearch, setCountrySearch] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [area, setArea] = useState('');
  const [scope, setScope] = useState<ProjectScope>(normalizeScope({ sectors: ['water', 'sanitation'], areaUrban: true, areaRural: false }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { metadata, error: metadataError, retry } = useCountryMetadata();
  const [, navigate] = useLocation();
  const country = metadata?.countries.find(value => value.id === countryCode);
  return <PortalLayout identity={identity}><main className="portal-wrap setup-layout"><aside className="setup-intro"><Link href="/user-portal" className="portal-text-btn">← Back to simulations</Link><div style={{ marginTop: 35 }}><span className="portal-eyebrow">Start a new planning record</span><h1>Define the frame.<br />Then build the case.</h1><p>A name, a country and a clear scope. You can save incomplete work and develop your evidence over time.</p></div><div className="setup-aside"><strong>PRIVATE BY DEFAULT</strong><br />Only you and authorized administrators can view your draft. To share it later, save a version and explicitly publish that checkpoint.</div></aside>
    <form className="setup-form" onSubmit={async event => {
      event.preventDefault(); if (!country || !name.trim()) return; setBusy(true); setError('');
      try { const project = await projectMutation<Simulation>('/simulations', { name: name.trim(), country_code: country.id, area_label: area.trim(), scope }); navigate(`/simulations/${project.id}`); }
      catch (err) { setError((err as Error).message); } finally { setBusy(false); }
    }}><span className="portal-eyebrow">Simulation setup</span><h2 style={{ fontSize: 25, margin: '12px 0 25px' }}>Where are we planning?</h2>
      <label className="setup-field">Simulation name<input required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Kinshasa service access strategy" /></label>
      <div className="setup-field"><label htmlFor="country-search">Find a country</label><input id="country-search" type="search" placeholder="Type to filter countries…" value={countrySearch} onChange={event => setCountrySearch(event.target.value)} /><select aria-label="Country" required value={countryCode} onChange={event => setCountryCode(event.target.value)}><option value="">{metadata ? 'Select country' : 'Loading World Bank country list…'}</option>{metadata?.countries.filter(value => value.id === countryCode || `${value.name} ${value.id} ${value.iso2Code}`.toLowerCase().includes(countrySearch.toLowerCase())).map(value => <option key={value.id} value={value.id}>{value.name} ({value.id})</option>)}</select></div>
      {metadataError && <ErrorMessage message={metadataError} retry={retry} />}{metadata?.stale && <div className="portal-message">{metadata.retrieved_at ? `Using cached classifications retrieved ${new Date(metadata.retrieved_at).toLocaleDateString()}.` : 'No cached country classifications are available.'} {metadata.error}</div>}
      {country && <div className="setup-meta"><span>{country.region.value}</span><span>· {country.incomeLevel.value}</span><span>· {country.lendingType.value}</span></div>}
      <label className="setup-field" style={{ marginTop: 20 }}>Area or provider label <small>Optional</small><input maxLength={160} value={area} onChange={event => setArea(event.target.value)} placeholder="e.g. metropolitan service area" /></label>
      <ScopeFields scope={scope} onChange={setScope} /><div className="portal-message">Country identity and classifications are not local assumptions. New areas start blank; no example population, costs or GDP are copied.</div>
      {error && <ErrorMessage message={error} />}<div className="project-dialog-actions"><Link href="/user-portal" className="portal-btn portal-btn--secondary">Cancel</Link><button disabled={busy || !country} type="submit" className="portal-btn">{busy ? 'Creating simulation…' : 'Create private simulation →'}</button></div>
    </form></main></PortalLayout>;
}
