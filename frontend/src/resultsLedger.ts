import { CONTRIBUTION_CATEGORIES } from './contributionView';
import { sourceDefinition } from './sourceAttribution';
import type { CoverageAttribution, SourceFunding } from './sourceAttribution';
import type { ViewBand } from './contributionView';

export type LedgerService = 'sm' | 'basic' | 'total';
export type LedgerMetric = 'coverage' | 'funding' | 'requirements' | 'gap';
export type LedgerBasis = 'annual' | 'closing';
export type LedgerView = 'source' | 'effects';
export type LedgerMeasure =
  | 'coverage' | 'target' | 'accessGap' | 'funding' | 'fundingApplied' | 'fundingShared'
  | 'fundingBeforeDebt'
  | 'fundingOperating' | 'fundingRestricted' | 'fundingExternal' | 'requirementsAnnual'
  | 'requirementsCatchUp' | 'requirementsResidual' | 'gapAnnual' | 'gapClosing'
  | 'plannedExpansion' | 'replacement' | 'replacementCredit' | 'cashDeficit'
  | 'outstanding' | 'accumulatedShortfalls' | 'repayments' | 'repaymentsPaid' | 'repaymentsUnfunded' | 'replacementPaid' | 'expansionPaid'
  | 'scheduledExpansion' | 'prefundingHousehold' | 'closingHousehold' | 'prefundingAncillary'
  | 'closingAncillary' | 'currentUnpaidReplacement' | 'priorReplacementShortfall'
  | 'accumulatedReplacementShortfall' | 'currentCashShortfall' | 'priorCashShortfall'
  | 'accumulatedCashShortfall' | 'householdExpansionPaid' | 'noncashDeliveryHH'
  | 'noncashDeliveryCredit' | 'cancelledExpansionCost' | 'outstandingRepricing' | 'ancillaryPaid'
  | 'sectorExpansionPaid' | 'externalExpansionPaid' | 'openingExpansionCost'
  | 'advanceDeliveryCredit' | 'newAncillaryCommitment' | 'sectorHouseholdPaid'
  | 'loanInjection' | 'loanOpeningUnspent' | 'loanInvestment' | 'loanClosingUnspent' | 'ordinaryInjection'
  | 'nrwNetCash' | 'eligibleNrwLinkCash' | 'connectionNetCash' | 'collectionCash' | 'tariffCash' | 'additionalNetCash';
export type LedgerVector = [number | null, number | null, number | null];
export type LedgerSnapshot = { year: number; population: number; values: Record<LedgerMeasure, LedgerVector> };
export type LedgerContribution = {
  key: string; label: string; category: string; order?: number; before: LedgerSnapshot[]; after: LedgerSnapshot[];
};
export type LedgerArea = {
  key: 'urban' | 'rural'; label: string; base?: LedgerSnapshot[]; scenario: LedgerSnapshot[];
};
export type LedgerData = {
  sector?: 'water' | 'sanitation';
  years: number[]; baselineYear: number; base: LedgerSnapshot[]; scenario: LedgerSnapshot[];
  contributions: LedgerContribution[]; attributionComplete: boolean; includesDebt: boolean;
  areas?: LedgerArea[];
  coverageAttribution?: CoverageAttribution; sourceFunding?: SourceFunding; sourceBands?: ViewBand[];
  selectedSourceKeys?: string[];
};
export type LedgerRow = {
  key: string; label: string; kind: 'baseline' | 'category' | 'intervention' | 'scenario' | 'detail' | 'target' | 'section' | 'summary' | 'area' | 'service' | 'component';
  values: (number | null)[]; unit: string; children?: LedgerRow[]; signedGap?: boolean; depth?: number;
  timing?: string; component?: string; geography?: string; service?: string; status?: string;
};

const measures: LedgerMeasure[] = [
  'coverage','target','accessGap','funding','fundingApplied','fundingShared','fundingBeforeDebt','fundingOperating','fundingRestricted',
  'fundingExternal','requirementsAnnual','requirementsCatchUp','requirementsResidual','gapAnnual','gapClosing',
  'plannedExpansion','replacement','replacementCredit','cashDeficit','outstanding','accumulatedShortfalls','repayments','repaymentsPaid','repaymentsUnfunded',
  'replacementPaid','expansionPaid','scheduledExpansion','prefundingHousehold','closingHousehold','prefundingAncillary',
  'closingAncillary','currentUnpaidReplacement','priorReplacementShortfall','accumulatedReplacementShortfall',
  'currentCashShortfall','priorCashShortfall','accumulatedCashShortfall','householdExpansionPaid','noncashDeliveryHH',
  'noncashDeliveryCredit','cancelledExpansionCost','outstandingRepricing','ancillaryPaid','sectorExpansionPaid','externalExpansionPaid',
  'openingExpansionCost','advanceDeliveryCredit','newAncillaryCommitment','sectorHouseholdPaid',
  'loanInjection','loanOpeningUnspent','loanInvestment','loanClosingUnspent','ordinaryInjection',
  'nrwNetCash','eligibleNrwLinkCash','connectionNetCash','collectionCash','tariffCash','additionalNetCash',
];
const sourceFields: Partial<Record<LedgerMeasure, string>> = {
  scheduledExpansion: 'scheduled_household_expansion_by_service',
  prefundingHousehold: 'prefunding_household_expansion_by_service',
  closingHousehold: 'closing_household_expansion_by_service',
  prefundingAncillary: 'prefunding_ancillary_by_service',
  closingAncillary: 'closing_ancillary_by_service',
  currentUnpaidReplacement: 'current_unpaid_replacement_by_service',
  priorReplacementShortfall: 'prior_replacement_shortfall_by_service',
  accumulatedReplacementShortfall: 'accumulated_replacement_shortfall_by_service',
  currentCashShortfall: 'current_cash_shortfall_by_service',
  priorCashShortfall: 'prior_cash_shortfall_by_service',
  accumulatedCashShortfall: 'accumulated_cash_shortfall_by_service',
  householdExpansionPaid: 'household_expansion_paid_by_service',
  sectorHouseholdPaid: 'sector_household_expansion_paid_by_service',
  noncashDeliveryHH: 'noncash_delivery_hh_by_service',
  noncashDeliveryCredit: 'noncash_delivery_credit_by_service',
  cancelledExpansionCost: 'cancelled_household_expansion_cost_by_service',
  outstandingRepricing: 'outstanding_repricing_by_service',
  openingExpansionCost: 'opening_household_expansion_cost_by_service',
  advanceDeliveryCredit: 'advance_delivery_credit_by_service',
  newAncillaryCommitment: 'new_ancillary_commitment_by_service',
  ancillaryPaid: 'ancillary_paid_by_service',
  replacement: 'replacement_by_service',
  replacementPaid: 'replacement_funding_applied_by_service',
  sectorExpansionPaid: 'sector_funded_expansion_by_service',
  externalExpansionPaid: 'externally_funded_expansion_by_service',
};
export function ledgerCategory(key: string, custom = false): string {
  if (custom) return 'custom';
  return CONTRIBUTION_CATEGORIES.find(c => (c.keys as readonly string[]).includes(key))?.id ?? 'other';
}
function at(sec: any, key: string, index: number): number {
  const value = sec?.[key]?.[index];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Missing ledger measure: ${key}`);
  return value;
}
function optionalAt(sec: any, key: string, index: number): number | null {
  const value = sec?.[key]?.[index];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function pair(sec: any, key: string, index: number): [number, number] {
  const value = sec?.[key];
  if (!Array.isArray(value) || value.length < 2 ||
      !Number.isFinite(value[0]?.[index]) || !Number.isFinite(value[1]?.[index]))
    throw new Error(`Missing service ledger measure: ${key}`);
  return [value[0][index], value[1][index]];
}
function optionalPair(sec: any, key: string, index: number): [number | null, number | null] {
  const value = sec?.[key];
  if (!Array.isArray(value) || value.length < 2) return [null, null];
  return [0, 1].map(i => Number.isFinite(value[i]?.[index]) ? value[i][index] : null) as [number | null, number | null];
}
const vector = (p: [number | null, number | null]): LedgerVector =>
  [p[0], p[1], p[0] == null || p[1] == null ? null : p[0] + p[1]];
const addKnown = (...values: (number | null)[]): number | null =>
  values.some(v => v == null) ? null : values.reduce<number>((sum, v) => sum + (v as number), 0);

/** Reporting only: consume actual engine allocations, never invent service shares. */
export function ledgerSnapshots(results: any[], sector: 'water_supply' | 'sanitation',
  baselineYear: number, scenario = true): LedgerSnapshot[] {
  if (!results.length) return [];
  const prefix = scenario ? 'scenario_' : '';
  return results[0].years.map((year: number, index: number) => {
    const values = Object.fromEntries(measures.map(key => [key, [null, null, null]])) as Record<LedgerMeasure, LedgerVector>;
    const initialized = new Set<string>();
    const population = results.reduce((sum, r) => sum + (Number(r.total_hh?.[index]) || 0), 0);
    for (const result of results) {
      const sec = result[sector];
      const p = (key: string) => pair(sec, prefix + key, index);
      const n = (key: string) => at(sec, prefix + key, index);
      const coverage = pair(sec, scenario ? 'scenario_hh' : 'bau_hh', index);
      const target = pair(sec, 'target_hh', index);
      const local: Partial<Record<LedgerMeasure, LedgerVector>> = {
        coverage: vector(coverage), target: vector(target),
        accessGap: [n('sm_access_gap'), n('at_least_basic_access_gap'), n('at_least_basic_access_gap')],
      };
      if (year > baselineYear) {
        const source = (measure: LedgerMeasure) => optionalPair(sec, prefix + (sourceFields[measure] || ''), index);
        const putSource = (measure: LedgerMeasure) => { local[measure] = vector(source(measure)); };
        for (const measure of Object.keys(sourceFields) as LedgerMeasure[]) putSource(measure);
        const planned = optionalPair(sec, prefix + 'annual_planned_expansion_cost_by_service', index);
        const catchUp = optionalPair(sec, prefix + 'prefunding_expansion_cost_by_service', index);
        const residual = optionalPair(sec, prefix + 'new_capex_by_service', index);
        const deficit = optionalPair(sec, prefix + 'cash_deficit_by_service', index);
        const external = optionalPair(sec, prefix + 'externally_funded_expansion_by_service', index);
        const sectorPaid = optionalPair(sec, prefix + 'sector_funded_expansion_by_service', index);
        const replacementPaid = optionalPair(sec, prefix + 'replacement_funding_applied_by_service', index);
        const replacement = source('replacement');
        const applied = [0, 1].map(i => addKnown(replacementPaid[i], sectorPaid[i], external[i])) as [number | null, number | null];
          const operatingCash = optionalAt(sec, prefix + 'available_total', index);
        const debtService = scenario ? optionalAt(sec, prefix + 'utility_debt_service', index) : 0;
        const debtPaid = scenario ? optionalAt(sec, prefix + 'debt_service_paid', index) : 0;
        const debtUnfunded = scenario ? optionalAt(sec, prefix + 'debt_service_unfunded', index) : 0;
        const reportedAfterService = scenario ? optionalAt(sec, prefix + 'available_after_debt_service', index) : null;
        // Prefer the explicit net alias from current results. Older engines only report pre-service cash;
        // derive the net once in that case, never subtract again from the alias.
        const operating = reportedAfterService != null
          ? reportedAfterService
          : operatingCash == null || debtPaid == null ? null : operatingCash - debtPaid;
        const restricted = scenario ? optionalAt(sec, prefix + 'utility_debt_cash_available', index) : 0;
        const injectionRow = scenario
          ? (sec?.scenario_utility_debt?.annual_injection || sec?.utility_debt?.annual_injection || [])
            .find((row: any) => Number(row.year) === Number(year))
          : null;
        const injectionValue = (key: string): number | null => {
          const value = injectionRow?.[key];
          return typeof value === 'number' && Number.isFinite(value) ? value : null;
        };
        const available = addKnown(operating == null ? null : Math.max(operating, 0), restricted, external[0], external[1]);
        const unapplied = available == null || applied[0] == null || applied[1] == null
          ? null : available - applied[0] - applied[1];
        Object.assign(local, {
          funding: [null, null, available], fundingApplied: vector(applied),
          fundingShared: [null, null, unapplied],
          fundingBeforeDebt: [null, null, operatingCash], fundingOperating: [null, null, operating], fundingRestricted: [null, null, restricted],
          fundingExternal: vector(external), replacementPaid: vector(replacementPaid),
          expansionPaid: vector([addKnown(sectorPaid[0], external[0]), addKnown(sectorPaid[1], external[1])]),
          requirementsAnnual: vector([0, 1].map(i => addKnown(planned[i], replacement[i], deficit[i])) as [number | null, number | null]),
          requirementsCatchUp: vector([0, 1].map(i => addKnown(catchUp[i], replacement[i], deficit[i])) as [number | null, number | null]),
          requirementsResidual: vector([0, 1].map(i => addKnown(residual[i], replacement[i], deficit[i])) as [number | null, number | null]),
          gapAnnual: vector(optionalPair(sec, prefix + 'financing_gap_by_service', index)),
          gapClosing: vector(optionalPair(sec, prefix + 'endline_financing_requirement_by_service', index)),
          plannedExpansion: vector(planned), replacement: vector(replacement),
          replacementCredit: vector(optionalPair(sec, prefix + 'funded_by_service', index)),
          cashDeficit: vector(deficit),
          outstanding: vector(optionalPair(sec, prefix + 'closing_outstanding_expansion_by_service', index)),
          accumulatedShortfalls: vector(optionalPair(sec, prefix + 'accumulated_shortfalls_by_service', index)),
          repayments: [null, null, scenario ? debtService : 0],
          repaymentsPaid: [null, null, debtPaid], repaymentsUnfunded: [null, null, debtUnfunded],
          loanInjection: [null, null, scenario ? injectionValue('disbursement') : 0],
          loanOpeningUnspent: [null, null, scenario ? injectionValue('opening_unspent_proceeds') : 0],
          loanInvestment: [null, null, scenario ? injectionValue('investment_from_loan_proceeds') : 0],
          loanClosingUnspent: [null, null, scenario ? injectionValue('closing_unspent_proceeds') : 0],
          ordinaryInjection: [null, null, scenario ? optionalAt(sec, prefix + 'exogenous_injection_cash', index) : 0],
        });
      }
      for (const key of measures) {
        const incoming = local[key];
        if (!incoming) continue;
        for (let j = 0; j < 3; j++) {
          const marker = `${key}:${j}`;
          const current = values[key][j];
          if (!initialized.has(marker)) {
            values[key][j] = incoming[j];
            initialized.add(marker);
          } else {
            values[key][j] = current == null || incoming[j] == null ? null : current + incoming[j]!;
          }
        }
      }
    }
    const revenueCashSources: [LedgerMeasure, string][] = [
      ['nrwNetCash', 'nrw_net'],
      ['eligibleNrwLinkCash', 'eligible_nrw_link_cash'],
      ['connectionNetCash', 'connection_net_cash'],
      ['collectionCash', 'collection_cash'],
      ['tariffCash', 'tariff_cash'],
      ['additionalNetCash', 'additional_net_cash'],
    ];
    for (const [measure, field] of revenueCashSources) {
      const amounts = results.map(result => optionalAt(result?.[sector], `${prefix}${field}`, index));
      const total = amounts.length && amounts.every(value => value != null)
        ? amounts.reduce<number>((sum, value) => sum + (value as number), 0) : null;
      values[measure] = [null, null, total];
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

/** Canonical source hierarchy used by both the year-column ledger and its exports. */
function sourceRows(data: LedgerData, options: {
  metric: LedgerMetric; service: LedgerService; basis: LedgerBasis; years: number[];
  isShare: boolean; moneyFactor: number; currency: string; sourceKind?: 'scenario' | 'bau';
}): LedgerRow[] {
  const { metric, service, basis, years, isShare, moneyFactor, currency } = options;
  const selected = options.sourceKind === 'bau' ? data.base : data.scenario;
  const unit = `B ${currency}`;
  const serviceIndex = service === 'sm' ? 0 : service === 'basic' ? 1 : 2;
  const snapshotsFor = (area?: LedgerArea) => options.sourceKind === 'bau' ? area?.base ?? [] : area?.scenario ?? [];
  const sourceBalance = (snap: LedgerSnapshot | undefined, rung: number): number | null => {
    if (!snap) return null;
    const v = snap.values;
    const keys: LedgerMeasure[] = metric === 'requirements'
        ? ['prefundingHousehold','prefundingAncillary','replacement','currentCashShortfall']
      : ['closingHousehold','closingAncillary','accumulatedReplacementShortfall','accumulatedCashShortfall'];
    const amounts = keys.map(key => v[key]?.[rung] ?? null);
    return addKnown(...amounts);
  };
  const balanceSeries = (snaps: LedgerSnapshot[]) => {
    const byYear = new Map(snaps.map(s => [s.year, s]));
    return years.map(y => {
      const snap = byYear.get(y);
      const amount = serviceIndex === 2
        ? addKnown(sourceBalance(snap, 0), sourceBalance(snap, 1))
        : sourceBalance(snap, serviceIndex);
      return amount == null ? null : amount * moneyFactor / 1000;
    });
  };
  const areaRows = (kind: 'need' | 'paid', snapshots: LedgerSnapshot[], geography?: string): LedgerRow[] => {
    const serviceRows = (svc: 'sm' | 'basic', rung: number): LedgerRow => {
      const get = (key: LedgerMeasure) => {
        const byYear = new Map(snapshots.map(s => [s.year, s]));
        return years.map(y => {
          const v = byYear.get(y)?.values[key]?.[rung];
          return v == null ? null : v * moneyFactor / 1000;
        });
      };
      const components: { key: LedgerMeasure; label: string; timing: string; status?: string }[] = kind === 'need'
        ? metric === 'requirements'
          ? [
            { key: 'scheduledExpansion', label: `Scheduled expansion cost — reference / ${svc === 'sm' ? 'SM upgrades: Basic → safely managed' : 'Basic access expansion: lower service → Basic'}`, timing: 'Reference — annual flow' },
            { key: 'prefundingHousehold', label: `Expansion still requiring funding — ${svc === 'sm' ? 'SM upgrades: Basic → safely managed' : 'Basic access expansion: lower service → Basic'}`, timing: 'Before funding' },
            { key: 'prefundingAncillary', label: 'Ancillary infrastructure still requiring funding', timing: 'Before funding', status: 'Existing model allocation — first committed expansion-cost weights; not validated' },
            { key: 'replacement', label: 'Current-year replacement requirement', timing: 'Before funding' },
            { key: 'currentCashShortfall', label: 'Current-year cash shortfall', timing: 'Before funding', status: 'Legacy cash allocation assumption; not validated' },
          ]
          : [
            { key: 'closingHousehold', label: `Expansion remaining — ${svc === 'sm' ? 'SM upgrades: Basic → safely managed' : 'Basic access expansion: lower service → Basic'}`, timing: 'Year-end balance' },
            { key: 'closingAncillary', label: 'Ancillary infrastructure remaining', timing: 'Year-end balance', status: 'Existing model allocation — first committed expansion-cost weights; not validated' },
            { key: 'accumulatedReplacementShortfall', label: 'Accumulated replacement shortfall — legacy measure', timing: 'Year-end balance', status: 'Unresolved allowance; not a verified settleable backlog' },
            { key: 'accumulatedCashShortfall', label: 'Accumulated cash shortfall', timing: 'Year-end balance', status: 'Legacy cash allocation assumption; not validated' },
          ]
        : [
          { key: 'householdExpansionPaid', label: 'Household expansion paid (sector + external)', timing: 'Annual flow' },
          { key: 'ancillaryPaid', label: 'Ancillary work paid', timing: 'Annual flow', status: 'Existing model allocation — first committed expansion-cost weights' },
          { key: 'replacementPaid', label: 'Replacement paid', timing: 'Annual flow' },
        ];
      const children: LedgerRow[] = components.map(c => {
        const values = get(c.key);
        const row: LedgerRow = {
          key: `${geography ?? 'scope'}-${svc}-${c.key}`, label: c.label, kind: 'component', unit,
          values, timing: c.timing, component: c.key, geography: geography ?? 'Selected scope',
          service: svc === 'sm' ? 'Safely managed' : 'Basic access', status: c.status,
        };
        if (kind === 'paid' && c.key === 'householdExpansionPaid') {
          row.children = [
            { key: `${row.key}-sector`, label: 'Sector-funded household expansion', kind: 'component', unit,
              values: get('sectorHouseholdPaid'), timing: 'Annual flow', component: 'sectorHouseholdPaid',
              geography: geography ?? 'Selected scope', service: row.service },
            { key: `${row.key}-external`, label: 'Externally funded household expansion', kind: 'component', unit,
              values: get('externalExpansionPaid'), timing: 'Annual flow', component: 'externalExpansionPaid',
              geography: geography ?? 'Selected scope', service: row.service },
          ];
        }
        if (kind === 'need' && c.key === 'accumulatedReplacementShortfall') {
          row.children = [
            { key: `${row.key}-current`, label: 'Current-year unpaid replacement', kind: 'component', unit,
              values: get('currentUnpaidReplacement'), timing: 'Year-end balance', component: 'currentUnpaidReplacement',
              geography: geography ?? 'Selected scope', service: row.service },
            { key: `${row.key}-prior`, label: 'Prior replacement shortfall — legacy measure', kind: 'component', unit,
              values: get('priorReplacementShortfall'), timing: 'Year-end balance', component: 'priorReplacementShortfall',
              geography: geography ?? 'Selected scope', service: row.service, status: 'Legacy carry; not verified deferred replacement' },
          ];
        }
        if (kind === 'need' && c.key === 'accumulatedCashShortfall') {
          row.children = [
            { key: `${row.key}-current`, label: 'Current-year cash shortfall', kind: 'component', unit,
              values: get('currentCashShortfall'), timing: 'Year-end balance', component: 'currentCashShortfall',
              geography: geography ?? 'Selected scope', service: row.service },
            { key: `${row.key}-prior`, label: 'Prior cash shortfall', kind: 'component', unit,
              values: get('priorCashShortfall'), timing: 'Year-end balance', component: 'priorCashShortfall',
              geography: geography ?? 'Selected scope', service: row.service },
          ];
        }
        return row;
      });
      const serviceBalanceSeries = years.map(year => {
        const snap = snapshots.find(s => s.year === year);
        const amount = snap ? sourceBalance(snap, rung) : null;
        return amount == null ? null : amount * moneyFactor / 1000;
      });
      return {
        key: `${kind}-${geography ?? 'scope'}-${svc}`, label: svc === 'sm' ? 'Safely managed' : 'Basic access',
        kind: 'service', unit, values: kind === 'need' ? serviceBalanceSeries : years.map((_, i) => children.reduce<number | null>((sum, child) =>
          sum == null || child.values[i] == null ? null : sum + child.values[i]!, 0)),
        children, geography: geography ?? 'Selected scope', service: svc === 'sm' ? 'Safely managed' : 'Basic access',
      };
    };
    const selectedServices = service === 'total' ? [serviceRows('sm', 0), serviceRows('basic', 1)]
      : service === 'sm' ? [serviceRows('sm', 0)] : [serviceRows('basic', 1)];
    return selectedServices;
  };
  const rootChildren: LedgerRow[] = [];
  const areas = data.areas?.filter(a => snapshotsFor(a).length) ?? [];
  if (areas.length) {
    for (const area of areas) {
      const children = areaRows('need', snapshotsFor(area), area.label);
      const totalSnaps = snapshotsFor(area);
      rootChildren.push({
        key: `area-${area.key}`, label: area.label, kind: 'area', unit,
        values: years.map((_, i) => children.reduce<number | null>((sum, child) =>
          sum == null || child.values[i] == null ? null : sum + child.values[i]!, 0)),
        children, geography: area.label,
      });
    }
  } else {
    rootChildren.push(...areaRows('need', selected));
  }
  const rootValues = balanceSeries(selected);
  const root = {
    key: 'source-total', label: options.sourceKind === 'bau'
      ? `BAU — ${metric === 'requirements' ? 'Requirements before this year’s funding' : 'Remaining financing need at year-end'}`
      : metric === 'requirements' ? 'Requirements before this year’s funding — Combined scenario total'
        : 'Remaining financing need at year-end — Combined scenario total',
    kind: options.sourceKind === 'bau' ? 'baseline' as const : 'scenario' as const,
    unit, values: rootValues, children: rootChildren,
    timing: metric === 'requirements' ? 'Before funding' : 'Year-end balance',
    status: metric === 'gap' ? 'Includes unresolved legacy replacement allowance where reported' : undefined,
  };
  const rows: LedgerRow[] = [root];
  const coverageSnapshots = selected;
  const coverageAreas = data.areas?.map(area => ({
    area, snapshots: snapshotsFor(area),
  })).filter(entry => entry.snapshots.length) ?? [];
  const nationalScope = !data.areas?.length || coverageAreas.length > 1;
  const coverageScopeLabel = nationalScope ? 'National' : coverageAreas[0]?.area.label ?? 'Selected scope';
  const coverageSeries = (snapshots: LedgerSnapshot[], component: number) => {
    const byYear = new Map(snapshots.map(s => [s.year, s]));
    const populations = new Map(coverageSnapshots.map(s => [s.year, s.population]));
    return years.map(year => {
      const snap = byYear.get(year);
      const actual = snap?.values.coverage[component];
      const target = snap?.values.target[component];
      if (actual == null || target == null) return null;
      const difference = actual - target;
      if (!isShare) return difference;
      const population = populations.get(year) ?? 0;
      return population > 0 ? difference / population * 100 : null;
    });
  };
  const thresholdRows: LedgerRow[] = [];
  for (const threshold of [
    { component: 0, label: 'Safely managed', key: 'sm' },
    { component: 2, label: 'At least Basic', key: 'at-least-basic' },
  ]) {
    thresholdRows.push({
      key: `coverage-surplus-${threshold.key}`,
      label: `${coverageScopeLabel} coverage surplus/shortfall — ${threshold.label}`,
      kind: 'detail', unit: isShare ? 'pp' : 'M households',
      values: coverageSeries(coverageSnapshots, threshold.component),
      timing: 'Year-end coverage', component: 'nationalCoverageSurplusShortfall',
      service: threshold.label,
      status: 'Actual households minus the engine-reported scope target; not a financial obligation',
    });
    const localAreaRows: LedgerRow[] = coverageAreas.map(({ area, snapshots }) => ({
      key: `coverage-local-${threshold.key}-${area.key}`,
      label: `${area.label} households still below the ${threshold.label} target`,
      kind: 'component', unit: 'M households', timing: 'Year-end coverage',
      values: years.map(year => {
        const snap = snapshots.find(s => s.year === year);
        const actual = snap?.values.coverage[threshold.component];
        const target = snap?.values.target[threshold.component];
        return actual == null || target == null ? null : Math.max(target - actual, 0);
      }),
      geography: area.label, service: threshold.label, component: 'localUnmetHouseholds',
      status: 'Positive local deficits only; national surplus does not offset them',
    }));
    const localValues = years.map((_, i) => !localAreaRows.length || localAreaRows.some(row => row.values[i] == null)
      ? null : localAreaRows.reduce<number>((sum, row) => sum + (row.values[i] ?? 0), 0));
    thresholdRows.push({
      key: `coverage-local-unmet-${threshold.key}`,
      label: `Households still below area-specific targets — ${threshold.label}`,
      kind: 'summary', unit: 'M households', values: localValues,
      timing: 'Year-end coverage', component: 'localUnmetHouseholds', service: threshold.label,
      status: coverageAreas.length ? 'Sum of positive area deficits; not a financial obligation'
        : 'Unavailable: no actual area datasets; national attainment is shown separately',
      children: localAreaRows,
    });
  }
  rows.push({
    key: 'coverage-thresholds-section', label: 'Coverage thresholds — separate from financial balances',
    kind: 'section', unit: '', values: years.map(() => null), children: thresholdRows,
  });
  if (kindHasSourceFields(selected, 'paid')) {
    const paidAreas = areas.length
      ? areas.map(area => {
        const children = areaRows('paid', snapshotsFor(area), area.label);
        return {
          key: `paid-${area.key}`, label: area.label, kind: 'area' as const, unit,
          values: years.map((_, i) => children.reduce<number | null>((sum, child) =>
            sum == null || child.values[i] == null ? null : sum + child.values[i]!, 0)),
          children, geography: area.label,
        };
      })
      : areaRows('paid', selected);
    rows.push({
      key: 'funding-applied-section', label: 'Funding applied during the year', kind: 'section', unit,
      values: years.map((_, i) => paidAreas.reduce<number | null>((sum, child) =>
        sum == null || child.values[i] == null ? null : sum + child.values[i]!, 0)), timing: 'Annual flow',
      children: paidAreas,
    });
  }
  const diagnostics: { key: LedgerMeasure; label: string; status?: string }[] = [
    { key: 'openingExpansionCost', label: 'Opening household expansion cost — prior prices' },
    { key: 'advanceDeliveryCredit', label: 'Advance-delivery credit' },
    { key: 'newAncillaryCommitment', label: 'New ancillary commitment — fixed adder', status: 'Existing model allocation — first committed expansion-cost weights; not validated' },
    { key: 'noncashDeliveryHH', label: 'Noncash physical delivery — households' },
    { key: 'noncashDeliveryCredit', label: 'Noncash delivery credit — not cash' },
    { key: 'cancelledExpansionCost', label: 'Cancelled household expansion cost' },
    { key: 'outstandingRepricing', label: 'Outstanding repricing' },
  ];
  const diagnosticServices = (service === 'total' ? [['sm', 0], ['basic', 1]] : service === 'sm' ? [['sm', 0]] : [['basic', 1]])
    .map(([svc, rung]) => ({
      key: `diagnostic-${svc}`, label: svc === 'sm' ? 'Safely managed' : 'Basic access',
      kind: 'service' as const, unit, service: svc === 'sm' ? 'Safely managed' : 'Basic access',
      values: years.map(() => null),
      children: diagnostics.map(item => ({
        key: `diagnostic-${svc}-${item.key}`, label: item.label, kind: 'component' as const,
        unit: item.key === 'noncashDeliveryHH' ? 'M households' : unit,
        timing: item.key === 'newAncillaryCommitment' ? 'Reference — annual flow' : 'Reporting diagnostic — not included in balance',
        values: years.map(year => {
          const snap = selected.find(s => s.year === year);
          const value = snap?.values[item.key]?.[Number(rung)] ?? null;
          return value == null ? null : item.key === 'noncashDeliveryHH' ? value : value * moneyFactor / 1000;
        }),
        component: item.key, service: svc === 'sm' ? 'Safely managed' : 'Basic access',
        status: item.status,
      })),
    }));
  if (diagnosticServices.some(svc => svc.children?.some(row => row.values.some(value => value != null)))) {
    rows.push({ key: 'diagnostics-section', label: 'Reconciliation diagnostics — not additive to balances',
      kind: 'section', unit: '', values: years.map(() => null), children: diagnosticServices });
  }
  const availabilityRows: LedgerRow[] = [
    { key: 'available-funding', label: 'Available funding — sector total', measure: 'funding' as any },
    { key: 'unapplied-funding', label: 'Available but not applied / restricted', measure: 'fundingShared' as any },
    { key: 'ordinary-cash', label: 'Ordinary net cash (signed)', measure: 'fundingOperating' as any },
  ].map(({ key, label, measure }: any) => ({
    key, label, kind: 'component', unit, timing: 'Availability context — not deducted from closing balance',
    values: years.map(year => {
      const snap = selected.find(s => s.year === year);
      const value = snap?.values[measure as LedgerMeasure]?.[2] ?? null;
      return value == null ? null : value * moneyFactor / 1000;
    }),
    component: measure,
  }));
  if (data.includesDebt) availabilityRows.push({
    key: 'restricted-loan-cash', label: 'Restricted loan cash available, including carry',
    kind: 'component', unit, timing: 'Restricted availability — not deducted from closing balance',
    values: years.map(year => {
      const snap = selected.find(s => s.year === year);
      const value = snap?.values.fundingRestricted?.[2] ?? null;
      return value == null ? null : value * moneyFactor / 1000;
    }),
    component: 'fundingRestricted',
  });
  if (availabilityRows.some(row => row.values.some(value => value != null))) {
    rows.push({ key: 'funding-context', label: 'Funding availability context — not deducted from closing need',
      kind: 'section', unit: '', values: years.map(() => null), children: availabilityRows });
  }
  return rows;
}
function kindHasSourceFields(snaps: LedgerSnapshot[], _kind: 'paid') {
  return snaps.some(s => [
    s.values.householdExpansionPaid, s.values.ancillaryPaid, s.values.replacementPaid,
  ].some(vector => vector.some(v => v != null)));
}

/** Unrounded values are shared by the table and exports. */
export function ledgerRows(data: LedgerData, options: {
  metric: LedgerMetric; service: LedgerService; basis: LedgerBasis; years: number[];
  isShare: boolean; moneyFactor: number; currency: string; view?: LedgerView; sourceKind?: 'scenario' | 'bau';
}): LedgerRow[] {
  const { metric, service, basis, years, isShare, moneyFactor, currency } = options;
  if (metric === 'requirements' || metric === 'gap') {
    if ((options.view ?? 'source') === 'source')
      return sourceRows(data, options);
  }
  const rung = service === 'sm' ? 0 : service === 'basic' ? 1 : 2;
  const measure = ledgerMeasure(metric, service, basis);
  const isCoverage = metric === 'coverage';
  const unit = isCoverage ? isShare ? '%' : 'M households' : `B ${currency}`;
  function series(snapshots: LedgerSnapshot[], key: LedgerMeasure = measure, denominators = snapshots, component = rung) {
    const byYear = new Map(snapshots.map(s => [s.year, s]));
    const populationByYear = new Map(denominators.map(s => [s.year, s.population]));
    return years.map(year => {
      const snap = byYear.get(year);
      const value = snap?.values[key]?.[component];
      if (value == null || !snap) return null;
      const population = populationByYear.get(year) ?? 0;
      return isCoverage ? isShare ? (population > 0 ? value / population * 100 : null) : value
        : value * moneyFactor / 1000;
    });
  }
  const difference = (after: (number | null)[], before: (number | null)[]) =>
    after.map((value, i) => value == null || before[i] == null ? null : value - before[i]!);
  const rows: LedgerRow[] = [{ key: 'bau', label: 'Pure BAU — year-end stock', kind: 'baseline', unit, values: series(data.base) }];
  const definition = (key: string) => sourceDefinition(key, data.sector ?? 'water');
  const selectedSource = (key: string) => key === 'baseline' ||
    (data.selectedSourceKeys == null || data.selectedSourceKeys.includes(key));
  const groupSources = (children: (LedgerRow & { category: string })[]) => {
    const categories = [...CONTRIBUTION_CATEGORIES.map(c => ({ id: c.id as string, label: c.label })),
      { id: 'custom', label: 'Custom interventions' }, { id: 'other', label: 'Direct physical delivery' }];
    for (const category of categories) {
      const members = children.filter(c => c.category === category.id);
      if (!members.length) continue;
      rows.push({ key: category.id, label: category.label, kind: 'category', unit,
        timing: isCoverage ? basis === 'annual' ? 'Annual delivered transitions' : 'Year-end attributed stock'
          : service === 'total' ? 'Signed ordinary receipts — annual flow' : 'Service capital paid — annual flow',
        children: members, values: years.map((_, i) => members.some(c => c.values[i] == null)
          ? null : members.reduce((sum, c) => sum + c.values[i]!, 0)) });
    }
  };
  if (isCoverage && (!data.coverageAttribution || data.coverageAttribution.version !== 1 ||
      data.coverageAttribution.method !== 'actual_source_funding'))
    throw new Error('Actual source-funded coverage is unavailable in this result set.');
  if (isCoverage && data.coverageAttribution) {
    const a = data.coverageAttribution;
    const annual = basis === 'annual';
    const valuesFor = (sm: number[], basic: number[]) => years.map(year => {
      const i = data.years.indexOf(year);
      if (i < 0) return null;
      if (!Number.isFinite(sm?.[i]) || !Number.isFinite(basic?.[i]))
        throw new Error(`Actual source-funded coverage is unavailable for ${year}.`);
      const value = service === 'sm' ? sm[i] : service === 'basic' ? basic[i] : sm[i] + basic[i];
      const population = data.scenario.find(s => s.year === year)?.population ?? 0;
      return isShare ? population > 0 ? value / population * 100 : null : value;
    });
    const stockSM = annual ? a.annual_sm_upgrades : a.sm_stock;
    const stockBasic = annual ? a.annual_basic_entries : a.basic_stock;
    if (annual) rows.length = 0;
    rows.push({ key: 'opening-baseline', label: annual ? 'Baseline-funded transitions' : 'Opening and baseline-funded coverage',
      kind: 'baseline', unit, timing: annual ? 'Annual delivered transitions' : 'Year-end stock',
      values: annual ? valuesFor(stockSM.baseline, stockBasic.baseline) : valuesFor(a.opening_baseline_stock.sm, a.opening_baseline_stock.basic) });
    const children = a.source_keys.filter(key => key !== 'baseline' && selectedSource(key)).map(key => {
      const band = definition(key);
      return { key, label: band.label, kind: 'intervention' as const, unit,
        timing: annual ? 'Annual delivered transitions' : 'Year-end attributed stock',
        values: valuesFor(stockSM[key], stockBasic[key]), category: ledgerCategory(band?.interventionKey ?? key, band?.custom) };
    });
    groupSources(children);
    // Zero-cost delivery is an accounting origin, not a selectable intervention.
    if (data.selectedSourceKeys && a.source_keys.includes('zero_cost')) {
      const values = valuesFor(stockSM.zero_cost, stockBasic.zero_cost);
      if (values.some(value => value != null && Math.abs(value) > 1e-12))
        rows.push({ key: 'zero-cost-delivery', label: 'Zero-cost delivery — accounting detail',
          kind: 'detail', unit, values });
    }
    const sumSources = (stocks: Record<string, number[]>) => data.years.map((_, i) => a.source_keys.reduce((sum, key) => sum + stocks[key][i], 0));
    rows.push({ key: 'scenario', label: annual ? service === 'total' ? 'Combined delivered transitions (entries + upgrades; not unique households)'
        : service === 'sm' ? 'Combined SM upgrades' : 'Combined Basic entries'
        : 'Combined scenario — year-end stock', kind: 'scenario', unit,
      values: annual ? valuesFor(sumSources(stockSM), sumSources(stockBasic)) : valuesFor(a.combined_stock.sm, a.combined_stock.basic) });
    if (annual) return rows;
    rows.push({ key: 'baseline-reconciliation', label: 'Baseline-funded difference from pure BAU (not an additional layer)', kind: 'detail',
      unit: isShare ? 'pp' : unit, values: valuesFor(a.baseline_difference_from_bau.sm, a.baseline_difference_from_bau.basic) });
  } else if (metric === 'funding') {
    const funding = data.sourceFunding;
    if (!funding || funding.version !== 1 || funding.method !== 'actual_source_funding' ||
        !Array.isArray(funding.source_keys) || !funding.source_keys.includes('baseline'))
      throw new Error('Actual source funding is unavailable in this result set.');
    const field = service === 'total' ? 'signed_contribution'
      : service === 'sm' ? 'sm_capital_spent' : 'basic_capital_spent';
    const amounts = (key: string, name = field, required = false) => years.map(year => {
      if (year <= data.baselineYear) return null;
      const v = funding[name]?.[key]?.[data.years.indexOf(year)];
      if (required && (typeof v !== 'number' || !Number.isFinite(v)))
        throw new Error(`Actual source funding unavailable: ${name}.${key} (${year}).`);
      return typeof v === 'number' && Number.isFinite(v) ? v * moneyFactor / 1000 : null;
    });
    const fields: [string, string][] = [
      ['signed_contribution', 'Signed ordinary contribution'],
      ['loss_charge', 'Proportional loss charge'],
      ['debt_charge', 'Debt service funded — not contractual debt due'],
      ['replacement_charge', 'Replacement allocation paid'],
      ['expansion_available', 'Expansion capacity before purchases'],
      ['basic_capital_spent', 'Basic capital spent'],
      ['sm_capital_spent', 'SM capital spent'],
      ['ancillary_spent', 'Ancillary capital spent — shared allocation'],
      ['unused', 'Unused source cash'],
    ];
    // Restricted proceeds and external household finance are not ordinary receipts.
    const keys = funding.source_keys.filter(key => service !== 'total' ||
      !['loan', 'microfinance', 'grant', 'zero_cost'].includes(key));
    const sourceRow = (key: string): LedgerRow & { category: string } => {
      const band = definition(key);
      return { key: `funding-source-${key}`, label: key === 'baseline'
          ? service === 'total' ? 'Baseline effective ordinary funding' : 'Baseline-funded service capital paid'
          : band.label,
        kind: key === 'baseline' ? 'baseline' : 'intervention', unit, values: amounts(key, field, true),
        component: field, category: ledgerCategory(band.interventionKey ?? key, band.custom),
        timing: service === 'total' ? 'Signed ordinary receipts — annual flow' : 'Service capital paid — annual flow',
        status: service === 'total' ? undefined : 'Actual capital paid; shared receipts, replacement and ancillary spending are not split between services.',
        children: fields.map(([name, label]) => ({
          key: `funding-source-${key}-${name}`, label, kind: 'component', unit, component: name,
          timing: 'Allocation stage — not additive to parent or other stages',
          values: amounts(key, name),
        })) };
    };
    rows.length = 0;
    rows.push(sourceRow('baseline'));
    const children = keys.filter(key => key !== 'baseline' && selectedSource(key)).map(sourceRow);
    groupSources(children);
    // Visibility must never change the actual combined model total.
    const sources = keys.map(sourceRow);
    rows.push({ key: 'scenario', label: service === 'total'
        ? 'Combined scenario — ordinary available funding before debt'
        : `Combined scenario — ${service === 'sm' ? 'SM' : 'Basic'} capital paid`,
      kind: 'scenario', unit, component: field, timing: 'Annual flow',
      values: years.map((_, i) => sources.some(row => row.values[i] == null)
        ? null : sources.reduce((sum, row) => sum + row.values[i]!, 0)) });
    if (service === 'total') {
      for (const [name, label] of [['loss_unfunded', 'Uncovered negative cash'],
        ['replacement_due', 'Replacement due'], ['replacement_paid', 'Replacement paid'],
        ['replacement_unfunded', 'Replacement unfunded']]) {
        rows.push({ key: `funding-total-${name}`, label, kind: 'detail', unit, component: name,
          timing: 'Annual flow — not additional receipts',
          values: years.map(year => {
            const v = year > data.baselineYear ? funding[name]?.[data.years.indexOf(year)] : null;
            return typeof v === 'number' && Number.isFinite(v) ? v * moneyFactor / 1000 : null;
          }) });
      }
    }
  } else if (!isCoverage && data.attributionComplete) {
    const children = data.contributions.map(contribution => {
      const after = series(contribution.after), before = series(contribution.before);
      return {
        key: contribution.key, label: `${contribution.order ? `[Step ${contribution.order}] ` : ''}${contribution.label}`,
        kind: 'intervention' as const, unit: isCoverage && isShare ? 'pp' : unit,
        values: difference(before, after),
        category: contribution.category,
      };
    });
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
  if (!isCoverage && metric !== 'funding') rows.push({ key: 'scenario', label: 'Combined scenario', kind: 'scenario', unit, values: series(data.scenario) });
  const detail = (key: LedgerMeasure, label: string) => {
    const timing = key === 'requirementsCatchUp' ? 'Before funding'
      : key === 'outstanding' || key === 'accumulatedShortfalls' || key === 'fundingShared' || key === 'fundingRestricted'
        ? 'Year-end balance'
        : key === 'plannedExpansion' ? 'Reference — annual flow' : 'Annual flow';
    rows.push({ key, label, kind: 'detail', unit, timing, component: key, values: series(data.scenario, key) });
  };
  if (isCoverage) {
    rows.push({ key: 'target', label: 'Original target', kind: 'target', unit, values: series(data.scenario, 'target') });
    const gapValues = (snapshots: LedgerSnapshot[], component: number) => {
      const coverage = new Map(snapshots.map(s => [s.year, s]));
      const population = new Map(data.scenario.map(s => [s.year, s.population]));
      return years.map(year => {
        const current = coverage.get(year);
        const actual = current?.values.coverage[component];
        const target = current?.values.target[component];
        if (actual == null || target == null) return null;
        const raw = actual - target;
        const value = isShare ? (population.get(year) ?? 0) > 0 ? raw / (population.get(year) as number) * 100 : null : raw;
        return value != null && Math.abs(value) < 1e-12 ? 0 : value;
      });
    };
    const serviceGap = (component: number, key: string, label: string, depth = 0) => {
      rows.push({ key, label: `${label} (scenario − target)`, kind: 'detail', unit: isShare ? 'pp' : unit, signedGap: true, depth,
        values: gapValues(data.scenario, component) });
      for (const area of data.areas ?? []) rows.push({
        key: `${key}-${area.key}`, label: `${area.label} ${component === 0 ? 'SM' : 'Basic-only'} gap (scenario − target)`,
        kind: 'detail', unit: isShare ? 'pp' : unit, signedGap: true, depth: depth + 1,
        values: gapValues(area.scenario, component),
      });
    };
    if (service === 'total') {
      rows.push({ key: 'atLeastBasicNetGap', label: 'At least basic net gap (scenario − target)', kind: 'detail',
        unit: isShare ? 'pp' : unit, signedGap: true, values: gapValues(data.scenario, 2) });
      serviceGap(0, 'smNetGap', 'SM net gap', 1);
      serviceGap(1, 'basicNetGap', 'Basic-only gap', 1);
    } else if (service === 'sm') serviceGap(0, 'smNetGap', 'SM net gap');
    else serviceGap(1, 'basicNetGap', 'Basic-only gap');
  } else if (metric === 'funding') {
    if (service === 'total') { detail('fundingApplied', 'Scenario — funds applied to SM + Basic'); detail('fundingShared', 'Scenario — available but not applied / restricted'); }
    detail('fundingExternal', 'Scenario — external household finance applied');
    if (service === 'total') {
      if (data.includesDebt) {
        rows.push({ key: 'debtFundingSection', label: 'Utility loan funding and scheduled obligations', kind: 'section', unit: '', values: years.map(() => null), status: 'Proceeds are restricted to expansion; only funded debt service is deducted from selected ordinary sources. Unfunded obligations are not forgiven.' });
        detail('loanInjection', 'New indicative loan proceeds injected');
        detail('loanOpeningUnspent', 'Opening unspent loan proceeds carried forward');
        detail('loanInvestment', 'Investment funded from loan proceeds');
        detail('loanClosingUnspent', 'Closing unspent loan proceeds');
        detail('fundingRestricted', 'Restricted loan cash available, including carry');
        detail('repayments', 'Debt-service obligations due');
        detail('repaymentsPaid', 'Debt service funded from selected sources');
        detail('repaymentsUnfunded', 'Debt service unfunded — not forgiven');
      }
      if (selectedSource('injection') && data.scenario.some(snap => snap.values.ordinaryInjection[2] != null)) {
        rows.push({
          key: 'ordinary-injection-section', label: 'Intervention funding injections — included in ordinary funds',
          kind: 'section', unit: '', values: years.map(() => null),
          timing: 'Annual flow — one-time injection is full available amount; recurring amount retains spending-share/execution adjustments',
          status: 'Engine-reported intervention injection series; not an additional amount to add to total funding.',
          children: [{
            key: 'ordinary-injection', label: 'Exogenous intervention injection', kind: 'detail', unit,
            timing: 'Annual flow — already included in ordinary available funds',
            values: series(data.scenario, 'ordinaryInjection'), component: 'ordinaryInjection',
          }],
        });
      }
      const cashFields: { key: LedgerMeasure; label: string }[] = [
        { key: 'connectionNetCash', label: 'Revenue from new connections' },
        { key: 'collectionCash', label: 'Collection attribution cash' },
        { key: 'tariffCash', label: 'Tariff attribution cash' },
        { key: 'nrwNetCash', label: 'Water NRW signed net cash after implementation cost' },
        { key: 'eligibleNrwLinkCash', label: 'Eligible NRW-linked sanitation signed net cash' },
        { key: 'additionalNetCash', label: 'Total additional net cash (identity check)' },
      ];
      const cashSourceKeys: Record<string, string> = {
        connectionNetCash: 'connections', collectionCash: 'collection', tariffCash: 'tariff',
        nrwNetCash: 'nrw', eligibleNrwLinkCash: 'nrw_link',
      };
      const cashRows: LedgerRow[] = cashFields.filter(item =>
        !cashSourceKeys[item.key] || selectedSource(cashSourceKeys[item.key])).map(item => ({
        key: item.key, label: item.label, kind: 'component' as const, unit,
        timing: 'Source cash diagnostic — included in ordinary available cash; not an additional funding amount',
        values: years.map(year => {
          const snap = data.scenario.find(entry => entry.year === year);
          const amount = snap?.values[item.key]?.[2] ?? null;
          return amount == null ? null : amount * moneyFactor / 1000;
        }),
        component: item.key,
      }));
      if (cashRows.some(row => row.values.some(value => value != null))) rows.push({
        key: 'revenue-source-cash-section', label: 'Reconciled revenue source cash — diagnostics, not additive to funding',
        kind: 'section', unit: '', values: years.map(() => null),
        status: 'Water NRW net cash remains signed after implementation costs. Eligible linked sanitation cash is a separate sanitation source; total additional net cash includes it. Marginal service-effect bands are not source cash.',
        children: cashRows,
      });
      if (data.includesDebt) detail('fundingBeforeDebt', 'Ordinary funds before scheduled debt service');
      rows.push({ key: 'fundingOperating', label: data.includesDebt ? 'Ordinary funds after debt service (signed)' : 'Ordinary net cash (signed)',
        kind: data.includesDebt ? 'summary' : 'detail', unit, values: series(data.scenario, 'fundingOperating') });
    }
  } else if (metric === 'requirements') {
    detail('plannedExpansion', 'Scheduled expansion and ancillary commitment — reference');
    detail('expansionPaid', 'Expansion paid — current year (household and ancillary)');
    detail('replacement', 'Current-year replacement requirement');
    detail('replacementPaid', 'Replacement paid — current year');
    detail('cashDeficit', 'Cash deficit — annual flow');
    detail('requirementsCatchUp', 'Requirements before this year’s funding');
    detail('outstanding', 'Outstanding expansion — year-end balance');
    detail('accumulatedShortfalls', 'Accumulated replacement shortfall — legacy measure plus cash shortfall');
  } else if (metric === 'gap') {
    detail('outstanding', basis === 'annual'
      ? 'Closing expansion plus current-year financial shortfall — advanced residual; not an annual flow'
      : 'Outstanding expansion — year-end balance');
    detail('replacement', 'Current-year replacement requirement');
    detail('replacementCredit', 'Capped replacement credit — annual flow');
    detail('cashDeficit', 'Current-year cash shortfall');
    detail('accumulatedShortfalls', 'Accumulated replacement shortfall — legacy measure plus cash shortfall');
  }
  return rows;
}
