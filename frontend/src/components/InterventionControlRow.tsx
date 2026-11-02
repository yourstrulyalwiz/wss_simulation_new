import type { MouseEventHandler } from 'react';

/** Shared compact enable control and independent parameter-drawer openers. */
export default function InterventionControlRow({ label, checked, disabled, expanded, onChange, onOpen, needsAttention = false, controls, settings = false, headingLabel = label }: {
  label: string; checked: boolean; disabled: boolean; expanded: boolean;
  onChange: (value: boolean) => void; onOpen: MouseEventHandler<HTMLButtonElement>;
  needsAttention?: boolean; controls?: string; settings?: boolean; headingLabel?: string;
}) {
  if (settings) return <div className="intervention-settings-control">
    <div><h3>{headingLabel}</h3>
      {needsAttention && <span className="intervention-toggle__issue">Needs attention</span>}
    </div>
    <label className="intervention-activation">
      <span>ACTIVATION</span>
      <input type="checkbox" role="switch" aria-label={`Enable ${label}`} disabled={disabled}
        checked={checked} onChange={event => onChange(event.target.checked)} />
      <span>{checked ? 'On' : 'Off'}</span>
    </label>
  </div>;
  return <div style={{
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    background: checked ? '#eef2ff' : '#fafbfc', borderBottom: expanded ? '1px solid #c7d2fe' : 'none',
  }}>
    <label className="intervention-toggle__checkbox">
      <input type="checkbox" aria-label={`Enable ${label}`} disabled={disabled} checked={checked}
        onChange={event => onChange(event.target.checked)}
        style={{ width: 18, height: 18, accentColor: '#2563eb' }} />
    </label>
    <button type="button" className="intervention-toggle__name" aria-expanded={expanded} aria-controls={controls}
      onClick={onOpen} title={`Open ${label} inputs`}>
      <span>{label}</span>
      {needsAttention && <span className="intervention-toggle__issue">Needs attention</span>}
    </button>
    <button type="button" aria-expanded={expanded} aria-controls={controls} onClick={onOpen}
      style={{ border: '1px solid #c7d2fe', background: '#fff', cursor: 'pointer', fontSize: 11, color: '#2563eb', fontWeight: 600, padding: '3px 10px', borderRadius: 12 }}>
      {expanded ? '▴ Hide' : '▾ Show'}
    </button>
  </div>;
}
