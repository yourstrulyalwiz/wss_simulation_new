import { CONTRIBUTION_CATEGORIES } from './contributionView';

export type LedgerService = 'sm' | 'basic' | 'total';
export type LedgerMetric = 'coverage' | 'funding' | 'requirements' | 'gap';
export type LedgerBasis = 'annual' | 'closing';
export type LedgerMeasure = 'coverage' | 'target' | 'accessGap' | 'funding' | 'fundingApplied' |
  'fundingShared' | 'fundingOperating' | 'fundingRestricted' | 'fundingExternal' |
  'requirementsAnnual' | 'requirementsCatchUp' | 'requirementsResidual' | 'gapAnnual' |
  'gapClosing' | 'plannedExpansion' | 'replacement' | 'replacementCredit' | 'cashDeficit' |
  'outstanding' | 'accumulatedShortfalls' | 'repayments' | 'replacementPaid' | 'expansionPaid';
export type LedgerVector = [number | null, number | null, number | null]; // SM, Basic, Sector total
export type LedgerSnapshot = { year: number; population: number; values: Record<LedgerMeasure, LedgerVector> };
export type LedgerContribution = {
  key: string; label: string; category: string; order?: number; before: LedgerSnapshot[]; after: LedgerSnapshot[];
};
export type LedgerData = {
  years: number[]; baselineYear: number; base: LedgerSnapshot[]; scenario: LedgerSnapshot[];
  contributions: LedgerContribution[]; attributionComplete: boolean; includesDebt: boolean;
  areas?: { key: 'urban' | 'rural'; label: string; scenario: LedgerSnapshot[] }[];
};
export type LedgerRow = {
  key: string; label: string; kind: 'baseline' | 'category' | 'intervention' | 'scenario' | 'detail' | 'target' | 'section' | 'summary';
  values: (number | null)[]; unit: string; children?: LedgerRow[]; signedGap?: boolean; depth?: number;
};
const measures: LedgerMeasure[] = ['coverage', 'target', 'accessGap', 'funding', 'fundingApplied',
  'fundingShared', 'fundingOperating', 'fundingRestricted', 'fundingExternal', 'requirementsAnnual',
  'requirementsCatchUp', 'requirementsResidual', 'gapAnnual', 'gapClosing', 'plannedExpansion',
  'replacement', 'replacementCredit', 'cashDeficit', 'outstanding', 'accumulatedShortfalls', 'repayments',
  'replacementPaid', 'expansionPaid'];
export function ledgerCategory(key: string, custom = false): string {
  if (custom) return 'custom';
  return CONTRIBUTION_CATEGORIES.find(c => (c.keys as readonly string[]).includes(key))?.id ?? 'other';
}
function at(sec: any, key: string, index: number): number {
  const value = sec[key]?.[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing ledger measure: ${key}`);
  return value;
}
function pair(sec: any, key: string, index: number): [number, number] {
  const value = sec[key];
  if (!Array.isArray(value) || !value.every((row: any) => Number.isFinite(row?.[index])))
    throw new Error(`Missing service ledger measure: ${key}`);
  return [value[0][index], value[1][index]];
}
const vector = (p: [number, number]): LedgerVector => [p[0], p[1], p[0] + p[1]];
const add = (...pairs: [number, number][]): [number, number] =>
  pairs.reduce<[number, number]>((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]);

/** Reporting only: consume actual engine allocations, never invent service shares. */
export function ledgerSnapshots(results: any[], sector: 'water_supply' | 'sanitation',
  baselineYear: number, scenario = true): LedgerSnapshot[] {
  const prefix = scenario ? 'scenario_' : '';
  return results[0].years.map((year: number, index: number) => {
    const values = Object.fromEntries(measures.map(key => [key, [0, 0, 0]])) as Record<LedgerMeasure, LedgerVector>;
    const population = results.reduce((sum, r) => sum + r.total_hh[index], 0);
    for (const result of results) {
      const sec = result[sector];
      const p = (key: string) => pair(sec, prefix + key, index);
      const n = (key: string) => at(sec, prefix + key, index);
      const coverage = pair(sec, scenario ? 'scenario_hh' : 'bau_hh', index);
      const target = pair(sec, 'target_hh', index);
      const local: Partial<Record<LedgerMeasure, LedgerVector>> = {
        coverage: vector(coverage), target: vector(target),
        // Gaps are assessed locally BEFORE aggregation. Basic costing is at-least-basic entry.
        accessGap: [n('sm_access_gap'), n('at_least_basic_access_gap'), n('at_least_basic_access_gap')],
      };
      if (year > baselineYear) {
        const replacement = p('replacement_by_service');
        const planned = p('annual_planned_expansion_cost_by_service');
        const catchUp = p('prefunding_expansion_cost_by_service');
        const residual = p('new_capex_by_service');
        const deficit = p('cash_deficit_by_service');
        const external = p('externally_funded_expansion_by_service');
        const applied = add(p('replacement_funding_applied_by_service'), p('sector_funded_expansion_by_service'), external);
        const operating = n('available_total') - (scenario ? n('utility_debt_service') : 0);
        const restricted = scenario ? n('utility_debt_cash_available') : 0;
        const available = Math.max(operating, 0) + restricted + external[0] + external[1];
        Object.assign(local, {
          funding: [null, null, available],
          fundingApplied: vector(applied),
          fundingShared: [null, null, available - applied[0] - applied[1]],
          fundingOperating: [null, null, operating],
          fundingRestricted: [null, null, restricted],
          fundingExternal: vector(external),
          replacementPaid: vector(p('replacement_funding_applied_by_service')),
          expansionPaid: vector(add(p('sector_funded_expansion_by_service'), external)),
          requirementsAnnual: vector(add(planned, replacement, deficit)),
          requirementsCatchUp: vector(add(catchUp, replacement, deficit)),
          requirementsResidual: vector(add(residual, replacement, deficit)),
          gapAnnual: vector(p('financing_gap_by_service')),
          gapClosing: vector(p('endline_financing_requirement_by_service')),
          plannedExpansion: vector(planned), replacement: vector(replacement),
          replacementCredit: vector(p('funded_by_service')), cashDeficit: vector(deficit),
          outstanding: vector(p('closing_outstanding_expansion_by_service')),
          accumulatedShortfalls: vector(p('accumulated_shortfalls_by_service')),
          repayments: [null, null, scenario ? n('utility_debt_service') : 0],
        });
      }
      for (const key of measures) {
        const incoming = local[key];
        for (let j = 0; j < 3; j++) {
          if (!incoming || incoming[j] == null) values[key][j] = null;
          else if (values[key][j] != null) values[key][j]! += incoming[j]!;
        }
      }
    }
    return { year, population, values };
  });
}

export function ledgerMeasure(metric: LedgerMetric, service: LedgerService, basis: LedgerBasis): LedgerMeasure {
  if (metric === 'coverage') return 'coverage';
  if (metric === 'funding') return service === 'total' ? 'funding' : 'fundingApplied';
  if (metric === 'requirements') return basis === 'closing' ? 'requirementsCatchUp' : 'requirementsAnnual';
  return basis === 'closing' ? 'gapClosing' : 'gapAnnual';
}

/** Unrounded values are shared by the table and its exports. */
export function ledgerRows(data: LedgerData, options: {
  metric: LedgerMetric; service: LedgerService; basis: LedgerBasis; years: number[];
  isShare: boolean; moneyFactor: number; currency: string;
}): LedgerRow[] {
  const { metric, service, basis, years, isShare, moneyFactor, currency } = options;
  const rung = service === 'sm' ? 0 : service === 'basic' ? 1 : 2;
  const measure = ledgerMeasure(metric, service, basis);
  const isCoverage = metric === 'coverage';
  const unit = isCoverage ? isShare ? '%' : 'M households' : `B ${currency}`;
  function series(snapshots: LedgerSnapshot[], key: LedgerMeasure = measure, denominators = snapshots, component = rung) {
    const byYear = new Map(snapshots.map(s => [s.year, s]));
    const populationByYear = new Map(denominators.map(s => [s.year, s.population]));
    return years.map(year => {
      const snap = byYear.get(year);
      const value = snap?.values[key][component];
      if (value == null || !snap) return null;
      const population = populationByYear.get(year) ?? 0;
      return isCoverage ? isShare ? (population > 0 ? value / population * 100 : 0) : value
        : value * moneyFactor / 1000;
    });
  }
  const difference = (after: (number | null)[], before: (number | null)[]) =>
    after.map((value, i) => value == null || before[i] == null ? null : value - before[i]!);
  const rows: LedgerRow[] = [{ key: 'bau', label: 'BAU', kind: 'baseline', unit, values: series(data.base) }];
  if (data.attributionComplete) {
    const children = data.contributions.map(contribution => ({
      key: contribution.key, label: `${contribution.order ? `[Step ${contribution.order}] ` : ''}${contribution.label}`, kind: 'intervention' as const,
      unit: isCoverage && isShare ? 'pp' : unit,
      values: difference(series(contribution.after), series(contribution.before)),
      category: contribution.category,
    }));
    const categories = [...CONTRIBUTION_CATEGORIES.map(c => ({ id: c.id as string, label: c.label })),
      { id: 'custom', label: 'Custom interventions' }, { id: 'other', label: 'Other / cross-sector interventions' }];
    for (const category of categories) {
      const members = children.filter(c => c.category === category.id);
      if (!members.length) continue;
      rows.push({ key: category.id, label: category.label, kind: 'category',
        unit: isCoverage && isShare ? 'pp' : unit, children: members,
        values: years.map((_, i) => members.some(c => c.values[i] == null) ? null :
          members.reduce((sum, c) => sum + c.values[i]!, 0)) });
    }
  }
  rows.push({ key: 'scenario', label: 'Combined scenario', kind: 'scenario', unit, values: series(data.scenario) });
  const detail = (key: LedgerMeasure, label: string) => rows.push({
    key, label, kind: 'detail', unit, values: series(data.scenario, key),
  });
  if (isCoverage) {
    rows.push({ key: 'target', label: 'Original target', kind: 'target', unit, values: series(data.scenario, 'target') });
    const gapValues = (snapshots: LedgerSnapshot[], component: number) =>
      difference(series(snapshots, 'coverage', data.scenario, component),
        series(snapshots, 'target', data.scenario, component))
        .map(value => value != null && Math.abs(value) < 1e-12 ? 0 : value);
    const serviceGap = (component: number, key: string, label: string, depth = 0) => {
      // Subtract the very same series displayed above, after scope aggregation.
      // This reporting difference must not replace local deficits used by the model.
      rows.push({
        key, label: `${label} (scenario − target)`, kind: 'detail',
        unit: isShare ? 'pp' : unit, signedGap: true, depth,
        values: gapValues(data.scenario, component),
      });
      for (const area of data.areas ?? []) {
        // Use the selected scope denominator so National area contributions add
        // to the National pp gap; single-area views use that area's denominator.
        rows.push({
          key: `${key}-${area.key}`,
          label: `${area.label} ${component === 0 ? 'SM' : 'Basic-only'} gap (scenario − target)`,
          kind: 'detail', unit: isShare ? 'pp' : unit, signedGap: true, depth: depth + 1,
          values: gapValues(area.scenario, component),
        });
      }
    };
    if (service === 'total') {
      rows.push({
        key: 'atLeastBasicNetGap', label: 'At least basic net gap (scenario − target)',
        kind: 'detail', unit: isShare ? 'pp' : unit, signedGap: true,
        values: gapValues(data.scenario, 2),
      });
      serviceGap(0, 'smNetGap', 'SM net gap', 1);
      serviceGap(1, 'basicNetGap', 'Basic-only gap', 1);
    } else if (service === 'sm') {
      serviceGap(0, 'smNetGap', 'SM net gap');
    } else {
      serviceGap(1, 'basicNetGap', 'Basic-only gap');
    }
  } else if (metric === 'funding') {
    if (service === 'total') {
      detail('fundingApplied', 'Scenario — funds applied to SM + Basic');
      detail('fundingShared', 'Scenario — available but not applied / restricted');
    }
    detail('fundingExternal', 'Scenario — external household finance applied');
    if (service === 'total') {
      if (data.includesDebt) {
        rows.push({ key: 'debtFundingSection', label: 'With debt servicing', kind: 'section',
          unit: '', values: years.map(() => null) });
        detail('fundingRestricted', 'Scenario — restricted loan cash available, including carry');
        detail('repayments', 'Scenario — debt service paid');
      }
      rows.push({ key: 'fundingOperating',
        label: data.includesDebt ? 'Ordinary net cash after debt service (signed)' : 'Ordinary net cash (signed)',
        kind: data.includesDebt ? 'summary' : 'detail', unit, values: series(data.scenario, 'fundingOperating') });
    }
  } else if (metric === 'requirements') {
    detail('plannedExpansion', 'Newly planned expansion — annual flow');
    detail('replacement', 'Replacement obligation — annual flow');
    detail('cashDeficit', 'Cash deficit — annual flow');
    detail('requirementsCatchUp', 'Pre-funding catch-up need incl. replacement and deficit');
    detail('replacementPaid', 'Replacement paid — current year');
    detail('expansionPaid', 'Expansion paid — current year');
    detail('outstanding', 'Outstanding expansion — year-end balance');
    detail('accumulatedShortfalls', 'Accumulated unpaid replacement and cash deficits');
  } else {
    detail('outstanding', 'Outstanding expansion — year-end balance');
    detail('replacement', 'Replacement obligation — annual flow');
    detail('replacementCredit', 'Capped replacement credit — annual flow');
    detail('cashDeficit', 'Cash deficit — annual flow');
    detail('accumulatedShortfalls', 'Accumulated unpaid replacement and cash deficits');
  }
  return rows;
}
