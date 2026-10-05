"""Minimum-service diagnostics, assessed locally before geographic aggregation.

Amounts are millions of households. The absolute tolerance is 1e-8 M HH
(0.01 household); it clears numerical residue only, never repairs invalid flows.
Exclusive basic-only gaps are diagnostics, not lower-to-basic cost drivers.
"""
import numpy as np


HOUSEHOLD_TOLERANCE = 1e-8
SERVICE_GAP_FIELDS = (
    'sm_overachievement', 'effective_basic_only_target',
    'adjusted_basic_only_gap', 'sm_access_gap',
    'at_least_basic_target', 'at_least_basic_coverage',
    'at_least_basic_access_gap',
)


def assess_service_gaps(total_hh, coverage, targets, years=None):
    """Return threshold diagnostics for five exclusive coverage rungs."""
    total = np.asarray(total_hh, dtype=float)
    actual = np.asarray(coverage, dtype=float)
    target = np.asarray(targets, dtype=float)
    if actual.shape != (5, total.size) or target.shape != actual.shape:
        raise ValueError('Service-gap assessment requires five rungs for each household year.')

    def require(condition, message):
        invalid = np.flatnonzero(~np.asarray(condition))
        if invalid.size:
            i = int(invalid[0])
            year = years[i] if years is not None else i
            raise ValueError(f'{message} (year {year}; values in millions of households).')

    tol = HOUSEHOLD_TOLERANCE
    require(np.isfinite(total) & (total >= -tol), 'Total households must be finite and nonnegative')
    for label, values in (('Coverage', actual), ('Targets', target)):
        require(np.all(np.isfinite(values) & (values >= -tol), axis=0),
                f'{label} must be finite and nonnegative')
    require(np.abs(actual.sum(axis=0) - total) <= tol,
            'Exclusive coverage categories must sum to total households')
    require(target[:2].sum(axis=0) <= total + tol,
            'SM plus basic-only targets exceed total households')
    require(actual[:2].sum(axis=0) <= total + tol,
            'SM plus basic-only coverage exceeds total households')

    def positive(values):
        return np.where(values > tol, values, 0.0)

    sm, basic = actual[:2]
    ts, tb = target[:2]
    surplus = positive(sm - ts)
    effective = positive(tb - surplus)
    return {
        'sm_overachievement': surplus,
        'effective_basic_only_target': effective,
        'adjusted_basic_only_gap': positive(effective - basic),
        'sm_access_gap': positive(ts - sm),
        'at_least_basic_target': ts + tb,
        'at_least_basic_coverage': sm + basic,
        'at_least_basic_access_gap': positive(ts + tb - sm - basic),
    }


def reconcile_expansion_gaps(closing_households, diagnostics, baseline_index, years):
    """Detect flow/ledger divergence without erasing financial obligations."""
    closing = np.asarray(closing_households)
    for rung, field in enumerate(('sm_access_gap', 'at_least_basic_access_gap')):
        difference = np.abs(closing[rung] - diagnostics[field])
        invalid = np.flatnonzero(difference[baseline_index + 1:] > HOUSEHOLD_TOLERANCE)
        if invalid.size:
            i = baseline_index + 1 + int(invalid[0])
            raise ValueError(f'Outstanding expansion does not reconcile to {field} '
                             f'in year {years[i]} (millions of households).')
