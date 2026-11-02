import React from 'react';

export function focusScope(config: { focus_scope?: string | null; area?: string }) {
  if (config.focus_scope === 'national' || config.focus_scope === 'subnational') return config.focus_scope;
  return !config.area?.trim() || config.area.trim().toLowerCase() === 'national' ? 'national' : 'subnational';
}

export default function AreaFocusFields({ config, onChange, readOnly }: {
  config: { focus_scope?: string | null; area?: string };
  onChange: (patch: { focus_scope?: string; area?: string }) => void;
  readOnly: boolean;
}) {
  const scope = focusScope(config);
  const style = { width: '100%', padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4, fontSize: 13, color: '#3A4452', boxSizing: 'border-box' as const };
  return <>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label htmlFor="focus-scope" style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Area of focus</label>
      <select id="focus-scope" value={scope} disabled={readOnly} style={style}
        onChange={e => onChange({ focus_scope: e.target.value, area: e.target.value === 'national' ? 'National' : '' })}>
        <option value="national">National</option>
        <option value="subnational">Subnational</option>
      </select>
    </div>
    {scope === 'subnational' && <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label htmlFor="focus-area-name" style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Area name</label>
      <input id="focus-area-name" type="text" value={config.area || ''} readOnly={readOnly}
        onChange={e => onChange({ area: e.target.value })} style={style} placeholder="e.g. Kathmandu Valley" />
    </div>}
  </>;
}
