import { INTV_PALETTE as P } from './chartColors';

export const REVENUE_SOURCES = [
  { key: 'connections', label: 'Revenue from new connections', color: P.connections, fields: ['connection_revenue_cash', 'connection_net_cash', 'connections_cash', 'connection_revenue_delta'] },
  { key: 'nrw', label: 'NRW signed cash', color: P.nrw, fields: ['nrw_net', 'eligible_nrw_link_cash', 'nrw_link_cash'] },
  { key: 'collection', label: 'Collection improvement', color: P.collection, fields: ['collection_cash'] },
  { key: 'tariff', label: 'Tariff reform', color: P.tariff, fields: ['tariff_cash'] },
] as const;

export function reconciliationVersion(result: any, sector: 'water_supply' | 'sanitation') {
  const sec = result?.[sector] ?? result;
  return Number((sec?.scenario_revenue_reconciliation ?? sec?.revenue_reconciliation)?.version) || null;
}
/** Exact final-ledger values, one alias per source. Missing data stays missing, never inferred. */
export function revenueSourceRows(results: any[], sector: 'water_supply' | 'sanitation', prefix = 'scenario_') {
  const years: number[] = results[0]?.years || [];
  return years.map((year, index) => {
    const row: Record<string, number | null> = { year };
    for (const source of REVENUE_SOURCES) {
      const values = results.map(result => {
        const sec = result?.[sector] ?? result;
        const fields = source.key === 'nrw' && sector === 'sanitation'
          ? ['eligible_nrw_link_cash', 'nrw_net', 'nrw_link_cash'] : source.fields;
        const field = fields.find(key => Array.isArray(sec?.[`${prefix}${key}`]));
        const value = field ? sec[`${prefix}${field}`][index] : null;
        return typeof value === 'number' && Number.isFinite(value) ? value : null;
      });
      row[source.key] = values.length && values.every(v => v != null)
        ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
    }
    row.total = REVENUE_SOURCES.every(source => row[source.key] != null)
      ? REVENUE_SOURCES.reduce((sum, source) => sum + row[source.key]!, 0) : null;
    return row;
  });
}
