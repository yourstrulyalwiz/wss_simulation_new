import React from 'react';

export type CurrencyDisplaySettings = {
  mode: 'local' | 'usd';
  sourceCurrency: string;
  localPerUsd: number | null;
  rateReferenceYear: number | null;
  sourceNote?: string;
};

export const defaultCurrencyDisplay = (sourceCurrency = 'LCU'): CurrencyDisplaySettings => ({
  mode: 'local',
  sourceCurrency: sourceCurrency || 'LCU',
  localPerUsd: null,
  rateReferenceYear: null,
  sourceNote: '',
});

export function validRate(settings: CurrencyDisplaySettings, sourceCurrency = settings.sourceCurrency): boolean {
  if (sourceCurrency.toUpperCase() === 'USD') return true;
  return settings.sourceCurrency === sourceCurrency &&
    Number.isFinite(settings.localPerUsd) && (settings.localPerUsd ?? 0) > 0 &&
    Number.isInteger(settings.rateReferenceYear) &&
    (settings.rateReferenceYear ?? 0) >= 1900 &&
    (settings.rateReferenceYear ?? 0) <= new Date().getFullYear();
}

export function displayCurrency(settings: CurrencyDisplaySettings, sourceCurrency = settings.sourceCurrency): string {
  return settings.mode === 'usd' && validRate(settings, sourceCurrency) ? 'USD' : sourceCurrency || 'LCU';
}

export function convertMoney(value: number | null | undefined, settings: CurrencyDisplaySettings,
  sourceCurrency = settings.sourceCurrency): number | null | undefined {
  if (value == null || !Number.isFinite(value)) return value;
  if (settings.mode !== 'usd' || !validRate(settings, sourceCurrency) || sourceCurrency.toUpperCase() === 'USD') return value;
  return value / (settings.localPerUsd as number);
}

export function currencyUnit(settings: CurrencyDisplaySettings, sourceCurrency = settings.sourceCurrency, scale: 'million' | 'billion' | 'per_household' | 'plain' = 'plain') {
  const code = displayCurrency(settings, sourceCurrency);
  if (code === 'USD') return scale === 'per_household' ? 'US$/household' : scale === 'million' ? 'US$ million' : scale === 'billion' ? 'US$ billion' : 'US$';
  return scale === 'per_household' ? `${code}/household` : scale === 'million' ? `${code} million` : scale === 'billion' ? `${code} billion` : code;
}

export function currencyRateNote(settings: CurrencyDisplaySettings, sourceCurrency = settings.sourceCurrency): string {
  if (sourceCurrency.toUpperCase() === 'USD') return 'Model currency is already USD; monetary values are unchanged.';
  if (!validRate(settings, sourceCurrency)) return `Set a valid ${sourceCurrency} per US$1 rate and reference year to enable USD display.`;
  const rate = String(settings.localPerUsd);
  const note = settings.sourceNote?.trim() ? ` · ${settings.sourceNote.trim()}` : '';
  return `US$1 = ${rate} ${sourceCurrency} · ${settings.rateReferenceYear} reference rate${note}`;
}

export function priceBasisNote(settings: CurrencyDisplaySettings, sourceCurrency = settings.sourceCurrency): string {
  if (sourceCurrency.toUpperCase() === 'USD') return 'Model constant-price basis; no annual exchange-rate forecast applied.';
  if (!validRate(settings, sourceCurrency)) return 'Model constant-price basis.';
  return `Constant-price model values translated at ${settings.localPerUsd} ${sourceCurrency} per US$1 (${settings.rateReferenceYear} reference rate). No annual exchange-rate forecast applied.`;
}

export function CurrencyDisplayControl({ settings, sourceCurrency, onModeChange, onEditRate, canUseUsd = true }: {
  settings: CurrencyDisplaySettings;
  sourceCurrency: string;
  onModeChange: (mode: 'local' | 'usd') => void;
  onEditRate: () => void;
  canUseUsd?: boolean;
}) {
  const usd = sourceCurrency.toUpperCase() === 'USD';
  const available = validRate(settings, sourceCurrency) && canUseUsd;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', fontSize: 10.5 }}>
      <span style={{ color: '#475569', fontWeight: 600 }}>Display currency:</span>
      {usd ? <span style={{ fontWeight: 700, color: '#1e3a5f' }}>USD (model currency)</span> : (
        <div role="group" aria-label="Display currency" style={{ display: 'inline-flex', border: '1px solid #cbd5e1', borderRadius: 5, overflow: 'hidden' }}>
          {([['local', sourceCurrency], ['usd', 'USD']] as const).map(([mode, label]) => (
            <button key={mode} type="button" aria-pressed={settings.mode === mode}
              disabled={mode === 'usd' && !available}
              onClick={() => onModeChange(mode)}
              style={{ padding: '4px 8px', border: 0, cursor: mode === 'usd' && !available ? 'not-allowed' : 'pointer',
                background: settings.mode === mode ? '#2563eb' : '#fff',
                color: mode === 'usd' && !available ? '#94a3b8' : settings.mode === mode ? '#fff' : '#475569',
                fontWeight: settings.mode === mode ? 700 : 500 }}>{label}</button>
          ))}
        </div>
      )}
      <span style={{ color: '#64748b' }}>{currencyRateNote(settings, sourceCurrency)}</span>
      {!usd && <button type="button" onClick={onEditRate}
        style={{ border: 0, background: 'transparent', color: '#2563eb', padding: '2px 0', cursor: 'pointer', textDecoration: 'underline' }}>
        {available ? 'Edit rate' : 'Set exchange rate'}
      </button>}
    </div>
  );
}