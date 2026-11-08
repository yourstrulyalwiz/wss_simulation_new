"""Annual recovered-capacity allocation; volumes are million m³/year.

This helper never creates households or assumes water storage between years.
"""
from dataclasses import dataclass
import math
from .utility_revenue import RevenueInputError

ALLOCATION_VERSION = 1
ALLOCATION_FIELDS = (
    'nrw_recovery_total', 'nrw_physical_sales_existing', 'nrw_physical_sales_connections',
    'nrw_physical_delivered_volume', 'nrw_production_avoided_volume',
    'nrw_unused_physical_capacity', 'nrw_direct_sales_volume',
    'nrw_modeled_production_volume',
)
PRIORITY = 'Existing-customer eligible sales, operational funded-connection demand, explicit production reduction, unused capacity.'


def nonnegative(value, label, maximum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        raise RevenueInputError(f'{label}: enter a finite nonnegative value; enter 0 if zero is intended.')
    if maximum is not None and value > maximum:
        raise RevenueInputError(f'{label}: value must not exceed {maximum}.')
    return float(value)


@dataclass(frozen=True)
class Allocation:
    commercial: float
    physical: float
    existing_sales: float
    connection_sales: float
    production_avoided: float
    unused: float

    @property
    def delivered(self):
        return self.existing_sales + self.connection_sales

    @property
    def direct_sales(self):
        return self.commercial + self.existing_sales


def allocate_recovery(recovery, physical_share, existing_demand, connection_demand, reduction_share):
    total = nonnegative(recovery, 'NRW recovery')
    phi = nonnegative(physical_share, 'Physical share of NRW', 1)
    existing = nonnegative(existing_demand, 'Existing-customer eligible demand')
    connections = nonnegative(connection_demand, 'Operational funded-connection demand')
    reduction = nonnegative(reduction_share, 'Production-reduction share', 1)
    physical = total * phi
    e = min(physical, existing)
    n = min(max(0., physical-e), connections)
    remaining = max(0., physical-e-n)
    avoided = remaining * reduction
    return Allocation(total-physical, physical, e, n, avoided, remaining-avoided)
