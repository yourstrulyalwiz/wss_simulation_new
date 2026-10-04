import React from 'react';
import './_group.css';

// Extracted shell structure from the planner's original App header and workflow navigation.
export function Current() {
  const tabs = ['Data Inputs', 'BAU Scenario', 'Intervention Design', 'Results Dashboard'];
  return (
    <div className="current-app">
      <header style={{ background: '#002244', color: '#fff', padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <h1 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>WSS Strategic Scenarios Simulation Tool</h1>
          <span style={{ fontSize: 11, opacity: 0.6 }}>Nepal — National</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,0.3)', background: '#1e3a5f', color: '#fff', fontSize: 11 }}>
            <option>Load Profile...</option><option>Nepal KV (Default)</option>
          </select>
          <button style={{ padding: '5px 10px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, background: 'transparent', color: 'white', fontSize: 11 }}>Save Profile</button>
          <button style={{ padding: '5px 10px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, background: 'transparent', color: 'white', fontSize: 11 }}>Save Scenario</button>
          <button style={{ padding: '5px 10px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: 4, background: 'transparent', color: 'white', fontSize: 11 }}>Tool Overview</button>
        </div>
      </header>
      <nav style={{ display: 'flex', gap: 8, padding: '8px 20px', background: '#f1f5f9', borderBottom: '1px solid #e2e8f0' }}>
        {tabs.map((tab, index) => (
          <button key={tab} style={{ padding: '8px 16px', border: 'none', borderRadius: 6, background: index === 0 ? '#2563eb' : 'transparent', color: index === 0 ? 'white' : '#475569', fontSize: 12, fontWeight: 600 }}>
            {index + 1}. {tab}
          </button>
        ))}
      </nav>
      <div style={{ padding: 20 }}>
        <div style={{ background: '#eef2ff', border: '1px solid #c7d2fe', borderLeft: '4px solid #2563eb', borderRadius: 8, padding: '12px 14px', color: '#1e3a5f', fontSize: 12 }}>
          <b>Editing area:</b> Nepal — Urban + Rural (national total) <span style={{ marginLeft: 10, padding: '5px 10px', background: '#312e81', color: 'white', borderRadius: 14 }}>Urban</span>
        </div>
        <div style={{ marginTop: 18, border: '1px solid #ddd', borderRadius: 8, background: 'white', maxWidth: 780 }}>
          <div style={{ padding: '12px 14px', background: '#ebf6fb', color: '#0073a8', fontWeight: 600, fontSize: 13 }}>1. Country, Area of Focus &amp; Currency <span style={{ float: 'right' }}>▾</span></div>
          <div style={{ padding: 14, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, color: '#475569', fontSize: 11 }}>
            <div>Country<br /><b style={{ display: 'block', marginTop: 5, color: '#1e293b' }}>Nepal</b></div>
            <div>Area of focus<br /><b style={{ display: 'block', marginTop: 5, color: '#1e293b' }}>National</b></div>
            <div>Currency<br /><b style={{ display: 'block', marginTop: 5, color: '#1e293b' }}>NPR</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}