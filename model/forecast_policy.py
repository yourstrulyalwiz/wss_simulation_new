"""Temporary pause of optional scalar forecast overrides, not entered series."""
from .inputs import MacroInputs


OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED = False
OPTIONAL_FORECAST_FIELDS = (
    "gdp_growth_forecast",
    "inflation_local_ongoing",
    "inflation_us_ongoing",
)


def effective_forecast_macro(macro: MacroInputs) -> MacroInputs:
    """Use established defaults without overwriting saved custom assumptions."""
    if OPTIONAL_FORECAST_ASSUMPTIONS_ENABLED:
        return macro
    return macro.model_copy(update={
        key: MacroInputs.model_fields[key].default
        for key in OPTIONAL_FORECAST_FIELDS
    })
