import React, { useEffect, useState } from 'react';
import { projectRequest, type CountryMetadata } from '../projectApi';
import { useProjectScope } from '../projectScope';

export function findProfile(countries: CountryMetadata['countries'], code?: string, name?: string) {
  const normalized = (value: string) => value.trim().toLowerCase();
  const aliases: Record<string, string> = {
    drc: 'COD', 'democratic republic of the congo': 'COD',
    'congo, dem. rep.': 'COD', nepal: 'NPL',
  };
  const key = aliases[normalized(code || '')] || code?.toUpperCase() || aliases[normalized(name || '')];
  return countries.find(country => country.id === key || country.iso2Code === key)
    || (!key ? countries.find(country => normalized(country.name) === normalized(name || '')) : undefined);
}

export default function CountryProfileFields({ countryName }: { countryName: string }) {
  const { countryCode, countryMetadata } = useProjectScope();
  const [catalog, setCatalog] = useState<CountryMetadata | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    projectRequest<CountryMetadata>('/country-metadata')
      .then(value => { if (live) setCatalog(value); })
      .catch(err => { if (live) setError(err.message || 'Country metadata could not be loaded.'); });
    return () => { live = false; };
  }, []);
  const current = findProfile(catalog?.countries || [], countryCode, countryName);
  const saved = findProfile(countryMetadata?.id ? [countryMetadata] : [], countryCode, countryName);
  const profile = current || saved;
  const unavailable = catalog || error ? 'Unavailable' : 'Loading…';
  return <>
    {[
      ['ISO country code (alpha-3)', profile?.id || countryCode || unavailable],
      ['Income group', profile?.incomeLevel?.value || unavailable],
      ['Region', profile?.region?.value || unavailable],
    ].map(([label, value]) => <div key={label} style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#3A4452', marginBottom: 5 }}>{label}</div>
      <output aria-label={label} style={{ display: 'block', padding: '8px 10px', borderRadius: 4, background: '#f1f5f9', color: '#334155' }}>{value}</output>
    </div>)}
    <div style={{ gridColumn: '1 / -1', fontSize: 11, color: '#64748b' }}>
      {error || catalog?.error || (!current && catalog ? 'No current World Bank country metadata match is available.' : 'Country classifications use the World Bank country catalogue.')}
      {catalog?.retrieved_at && ` Retrieved ${new Date(catalog.retrieved_at).toLocaleDateString()}.`}
      {!current && saved && ' Showing saved country metadata.'}
      {' These descriptive fields do not change saved simulation inputs or results.'}
    </div>
  </>;
}
