import React from 'react';

// Shared legend renderer that lists LINE series first and AREA/rect fills after.
// recharts v3 removed the `payload` prop on <Legend>, so instead of reordering by passing a payload we
// reorder recharts' own auto-generated payload here via the <Legend content={...}> hook. Colours and
// labels come straight from recharts (correct for every series), we only change the ORDER and the markup.
export function linesFirstLegend(props: any) {
  const items: any[] = props?.payload ? [...props.payload] : [];
  const isLine = (t: string) => t === 'line' || t === 'plainline';
  const ordered = [
    ...items.filter(i => isLine(i.type)),   // lines first
    ...items.filter(i => !isLine(i.type)),  // then area / rect fills
  ];
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '4px 14px', margin: 0, padding: 0, fontSize: 10 }}>
      {ordered.map((it, i) => (
        <li key={it.dataKey ?? it.value ?? i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#334155' }}>
          {isLine(it.type)
            ? <svg width={16} height={10} style={{ overflow: 'visible' }}><line x1={0} y1={5} x2={16} y2={5} stroke={it.color} strokeWidth={2.25} strokeDasharray={it.payload?.strokeDasharray} strokeLinecap="round" /></svg>
            : <span style={{ width: 11, height: 11, background: it.color, borderRadius: 2, display: 'inline-block' }} />}
          <span>{it.value}</span>
        </li>
      ))}
    </ul>
  );
}
