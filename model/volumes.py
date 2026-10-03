"""Exogenous volume projection, deliberately independent of coverage and financing.

This release projects entered billed/system-input volumes, not paying customers.
Revenue consumes the resulting volume arrays; physical connection counts do not
feed them. A future billable-customer/consumption model can replace this projection
without changing tariff/collection reconciliation or debt accounting.
"""
import numpy as np


def exogenous_volume_factors(years, population, *, anchor_year, baseline_year, growth_rate=None):
    """Return one growth multiplier per year, preserving the existing conventions.

    None: population[t] / population[anchor], applied ONCE to the entered volume.
    A supplied rate (including zero): (1 + rate) ** (year - anchor year), INSTEAD
    of population scaling. An absent anchor uses baseline; out-of-window anchors
    use the closest model year. A zero-population anchor retains the existing
    zero-volume result. Historical/forecast gating stays with the caller.

    No simulated connections, service upgrades, loan proceeds or consumption
    assumptions are accepted here. In particular, Basic→SM is not a new-customer
    rule. Future feedback needs explicit billable-customer transitions and usage.
    """
    years = np.asarray(years, dtype=int)
    population = np.asarray(population, dtype=float)
    if years.ndim != 1 or not len(years) or population.shape != years.shape:
        raise ValueError("Volume projection requires matching annual years and population arrays.")
    anchor_index = int(np.clip((anchor_year or baseline_year) - years[0], 0, len(years) - 1))
    if growth_rate is not None:
        return (1.0 + float(growth_rate)) ** (years - years[anchor_index])
    anchor_population = population[anchor_index]
    return population / anchor_population if anchor_population > 0 else np.zeros(len(years))