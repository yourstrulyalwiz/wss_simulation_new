/** Sum already-assessed local diagnostics; never net one area's surplus against another. */
export const ACCESS_COLUMNS = [
  ['Original SM target', 'target_hh', 0],
  ['Original basic-only target', 'target_hh', 1],
  ['SM coverage', 'bau_hh', 0],
  ['Basic-only coverage', 'bau_hh', 1],
  ['SM overachievement', 'sm_overachievement'],
  ['Effective basic-only target after SM credit', 'effective_basic_only_target'],
  ['Basic-only target shortfall after SM credit (diagnostic)', 'adjusted_basic_only_gap'],
  ['SM access gap', 'sm_access_gap'],
  ['At-least-basic coverage', 'at_least_basic_coverage'],
  ['At-least-basic target', 'at_least_basic_target'],
  ['At-least-basic access gap (basic-entry costing)', 'at_least_basic_access_gap'],
  ['Outstanding SM upgrades', 'closing_outstanding_hh', 0],
  ['Outstanding lower-to-basic entries', 'closing_outstanding_hh', 1],
] as const;

export type AccessRow = { year: number; pass: string; values: number[] };

export function serviceAccessRows(results: any[], sector: 'water_supply' | 'sanitation', baseline: number,
  passes: ('BAU' | 'Scenario')[] = ['BAU', 'Scenario']): AccessRow[] {
  return results[0].years.flatMap((year: number, i: number) => year <= baseline ? [] :
    passes.map(pass => ({
      year, pass,
      values: ACCESS_COLUMNS.map(column => results.reduce((sum, result) => {
        const [, key] = column;
        const rung = column.length === 3 ? column[2] : undefined;
        const name = pass === 'BAU' ? key : key === 'bau_hh' ? 'scenario_hh' : 'scenario_' + key;
        const series = result[sector][name];
        return sum + (rung === undefined ? series[i] : series[rung][i]);
      }, 0)),
    })));
}
