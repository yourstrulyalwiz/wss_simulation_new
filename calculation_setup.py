"""Restore automatic model configuration, never missing country calibration."""
from copy import deepcopy

from model.inputs import ModelInputs, PeriodInputs, MacroInputs, PopulationInputs, WSSBudgetInputs
from model.engine import build_context


class CountryCalibrationError(ValueError):
    """A required country-specific input was explicitly left blank."""


def restore_automatic_inputs(inputs):
    """Null legacy/imported configuration behaves like omitted configuration.

    Only established automatic settings are repaired. Numeric zero and all
    supplied series/overrides remain intact; country unit costs and technical
    assumptions are deliberately excluded.
    """
    restored = deepcopy(inputs)
    period = restored.setdefault("period", {})
    baseline = period.get("baseline_year", 2025)
    for key, default in {
        "as_is_forecast_start": baseline + 1,
        "as_is_forecast_length": PeriodInputs.model_fields["as_is_forecast_length"].default,
        "perf_improvement_start_year": baseline + 1,
        "real_price_year": baseline,
    }.items():
        if period.get(key) is None:
            period[key] = default
    macro = restored.setdefault("macro", {})
    for key in ("gdp_growth_forecast", "inflation_local_ongoing", "inflation_us_ongoing"):
        if macro.get(key) is None:
            macro[key] = MacroInputs.model_fields[key].default
    if macro.get("real_price_year") is None:
        macro["real_price_year"] = baseline
    for key in ("capex_pct_budget", "execution_rate"):
        if macro.get(key) is None:
            macro[key] = WSSBudgetInputs.model_fields[key].default
    bau = restored.setdefault("bau", {})
    mode = macro.get("budget_source", bau.get("budget_source",
                      macro.get("budget_input_mode", bau.get("budget_input_mode", "pct_gdp"))))
    if mode in ("from_cost", "direct"):
        # %GDP parameters are not used in these modes. Do not borrow Nepal's rates.
        for key in ("ws_budget_pct_gdp", "san_budget_pct_gdp"):
            if macro.get(key) is None:
                macro[key.replace("_budget_pct_gdp", "_total_spending_provided")] = False
                macro[key] = 0.0
    for prefix in ("ws", "san"):
        key = f"{prefix}_budget_ongoing"
        if bau.get(key) is None:
            bau[key] = WSSBudgetInputs.model_fields[f"{prefix}_budget_direct_ongoing"].default
    for sector in ("water", "sanitation"):
        intervention = restored.get(f"{sector}_interventions")
        if isinstance(intervention, dict):
            for field, default in {
                "fin_gdp_start_year": baseline + 1,
                "fin_growth_start_year": baseline + 1,
                "fin_growth_end_year": period.get("forecast_end_year", baseline + 1),
                "fin_injection_start_year": baseline + 1,
                "fin_injection_end_year": period.get("forecast_end_year", baseline + 1),
            }.items():
                if intervention.get(field) is None:
                    intervention[field] = default
    # An unused, cleared reform target must not become zero below the actual
    # shared baseline. Neutral targets come from THIS area's entered base, never
    # a different country's reform assumptions. Enabled reform targets stay required.
    toggles = restored.get("toggles") or {}
    bases = restored.get("revenue_bases") or {}
    for sector, prefix in (("water", "ws"), ("sanitation", "san")):
        base = bases.get(sector) or {}
        interventions = restored.get(f"{sector}_interventions")
        if not isinstance(interventions, dict):
            continue
        for field, source, enabled in (
            ("ce_target_ratio", "collection_ratio",
             toggles.get(f"{prefix}_collection_efficiency_enabled") or toggles.get(f"{prefix}_collection_enabled")),
            ("tariff_target", "tariff", toggles.get(f"{prefix}_tariff_enabled")),
        ):
            if not enabled and interventions.get(field) is None and base.get(source) is not None:
                interventions[field] = base[source]
    debt = restored.get("utility_debt")
    if isinstance(debt, dict):
        if debt.get("schema_version") is None:
            debt.pop("schema_version", None)
        for sector in ("water", "sanitation"):
            config = debt.get(sector)
            if isinstance(config, dict) and not config.get("enabled"):
                debt[sector] = {key: value for key, value in config.items() if value is not None}
    return restored


def validate_country_inputs(inputs):
    """Report actual cleared calibration fields, not obscure float(None) errors.

    Absent keys retain legacy adapter behavior; explicitly blank fields must
    never inherit a different country's costs or technical assumptions.
    """
    missing = []
    fields = {
        "water_costs": {
            "network_cost_per_hh_serv1": "Water supply safely-managed unit cost",
            "network_cost_per_hh_serv2": "Water supply basic unit cost",
        },
        "sanitation_costs": {
            "sewer_cost_per_hh_sserv1": "Sanitation safely-managed unit cost",
            "sewer_cost_per_hh_sserv2": "Sanitation basic unit cost",
        },
        "technical": {
            "ws_asset_life": "Water supply useful life of assets",
            "san_asset_life": "Sanitation useful life of assets",
            "ws_non_hh_pct": "Water sold to non-households",
            "san_non_hh_pct": "Wastewater from non-households",
        },
    }
    for section, labels in fields.items():
        for key, label in labels.items():
            values = inputs.get(section) or {}
            if key in values and values[key] in (None, ""):
                missing.append(label)
    if missing:
        raise CountryCalibrationError("Missing country-specific inputs: " + "; ".join(missing)
                         + ". Enter these in Data Inputs → 7. Unit Costs & Technical Parameters "
                         "for each sector and area. Automatic GDP and population projections "
                         "do not require these inputs.")


def economic_projections(inputs):
    """Use the exact existing engine formulas without running cost-dependent sectors."""
    inputs = restore_automatic_inputs(inputs)
    per, macro = inputs["period"], inputs["macro"]
    model = ModelInputs(
        period=PeriodInputs(**per),
        macro=MacroInputs(**{
            **{key: value for key, value in macro.items() if key in MacroInputs.model_fields},
            "inflation_local": macro.get("inflation_nepal", macro.get("inflation_local", [])),
        }),
        population=PopulationInputs(**(inputs.get("population") or {})),
    )
    ctx = build_context(model)
    return {key: ctx[key].tolist() for key in
            ("years", "population", "total_hh", "hh_size", "gdp_real_local")}