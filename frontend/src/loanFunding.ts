export const LOAN_FUNDING_QUALIFICATION =
  'Indicative loan proceeds — repayment accounting deferred. Loan sizing uses the selected year’s additional net cash and assumes equal annual repayments. Principal and interest payments are not deducted from model funding in this version.';

const LEGACY_SOURCES = ['collection', 'tariff', 'nrw'];
const SOURCES = [...LEGACY_SOURCES, 'connections'];

const hasOwn = (value: any, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = (value: any): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const LEGACY_FIELDS = ['principal_grace_years', 'maturity_year', 'repayment_structure', 'loan_ceiling'];

/** Normalize saved loan options without losing legacy fields or interpreting a cleared v2 term as legacy. */
export function migrateLoanFundingConfig(config: any = {}) {
  const priorSchema = config.schema_version == null || Number(config.schema_version) < 2;
  const legacyRecord = config.mode !== 'indicative_lump_sum' || priorSchema;
  const legacyFields = Object.fromEntries(LEGACY_FIELDS
    .filter(key => hasOwn(config, key)).map(key => [key, config[key]]));
  const legacyMetadata = isRecord(config.legacy_metadata) ? config.legacy_metadata : {};
  const legacyParameters = isRecord(config.legacy_parameters) ? config.legacy_parameters : {};
  const legacyPayload = config.legacy_parameters != null && !isRecord(config.legacy_parameters)
    ? { legacy_parameters_original: config.legacy_parameters }
    : config.legacy_metadata != null && !isRecord(config.legacy_metadata)
      ? { legacy_metadata_original: config.legacy_metadata } : {};
  const inactiveParameters = { ...legacyFields, ...legacyMetadata, ...legacyParameters, ...legacyPayload };
  let sources = config.revenue_sources;
  if ((!hasOwn(config, 'revenue_sources') && legacyRecord) || sources === 'all') sources = [...LEGACY_SOURCES];
  else if (!hasOwn(config, 'revenue_sources') && !legacyRecord) sources = [];
  let term = config.loan_term_years;
  let migrated = false;
  if (legacyRecord && term == null && Number.isInteger(Number(config.disbursement_year)) &&
      Number.isInteger(Number(config.maturity_year))) {
    const span = Number(config.maturity_year) - Number(config.disbursement_year);
    if (span > 0) {
      term = span;
      migrated = true;
    }
  }
  const existingNotice = config.migration_notice ?? config.migration_note;
  const notice = existingNotice ?? (migrated
    ? 'Legacy grace, repayment structure and ceiling are retained as inactive metadata. The indicative term was derived from maturity year minus disbursement year; repayment accounting is deferred.'
    : undefined);
  return {
    ...config,
    schema_version: 2,
    mode: 'indicative_lump_sum',
    revenue_sources: sources,
    loan_term_years: term ?? null,
    legacy_parameters: inactiveParameters,
    ...(notice !== undefined ? { migration_notice: notice } : {}),
  };
}

export function validateLoanFundingConfig(config: any, period?: any) {
  const errors: Record<string, string> = {};
  const sources = config?.revenue_sources;
  const validSources = Array.isArray(sources) && sources.every((source: unknown) => SOURCES.includes(String(source))) &&
    new Set(sources).size === sources.length;
  if (!validSources) errors.revenue_sources = 'Choose supported sources without duplicates.';
  const rawShare = config?.allocation_share;
  const share = Number(rawShare);
  if (rawShare == null || rawShare === '') {
    if (config?.enabled) errors.allocation_share = 'Enter a pooled allocation from 0% to 100%.';
  } else if (!Number.isFinite(share) || share < 0 || share > 1) errors.allocation_share = 'Allocation must be between 0% and 100%.';
  const rate = config?.annual_real_interest_rate;
  const rateProvided = rate != null && rate !== '';
  if (rateProvided && (!Number.isFinite(Number(rate)) || Number(rate) < 0))
    errors.annual_real_interest_rate = 'Enter a finite, nonnegative real rate.';
  const term = config?.loan_term_years;
  const termProvided = term != null && term !== '';
  if (termProvided && (!Number.isInteger(Number(term)) || Number(term) <= 0))
    errors.loan_term_years = 'Enter a positive whole number of years.';

  if (config?.enabled) {
    const baseline = Number(period?.baseline_year);
    const forecastEnd = Number(period?.forecast_end_year);
    const year = Number(config.disbursement_year);
    if (!Number.isInteger(year) || year <= 0 || !Number.isFinite(baseline) || !Number.isFinite(forecastEnd) ||
        year <= baseline || year > forecastEnd)
      errors.disbursement_year = 'Choose a positive reference/injection year after baseline and within the forecast horizon.';
    const hasPositivePoolAssumptions = Number.isFinite(share) && share > 0 && validSources && sources.length > 0;
    if (hasPositivePoolAssumptions) {
      if (!rateProvided) errors.annual_real_interest_rate = 'Enter a finite, nonnegative real rate.';
      if (!termProvided) errors.loan_term_years = 'Enter a positive whole number of years.';
    }
  }
  return errors;
}
