import React from 'react';
import { spendingRows, validateSpendingRows, draftPoints, type SpendingDraft } from '../publicSpendingSchedule';

export default function PublicSpendingTargets({ inputs, section, onChange }: {
  inputs: any; section: 'water_interventions' | 'sanitation_interventions'; onChange: (inputs: any) => void;
}) {
  const iv = inputs[section] || {};
  const first = inputs.period.baseline_year + 1, last = inputs.period.forecast_end_year;
  const rows = spendingRows(iv, first);
  const error = validateSpendingRows(rows, first, last);
  const update = (draft: SpendingDraft[]) => {
    const problem = validateSpendingRows(draft, first, last);
    const points = problem ? undefined : draftPoints(draft).sort((a, b) => a.year! - b.year!);
    onChange({ ...inputs, [section]: { ...iv, fin_gdp_target_draft: draft,
      ...(points ? { fin_gdp_targets: points, fin_gdp_start_year: points[0].year,
        fin_gdp_target_share: points[0].target_share } : {}),
    } });
  };
  const taken = new Set(rows.map(row => Number(row.year)));
  const precedingYear = Number(rows[rows.length - 1]?.year);
  let nextYear = Math.max(first, Number.isInteger(precedingYear) ? precedingYear + 1 : first);
  while (taken.has(nextYear) && nextYear <= last) nextYear++;
  const available = nextYear <= last;
  const edit = (index: number, key: keyof SpendingDraft, value: string) =>
    update(rows.map((row, i) => i === index ? { ...row, [key]: value } : row));
  const inputStyle: React.CSSProperties = { width: '100%', minWidth: 0, boxSizing: 'border-box',
    padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4 };
  return <div data-public-spending-schedule={section} style={{ gridColumn: '1 / -1', minWidth: 0 }}>
    {rows.map((row, index) => <div key={index} data-spending-target-row
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10, marginBottom: 12 }}>
      <label style={{ flex: '1 1 190px', minWidth: 0 }}>
        Target executed spending share (% of GDP)
        <input aria-label={`Target ${index + 1} executed spending share (% of GDP)`} type="text" inputMode="decimal"
          value={row.share} onChange={event => edit(index, 'share', event.target.value)} style={inputStyle} />
      </label>
      <label style={{ flex: '1 1 130px', minWidth: 0 }}>Effective year
        <input aria-label={`Target ${index + 1} effective year`} type="text" inputMode="numeric"
          value={row.year} onChange={event => edit(index, 'year', event.target.value)} style={inputStyle} />
      </label>
      {index > 0 && <button type="button" aria-label={`Remove target ${index + 1}`}
        onClick={() => update(rows.filter((_, i) => i !== index))}>Remove target</button>}
    </div>)}
    <button type="button" disabled={!available || !!error} onClick={() =>
      update([...rows, { year: String(nextYear), share: rows[rows.length - 1]?.share || '0' }])}>Add target and year</button>
    {!available && <p>No later forecast year is available. Edit an existing effective year to make room.</p>}
    {error && <p role="alert" style={{ color: '#b91c1c' }}>{section === 'water_interventions' ? 'Water' : 'Sanitation'}: {error} Correct this draft before using scenario results.</p>}
    {iv.fin_gdp_targets == null && !iv.fin_gdp_target_draft && <p style={{ fontSize: 11 }}>
      Legacy single target: only an increase above BAU applies. Editing a target or adding a row adopts the stepwise schedule, including spending cuts.</p>}
    <p style={{ fontSize: 11, lineHeight: 1.5 }}>
      Each target applies from its effective year until the next target. Spending is recalculated using that year's GDP.
      Targets may increase or decrease; a target below BAU reduces public funding. Annual spending increases remain additive,
      and improved budget execution is reported separately.
    </p>
  </div>;
}
