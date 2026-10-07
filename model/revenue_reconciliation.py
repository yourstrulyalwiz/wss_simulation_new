"""One signed collected-revenue identity; money/volume are in millions."""
import math
from .utility_revenue import RevenueInputError

RECONCILIATION_FIELDS = (
    'raw_billed_volume_million_m3', 'non_nrw_billed_volume_million_m3',
    'nrw_sales_volume', 'nrw_overlap_volume', 'nrw_physical_recovery',
    'nrw_commercial_recovery', 'nrw_residual_recovery', 'nrw_sales_cash',
    'nrw_operating_cost', 'nrw_implementation_cost', 'nrw_avoided_cost_cash',
    'nrw_net', 'nrw_potential_upgrade_hh', 'nrw_delivered_upgrade_hh',
    'funded_sm_upgrade_hh', 'funded_basic_entry_hh',
    'eligible_basic_remaining_hh', 'eligible_lower_remaining_hh',
    'nrw_capacity_committed', 'nrw_capacity_uncommitted',
    'target_sm_overachievement_hh', 'target_basic_or_better_overachievement_hh',
    'mf_flow_hh', 'grant_flow_hh', 'self_finance_exclusion_flow_hh',
    'microfinance_cohort_unoffered',
)
ATTRIBUTION = ('Connection at reference rates; collection before tariff on non-NRW '
               'volume; joint scenario rates on NRW sales; implementation costs remain in NRW net cash.')


def reconcile_revenue(raw, reference, sales, overlap, p0, c0, p, c,
                      marginal_cost=0.0, implementation_cost=0.0,
                      avoided_cost=0.0):
    """Remove only explicitly tagged overlap, including its duplicate cost.

    Existing connection marginal cost moves with the overlapped household sales.
    No new production cost is imposed on water already produced/recovered.
    Avoided-cost mode may remove tagged household billing without booking sales.
    """
    values = (raw, reference, sales, overlap, p0, c0, p, c,
              marginal_cost, implementation_cost, avoided_cost)
    if not all(math.isfinite(float(v)) and v >= 0 for v in values):
        raise RevenueInputError('Reconciled billing volumes, rates and costs must be finite and nonnegative.')
    if c0 > 1 or c > 1 or overlap > raw + 1e-10:
        raise RevenueInputError('Invalid collection rate or tagged billing overlap.')
    pre = max(0.0, raw - overlap)
    total = pre + sales
    connection_gross = (pre - reference) * p0 * c0
    connection_cost = (pre - reference) * marginal_cost
    nrw_cost = overlap * marginal_cost
    connection_net = connection_gross - connection_cost
    collection = pre * p0 * (c - c0)
    tariff = pre * (p - p0) * c
    nrw_gross = sales * p * c
    nrw_net = nrw_gross + avoided_cost - nrw_cost - implementation_cost
    recurring_cost = connection_cost + nrw_cost
    additional = connection_net + collection + tariff + nrw_net
    collected, ref_collected = total * p * c, reference * p0 * c0
    expected = collected - ref_collected - recurring_cost + avoided_cost - implementation_cost
    if not math.isclose(additional, expected, rel_tol=1e-10, abs_tol=1e-8):
        raise RevenueInputError('Reconciled source cash does not match collected revenue less costs.')
    return {
        'raw_billed_volume_million_m3': raw,
        'non_nrw_billed_volume_million_m3': pre,
        'billed_volume_million_m3': total,
        'reference_billed_volume_million_m3': reference,
        'nrw_sales_volume': sales, 'nrw_overlap_volume': overlap,
        'baseline_collected_revenue': total * p0 * c0,
        'reference_collected_revenue': ref_collected, 'collected_revenue': collected,
        'connection_revenue_delta': connection_gross,
        'incremental_variable_operating_cost': recurring_cost,
        'connection_net_cash': connection_net,
        'collection_cash': collection, 'tariff_cash': tariff,
        'nrw_sales_cash': nrw_gross, 'nrw_operating_cost': nrw_cost,
        'nrw_implementation_cost': implementation_cost,
        'nrw_avoided_cost_cash': avoided_cost, 'nrw_net': nrw_net,
        'additional_net_cash': additional,
        'applicable_tariff': p, 'applicable_collection_ratio': c,
    }
