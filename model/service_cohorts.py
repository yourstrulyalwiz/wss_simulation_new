"""Anonymous income-band cohorts: one offer per eligible Basic household."""
import numpy as np


class EligibleCohorts:
    def __init__(self, opening, shares):
        weights = np.maximum(np.asarray(shares, dtype=float), 0.0)
        if not len(weights) or not np.isfinite(weights).all() or weights.sum() <= 0:
            raise ValueError('Eligible household cohorts require positive finite income-band shares.')
        self.weights = weights / weights.sum()
        self.unoffered = max(0.0, opening) * self.weights
        self.offered_unserved = np.zeros(len(weights))
        self.excluded_self = np.zeros(len(weights))

    @property
    def remaining(self):
        return float(self.unoffered.sum() + self.offered_unserved.sum() + self.excluded_self.sum())

    def remove(self, count):
        """NRW/public funding removes customers proportionally where identity is unknown."""
        fraction = min(1.0, max(0.0, count) / self.remaining) if self.remaining > 0 else 0.0
        for state in (self.unoffered, self.offered_unserved, self.excluded_self):
            state *= 1 - fraction

    def reconcile_opening(self, opening):
        # Demographic attrition never creates new offers.
        self.remove(max(0.0, self.remaining - opening))

    def add_entrants(self, count):
        self.unoffered += max(0.0, count) * self.weights

    def offer(self, self_share):
        offered = self.unoffered.copy()
        self.unoffered[:] = 0
        exclusions = np.zeros(len(offered))
        to_exclude = offered.sum() * min(1.0, max(0.0, self_share))
        for i in range(len(offered) - 1, -1, -1):
            exclusions[i] = min(offered[i], to_exclude)
            offered[i] -= exclusions[i]
            to_exclude -= exclusions[i]
        self.excluded_self += exclusions
        self.offered_unserved += offered
        return offered.tolist(), float(exclusions.sum())

    def deliver(self, count):
        # Allocation is anonymous/proportional, not an assertion of individual identities.
        pool = float(self.offered_unserved.sum())
        delivered = min(pool, max(0.0, count))
        if pool > 0:
            self.offered_unserved *= 1 - delivered / pool
        return delivered

    def deliver_by_band(self, counts):
        """Known affordability outcomes are deducted from their actual income band."""
        delivered = np.minimum(self.offered_unserved, np.maximum(np.asarray(counts), 0))
        self.offered_unserved -= delivered
        return float(delivered.sum())
