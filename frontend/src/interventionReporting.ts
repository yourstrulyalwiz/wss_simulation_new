export type InterventionServiceLevel = 'safely_managed' | 'basic' | 'at_least_basic';
export type ScenarioSpendingRow = { year: number; expansion: number; replacement: number; available: number };
export type ScenarioTableRow = {
  year: number; bau: number | null; scenario: number | null; target: number | null;
  expansion: number | null; replacement: number | null; available: number | null; gap: number | null;
};

function seriesValue(sector: any, field: string, index: number): number | null {
  const value = sector?.[field]?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function rungs(level: InterventionServiceLevel): number[] {
  return level === 'at_least_basic' ? [0, 1] : [level === 'basic' ? 1 : 0];
}
function summedCoverage(sector: any, field: string, index: number, level: InterventionServiceLevel): number | null {
  const actual = rungs(level).map(rung => {
    const value = sector?.[field]?.[rung]?.[index];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  });
  return actual.every(value => value !== null) ? actual.reduce((sum, value) => sum + (value as number), 0) : null;
}

/** Scenario spending is reported only from scenario-prefixed engine fields. Missing values are errors, not zero. */
export function scenarioSpendingRows(results: any[], sectorKey: string, baselineYear: number): ScenarioSpendingRow[] {
  if (!results.length) return [];
  const years: number[] = results[0]?.years;
  if (!Array.isArray(years)) throw new Error('Scenario funding is unavailable: engine years are missing.');
  return years.flatMap((year, index) => {
    if (year <= baselineYear) return [];
    const get = (field: string) => {
      const values = results.map(result => seriesValue(result?.[sectorKey], `scenario_${field}`, index));
      if (values.some(value => value === null)) throw new Error(`Scenario funding is unavailable: scenario_${field} has missing values for ${year}.`);
      return values.reduce<number>((sum, value) => sum + (value as number), 0);
    };
    return [{
      year,
      expansion: get('annual_planned_expansion_cost'),
      replacement: get('replacement_capex'),
      available: get('available_total'),
    }];
  });
}

/** Coverage plus annual financing metrics for the selected service objective; missing metrics remain null. */
export function interventionTableRows(result: any, sectorKey: string, baselineYear: number,
  level: InterventionServiceLevel): ScenarioTableRow[] {
  const years: number[] = result?.years;
  if (!Array.isArray(years)) throw new Error('Intervention table is unavailable: engine years are missing.');
  const sector = result?.[sectorKey];
  const coverage = (field: string, index: number) => summedCoverage(sector, field, index, level);
  const annual = (field: string, index: number) => seriesValue(sector, `scenario_${field}`, index);
  return years.flatMap((year, index) => {
    if (year <= baselineYear) return [];
    return [{
      year,
      bau: coverage('bau_hh', index),
      scenario: coverage('scenario_hh', index),
      target: coverage('scenario_target_hh', index),
      expansion: annual('annual_planned_expansion_cost', index),
      replacement: annual('replacement_capex', index),
      available: annual('available_total', index),
      gap: annual('endline_financing_requirement', index),
    }];
  });
}

/** Scenario ledger statistics with pure BAU households retained only as a comparison. */
export function interventionComparisonRows(result: any, sectorKey: string, baselineYear: number,
  level: InterventionServiceLevel): (number | null)[][] {
  if (!Array.isArray(result?.years)) throw new Error('Intervention table is unavailable: engine years are missing.');
  const sector = result?.[sectorKey];
  const accessKey = level === 'at_least_basic' ? 'at_least_basic_access_gap'
    : level === 'basic' ? 'adjusted_basic_only_gap' : 'sm_access_gap';
  return result.years.flatMap((year: number, index: number) => {
    if (year <= baselineYear) return [];
    const total = seriesValue(result, 'total_hh', index);
    const coverage = (field: string) => {
      const value = summedCoverage(sector, field, index, level);
      return total === null || value === null ? null : Math.min(total, value);
    };
    const service = (field: string) => summedCoverage(sector, `scenario_${field}`, index, level);
    const scenario = coverage('scenario_hh');
    const target = coverage('scenario_target_hh');
    // Basic-only is a diagnostic after SM credit, not an independent access minimum.
    const gap = level === 'basic' ? seriesValue(sector, `scenario_${accessKey}`, index)
      : scenario === null || target === null ? null : Math.max(0, target - scenario);
    return [[year, total, coverage('bau_hh'), target, gap,
      service('new_capex_by_service'), service('replacement_by_service'), service('funded_by_service'),
      service('replacement_backlog_closing_by_service'), service('financing_gap_by_service'),
      seriesValue(sector, 'scenario_financing_gap', index), seriesValue(sector, 'scenario_available_total', index),
      scenario]];
  });
}

/** Forecast-end KPI values using engine coverage and household totals; absent data is unavailable. */
export function interventionCoverageKpis(result: any, sectorKey: string, baselineYear: number,
  level: InterventionServiceLevel) {
  const years: number[] = result?.years;
  if (!Array.isArray(years) || !years.length) return { baselineYear, endYear: null, baseline: null, scenario: null, target: null };
  const sector = result?.[sectorKey];
  const share = (field: string, index: number) => {
    const total = seriesValue(result, 'total_hh', index);
    const households = summedCoverage(sector, field, index, level);
    return total !== null && total > 0 && households !== null ? Math.min(total, households) / total * 100 : null;
  };
  const baselineIndex = years.indexOf(baselineYear);
  const endIndex = years.length - 1;
  return {
    baselineYear, endYear: years[endIndex],
    baseline: baselineIndex >= 0 ? share('bau_hh', baselineIndex) : null,
    scenario: share('scenario_hh', endIndex),
    target: share('scenario_target_hh', endIndex),
  };
}
