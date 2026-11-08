export type PostArea = 'urban' | 'rural' | 'national';
export type PostSector = 'water' | 'sanitation';
export type PostTargets = { atLeastBasicShare: number | null; safelyManagedShare: number | null };
export type PostInterventionSettings = {
  version: 1; targetYear: number | null;
  targetOverrides: Partial<Record<PostArea, Partial<Record<PostSector, PostTargets>>>>;
  toggleOverrides: Partial<Record<PostArea, Record<string, boolean>>>;
  fundingMethod: 'constant_gdp_share';
};
export type PostCoverage = { sm: number[]; basic: number[]; at_least_basic: number[]; total: number[] };
export type PostComposition = { household_expansion: number; ancillary: number; replacement_backlog: number;
  cash_shortfall: number; total: number };
export type PostBucket = {
  solver_status: string; error?: string;
  reference_coverage: PostCoverage; original_target_coverage: PostCoverage;
  adjusted_existing_funding_coverage: PostCoverage; target_coverage: PostCoverage;
  sm_gap: number; at_least_basic_gap: number;
  target_year_residual_components: PostComposition; target_year_residual_total: number;
  funding_fraction: number | null; candidate_fraction?: number;
  funding_available_by_year: number[]; funding_used_by_year: number[]; unused_by_year: number[];
  verified_funded_coverage: PostCoverage | null; remaining_financial_components: PostComposition | null;
  convergence_diagnostics: Record<string, unknown>; warnings: string[];
};
export type PostResponse = {
  method_version: string; input_signature: string; status: string; selected_year: number;
  funding_window: { start: number; end: number }; years: number[]; national_gdp: number[] | null;
  currency: string; real_price_year: number; units: { households: string; money: string };
  effective_scope: unknown; intervention_mask: unknown; loan_inclusion: boolean; fixed_loan_reference: unknown;
  per_area_sector: Partial<Record<PostArea, Partial<Record<PostSector, PostBucket>>>>;
  combined: { complete: boolean; funding_fraction: number | null; target_year_residual_total: number | null;
    funding_available_by_year: number[] | null; funding_used_by_year: number[] | null; unused_by_year: number[] | null };
  warnings: string[];
};
