import bundle from './bundle.json';
import defaults from './defaults.json';
import calculated from './calculate.json';
import projections from './projections.json';
import bases from './revenue-bases.json';
import templates from './cost-mix.json';

// Every preview has its own in-memory session. Never touch the working app's storage.
const values = new Map<string, string>([
  ['wss_working_bundle', JSON.stringify(bundle)],
  ['wss_scope_hint_seen', '1'],
  ['wss_overview_arrow_seen', '1'],
]);
export const localStorage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value); },
  removeItem: (key: string) => { values.delete(key); },
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const path = new URL(url, window.location.href).pathname;
  if (!path.startsWith('/api/')) return nativeFetch(input, init);
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: {'Content-Type': 'application/json'},
  });
  if (path === '/api/development-preview') return json({ revision: 'design-preview', bundle, enabled: false });
  if (path.startsWith('/api/defaults')) return json(defaults);
  if (path === '/api/countries') return json([{ name: 'Democratic Republic of the Congo', code: 'COD' }]);
  if (path === '/api/calculate') return json(calculated);
  if (path === '/api/projections') return json(projections);
  if (path === '/api/revenue-bases') return json(bases);
  if (path === '/api/cost-mix/templates') return json(templates);
  if (path === '/api/profiles' && (!init?.method || init.method === 'GET')) return json([]);
  return json({detail: 'Design preview only. Saving profiles and file exports remain available in the working application.'}, 400);
};
