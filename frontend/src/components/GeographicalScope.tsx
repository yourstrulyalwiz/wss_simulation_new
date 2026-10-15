import React from 'react';

export default function GeographicalScope({ value, onChange, area, onAreaChange, hint, dismissHint }: {
  value: string; onChange: (value: string) => void; area: string;
  onAreaChange: (area: 'urban' | 'rural') => void; hint: boolean; dismissHint: () => void;
}) {
  return <div className="modern-geographical-scope" onClickCapture={dismissHint}>
    <div className="modern-geographical-scope__row">
      <label htmlFor="input-geographical-scope">Select geographical scope</label>
      <select id="input-geographical-scope" className="wb-scope-select" value={value}
        onChange={event => { onChange(event.target.value); dismissHint(); }}>
        <option value="both">Urban + Rural (national total)</option>
        <option value="urban">Urban only</option>
        <option value="rural">Rural only</option>
        <option value="national">National (no urban/rural breakdown)</option>
      </select>
      {hint && <span className="modern-geographical-scope__hint">Start here</span>}
    </div>
    {value === 'both' && <div className="modern-geographical-scope__row">
      <span>Entering data for:</span>
      {(['urban', 'rural'] as const).map(item =>
        <button key={item} type="button" aria-pressed={area === item} onClick={() => onAreaChange(item)}
          className={`wb-scope-option${area === item ? ' wb-scope-option-active' : ''}`}>{item}</button>)}
    </div>}
    {value === 'national' && <p>National should only be used if you do not have — and cannot estimate — urban/rural breakdowns for WSS data and access.</p>}
    {(value === 'urban' || value === 'rural') && <p>Graphs &amp; outputs show {value === 'rural' ? 'Rural' : 'Urban'} only.</p>}
  </div>;
}
