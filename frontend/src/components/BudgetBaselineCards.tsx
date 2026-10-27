import React from 'react';

export default function BudgetBaselineCards({ results, baselineYear, sectors }: {
  results: any; baselineYear: number; sectors: string[];
}) {
  const index = results?.years?.indexOf(baselineYear) ?? -1;
  const percent = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? `${(value * 100).toFixed(2)}%` : 'Unavailable';
  const calibration = (meta: any) => {
    const years = meta?.initialization_years;
    if (!Array.isArray(years) || !years.length) return 'Unavailable';
    return `${years.join(', ')}${years.length < 3 ? ` (${years.length} of 3 years available)` : ''}`;
  };
  return <div style={{ gridColumn: '1 / -1' }}>
    <div style={{ fontSize: 11, color: '#526b76', marginBottom: 10 }}>
      Baseline-year values ({baselineYear}). The three-year calibration windows below initialize forecasts; these cards are not three-year averages.
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
      {[
        { sector: 'water', key: 'water_supply', label: 'Water supply' },
        { sector: 'sanitation', key: 'sanitation', label: 'Sanitation' },
      ].filter(item => sectors.includes(item.sector)).map(({ key, label }) => {
        const data = results?.[key];
        const executed = data?.budget_executed_input_basis?.[index];
        const gdp = results?.gdp_real_local?.[index];
        const share = typeof executed === 'number' && typeof gdp === 'number' && gdp > 0 ? executed / gdp : null;
        const meta = data?.budget_forecast_metadata;
        return <section key={key} aria-label={`${label} budget baseline`} style={{ padding: '14px 16px', border: '1px solid #dce9ed', borderRadius: 8, background: '#f4f9fa' }}>
          <h4 style={{ margin: '0 0 12px', color: '#005675', fontSize: 13 }}>{label}</h4>
          <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, margin: 0 }}>
            {[
              ['Baseline budget execution', percent(data?.budget_execution_baseline?.[index])],
              ['Baseline executed budget / GDP', percent(share)],
            ].map(([title, value]) => <div key={title}>
              <dt style={{ fontSize: 11, color: '#526b76' }}>{title}</dt>
              <dd style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, color: '#005675' }}>{value}</dd>
            </div>)}
          </dl>
          <p style={{ fontSize: 11, color: '#526b76', margin: '12px 0 0', lineHeight: 1.6 }}>
            Three-year forecast calibration:<br />
            Executed budget: {calibration(meta?.executed)}<br />
            Allocated budget: {calibration(meta?.allocated)}
          </p>
        </section>;
      })}
    </div>
  </div>;
}
