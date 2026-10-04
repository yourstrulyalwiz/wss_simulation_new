import React from 'react';
import './_group.css';

export function WorldBank() {
  const tabs = ['Data Inputs', 'BAU Scenario', 'Intervention Design', 'Results Dashboard'];
  return (
    <div className="wb-app">
      <header className="wb-header">
        <div className="wb-brand-lockup">
          <span className="wb-brand-mark" aria-hidden="true">WSS</span>
          <span className="wb-brand-divider" aria-hidden="true" />
          <div>
            <h1 className="wb-brand-title">
              <span className="wb-heading-strong">WSS STRATEGIC SCENARIOS</span>
              <span className="wb-heading-light">SIMULATION TOOL</span>
            </h1>
            <span className="wb-brand-meta">Nepal — National</span>
          </div>
        </div>
        <div className="wb-header-actions">
          <select className="wb-profile-select"><option>Load Profile...</option><option>Nepal KV (Default)</option></select>
          <button className="wb-header-action">Save Profile</button>
          <button className="wb-header-action">Save Scenario</button>
          <button className="wb-header-action">Tool Overview</button>
        </div>
      </header>
      <nav className="wb-tab-nav" aria-label="Scenario workflow">
        {tabs.map((tab, index) => (
          <button key={tab} className={`wb-tab${index === 0 ? ' wb-tab-active' : ''}`}>
            <span className="wb-tab-step">{index + 1}</span>
            <span><span className="wb-tab-first">{tab.split(' ')[0]}</span>{' '}
              <span className="wb-tab-rest">{tab.slice(tab.indexOf(' ') + 1)}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="wb-scope-bar">
        <div className="wb-scope-card">
          <span className="wb-scope-label">Geographic scope</span>
          <button className="wb-scope-pill wb-scope-pill-active">Urban + Rural</button>
          <button className="wb-scope-pill">Urban only</button>
          <button className="wb-scope-pill">Rural only</button>
          <button className="wb-scope-pill">National</button>
          <span style={{ marginLeft: 12, color: 'var(--wb-mid)', fontSize: 11 }}>Editing: Urban</span>
        </div>
      </div>
      <main className="wb-demo-content">
        <section className="wb-demo-card">
          <div className="wb-demo-card-title"><span>1. Country &amp; Currency</span><span>▾</span></div>
          <div className="wb-demo-card-body">
            <div><b style={{ color: 'var(--wb-navy)' }}>COUNTRY</b><br />Nepal</div>
            <div style={{ marginTop: 14 }}><b style={{ color: 'var(--wb-navy)' }}>AREA OF FOCUS</b><br />Urban and rural service coverage</div>
            <div style={{ marginTop: 14 }}><b style={{ color: 'var(--wb-navy)' }}>CURRENCY</b><br />NPR · Presentation display: local currency</div>
          </div>
        </section>
        <section className="wb-demo-card">
          <div className="wb-demo-card-title"><span>2. Analysis Period</span><span>▾</span></div>
          <div className="wb-demo-card-body" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <div><b style={{ color: 'var(--wb-navy)' }}>MODEL START</b><br />2011</div>
            <div><b style={{ color: 'var(--wb-navy)' }}>HISTORICAL BASELINE</b><br />2025</div>
            <div><b style={{ color: 'var(--wb-navy)' }}>FORECAST END</b><br />2040</div>
          </div>
          <div className="wb-demo-card-body">
            Set the model window and review historical inputs before adjusting targets or interventions.
          </div>
        </section>
      </main>
    </div>
  );
}