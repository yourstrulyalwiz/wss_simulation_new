import React, { useState, useRef, useEffect } from 'react';
import { downloadTemplate, importTemplate } from '../api';
import NumInput from './NumInput';
import { RevenueInputsSection } from './RevenueBase';
import { CurrencyDisplayControl, currencyRateNote, defaultCurrencyDisplay, type CurrencyDisplaySettings } from '../currencyDisplay';

// Explains why sanitation's safely-managed and basic rungs share ONE technology mix: the JMP service
// level is set by service attributes (sharing, emptying, treatment), not the technology. Shown under
// the sanitation technology mix — the same identical flush/pour-flush to septic tank lands at four
// different service levels depending only on circumstance.
function SanServiceLevelExplainer() {
  const rows: [string, string, string, string][] = [
    ['A', 'Shares the toilet with a neighbouring household', 'Limited', '#b45309'],
    ['B', 'Own toilet; septic tank emptied but the contents discharged locally (drain, field, water body), or the fate is unknown', 'Basic', '#0369a1'],
    ['C', 'Own toilet; tank is contained and has never been emptied, or was emptied with the sludge buried on site', 'Safely managed — disposed in situ', '#15803d'],
    ['D', 'Own toilet; tank emptied by a service provider and the sludge delivered to a treatment plant and treated', 'Safely managed — emptied & treated', '#15803d'],
  ];
  return (
    <div style={{ gridColumn: '1 / -1', marginTop: 8, border: '1px solid #bfdbfe', borderRadius: 8, background: '#f8fbff', padding: '10px 12px' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1e3a5f', marginBottom: 4 }}>Why safely-managed and basic share one technology mix</div>
      <div style={{ fontSize: 11, color: '#475569', lineHeight: 1.5, marginBottom: 8 }}>
        Sanitation has no technology-based cap: the same facility can land at limited, basic or safely-managed depending on service attributes — <b>sharing</b>, <b>emptying</b> and <b>treatment</b> — not the hardware. Below, four households with the <i>identical</i> flush / pour-flush to septic tank:
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '3px 6px' }}>HH</th><th style={{ padding: '3px 6px' }}>Circumstance</th><th style={{ padding: '3px 6px' }}>Service level</th>
          </tr></thead>
          <tbody>
            {rows.map(([hh, circ, level, color]) => (
              <tr key={hh} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: '4px 6px', fontWeight: 700, color: '#334155', verticalAlign: 'top' }}>{hh}</td>
                <td style={{ padding: '4px 6px', color: '#475569' }}>{circ}</td>
                <td style={{ padding: '4px 6px', fontWeight: 600, color, whiteSpace: 'nowrap' }}>{level}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
        The technology is identical in all four cases — only the service attributes differ. That is why the safely-managed and basic tables above list the same technologies; any gap between the two tables' costs reflects the added safe-management steps (containment, emptying, treatment).
      </div>
    </div>
  );
}

function Section({ title, children, defaultOpen = false, cols = 3, sectionKey, onFocus, openSignal }: { title: string; children: React.ReactNode; defaultOpen?: boolean; cols?: number; sectionKey?: string; onFocus?: (key: string) => void; openSignal?: number }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (openSignal) setOpen(true); }, [openSignal]);
  // Responsive columns: fields size to a min track and the column count adapts to the available
  // width (so the grid never stretches fields edge-to-edge on wide screens, nor cramps on a laptop).
  // The 2-col target/cost/technical sections keep a slightly wider min than the denser 3-col ones.
  const colMin = cols <= 2 ? 240 : 200;
  const titleParts = title.match(/^(\d+\.\s+\S+)(?:\s+(.*))?$/) || title.match(/^(\S+)(?:\s+(.*))?$/);
  const handleClick = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen && sectionKey && onFocus) onFocus(sectionKey);
  };
  return (
    <div data-section-key={sectionKey} className="wb-panel-section" style={{ marginBottom: 8 }}>
      <button onClick={handleClick} className={`wb-section-trigger${open ? ' wb-section-trigger-open' : ''}`}>
        <span>
          <span className="wb-heading-strong">{titleParts?.[1] || title}</span>
          {titleParts?.[2] && <> <span className="wb-heading-light">{titleParts[2]}</span></>}
        </span>
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div onFocusCapture={() => { if (sectionKey && onFocus) onFocus(sectionKey); }} onClickCapture={() => { if (sectionKey && onFocus) onFocus(sectionKey); }} style={{ padding: '10px 14px 12px', display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${colMin}px, 1fr))`, gap: '12px 16px', alignItems: 'start' }}>{children}</div>}
    </div>
  );
}

// Full-width span helper for grid layout
const FULL = { gridColumn: '1 / -1' } as const;

function SubHead({ text }: { text: string }) {
  return <div className="wb-subhead" style={{ gridColumn: '1 / -1', margin: '6px 0 2px', paddingBottom: 3 }}>{text}</div>;
}

// A row in a year-by-year table. `section`/`sub` render a band header instead of data cells.
type YRow = { label: React.ReactNode; tip?: string; section?: boolean; sub?: boolean; computed?: boolean; cells: React.ReactNode[] };

// Shared year-by-year table used by the split Data-Inputs sections (service levels / economic &
// demographic / budget). IMPORTANT: border-collapse must be SEPARATE (not collapse) — otherwise the
// sticky left label column does not freeze when the user scrolls the year columns horizontally.
function YearTable({ rows, years, baseYr2, colIsTarget, markTargets = false }: {
  rows: YRow[]; years: number[]; baseYr2: number; colIsTarget?: (idx: number) => boolean; markTargets?: boolean;
}) {
  return (
    <div style={{ gridColumn: '1 / -1', overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 4 }}>
      <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11 }}>
        <thead>
          <tr>
            <th style={{ padding: '4px 8px', textAlign: 'left', position: 'sticky', left: 0, background: '#f1f5f9', zIndex: 3, minWidth: 150 }}></th>
            {years.map((yr: number, i: number) => {
              const tgt = !!(markTargets && yr > baseYr2 && colIsTarget?.(i));
              return (
                <th key={yr} title={tgt ? 'Target year (a full service-level column is entered here)' : undefined} style={{ padding: '4px 4px', textAlign: 'center', fontSize: 10, fontWeight: yr > baseYr2 ? 600 : 500, color: tgt ? '#009CA7' : yr > baseYr2 ? '#617078' : '#29343b', minWidth: 62, background: tgt ? '#e5f4f5' : '#f4f7f9' }}>
                  {yr}{tgt ? <span style={{ fontSize: 8, fontWeight: 700, color: '#009CA7' }}> T</span> : yr > baseYr2 ? <span style={{ fontSize: 7, verticalAlign: 'super' }}>F</span> : null}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => row.section ? (
            <tr key={ri}>
              {/* Full-width band; the label is wrapped in a sticky span so it stays visible when the
                  year columns are scrolled right (a full-colSpan cell itself can't be pinned). */}
              <td colSpan={years.length + 1} style={{ padding: 0, background: row.sub ? '#e5f4f5' : '#edf1f3' }}>
                <div style={{ position: 'sticky', left: 0, display: 'inline-block', padding: row.sub ? '3px 8px 3px 22px' : '5px 8px', fontWeight: row.sub ? 600 : 700, fontStyle: row.sub ? 'italic' : 'normal', fontSize: row.sub ? 10.5 : 11, color: row.sub ? '#4f46e5' : '#312e81' }}>
                  {row.label}
                </div>
              </td>
            </tr>
          ) : (
            <tr key={ri} style={{ background: ri % 2 ? '#fafbfc' : '#fff' }}>
              <td style={{ padding: '4px 8px', fontWeight: 600, fontSize: 11, color: row.computed ? '#94a3b8' : '#1e3a5f', position: 'sticky', left: 0, background: ri % 2 ? '#fafbfc' : '#fff', zIndex: 2, whiteSpace: 'nowrap' }} title={row.tip || undefined}>
                {row.label}
                {row.tip && <span style={{
                  width: 14, height: 14, borderRadius: '50%', marginLeft: 5,
                  background: '#C2CBD6', color: '#fff', fontSize: 10, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center', cursor: 'help', verticalAlign: 'middle',
                  fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700,
                }} title={row.tip}>i</span>}
              </td>
              {row.cells.map((cell, ci) => (
                <td key={ci} style={{ padding: '2px 2px', textAlign: 'center' }}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Color convention: blue text = editable input, green text = cross-linked, gray = computed/derived
// Share of NEW investment (after replacement) directed at BASIC service. The remainder buys safely
// managed service. Both fields edit the same underlying number, so they always total 100%.
// It lives with the BUDGET inputs rather than the interventions because it drives the BAU projection,
// not just the designed scenario.
function SplitControl({ inputs, onChange, section, sector }: {
  inputs: any; onChange: (i: any) => void; section: 'water_interventions' | 'sanitation_interventions'; sector: string;
}) {
  const iv = inputs[section] || {};
  const basic = Math.round(((+iv.basic_share || 0) * 1000)) / 10;      // percent, 1dp
  const sm = Math.round((100 - basic) * 10) / 10;
  const setBasic = (pct: number) => {
    const v = Math.min(100, Math.max(0, isFinite(pct) ? pct : 0));
    onChange({ ...inputs, [section]: { ...iv, basic_share: v / 100 } });
  };
  const cell: React.CSSProperties = { padding: '4px 6px', border: '1px solid #dce4e8', background: '#e5f4f5', borderRadius: 3, fontSize: 12, color: '#29343b', outline: 'none', width: 66 };
  return (
    <div style={{ gridColumn: '1 / -1', border: '1px solid #bfdbfe', background: '#f8fbff',
      borderRadius: 6, padding: '10px 14px', marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#1e3a5f' }}>Investment split by service level</span>
        <span style={{ fontSize: 10.5, color: '#64748b' }}>
          How new {sector} investment is divided once replacement is funded. The safely-managed share
          upgrades households from basic and below; the basic share upgrades households from limited and
          below. Each is bought at its own unit cost.
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <label style={{ fontSize: 11.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          Safely managed
          <NumInput style={cell} value={sm} onValue={v => setBasic(100 - (v ?? 0))} />
          <span style={{ color: '#64748b' }}>%</span>
        </label>
        <label style={{ fontSize: 11.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          Basic
          <NumInput style={cell} value={basic} onValue={v => setBasic(v ?? 0)} />
          <span style={{ color: '#64748b' }}>%</span>
        </label>
        <div style={{ flex: 1, minWidth: 260, display: 'flex', alignItems: 'center', gap: 9 }}>
          <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>all safely managed</span>
          <input type="range" min={0} max={100} step={1} value={basic} onChange={e => setBasic(+e.target.value)}
            style={{ flex: 1, accentColor: '#2563eb' }} title="Drag to shift investment toward basic service" />
          <span style={{ fontSize: 10, color: '#94a3b8', whiteSpace: 'nowrap' }}>all basic</span>
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: '#475569', marginTop: 7 }}>
        Currently <b>{sm}%</b> of new {sector} investment buys safely-managed service and <b>{basic}%</b> buys
        basic service. This drives the business-as-usual projection, not only the designed scenario.
      </div>
    </div>
  );
}

function F({ label, value, onChange, unit, step, isPercent, min, max, tip, slider, fieldType, integer }: {
  label: string; value: number; onChange: (v: number) => void; unit?: string; step?: number; isPercent?: boolean;
  min?: number; max?: number; tip?: string; slider?: boolean; fieldType?: 'input' | 'linked' | 'computed'; integer?: boolean;
}) {
  const labelColor = fieldType === 'linked' ? '#16a34a' : fieldType === 'computed' ? '#94a3b8' : '#0000cc';
  const rawPct = Math.round(value * 1e4) / 1e2; // 2 decimal places for %
  const displayVal = value == null ? NaN : isPercent ? (fieldType === 'computed' ? Math.round(rawPct * 100) / 100 : rawPct) : (integer ? Math.round(value) : Math.round(value * 100) / 100);
  const displayMin = min !== undefined ? (isPercent ? Math.round(min * 1e10) / 1e8 : min) : undefined;
  const displayMax = max !== undefined ? (isPercent ? Math.round(max * 1e10) / 1e8 : max) : undefined;
  const outOfRange = (displayMin !== undefined && displayVal < displayMin) || (displayMax !== undefined && displayVal > displayMax);
  // Show thousands separators for large amounts, but never for years or percentages
  const looksLikeYear = !unit && !isPercent && Number.isInteger(value) && value >= 1900 && value <= 2100;
  const useCommas = !isPercent && !looksLikeYear && Math.abs(displayVal) >= 1000;
  const commaStr = useCommas ? displayVal.toLocaleString('en-US') : '';

  let tooltip = tip || '';
  if (displayMin !== undefined || displayMax !== undefined) {
    const rangeStr = displayMin !== undefined && displayMax !== undefined
      ? `Range: ${displayMin}–${displayMax}${unit ? ' ' + unit : ''}`
      : displayMin !== undefined ? `Min: ${displayMin}${unit ? ' ' + unit : ''}` : `Max: ${displayMax}${unit ? ' ' + unit : ''}`;
    tooltip = tooltip ? `${tooltip}\n${rangeStr}` : rangeStr;
  }

  const showSlider = slider && displayMin !== undefined && displayMax !== undefined;

  // World Bank SSST style: editable = cream, derived = gray
  const isDerived = fieldType === 'computed' || fieldType === 'linked';
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0,
    }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#3A4452', lineHeight: 1.3, fontWeight: 500, minHeight: 32 }} title={tooltip || undefined}>
        {label}
        {tooltip && <span style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          background: '#C2CBD6', color: '#fff', fontSize: 10, display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center', cursor: 'help',
          fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700,
        }} title={tooltip}>i</span>}
      </label>
      {isDerived ? (
        <input type={useCommas ? 'text' : 'number'} inputMode="decimal"
          value={useCommas ? commaStr : displayVal} readOnly
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, textAlign: 'left',
            border: '1px solid #DDE3EA', background: '#F1F3F5', color: '#6B7785',
            cursor: 'not-allowed', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
          }} />
      ) : (
        <NumInput
          value={Number.isNaN(displayVal) ? undefined : displayVal} commas={useCommas}
          // Empty cell → NaN in the model (serialises to null → engine reads 0). Lets the user clear/retype.
          onValue={v => onChange(v === undefined ? (NaN as number) : (isPercent ? v / 100 : v))}
          style={{
            width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, textAlign: 'left',
            border: outOfRange ? '1.5px solid #E74C3C' : '1px solid #F0D070',
            background: outOfRange ? '#FFE9E9' : '#FFF9E6',
            color: '#3A4452', cursor: 'text',
            boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none',
          }} />
      )}
      {unit && <span style={{ fontSize: 11, color: '#6B7785' }}>{unit}</span>}
      {showSlider && (
        <input type="range" value={displayVal}
          onChange={e => { const v = parseFloat(e.target.value); onChange(isPercent ? v / 100 : v); }}
          min={displayMin} max={displayMax} step={isPercent ? 1 : (step || 1)}
          style={{ width: '100%', height: 6, marginTop: 4, accentColor: '#2563eb' }}
        />
      )}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13 }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
      <span style={{ color: checked ? '#1a1a2e' : '#94a3b8', fontWeight: checked ? 600 : 400 }}>{label}</span>
    </label>
  );
}

// A year input that commits only on blur / Enter (not per keystroke), so a half-typed year like "19"
// can't momentarily re-anchor every data series or spawn thousands of table columns mid-edit.
function YearField({ label, value, onCommit, min, max, tip }: {
  label: string; value: number; onCommit: (v: number) => void; min?: number; max?: number; tip?: string;
}) {
  const [txt, setTxt] = useState(String(value ?? ''));
  React.useEffect(() => { setTxt(String(value ?? '')); }, [value]);
  const commit = () => {
    const v = parseInt(txt, 10);
    if (!isNaN(v) && v !== value) onCommit(v); else setTxt(String(value ?? ''));
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#3A4452', lineHeight: 1.3, fontWeight: 500, minHeight: 32 }} title={tip || undefined}>
        {label}
        {tip && <span style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, background: '#C2CBD6', color: '#fff', fontSize: 10, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700 }} title={tip}>i</span>}
      </label>
      <input type="number" value={txt}
        onChange={e => setTxt(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        min={min} max={max}
        style={{ width: '100%', padding: '7px 10px', borderRadius: 4, fontSize: 13, textAlign: 'left', border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452', boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }}
      />
    </div>
  );
}

interface Props { inputs: any; onChange: (i: any) => void; results?: any; onCalculate?: () => void; loading?: boolean; showSection?: string; geoScope?: string; bauSector?: 'water' | 'sanitation'; onBauSectorChange?: (v: 'water' | 'sanitation') => void; onSectionFocus?: (sectionKey: string) => void; currencyDisplay?: CurrencyDisplaySettings; onCurrencyDisplayChange?: (v: CurrencyDisplaySettings) => void; focusCurrencyRequest?: number; onEditCurrencyRate?: () => void; calculationError?: string; projectionError?: string; }

export default function InputPanel({ inputs, onChange, results, onCalculate, loading, showSection = 'inputs', geoScope = 'urban', bauSector: bauSectorProp, onBauSectorChange, onSectionFocus, currencyDisplay, onCurrencyDisplayChange, focusCurrencyRequest = 0, onEditCurrencyRate, calculationError, projectionError }: Props) {
  const [countries, setCountries] = useState<{name:string, currency:string}[]>([]);
  const [bauSectorLocal, setBauSectorLocal] = useState<'water' | 'sanitation'>('water');
  const rateInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusCurrencyRequest) return;
    const timer = setTimeout(() => {
      const section = document.querySelector('[data-section-key="country"]');
      section?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      rateInputRef.current?.focus();
    }, 80);
    return () => clearTimeout(timer);
  }, [focusCurrencyRequest]);
  const bauSector = bauSectorProp || bauSectorLocal;
  // The sector toggle is rendered in two places: above the Budget section on Data Inputs (so the split
  // control below it follows the chosen sector) and above section 6 on the BAU tab. Defined once here.
  // A compact segmented control in a card, so it reads as part of the section stack rather than two
  // full-width slabs. Sized to its content, so it looks the same in the wide Data-Inputs column and
  // the narrow BAU panel.
  const sectorToggle = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
      background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8,
      padding: '8px 14px', marginBottom: 10 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Sector</span>
      <div style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 6, overflow: 'hidden' }}>
        {(['water', 'sanitation'] as const).map(sct => (
          <button key={sct} onClick={() => setBauSector(sct)} style={{
            padding: '6px 22px', border: 'none', cursor: 'pointer',
            background: bauSector === sct ? '#2563eb' : '#fff',
            color: bauSector === sct ? '#fff' : '#475569',
            fontWeight: bauSector === sct ? 700 : 500, fontSize: 12.5,
          }}>{sct === 'water' ? 'Water Supply' : 'Sanitation'}</button>
        ))}
      </div>
      <span style={{ fontSize: 10.5, color: '#94a3b8' }}>
        Sections below are entered one sector at a time.
      </span>
    </div>
  );
  const setBauSector = onBauSectorChange || setBauSectorLocal;
  // Excel round-trip (download a template of the year-by-year table, fill offline, upload to populate).
  const [xlsxStatus, setXlsxStatus] = useState<{ kind: 'idle' | 'busy' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' });
  const fileRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    fetch('/api/countries').then(r => r.json()).then(setCountries).catch(() => {});
  }, []);

  const handleXlsxDownload = async () => {
    try { setXlsxStatus({ kind: 'busy', msg: 'Preparing template…' }); await downloadTemplate(inputs); setXlsxStatus({ kind: 'ok', msg: 'Template downloaded — fill the cream (historical) and blue (forecast) cells, then upload it back.' }); }
    catch (e) { setXlsxStatus({ kind: 'err', msg: String(e) }); }
  };
  const handleXlsxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      setXlsxStatus({ kind: 'busy', msg: `Reading ${f.name}…` });
      const { inputs: merged, cellsUpdated } = await importTemplate(f, inputs);
      onChange(merged);
      setXlsxStatus({ kind: 'ok', msg: `Loaded ${cellsUpdated} value${cellsUpdated === 1 ? '' : 's'} from ${f.name}.` });
    } catch (err) {
      setXlsxStatus({ kind: 'err', msg: String(err) });
    } finally {
      e.target.value = '';   // let the same file be re-selected
    }
  };

  if (!inputs) return null;
  const u = (section: string, field: string, value: number) => {
    onChange({ ...inputs, [section]: { ...inputs[section], [field]: value } });
  };

  // Every macro / population / service / budget series is stored POSITIONALLY (index 0 = model start
  // year). So moving the start year must shift these arrays, otherwise the old values just slide onto
  // the new years (e.g. changing the start to 1999 would show the 2011 numbers under 1999). We re-anchor
  // so each value stays attached to its YEAR: extend the start earlier → the newly-exposed years come in
  // blank; move it later → the dropped leading years fall off.
  const shiftYearSeries = (arr: any, delta: number) =>
    (!Array.isArray(arr) || !delta) ? arr
      : delta > 0 ? arr.slice(delta)                       // start later: drop leading years
      : [...Array(-delta).fill(0), ...arr];                // start earlier: prepend blank years
  const setModelStartYear = (newYr: number) => {
    const oldYr = inputs.period?.model_start_year;
    const delta = (Number.isFinite(newYr) && Number.isFinite(oldYr)) ? (newYr - oldYr) : 0;
    const next: any = { ...inputs, period: { ...inputs.period, model_start_year: newYr } };
    if (delta) {
      const shiftGroup = (obj: any, fields: string[]) => {
        if (!obj) return obj;
        const o = { ...obj };
        fields.forEach(f => { if (Array.isArray(o[f])) o[f] = shiftYearSeries(o[f], delta); });
        return o;
      };
      next.macro = shiftGroup(next.macro, ['gdp_real_local', 'gdp_nominal_usd', 'inflation_nepal', 'inflation_us', 'exchange_rate', 'gdp_growth']);
      next.population = shiftGroup(next.population, ['pop_ts', 'hh_ts']);
      next.water_service = shiftGroup(next.water_service, ['serv1_ts', 'serv2_ts', 'serv3_ts', 'serv4_ts', 'serv5_ts']);
      next.sanitation_service = shiftGroup(next.sanitation_service, ['sserv1_ts', 'sserv2_ts', 'sserv3_ts', 'sserv4_ts', 'sserv5_ts']);
      next.bau = shiftGroup(next.bau, ['ws_budget_ts', 'san_budget_ts', 'ws_expend_ts', 'san_expend_ts']);
    }
    onChange(next);
  };
  const toggleIntv = (field: string, value: boolean) => {
    onChange({ ...inputs, toggles: { ...inputs.toggles, [field]: value } });
  };

  // Technology-mix editor (unit-cost sections): TWO tables per sector, one per rung. Σ(share × cost) is
  // written through to that rung's weighted engine cost field. WATER uses different technologies for the
  // two rungs; SANITATION uses the same technologies in both (service level is attribute-driven).
  const setCostMix = (section: string, mixKey: string, engineField: string, arr: any[]) => {
    const weighted = arr.reduce((a: number, t: any) => a + (+t.share || 0) * (+t.cost || 0), 0);
    onChange({ ...inputs, [section]: { ...inputs[section], [mixKey]: arr, [engineField]: weighted } });
  };
  const renderCostMix = (section: string, mixKey: string, engineField: string, title: string) => {
    const m: any[] = (inputs[section]?.[mixKey] || []).filter((t: any) => t && typeof t === 'object');
    if (!m.length) return null;
    const shareSum = m.reduce((a: number, t: any) => a + (+t.share || 0), 0);
    const weighted = m.reduce((a: number, t: any) => a + (+t.share || 0) * (+t.cost || 0), 0);
    const ok = Math.abs(shareSum - 1) < 0.001;
    const cellStyle: React.CSSProperties = { padding: '4px 6px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 3, fontSize: 11, color: '#3A4452', outline: 'none' };
    // Shares that do not total 100% make the weighted cost wrong, so the share cells turn red until fixed.
    const shareCell: React.CSSProperties = ok ? cellStyle : { ...cellStyle, border: '1px solid #dc2626', background: '#fef2f2' };
    const upd = (i: number, patch: any) => setCostMix(section, mixKey, engineField, m.map((x: any, j: number) => j === i ? { ...x, ...patch } : x));
    return (
      <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#1e3a5f', margin: '4px 0 2px' }}>{title} — technology mix</div>
        <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
          <thead><tr style={{ color: '#64748b' }}><th style={{ textAlign: 'left', padding: '2px 6px' }}>technology</th><th>share %</th><th>cost/HH</th><th></th></tr></thead>
          <tbody>
            {m.map((t: any, i: number) => (
              <tr key={i}>
                <td><input type="text" style={{ ...cellStyle, width: 188 }} value={t.name || ''}
                  onChange={e => upd(i, { name: e.target.value })} /></td>
                <td><NumInput style={{ ...shareCell, width: 62 }}
                  value={(t.share == null || Number.isNaN(+t.share)) ? undefined : Math.round((+t.share) * 1e6) / 1e4}
                  onValue={v => upd(i, { share: v === undefined ? undefined : v / 100 })} /></td>
                <td><NumInput style={{ ...cellStyle, width: 96 }} commas
                  value={(t.cost == null || Number.isNaN(+t.cost)) ? undefined : Math.round(+t.cost)}
                  onValue={v => upd(i, { cost: v })} /></td>
                <td><button onClick={() => { if (m.length > 1) setCostMix(section, mixKey, engineField, m.filter((_: any, j: number) => j !== i)); }}
                  style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 3, padding: '2px 7px', cursor: 'pointer', fontSize: 10 }}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setCostMix(section, mixKey, engineField, [...m, { name: 'New technology', share: 0, cost: 0 }])}
          style={{ margin: '3px 0', padding: '3px 9px', fontSize: 11, border: '1px dashed #0073A8', background: '#fff', color: '#0073A8', borderRadius: 5, cursor: 'pointer' }}>+ Add technology</button>
        <div style={{ fontSize: 10.5, color: ok ? '#0073A8' : '#b91c1c' }}>
          Shares add up to {(shareSum * 100).toFixed(2)}%{ok ? '' : ' (they must total 100%)'}. Weighted {title} cost per household: <b>{Math.round(weighted).toLocaleString()} {CUR}</b>, used by the model.
        </div>
      </div>
    );
  };

  const setCountryConfig = (field: string, value: string) => {
    const updated = { ...inputs, country_config: { ...inputs.country_config, [field]: value } };
    // Auto-fill currency when country changes
    if (field === 'country') {
      const match = countries.find(c => c.name.toLowerCase() === value.toLowerCase());
      if (match) updated.country_config.currency = match.currency;
    }
    onChange(updated);
  };

  const isInputs = showSection === 'inputs';
  const isBAU = showSection === 'bau';
  const isInterventions = showSection === 'interventions';

  // Dynamic labels from country config and provider lists
  const cc = inputs.country_config || {};
  const wProviders = inputs.water_targets?.providers || [];
  const sProviders = inputs.sanitation_targets?.providers || [];
  const CUR = cc.currency || 'LCU';
  const displaySettings = currencyDisplay || defaultCurrencyDisplay(CUR);
  const updateDisplaySettings = (changes: Partial<CurrencyDisplaySettings>) => {
    onCurrencyDisplayChange?.({ ...displaySettings, ...changes, sourceCurrency: CUR });
  };
  const ws = [cc.ws_serv1_name||'Level 1', cc.ws_serv2_name||'Level 2', cc.ws_serv3_name||'Level 3', cc.ws_serv4_name||'Level 4', cc.ws_serv5_name||'Level 5'];
  const ss = [cc.san_serv1_name||'Level 1', cc.san_serv2_name||'Level 2', cc.san_serv3_name||'Level 3', cc.san_serv4_name||'Level 4', cc.san_serv5_name||'Level 5'];
  const startYr = inputs.period.model_start_year;
  const baseYr = inputs.period.baseline_year;
  const scopeLabel = geoScope === 'national' ? 'National' : geoScope === 'rural' ? 'Rural' : 'Urban';
  const scopeLower = scopeLabel.toLowerCase();
  // test2: the WSS budget is derived from the cost of new service (historical) and the mean
  // historical budget/GDP ratio × real GDP (forecast); any cell can be overridden in the table.

  // CAGR helper: (end/start)^(1/n) - 1
  const cagr = (start: number, end: number, years: number) => {
    if (!start || !end || !years || years <= 0 || start <= 0 || end <= 0) return 0;
    return Math.pow(end / start, 1 / years) - 1;
  };
  const nYears = (baseYr && startYr && baseYr > startYr) ? baseYr - startYr : 0;
  const pop = inputs.population || {};
  const popCagr = cagr(pop.total_pop_start, pop.total_pop_baseline, nYears);
  const hhStart = pop.total_hh_start || 0;
  const hhBase = pop.total_hh_baseline || 0;
  const avgHHSizeStart = (hhStart > 0 && pop.total_pop_start > 0) ? pop.total_pop_start / (hhStart * 1e6) : 0;
  const avgHHSizeBase = (hhBase > 0 && pop.total_pop_baseline > 0) ? pop.total_pop_baseline / (hhBase * 1e6) : 0;
  const hhSizeCagr = cagr(avgHHSizeStart, avgHHSizeBase, nYears);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', background: '#fafbfc', fontSize: 12 }}>
      {/* Content is capped to a consistent max width and centered, so section cards don't sprawl
          edge-to-edge on wide screens; the grey scroll container stays full-bleed behind it. */}
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 18, fontSize: 12, marginBottom: 12, color: '#3A4452', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #F0D070', background: '#FFF9E6', display: 'inline-block' }} />
          Historical input
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #dce4e8', background: '#e5f4f5', display: 'inline-block' }} />
          Forecast / target input
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 14, borderRadius: 3, border: '1px solid #DDE3EA', background: '#F1F3F5', display: 'inline-block' }} />
          Auto-calculated
        </span>
      </div>

      {/* Area-scope banner. On BAU/intervention tabs it sits at the top (every field there is scope-specific).
          On the Data Inputs tab it is moved BELOW §2a instead (see the "every section below" flag there), since
          §1 Country and §2a Analysis Period apply to the whole analysis rather than to one area. */}
      {!isInputs && (
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12, textAlign: 'left',
        padding: '8px 14px', borderRadius: 6, fontSize: 12.5,
        background: '#EBF6FB', border: '1px solid #9fd3ec', borderLeft: '4px solid #0073A8', color: '#0073A8',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 600 }}>
          <span>Entering <span style={{ display: 'inline-block', background: '#0073A8', color: '#fff', fontWeight: 700, padding: '1px 10px', borderRadius: 12, fontSize: 12, textTransform: 'capitalize', verticalAlign: 'baseline' }}>{scopeLabel}</span> data — every field on this page is {scopeLower}-specific.</span>
        </div>
        {isBAU && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 500, lineHeight: 1.5 }}>
            <span><strong>BAU data entry</strong> — Data fields below are synced with corresponding entries on the <strong>Data Inputs</strong> tab. They can be used to edit the BAU scenario directly from this tab.</span>
          </div>
        )}
        {isBAU && onCurrencyDisplayChange && (
          <CurrencyDisplayControl settings={displaySettings} sourceCurrency={CUR}
            onModeChange={mode => updateDisplaySettings({ mode })}
            onEditRate={() => onEditCurrencyRate?.()} />
        )}
      </div>
      )}

      {/* ===== INTERVENTION TOGGLES (shown in interventions step) ===== */}
      {isInterventions && inputs.toggles && <>
        <Section title="Intervention Toggles" cols={2}>
          <SubHead text="Water Supply" />
          <Toggle label="Collection efficiency" checked={inputs.toggles.ws_collection_enabled} onChange={v => toggleIntv('ws_collection_enabled', v)} />
          <Toggle label="NRW reduction" checked={inputs.toggles.ws_nrw_enabled} onChange={v => toggleIntv('ws_nrw_enabled', v)} />
          {/* One "Budget execution improvement" lever (internally keyed ws_capital_efficiency_enabled — the
              live capex-efficiency wiring). The old separate ws_budget_execution_enabled stub is removed. */}
          <Toggle label="Budget execution improvement" checked={inputs.toggles.ws_capital_efficiency_enabled} onChange={v => toggleIntv('ws_capital_efficiency_enabled', v)} />
          <Toggle label="Tariff increase" checked={inputs.toggles.ws_tariff_enabled} onChange={v => toggleIntv('ws_tariff_enabled', v)} />
          <SubHead text="Sanitation" />
          <Toggle label="Collection efficiency" checked={inputs.toggles.san_collection_enabled} onChange={v => toggleIntv('san_collection_enabled', v)} />
          <Toggle label="Budget execution improvement" checked={inputs.toggles.san_capital_efficiency_enabled} onChange={v => toggleIntv('san_capital_efficiency_enabled', v)} />
          <Toggle label="Tariff increase" checked={inputs.toggles.san_tariff_enabled} onChange={v => toggleIntv('san_tariff_enabled', v)} />
        </Section>
      </>}

      {isInputs && <>

      {/* ===== COUNTRY CONFIG ===== */}
      <Section title="1. Country, Area of Focus & Currency" sectionKey="country" onFocus={onSectionFocus} openSignal={focusCurrencyRequest}>
        {inputs.country_config && <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Country</label>
            <input type="text" list="country-list" value={inputs.country_config.country || ''}
              onChange={e => setCountryConfig('country', e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4, fontSize: 13, color: '#3A4452', boxSizing: 'border-box', outline: 'none' }}
              placeholder="Type to search..."
            />
            <datalist id="country-list">
              {countries.map(c => <option key={c.name} value={c.name} />)}
            </datalist>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Area of focus</label>
            <input type="text" value={inputs.country_config.area || ''}
              onChange={e => setCountryConfig('area', e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4, fontSize: 13, color: '#3A4452', boxSizing: 'border-box', outline: 'none' }}
              placeholder="e.g. Kathmandu Valley" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <label style={{ fontSize: 12, color: '#3A4452', fontWeight: 500 }}>Currency code</label>
            <input type="text" value={inputs.country_config.currency || ''}
              onChange={e => setCountryConfig('currency', e.target.value)}
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #F0D070', background: '#FFF9E6', borderRadius: 4, fontSize: 13, color: '#3A4452', boxSizing: 'border-box', outline: 'none' }} />
          </div>
          <div style={{ gridColumn: '1 / -1', border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 6, padding: '10px 12px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px 14px' }}>
            <div style={{ gridColumn: '1 / -1', fontSize: 12, fontWeight: 700, color: '#1e3a5f' }}>Optional USD display conversion</div>
            {CUR.toUpperCase() === 'USD' ? (
              <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#475569' }}>Model currency is USD. USD display is identical to the model values; no exchange rate is needed.</div>
            ) : <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="usd-display-rate" style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>Local currency per US$1</label>
                <input ref={rateInputRef} id="usd-display-rate" type="number" min="0.000000001" step="any"
                  value={displaySettings.localPerUsd ?? ''}
                  onChange={e => updateDisplaySettings({ localPerUsd: e.target.value === '' ? null : Number(e.target.value), mode: 'local' })}
                  style={{ width: '100%', padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }}
                  placeholder="Enter a positive rate" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label htmlFor="usd-display-year" style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>Rate reference year</label>
                <input id="usd-display-year" type="number" min="1900" max={new Date().getFullYear()} step="1"
                  value={displaySettings.rateReferenceYear ?? ''}
                  onChange={e => updateDisplaySettings({ rateReferenceYear: e.target.value === '' ? null : Number(e.target.value), mode: 'local' })}
                  style={{ width: '100%', padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }}
                  placeholder="e.g. 2025" />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: '1 / -1' }}>
                <label htmlFor="usd-display-source" style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>Rate source / notes (optional)</label>
                <input id="usd-display-source" type="text" value={displaySettings.sourceNote || ''}
                  onChange={e => updateDisplaySettings({ sourceNote: e.target.value })}
                  style={{ width: '100%', padding: '7px 9px', border: '1px solid #cbd5e1', borderRadius: 4, fontSize: 12, boxSizing: 'border-box' }}
                  placeholder="Source or notes for this fixed rate" />
              </div>
              <div style={{ gridColumn: '1 / -1', fontSize: 10.5, lineHeight: 1.5, color: '#64748b' }}>
                {currencyRateNote(displaySettings, CUR)} Calculations, inputs, stored results and coverage measures remain in {CUR}; this setting changes presentation only.
              </div>
            </>}
          </div>
        </>}
      </Section>

      {/* ===== 2. ANALYSIS PERIOD (key dates) ===== */}
      <Section title="2. Analysis Period" sectionKey="period" onFocus={onSectionFocus}>
        <SubHead text="Key dates" />
        <YearField label="Model start year" value={inputs.period.model_start_year} onCommit={setModelStartYear} min={1950} max={inputs.period.baseline_year - 1} tip="First year of historical data; must be at least 3 years before the last year of historical data. Existing data keeps its year — newly added earlier years come in blank for you to fill." />
        <F label="Last year of historical data" value={inputs.period.baseline_year} onChange={v => u('period','baseline_year',v)} min={2023} tip="Last year with complete actual data; must be within the last three years" />
        <F label="Forecast end year" value={inputs.period.forecast_end_year} onChange={v => u('period','forecast_end_year',v)} min={inputs.period.baseline_year + 5} tip="Last year of projection" />
      </Section>

      {/* ===== SCOPE-SPECIFICITY FLAG. §1 and §2a above apply to the whole analysis; every section below
              (the year-by-year table and the cost/technical sections) is entered per the selected scope. ===== */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8, textAlign: 'left',
        padding: '8px 14px', borderRadius: 6, fontSize: 12.5,
        background: '#EBF6FB', border: '1px solid #9fd3ec', borderLeft: '4px solid #0073A8', color: '#0073A8',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontWeight: 600 }}>
          <span>Every section below is <span style={{ display: 'inline-block', background: '#0073A8', color: '#fff', fontWeight: 700, padding: '1px 10px', borderRadius: 12, fontSize: 12, textTransform: 'capitalize', verticalAlign: 'baseline' }}>{scopeLabel}</span>-specific — enter {scopeLower} figures here. Sections 1 and 2 above apply to the whole analysis and are shared across areas.</span>
        </div>
      </div>

      {/* ===== EXCEL ROUND-TRIP — OPTIONAL bulk entry covering every section of the year-by-year table ===== */}
      <div style={{ marginBottom: 8, border: '1px solid #c7d2fe', borderLeft: '4px solid #2563eb', borderRadius: 8, background: '#fff', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#014972', marginBottom: 2 }}>Bulk data entry</div>
          <div style={{ fontSize: 11.5, color: '#475569', lineHeight: 1.45 }}>
            You can enter the year-by-year data two ways: type it directly in the sections below, or download the Excel template for {scopeLabel}, fill it in, and upload it.
          </div>
        </div>
        <button onClick={handleXlsxDownload} disabled={xlsxStatus.kind === 'busy'} style={{ padding: '6px 12px', fontSize: 12, border: '1px solid #2563eb', borderRadius: 6, background: '#fff', color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}>⤓ Download template</button>
        <button onClick={() => fileRef.current?.click()} disabled={xlsxStatus.kind === 'busy'} style={{ padding: '6px 12px', fontSize: 12, border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 }}>⤒ Upload filled template</button>
        <input ref={fileRef} type="file" accept=".xlsx" onChange={handleXlsxUpload} style={{ display: 'none' }} />
        {xlsxStatus.kind !== 'idle' && (
          <span style={{ gridColumn: '1 / -1', fontSize: 11, width: '100%',
            color: xlsxStatus.kind === 'err' ? '#b91c1c' : xlsxStatus.kind === 'ok' ? '#15803d' : '#64748b' }}>
            {xlsxStatus.kind === 'busy' ? 'Preparing: ' : xlsxStatus.kind === 'ok' ? 'Complete: ' : 'Warning: '}{xlsxStatus.msg}
          </span>
        )}
      </div>

      {/* ===== 3-5. YEAR-BY-YEAR DATA — split into Service levels / Economic & demographic / Budget ===== */}
      {(() => {
          // ── Shared computation for the three split year-by-year sections (service levels / economic
          // & demographic / budget); each renders the same year columns via <YearTable>. The table
          // spans the FULL model window (start -> forecast end): hard values render editable; the tail
          // shows grey markers for the engine's fills. ──
          const startYr2 = inputs.period.model_start_year || 2011;
          const endYr2 = inputs.period.forecast_end_year || 2040;
          // Clamp the rendered span so a half-typed year (e.g. "20" mid-entry) can't spawn thousands of columns.
          const span = Math.max(1, endYr2 - startYr2 + 1);
          const years = Array.from({ length: Math.min(span, 120) }, (_: unknown, i: number) => startYr2 + i);
          const baseYr2 = inputs.period.baseline_year || 2025;
          // ── Cell styling: cream = historical input, blue = forecast/projection input, grey = computed.
          const inputBase: React.CSSProperties = { width: 58, padding: '3px 4px', borderRadius: 3, fontSize: 11, textAlign: 'left', outline: 'none' };
          const CREAM: React.CSSProperties = { border: '1px solid #F0D070', background: '#FFF9E6', color: '#3A4452' };  // historical input
          const BLUE: React.CSSProperties = { border: '1px solid #dce4e8', background: '#e5f4f5', color: '#29343b' };    // forecast / projection input
          const grey = (txt: string, note: string) => <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }} title={note}>{txt}</span>;
          // 3 significant figures, at most 2 decimals, thousands-separated (no scientific notation) —
          // used by the grey "→ … used" projection rows. toPrecision rounds to 3 sig figs WITHOUT the
          // float artefacts that dividing by a tiny power of ten produced (e.g. 117 / 1e-5 gave
          // 11,699,999.999999998); maximumFractionDigits caps the shown decimals.
          const fmtNum = (v: number) => {
            if (!isFinite(v) || v === 0) return '0';
            return Number(v.toPrecision(3)).toLocaleString('en-US', { maximumFractionDigits: 2 });
          };
          const resAt = (key: string, idx: number): number | null => {
            const a = results?.[key];
            return Array.isArray(a) && idx < a.length && a[idx] != null ? a[idx] : null;
          };
          const secRes = (sector: 'water_supply' | 'sanitation', key: string, idx: number): number | null => {
            const a = results?.[sector]?.[key];
            return Array.isArray(a) && idx < a.length && a[idx] != null ? a[idx] : null;
          };
          // Write a value into inputs[section][field][idx] (macro / a named section / bau), growing the array.
          // Write a numeric value (already in model units) into inputs[section][field][idx], growing the array.
          const writeCellNum = (section: string, field: string, idx: number, value: number) => {
            const src = section === 'macro' ? inputs.macro : inputs[section];
            const a = [...((src?.[field]) || [])];
            while (a.length <= idx) a.push(0);
            a[idx] = value;
            onChange(section === 'macro' ? { ...inputs, macro: { ...inputs.macro, [field]: a } }
                                         : { ...inputs, [section]: { ...inputs[section], [field]: a } });
          };
          // An editable series cell. `forecast` colours it blue; `emptyZero` shows a blank (not 0) when unset,
          // so the user can see which forecast cells are empty (and will auto-fill at mean growth). Cells use
          // a text buffer (NumInput) so a cell can be cleared / the last digit deleted; a cleared cell reads 0.
          const editCell = (section: string, field: string, idx: number, isPct: boolean, forecast: boolean, emptyZero = false) => {
            const val = (((section === 'macro' ? inputs.macro : inputs[section])?.[field]) || [])[idx] ?? 0;
            const disp = (emptyZero && !(val > 0)) ? undefined : (isPct ? Math.round(val * 10000) / 100 : Math.round(val * 100) / 100);
            return <NumInput value={disp}
              onValue={v => writeCellNum(section, field, idx, v === undefined ? 0 : (isPct ? v / 100 : v))}
              style={{ ...inputBase, ...(forecast ? BLUE : CREAM) }} />;
          };
          // A grey "auto-fill" row: the value the model actually uses each year (the user's own entries,
          // with blank years filled at the mean historical growth). This is the separate projection row.
          const projRow = (label: string, tip: string, get: (i: number) => number | null, isPct: boolean) => ({
            label, tip, computed: true,
            cells: years.map((_: number, i: number) => { const v = get(i); return v == null ? grey('…', 'computing…') : grey(isPct ? (v * 100).toFixed(1) : fmtNum(v), 'Value the model uses this year'); }),
          });
          // Budget cell (from_cost): the model-computed budget shows as a PLACEHOLDER; type to OVERRIDE that
          // year (stored in the bau expenditure series). Historical = cream, forecast = blue.
          const budgetCostCell = (ovField: string, sector: 'water_supply' | 'sanitation', idx: number, placeholderField: string) => {
            const ov = (inputs.bau?.[ovField] || [])[idx] ?? 0;
            const forecast = years[idx] > baseYr2;
            const computed = secRes(sector, placeholderField, idx);
            return <NumInput value={ov > 0 ? Math.round(ov * 100) / 100 : undefined} commas
              placeholder={computed != null ? String(Math.round(computed)) : ''}
              title={ov > 0 ? 'Your override for this year' : 'Model-computed value — type to override'}
              onValue={v => { const a = [...(inputs.bau?.[ovField] || [])]; while (a.length <= idx) a.push(0); a[idx] = v === undefined ? 0 : v; onChange({ ...inputs, bau: { ...inputs.bau, [ovField]: a } }); }}
              style={{ ...inputBase, width: 64, ...(forecast ? BLUE : CREAM) }} />;
          };

          // Service-level cell. The validated model consumes exactly TWO points per rung — the
          // START-year split and the BASELINE-year split (the historical path follows each rung's
          // CAGR internally). Only those two years are editable; in-between years show the
          // engine's historical path; forecast years come from the engine.
          const biSvc = baseYr2 - startYr2;   // baseline offset (index of the baseline-year split)
          // ── Historical service-level display, computed LIVE to MATCH the engine's 4a block ──
          // The engine does NOT interpolate %s linearly. Each rung's UNADJUSTED household COUNT
          // grows geometrically from its start-year count at the rung's historical count-CAGR
          // (count = %·HH), then the adjusted (displayed) counts are rescaled to that year's total
          // HHs. Water rescales ALL rungs proportionally (HH cancels → pure endpoint-% function);
          // sanitation keeps SM as the raw geometric count and plugs Basic (so it needs the HH
          // series). We replicate that here so the grey preview equals what the model uses.
          const svcFields = (section: string) => section === 'water_service'
            ? ['serv1_ts', 'serv2_ts', 'serv3_ts', 'serv4_ts', 'serv5_ts']
            : ['sserv1_ts', 'sserv2_ts', 'sserv3_ts', 'sserv4_ts', 'sserv5_ts'];
          // Projected total households at a year-offset (mirrors engine _project_series): every
          // user-entered value > 0 is HONOURED — including the baseline year and forecast overrides —
          // and blank years fill from the prior year at the mean YoY growth of the leading
          // contiguous run of entered values.
          const hhSeries = inputs.population?.hh_ts || [];
          // Mirror the engine's _project_series: honour entered values, smooth the blanks by the YoY
          // growth rate — interior gaps interpolate geometrically between the nearest entered value
          // before and after; the tail (and any leading gap) extrapolates at mean historical growth.
          const hhProj = (() => {
            const n = years.length;
            const out = Array.from({ length: n }, (_: unknown, t: number) => (hhSeries[t] ?? 0) > 0 ? hhSeries[t] : 0);
            const anchors: number[] = [];
            for (let t = 0; t < n; t++) if (out[t] > 0) anchors.push(t);
            const known: number[] = [];
            for (let t = 0; t < n; t++) { if (out[t] > 0) known.push(out[t]); else break; }
            const yoy: number[] = [];
            for (let i = 1; i < known.length; i++) if (known[i - 1] > 0) yoy.push(known[i] / known[i - 1] - 1);
            const g = yoy.length ? yoy.reduce((a, b) => a + b, 0) / yoy.length : 0;
            if (!anchors.length) return out;
            for (let ai = 0; ai < anchors.length - 1; ai++) {          // interior gaps: geometric interpolation
              const lo = anchors[ai], hi = anchors[ai + 1];
              if (hi - lo <= 1) continue;
              const vLo = out[lo], vHi = out[hi];
              const r = (vLo > 0 && vHi > 0) ? Math.pow(vHi / vLo, 1 / (hi - lo)) - 1 : g;
              for (let j = 1; j < hi - lo; j++) out[lo + j] = vLo * Math.pow(1 + r, j);
            }
            for (let t = anchors[anchors.length - 1] + 1; t < n; t++) out[t] = out[t - 1] * (1 + g);   // trailing
            const denom = 1 + g;
            for (let t = anchors[0] - 1; t >= 0; t--) out[t] = denom !== 0 ? out[t + 1] / denom : 0;   // leading
            return out;
          })();
          const totalHHAt = (t: number) => hhProj[t] ?? 0;
          const histSvcPct = (section: string, rung0: number, t: number) => {
            if (biSvc <= 0) return 0;
            const fields = svcFields(section);
            const pctStart = fields.map(f => (inputs[section]?.[f] || [])[0] || 0);
            const pctBase = fields.map(f => (inputs[section]?.[f] || [])[biSvc] || 0);
            const hh0 = totalHHAt(0), hhB = totalHHAt(biSvc), hhT = totalHHAt(t);
            const haveHH = hh0 > 0 && hhB > 0 && hhT > 0;
            // Unadjusted count per rung: base0·(1+count-CAGR)^t, with the engine's guard (a rung
            // with a zero start or baseline % stays flat at its base0, no growth).
            const unadj = pctStart.map((ps, r) => {
              const pb = pctBase[r];
              const base0 = ps * (haveHH ? hh0 : 1);
              if (ps > 0 && pb > 0) {
                const ratio = haveHH ? (pb * hhB) / (ps * hh0) : pb / ps;
                return base0 * Math.pow(ratio, t / biSvc);
              }
              return base0;
            });
            const totalUnadj = unadj.reduce((a, b) => a + b, 0);
            const prop = (r: number) => totalUnadj > 0 ? unadj[r] / totalUnadj : 0;
            // Water (and sanitation fallback when the HH series is unavailable): proportional rescale.
            if (section === 'water_service' || !haveHH) return prop(rung0);
            // Sanitation: SM kept as raw geometric share, lower rungs proportional, Basic = plug.
            const smPct = unadj[0] / hhT;
            if (rung0 === 0) return smPct;
            if (rung0 === 2 || rung0 === 3 || rung0 === 4) return prop(rung0);
            return 1 - smPct - (prop(2) + prop(3) + prop(4));   // Basic
          };

          const svcCell = (section: string, field: string, idx: number) => {
            const yr = years[idx];
            // test2 (item 7): EVERY historical year is an editable cream input (like the GDP / population
            // rows); blank years are ignored and filled by the engine at the mean historical growth.
            if (yr <= baseYr2) {
              return editCell(section, field, idx, true, false, true);    // cream, blank when unentered
            }
            // Forecast year: EDITABLE target cell (blue). Fill all 5 rungs (Σ 100%) to make this a target year.
            return editCell(section, field, idx, true, true, true);
          };
          // A forecast column is a target year when its 5 rung shares sum to ~100% (zeros allowed).
          const colIsTarget = (section: string, idx: number) => {
            const fields = svcFields(section);
            let s = 0;
            for (const f of fields) { const v = (inputs[section]?.[f] || [])[idx]; if (v != null && v > 0) s += v; }
            return Math.abs(s - 1) < 0.02;
          };
          const svcRow = (label: string, section: string, field: string) => ({
            label, tip: 'Share of households at this service level. Historical years are editable inputs; fill a forecast column (all 5 rungs add up to 100%) to set a target year.',
            cells: years.map((_: number, i: number) => svcCell(section, field, i)),
          });

          // Lighter sub-header band (Water supply / Sanitation) inside the Service levels table.
          const subRow = (label: React.ReactNode): YRow => ({ label, section: true, sub: true, computed: false, cells: [] });
          // Per-sector "first year" picker (item 8): the BAU growth rate = mean year-on-year growth from
          // this year to the last historical year. Stored as inputs.<section>.bau_first_year — a YEAR, so
          // it survives a model-start-year shift. Rendered in the sector band so it's clearly on the table.
          const firstYearPicker = (section: string, label: string) => {
            const histYears = years.filter((y: number) => y <= baseYr2);
            const cur = inputs[section]?.bau_first_year || startYr2;
            return (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>{label}</span>
                <span style={{ fontWeight: 500, fontStyle: 'normal', fontSize: 10.5, color: '#4f46e5', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  BAU rate from
                  <select value={cur} onChange={e => u(section, 'bau_first_year', parseInt(e.target.value, 10))}
                    style={{ fontSize: 10.5, padding: '1px 4px', border: '1px solid #c7d2fe', borderRadius: 4, background: '#fff', color: '#312e81', cursor: 'pointer' }}>
                    {histYears.map((y: number) => <option key={y} value={y}>{y}</option>)}
                  </select>
                  to {baseYr2}
                  <span title="Sets the first historical year used to work out this sector's business-as-usual trend. The tool averages year-on-year growth from that year to the last historical year, then projects it forward. Pick the year whose trend best reflects the pace you expect to continue." style={{ width: 13, height: 13, borderRadius: '50%', background: '#C2CBD6', color: '#fff', fontSize: 9, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'help', fontStyle: 'italic', fontFamily: 'Georgia, serif', fontWeight: 700 }}>i</span>
                </span>
              </span>
            );
          };

          const hhLbl = `${scopeLabel} households`;
          const anyTarget = (i: number) => colIsTarget('water_service', i) || colIsTarget('sanitation_service', i);
          const serviceRows: YRow[] = [
            subRow(firstYearPicker('water_service', 'Water supply')),
            svcRow(`% ${ws[0]}`, 'water_service', 'serv1_ts'),
            svcRow(`% ${ws[1]}`, 'water_service', 'serv2_ts'),
            svcRow(`% ${ws[2]}`, 'water_service', 'serv3_ts'),
            svcRow(`% ${ws[3]}`, 'water_service', 'serv4_ts'),
            svcRow(`% ${ws[4]}`, 'water_service', 'serv5_ts'),
            subRow(firstYearPicker('sanitation_service', 'Sanitation')),
            svcRow(`% ${ss[0]}`, 'sanitation_service', 'sserv1_ts'),
            svcRow(`% ${ss[1]}`, 'sanitation_service', 'sserv2_ts'),
            svcRow(`% ${ss[2]}`, 'sanitation_service', 'sserv3_ts'),
            svcRow(`% ${ss[3]}`, 'sanitation_service', 'sserv4_ts'),
            svcRow(`% ${ss[4]}`, 'sanitation_service', 'sserv5_ts'),
          ];
          const econRows: YRow[] = [
            { label: `Real GDP (${CUR} M)`, tip: `Real GDP in local currency (millions, base-year prices). Enter historical years; blank forecast years fill in from the yearly growth rate, or type your own. This drives the forecast budget.`, cells: years.map((_: number, i: number) => editCell('macro', 'gdp_real_local', i, false, years[i] > baseYr2, true)) },
            projRow(`→ Real GDP used (${CUR} M)`, 'Auto-fill: real GDP the model uses each year (your entries; blank years filled at mean historical growth).', (i) => resAt('gdp_real_local', i), false),
            { label: 'GDP growth %', tip: 'Year-on-year real GDP growth (auto-calculated from the values the model uses).', computed: true, cells: years.map((_: number, i: number) => {
              const cur = resAt('gdp_real_local', i), prev = resAt('gdp_real_local', i - 1);
              const g = (i > 0 && cur && prev) ? ((cur/prev)-1)*100 : 0;
              return <span style={{ fontSize: 10, color: '#94a3b8' }}>{i > 0 && cur ? g.toFixed(1)+'%' : 'n/a'}</span>;
            }) },
            { label: `${scopeLabel} population (mill)`, tip: `Total ${scopeLower} population in millions. Historical years are inputs; blank forecast years fill in from the yearly growth rate, or type your own.`, cells: years.map((_: number, i: number) => editCell('population', 'pop_ts', i, false, years[i] > baseYr2, true)) },
            projRow('→ Population used (mill)', 'Auto-fill: population the model uses each year.', (i) => resAt('population', i), false),
            { label: 'Pop growth %', tip: 'Year-on-year population growth (auto-calculated).', computed: true, cells: years.map((_: number, i: number) => {
              const cur = resAt('population', i), prev = resAt('population', i - 1);
              const g = (i > 0 && cur && prev) ? ((cur/prev)-1)*100 : 0;
              return <span style={{ fontSize: 10, color: '#94a3b8' }}>{i > 0 && cur ? g.toFixed(1)+'%' : 'n/a'}</span>;
            }) },
            { label: `${hhLbl} (mill)`, tip: `Total ${scopeLower} households in millions — DRIVES the model. Historical years are inputs; blank forecast years fill in from the yearly growth rate, or type your own.`, cells: years.map((_: number, i: number) => editCell('population', 'hh_ts', i, false, years[i] > baseYr2, true)) },
            projRow(`→ ${hhLbl} used (mill)`, 'Auto-fill: households the model uses each year.', (i) => resAt('total_hh', i), false),
            { label: 'Avg HH size', tip: 'Average household size = population ÷ households (auto-calculated).', computed: true, cells: years.map((_: number, i: number) => {
              const p = resAt('population', i) ?? 0; const h = resAt('total_hh', i) ?? 0;
              const sz = (h > 0 && p > 0) ? p / h : 0;
              return <span style={{ fontSize: 10, color: '#94a3b8' }}>{sz > 0 ? sz.toFixed(2) : 'n/a'}</span>;
            }) },
          ];
          const budgetRows: YRow[] = [
            { label: 'WS executed budget', tip: 'Water supply capital that actually gets put to work building new service = new households × unit cost (set by the technology mix). Historical = cost of new service; forecast = mean historical budget/GDP × real GDP. Placeholder shows the model value — type to override.', cells: years.map((_: number, i: number) => budgetCostCell('ws_expend_ts', 'water_supply', i, 'budget_used')) },
            { label: 'WS allocated budget', tip: 'Water supply capital budget ALLOCATED on paper (e.g. government budget) — a manual input, normally larger than the budget actually put to work. Historical default ≈ 77% budget execution; forecast = mean historical (allocated ÷ executed) × the executed-budget forecast. Budget execution = executed budget ÷ allocated.', cells: years.map((_: number, i: number) => budgetCostCell('ws_alloc_ts', 'water_supply', i, 'budget_allocated')) },
            { label: 'SAN executed budget', tip: 'Sanitation capital that actually gets put to work building new service = new households × unit cost. Historical = cost of new service; forecast = mean historical budget/GDP × real GDP. Placeholder shows the model value — type to override.', cells: years.map((_: number, i: number) => budgetCostCell('san_expend_ts', 'sanitation', i, 'budget_used')) },
            { label: 'SAN allocated budget', tip: 'Sanitation capital budget ALLOCATED on paper — a manual input, normally larger than the budget actually put to work. Historical default ≈ 77% budget execution; forecast = mean historical (allocated ÷ executed) × the executed-budget forecast. Budget execution = executed budget ÷ allocated.', cells: years.map((_: number, i: number) => budgetCostCell('san_alloc_ts', 'sanitation', i, 'budget_allocated')) },
          ];
          return (
            <>
              <Section title="3. Service levels" sectionKey="service_levels" onFocus={onSectionFocus}>
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b', marginBottom: 4, padding: '4px 8px', background: '#f8fafc', borderRadius: 4 }}>
                  Enter the historical share of households at each service level in neutral-fill cells. The five rungs in each year must add up to 100%. Blank years fill in automatically from the yearly growth rate. In each sector's band below, the <b>"BAU rate from"</b> dropdown sets the first historical year used to work out the business-as-usual trend: the tool averages year-on-year growth from that year to the last historical year and projects it forward, so pick the year whose trend best reflects the pace you expect to continue (or leave the default if unsure). To set a <b style={{ color: '#009CA7' }}>target</b>, fill in a teal-tinted forecast column so its five rungs add up to 100%. You can set as many target years as you like.
                </div>
                <YearTable rows={serviceRows} years={years} baseYr2={baseYr2} markTargets colIsTarget={anyTarget} />
              </Section>

              <Section title="4. Economic & demographic data" sectionKey="econ_demo" onFocus={onSectionFocus}>
                {projectionError && <div role="alert" style={{ gridColumn: '1 / -1', color: '#b91c1c', fontSize: 11 }}>
                  Automatic economic projections could not run: {projectionError}
                </div>}
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b', marginBottom: 4, padding: '4px 8px', background: '#f8fafc', borderRadius: 4 }}>
                  Enter historical values in neutral-fill cells. Teal-tinted forecast cells are optional. Blank cells fill in from the yearly growth rate, shown in the muted "used" row. GDP growth, population growth, and average household size are auto-calculated.
                </div>
                <YearTable rows={econRows} years={years} baseYr2={baseYr2} />
                <SubHead text="Optional forecast assumptions" />
                <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b' }}>
                  GDP, population and households continue to project automatically from entered data.
                  GDP fallback growth is used only when there are fewer than two GDP observations.
                  The rates below show the existing model defaults when no override is entered;
                  they are not measured DRC inflation.
                </div>
                <F label="GDP growth fallback" value={inputs.macro.gdp_growth_forecast ?? 0.05}
                  onChange={v => u('macro','gdp_growth_forecast',v)} isPercent unit="%" min={-0.99}
                  tip="Fallback only: with sufficient GDP observations, the model uses growth from the supplied series instead." />
                <F label="Ongoing local inflation" value={inputs.macro.inflation_local_ongoing ?? 0.05}
                  onChange={v => u('macro','inflation_local_ongoing',v)} isPercent unit="%" min={-0.99}
                  tip="Existing model default: 5%. Override with a country-specific assumption. Used after the entered inflation series ends." />
                <F label="Ongoing US inflation" value={inputs.macro.inflation_us_ongoing ?? 0.022}
                  onChange={v => u('macro','inflation_us_ongoing',v)} isPercent unit="%" min={-0.99}
                  tip="Existing model default: 2.2%. Override when relevant to the legacy USD conversion workflow." />
              </Section>

              {/* Sector choice ahead of the budget, so the split control below follows one sector
                  instead of showing a pair. */}
              {sectorToggle}

              <Section title="5. Budget" sectionKey="budget" onFocus={onSectionFocus}>
                <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', marginBottom: 4 }}>
                  <b>Two budgets per sector.</b> <b>Executed budget</b> = capital that actually gets put to work building service (new households × unit cost) — this drives the BAU. <b>Allocated budget</b> = the capital budget on paper (a manual input, normally larger). Their ratio is the <b>budget execution</b> (executed budget ÷ allocated budget) that the Budget-execution intervention improves. Type any cell to override that year; blanks fill from the model.
                </div>
                <YearTable rows={budgetRows} years={years} baseYr2={baseYr2} />
                <SplitControl inputs={inputs} onChange={onChange}
                  section={bauSector === 'water' ? 'water_interventions' : 'sanitation_interventions'}
                  sector={bauSector === 'water' ? 'water supply' : 'sanitation'} />
              </Section>
              <Section title="6. Revenue Inputs" sectionKey="revenue_inputs" onFocus={onSectionFocus}>
                {calculationError && inputs.revenue_bases?.water && inputs.revenue_bases?.sanitation &&
                  <div role="alert" style={{ gridColumn: '1 / -1', padding: '8px 10px', color: '#9f1239', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 5 }}>
                    {calculationError}
                  </div>}
                <RevenueInputsSection inputs={inputs} onChange={onChange} sector={bauSector} area={geoScope} />
              </Section>
            </>
          );
        })()}

      </>}

      {(isBAU || isInputs) && <>
      {calculationError?.includes('Missing country-specific inputs') &&
        <div role="alert" style={{ padding: '8px 12px', marginBottom: 8, color: '#9f1239', background: '#fff1f2', border: '1px solid #fecdd3', borderRadius: 5 }}>
          {calculationError}
        </div>}
      {isBAU && sectorToggle}

      {/* ===== UNIT COSTS + TECHNICAL (merged, sector-dependent). Targets are now set in the §2 table. ===== */}
      {bauSector === 'water' && (
      <Section title={`7. ${scopeLabel} Water Supply — Unit Costs & Technical Parameters`} cols={2} sectionKey="ws_unit_costs" onFocus={onSectionFocus}>
        <SubHead text="Unit costs (nominal → real)" />
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#617078', padding: '4px 8px', background: '#e5f4f5', borderRadius: 4, border: '1px solid #dce4e8' }}>
          Enter technology costs as <b>nominal</b> prices for the price-index year below. The model uses the <b>real</b> price = nominal × price index ÷ 100. The engine consumes the <b>{ws[0]}</b> and <b>{ws[1]}</b> weighted costs, built from the technology mixes below.
        </div>
        <F label="Nominal price year" value={inputs.water_costs.price_index_year ?? inputs.period.baseline_year} onChange={v => u('water_costs','price_index_year',v)} tip="The year the nominal technology prices are quoted in." />
        <F label="Price index (base = 100)" value={inputs.water_costs.price_index ?? 100} onChange={v => u('water_costs','price_index',v)} step={1} min={0} max={100000} tip="Real price = nominal × price index ÷ 100. Leave at 100 for no adjustment; change it and every technology price rescales accordingly." />
        {(() => { const pi = (inputs.water_costs.price_index ?? 100) / 100; return (
          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#475569', background: '#f8fafc', borderRadius: 4, padding: '3px 8px' }}>Real (used by the model): {ws[0]} = <b>{Math.round((inputs.water_costs.network_cost_per_hh_serv1||0)*pi).toLocaleString()}</b> {CUR}/HH · {ws[1]} = <b>{Math.round((inputs.water_costs.network_cost_per_hh_serv2||0)*pi).toLocaleString()}</b> {CUR}/HH</div>
        ); })()}
        <SubHead text="Distribution network cost per HH (nominal)" />
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b', marginBottom: 2 }}>
          Two technology mixes — for water, {ws[0].toLowerCase()} and {ws[1].toLowerCase()} use different technologies (safely-managed = on-premises improved sources; basic = shared / communal supplies). The weighted cost per household is shown beneath each table.
        </div>
        {renderCostMix('water_costs', 'sm_tech_mix', 'network_cost_per_hh_serv1', ws[0])}
        {renderCostMix('water_costs', 'basic_tech_mix', 'network_cost_per_hh_serv2', ws[1])}
        <SubHead text="Technical parameters" />
        <F label="Useful life of assets" value={inputs.technical.ws_asset_life} onChange={v => u('technical','ws_asset_life',v)} unit="yrs" min={5} max={100} tip="Expected useful life of infrastructure assets — drives the replacement (depreciation) capex." />
        <F label="% water sold to non-household" value={inputs.technical.ws_non_hh_pct} onChange={v => u('technical','ws_non_hh_pct',v)} isPercent unit="%" tip="Share of water sold to non-household customers (commercial, industrial, institutional) — scales the total capex above the household capex." />
        <SubHead text="Non-revenue water — feeds the BAU new-capex adder" />
        <F label="Treatment cost as % of capex" value={inputs.water_interventions?.nrw_treatment_cost_pct_capex ?? 0.4} onChange={v => u('water_interventions','nrw_treatment_cost_pct_capex',v)} isPercent unit="%" tip="Part of the new-capex adder: cost × (treat% × NRW% × physical%)" />
        <F label="Current NRW" value={inputs.water_interventions?.nrw_current_pct ?? 0.4} onChange={v => u('water_interventions','nrw_current_pct',v)} isPercent unit="%" tip="Non-revenue water as share of water produced" />
        <F label="Physical losses as % of NRW" value={inputs.water_interventions?.nrw_physical_loss_pct ?? 0.5} onChange={v => u('water_interventions','nrw_physical_loss_pct',v)} isPercent unit="%" tip="Physical (leakage) share of total NRW" />
      </Section>
      )}

      {bauSector === 'sanitation' && (
      <Section title={`7. ${scopeLabel} Sanitation — Unit Costs & Technical Parameters`} cols={2} sectionKey="san_unit_costs" onFocus={onSectionFocus}>
        <SubHead text="Unit costs (nominal → real)" />
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#617078', padding: '4px 8px', background: '#e5f4f5', borderRadius: 4, border: '1px solid #dce4e8' }}>
          Enter technology costs as <b>nominal</b> prices for the price-index year below. The model uses the <b>real</b> price = nominal × price index ÷ 100. The engine consumes the <b>{ss[0]}</b> and <b>{ss[1]}</b> weighted costs, built from the technology mixes below.
        </div>
        <F label="Nominal price year" value={inputs.sanitation_costs.price_index_year ?? inputs.period.baseline_year} onChange={v => u('sanitation_costs','price_index_year',v)} tip="The year the nominal technology prices are quoted in." />
        <F label="Price index (base = 100)" value={inputs.sanitation_costs.price_index ?? 100} onChange={v => u('sanitation_costs','price_index',v)} step={1} min={0} max={100000} tip="Real price = nominal × price index ÷ 100. Leave at 100 for no adjustment; change it and every technology price rescales accordingly." />
        {(() => { const pi = (inputs.sanitation_costs.price_index ?? 100) / 100; return (
          <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#475569', background: '#f8fafc', borderRadius: 4, padding: '3px 8px' }}>Real (used by the model): {ss[0]} = <b>{Math.round((inputs.sanitation_costs.sewer_cost_per_hh_sserv1||0)*pi).toLocaleString()}</b> {CUR}/HH · {ss[1]} = <b>{Math.round((inputs.sanitation_costs.sewer_cost_per_hh_sserv2||0)*pi).toLocaleString()}</b> {CUR}/HH</div>
        ); })()}
        <SubHead text="Sanitation cost per HH (nominal)" />
        <div style={{ gridColumn: '1 / -1', fontSize: 10, color: '#64748b', marginBottom: 2 }}>
          Two tables using the <b>same</b> technologies — for sanitation the service level is set by service attributes (sharing, emptying, treatment), not the technology (see the panel below). Costs default equal; raise the {ss[0].toLowerCase()} table if it adds safe emptying/treatment.
        </div>
        {renderCostMix('sanitation_costs', 'sm_tech_mix', 'sewer_cost_per_hh_sserv1', ss[0])}
        {renderCostMix('sanitation_costs', 'basic_tech_mix', 'sewer_cost_per_hh_sserv2', ss[1])}
        <SanServiceLevelExplainer />
        <SubHead text="Technical parameters" />
        <F label="Useful life of assets" value={inputs.technical.san_asset_life} onChange={v => u('technical','san_asset_life',v)} unit="yrs" min={5} max={100} tip="Expected useful life of infrastructure assets — drives the replacement (depreciation) capex." />
        <F label="% wastewater from non-household" value={inputs.technical.san_non_hh_pct} onChange={v => u('technical','san_non_hh_pct',v)} isPercent unit="%" tip="Share of wastewater from non-household sources (commercial, industrial, institutional) — scales the total capex above the household capex." />
      </Section>
      )}
      </>}

      {isInterventions && <>
      {/* ===== WATER INTERVENTIONS ===== */}
      <Section title="7. Water Supply Interventions" cols={2} sectionKey="ws_interventions" onFocus={onSectionFocus}>
        <SubHead text="Collection efficiency" />
        <F label="Start year" value={inputs.water_interventions.ce_start_year} onChange={v => u('water_interventions','ce_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the intervention begins; must be after baseline" />
        <F label="Target year" value={inputs.water_interventions.ce_target_year} onChange={v => u('water_interventions','ce_target_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the target is fully achieved; must be after start year" />
        <F label="Current collection ratio" value={inputs.water_interventions.ce_current_ratio} onChange={v => u('water_interventions','ce_current_ratio',v)} isPercent unit="%" tip="Fraction of billed amounts actually collected" />
        <F label="Target collection ratio" value={inputs.water_interventions.ce_target_ratio} onChange={v => u('water_interventions','ce_target_ratio',v)} isPercent unit="%" tip="Fraction of billed amounts actually collected" />
        <F label="Total water supply volume sold" value={inputs.water_interventions.ce_water_sold_mld} onChange={v => u('water_interventions','ce_water_sold_mld',v)} unit="MLD" min={0} max={10000} tip="Total water supply volume sold in MLD" />
        <F label="Current average water tariff" value={inputs.water_interventions.ce_current_tariff} onChange={v => u('water_interventions','ce_current_tariff',v)} unit={CUR} min={0} max={1000} tip={`Average water tariff in ${CUR} per cubic meter`} />

        <SubHead text="NRW reduction" />
        <F label="Start year" value={inputs.water_interventions.nrw_start_year} onChange={v => u('water_interventions','nrw_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the NRW reduction begins; must be after baseline" />
        <F label="Target year" value={inputs.water_interventions.nrw_target_year} onChange={v => u('water_interventions','nrw_target_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the NRW target is fully achieved; must be after start year" />
        <F label="Current NRW %" value={inputs.water_interventions.nrw_current_pct} onChange={v => u('water_interventions','nrw_current_pct',v)} isPercent unit="%" tip="Non-revenue water as share of total water produced" />
        <F label="Target NRW %" value={inputs.water_interventions.nrw_target_pct} onChange={v => u('water_interventions','nrw_target_pct',v)} isPercent unit="%" min={0.03} max={1.0} tip="Minimum 3% — even best-performing utilities globally cannot eliminate NRW below ~3% due to unavoidable physical losses" />
        {(() => {
          const t = inputs.water_interventions.nrw_target_pct || 0;
          if (t > 0 && t < 0.03) return <div style={{ fontSize: 10, fontWeight: 600, color: '#dc2626', padding: '3px 8px', background: '#fef2f2', borderRadius: 4, marginBottom: 4 }}>Warning: Below 3% is unrealistic — no utility globally achieves NRW below ~3%</div>;
          if (t >= 0.03 && t < 0.07) return <div style={{ fontSize: 10, fontWeight: 600, color: '#92400e', padding: '3px 8px', background: '#fef3c7', borderRadius: 4, marginBottom: 4 }}>Warning: 3–7% is highly ambitious — only top-performing utilities (Singapore, Tokyo) achieve this range</div>;
          return null;
        })()}
        <F label="Commercial losses as % of NRW" value={inputs.water_interventions.nrw_commercial_loss_pct} onChange={v => u('water_interventions','nrw_commercial_loss_pct',v)} isPercent unit="%" tip="Commercial (non-physical) losses as share of total NRW; commercial + physical must sum to 100%" />
        <F label="Physical losses as % of NRW" value={inputs.water_interventions.nrw_physical_loss_pct || 0} onChange={v => u('water_interventions','nrw_physical_loss_pct',v)} isPercent unit="%" tip="Physical losses as share of total NRW; commercial + physical must sum to 100%" />
        <F label="Capex unit cost NRW reduction (USD)" value={inputs.water_interventions.nrw_capex_unit_cost_usd} onChange={v => u('water_interventions','nrw_capex_unit_cost_usd',v)} step={10} unit="USD" min={0} max={10000} tip="Cost to reduce NRW by one unit (USD per m3/day)" />
        <F label="Lag between Capex and improvement" value={inputs.water_interventions.nrw_lag_years} onChange={v => u('water_interventions','nrw_lag_years',v)} unit="yrs" min={0} max={5} tip="Years between NRW investment and realized improvement" />

        <SubHead text="Capital efficiency" />
        <F label="Start year" value={inputs.water_interventions.capeff_start_year} onChange={v => u('water_interventions','capeff_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year capital efficiency gains begin; must be after baseline" />
        <F label="Efficiency gains" value={inputs.water_interventions.capeff_gains_pct} onChange={v => u('water_interventions','capeff_gains_pct',v)} isPercent unit="%" tip="Reduction in unit cost from better procurement/management; typically 10-30%" />

        <SubHead text="Tariff increase" />
        <F label="Start year" value={inputs.water_interventions.tariff_start_year} onChange={v => u('water_interventions','tariff_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the tariff reform begins; must be after baseline" />
        <F label="Target year" value={inputs.water_interventions.tariff_target_year} onChange={v => u('water_interventions','tariff_target_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the tariff target is achieved; must be after start year" />
        <F label="Monthly income bottom 20%" value={inputs.water_interventions.tariff_monthly_income_bottom20} onChange={v => u('water_interventions','tariff_monthly_income_bottom20',v)} step={100} unit={CUR} min={0} max={10000000} tip="Monthly income of bottom 20% of population" />
        <F label="Max % income on water" value={inputs.water_interventions.tariff_max_pct_income_water} onChange={v => u('water_interventions','tariff_max_pct_income_water',v)} isPercent unit="%" tip="Maximum affordable share of household income for water" />
        <F label="Current operating revenue" value={inputs.water_interventions.tariff_op_revenue || 0} onChange={v => u('water_interventions','tariff_op_revenue',v)} step={1000000} unit={CUR} min={0} max={10000000} tip="Annual operating revenue" />
        <F label="Current operating expenditure" value={inputs.water_interventions.tariff_op_expenditure || 0} onChange={v => u('water_interventions','tariff_op_expenditure',v)} step={1000000} unit={CUR} min={0} max={10000000} tip="Annual operating expenditure" />
        <F label="Current O&M recovery ratio (calculated)" value={(inputs.water_interventions.tariff_op_revenue && inputs.water_interventions.tariff_op_expenditure) ? inputs.water_interventions.tariff_op_revenue / inputs.water_interventions.tariff_op_expenditure : 0} onChange={() => {}} fieldType="computed" step={0.01} min={0} max={10} tip="Current ratio of operating revenue to operating expenditure (live calculated: revenue / expenditure)" />
        <F label="O&M cost recovery target" value={inputs.water_interventions.tariff_om_recovery_target} onChange={v => u('water_interventions','tariff_om_recovery_target',v)} step={0.1} min={0} max={10} tip="Target ratio of operating revenue to operating expenditure" />

        <SubHead text="Budget execution improvement" />
        <F label="Start year" value={inputs.water_interventions.budget_exec_start_year || 0} onChange={v => u('water_interventions','budget_exec_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year budget execution improvement begins" />
        <F label="Current execution rate (calculated)" value={inputs.water_interventions.budget_exec_current_rate || 0} onChange={() => {}} fieldType="computed" isPercent unit="%" tip="Current budget execution rate (computed from historical data)" />
        <F label="Target execution rate" value={inputs.water_interventions.budget_exec_target_rate || 0} onChange={v => u('water_interventions','budget_exec_target_rate',v)} isPercent unit="%" tip="Target budget execution rate" />
      </Section>

      {/* ===== SANITATION INTERVENTIONS ===== */}
      <Section title="8. Sanitation Interventions" cols={2} sectionKey="san_interventions" onFocus={onSectionFocus}>
        <SubHead text="Collection efficiency" />
        <F label="Start year" value={inputs.sanitation_interventions.ce_start_year} onChange={v => u('sanitation_interventions','ce_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the intervention begins; must be after baseline" />
        <F label="Target year" value={inputs.sanitation_interventions.ce_target_year} onChange={v => u('sanitation_interventions','ce_target_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the target is fully achieved; must be after start year" />
        <F label="Sewer tariff as % of water tariff" value={inputs.sanitation_interventions.ce_sewer_tariff_pct_water} onChange={v => u('sanitation_interventions','ce_sewer_tariff_pct_water',v)} isPercent unit="%" tip="Sewer tariff as percentage of water tariff" />

        <SubHead text="Capital efficiency" />
        <F label="Start year" value={inputs.sanitation_interventions.capeff_start_year} onChange={v => u('sanitation_interventions','capeff_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year capital efficiency gains begin; must be after baseline" />
        <F label="Efficiency gains" value={inputs.sanitation_interventions.capeff_gains_pct} onChange={v => u('sanitation_interventions','capeff_gains_pct',v)} isPercent unit="%" tip="Reduction in unit cost from better procurement/management; typically 10-30%" />

        <SubHead text="Tariff increase" />
        <F label="Start year" value={inputs.sanitation_interventions.tariff_start_year} onChange={v => u('sanitation_interventions','tariff_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the tariff reform begins; must be after baseline" />
        <F label="Target year" value={inputs.sanitation_interventions.tariff_target_year} onChange={v => u('sanitation_interventions','tariff_target_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year the tariff target is achieved; must be after start year" />
        <F label="Max % income on sanitation" value={inputs.sanitation_interventions.tariff_max_pct_income_san} onChange={v => u('sanitation_interventions','tariff_max_pct_income_san',v)} isPercent unit="%" tip="Maximum affordable share of household income for sanitation" />
        <F label="Tariff real growth rate" value={inputs.sanitation_interventions.san_tariff_growth_rate} onChange={v => u('sanitation_interventions','san_tariff_growth_rate',v)} isPercent unit="%" tip="Annual real growth rate of sanitation tariff" />
        <F label="Current operating revenue" value={inputs.sanitation_interventions.tariff_op_revenue || 0} onChange={v => u('sanitation_interventions','tariff_op_revenue',v)} step={1000000} unit={CUR} min={0} max={10000000} tip="Annual sanitation operating revenue" />
        <F label="Current operating expenditure" value={inputs.sanitation_interventions.tariff_op_expenditure || 0} onChange={v => u('sanitation_interventions','tariff_op_expenditure',v)} step={1000000} unit={CUR} min={0} max={10000000} tip="Annual sanitation operating expenditure" />
        <F label="Current O&M recovery ratio (calculated)" value={(inputs.sanitation_interventions.tariff_op_revenue && inputs.sanitation_interventions.tariff_op_expenditure) ? inputs.sanitation_interventions.tariff_op_revenue / inputs.sanitation_interventions.tariff_op_expenditure : 0} onChange={() => {}} fieldType="computed" step={0.01} min={0} max={10} tip="Current ratio of operating revenue to operating expenditure (live calculated: revenue / expenditure)" />
        <F label="O&M recovery target" value={inputs.sanitation_interventions.tariff_om_recovery_target} onChange={v => u('sanitation_interventions','tariff_om_recovery_target',v)} step={0.1} min={0} max={10} tip="Target ratio of operating revenue to operating expenditure" />

        <SubHead text="Budget execution improvement" />
        <F label="Start year" value={inputs.sanitation_interventions.budget_exec_start_year || 0} onChange={v => u('sanitation_interventions','budget_exec_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year budget execution improvement begins" />
        <F label="Current execution rate (calculated)" value={inputs.sanitation_interventions.budget_exec_current_rate || 0} onChange={() => {}} fieldType="computed" isPercent unit="%" tip="Current budget execution rate (computed from historical data)" />
        <F label="Target execution rate" value={inputs.sanitation_interventions.budget_exec_target_rate || 0} onChange={v => u('sanitation_interventions','budget_exec_target_rate',v)} isPercent unit="%" tip="Target budget execution rate" />

        <SubHead text="Microfinance for on-site sanitation" />
        <F label="Start year" value={inputs.sanitation_interventions.mf_start_year || 0} onChange={v => u('sanitation_interventions','mf_start_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year microfinance program begins" />
        <F label="End year" value={inputs.sanitation_interventions.mf_end_year || 0} onChange={v => u('sanitation_interventions','mf_end_year',v)} min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year microfinance program ends" />
        <F label={`Cost of on-site facility (${CUR})`} value={inputs.sanitation_interventions.mf_onsite_cost || 0} onChange={v => u('sanitation_interventions','mf_onsite_cost',v)} step={1000} unit={CUR} min={0} max={10000000} tip="Capital cost of on-site sanitation facility being financed" />
        <F label="Nominal interest rate" value={inputs.sanitation_interventions.mf_interest_rate || 0} onChange={v => u('sanitation_interventions','mf_interest_rate',v)} isPercent unit="%" tip="Nominal annual interest rate on microfinance loans" />
        <F label="Tenor" value={inputs.sanitation_interventions.mf_tenor || 0} onChange={v => u('sanitation_interventions','mf_tenor',v)} unit="yrs" min={0} max={30} tip="Loan repayment period for microfinance" />
        <F label={`Cost of collection & emptying (${CUR})`} value={inputs.sanitation_interventions.mf_collection_cost || 0} onChange={v => u('sanitation_interventions','mf_collection_cost',v)} step={500} unit={CUR} min={0} max={10000000} tip="Annual cost of fecal sludge collection and emptying per household" />
        <F label="Emptying frequency" value={inputs.sanitation_interventions.mf_emptying_frequency || 0} onChange={v => u('sanitation_interventions','mf_emptying_frequency',v)} unit="yrs" min={0} max={20} tip="Average years between emptying of on-site containment" />
        <F label="Max % household income on sanitation" value={inputs.sanitation_interventions.mf_max_pct_income || 0} onChange={v => u('sanitation_interventions','mf_max_pct_income',v)} isPercent unit="%" tip="Maximum affordable share of household income for sanitation" />
        <F label="Adoption rate" value={inputs.sanitation_interventions.mf_adoption_rate || 0} onChange={v => u('sanitation_interventions','mf_adoption_rate',v)} isPercent unit="%" tip="Share of eligible households that take up microfinance" />
      </Section>

      {/* ===== CUSTOM INTERVENTIONS ===== */}
      <Section title="9. Custom Interventions" cols={2} sectionKey="custom_interventions" onFocus={onSectionFocus}>
        {(inputs.custom_interventions || []).map((ci: any, idx: number) => {
          const updateCI = (field: string, val: any) => {
            const arr = [...inputs.custom_interventions];
            arr[idx] = { ...arr[idx], [field]: val };
            onChange({ ...inputs, custom_interventions: arr });
          };
          return (
            <div key={idx} style={{ border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 10px', marginBottom: 8, background: '#faf5ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6 }}>
                <input type="color" value={ci.color || '#ae4f0e'} onChange={e => updateCI('color', e.target.value)}
                  style={{ width: 24, height: 24, border: 'none', cursor: 'pointer', borderRadius: 3 }} />
                <input type="text" value={ci.name} onChange={e => updateCI('name', e.target.value)}
                  style={{ flex: 1, border: '1px solid #ccc', borderRadius: 3, padding: '3px 6px', fontSize: 12, fontWeight: 600 }} />
                <Toggle label="" checked={ci.enabled} onChange={v => updateCI('enabled', v)} />
                <button onClick={() => {
                  const arr = inputs.custom_interventions.filter((_: any, i: number) => i !== idx);
                  onChange({ ...inputs, custom_interventions: arr });
                }} style={{ border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 3, padding: '2px 6px', cursor: 'pointer', fontSize: 10 }}>✕</button>
              </div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 4 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: '#64748b' }}>Sector</label>
                  <select value={ci.sector} onChange={e => updateCI('sector', e.target.value)}
                    style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, fontSize: 10, background: '#fff', color: '#333', cursor: 'pointer' }}>
                    <option value="water">Water Supply</option>
                    <option value="sanitation">Sanitation</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 10, color: '#64748b' }}>Type</label>
                  <select value={ci.intervention_type} onChange={e => updateCI('intervention_type', e.target.value)}
                    style={{ width: '100%', padding: '4px 6px', border: '1px solid #ccc', borderRadius: 4, fontSize: 10, background: '#fff', color: '#333', cursor: 'pointer' }}>
                    <option value="fixed_annual">Fixed Annual Amount</option>
                    <option value="revenue_stream">Revenue Stream (growing)</option>
                    <option value="per_hh_subsidy">Per-HH Subsidy</option>
                  </select>
                </div>
              </div>
              <F label="Start year" value={ci.start_year} onChange={v => updateCI('start_year', v)}
                min={inputs.period.baseline_year + 1} max={inputs.period.forecast_end_year} tip="Year this intervention begins" />
              <F label="End year" value={ci.end_year} onChange={v => updateCI('end_year', v)}
                min={ci.start_year} max={inputs.period.forecast_end_year} tip="Year this intervention ends" />
              {ci.intervention_type === 'fixed_annual' && (
                <F label={`Annual amount (${CUR} mill)`} value={ci.annual_amount} onChange={v => updateCI('annual_amount', v)}
                  step={100} min={0} max={1000000} tip="Fixed annual cash amount in currency millions" />
              )}
              {ci.intervention_type === 'revenue_stream' && (<>
                <F label={`Starting amount (${CUR} mill)`} value={ci.starting_amount} onChange={v => updateCI('starting_amount', v)}
                  step={100} min={0} max={1000000} tip="Revenue in the first year, in currency millions" />
                <F label="Annual growth rate" value={ci.growth_rate} onChange={v => updateCI('growth_rate', v)}
                  isPercent unit="%" tip="Annual growth rate of the revenue stream" />
              </>)}
              {ci.intervention_type === 'per_hh_subsidy' && (
                <F label={`Subsidy per HH (${CUR})`} value={ci.subsidy_per_hh} onChange={v => updateCI('subsidy_per_hh', v)}
                  step={1000} min={0} max={10000000} tip="Cost subsidy per household connected" />
              )}
            </div>
          );
        })}
        <button onClick={() => {
          const existing = inputs.custom_interventions || [];
          // Kept in sync with InterventionPanel — presets distinct from the built-in bands
          // (chartColors INTV_PALETTE) and clear of the reserved blue/green.
          const colors = ['#9e17bf','#fb46a2','#c11632','#b6157d','#f23dd3'];
          const newCI = {
            name: 'New Intervention', enabled: true, sector: 'water', intervention_type: 'fixed_annual',
            start_year: inputs.period.baseline_year + 3, end_year: inputs.period.baseline_year + 7,
            annual_amount: 1000, starting_amount: 500, growth_rate: 0.05, subsidy_per_hh: 10000,
            color: colors[existing.length % colors.length],
          };
          onChange({ ...inputs, custom_interventions: [...existing, newCI] });
        }} style={{ width: '100%', padding: '6px', border: '1px dashed #9333ea', borderRadius: 4, background: 'none', cursor: 'pointer', fontSize: 11, color: '#9333ea' }}>
          + Add Custom Intervention
        </button>
      </Section>
      </>}
      </div>
    </div>
  );
}
