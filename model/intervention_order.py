"""Agreed marginal attribution order (not independent or order-invariant effects).

Additional options precede explicit public contributions so the final capital sources
close only their observed marginal share of the residual, never an assumed government top-up.
"""

INTERVENTION_ORDER = [
    'ws_capital_efficiency_enabled', 'san_capital_efficiency_enabled',
    'ws_collection_efficiency_enabled', 'san_collection_efficiency_enabled',
    'ws_nrw_enabled', 'san_nrw_link_enabled',
    'ws_costeff_enabled', 'san_costeff_enabled',
    'ws_techmix_enabled', 'san_techmix_enabled',
    'ws_tariff_enabled', 'san_tariff_enabled',
    'ws_microfinance_enabled', 'san_microfinance_enabled',
    '__custom',
    'ws_borrowing_enabled', 'san_borrowing_enabled',
    'ws_financial_commitment_enabled', 'san_financial_commitment_enabled',
    'ws_exogenous_injection_enabled', 'san_exogenous_injection_enabled',
]


def ordered(definitions):
    return sorted(definitions, key=lambda definition: INTERVENTION_ORDER.index(definition[0]))