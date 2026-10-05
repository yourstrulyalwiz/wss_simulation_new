"""Explicit development-only demonstration assumptions; never a country calibration."""
from copy import deepcopy
import math

from calculation_setup import economic_projections, CountryCalibrationError
from unit_cost_templates import blank_cost_mix_templates

MOCK_REVISION = "drc-mock-inputs-2309.58-v1"
CDF_PER_USD = 2309.58

# Shares and USD capital prices are illustrative, not inherited Nepal assumptions.
MIXES = {
    "urban": [
        [(0, .75, 1400), (1, .25, 600)],
        [(0, .5, 500), (3, .5, 300)],
        [(0, .6, 2400), (1, .4, 900)],
        [(3, .5, 450), (4, .5, 250)],
    ],
    "rural": [
        [(1, .5, 1800), (2, .5, 1200)],
        [(3, .5, 600), (4, .5, 400)],
        [(1, .5, 1400), (3, .5, 1000)],
        [(3, .5, 350), (4, .5, 150)],
    ],
}
GROUPS = [
    ("water_costs", "sm_tech_mix", "network_cost_per_hh_serv1"),
    ("water_costs", "basic_tech_mix", "network_cost_per_hh_serv2"),
    ("sanitation_costs", "sm_tech_mix", "sewer_cost_per_hh_sserv1"),
    ("sanitation_costs", "basic_tech_mix", "sewer_cost_per_hh_sserv2"),
]


def missing(value):
    return value is None or value == ""


def mock_area(source, area):
    value = deepcopy(source)
    assumptions = []
    baseline = value["period"]["baseline_year"]
    templates = blank_cost_mix_templates()

    def fill(group, key, default, explanation):
        if missing(group.get(key)):
            group[key] = default
            assumptions.append({"field": key, "value": default, "basis": explanation})

    for index, (section, mix_key, field) in enumerate(GROUPS):
        costs = value.setdefault(section, {})
        template = templates[section][mix_key]
        for row in template:
            row["share"] = 0
        for position, share, usd in MIXES[area][index]:
            template[position].update(share=share, cost=round(usd * CDF_PER_USD, 2))
        target = sum(row["share"] * (row["cost"] or 0) for row in template)
        if missing(costs.get(field)):
            rows = costs.get(mix_key) or deepcopy(template)
            rows = deepcopy(rows)
            total = sum(float(row.get("share") or 0) for row in rows)
            unset = [row for row in rows if missing(row.get("share"))]
            if any(not math.isfinite(float(row.get("share") or 0)) or
                   not 0 <= float(row.get("share") or 0) <= 1 for row in rows) or total > 1.001:
                raise CountryCalibrationError("Cannot fill mock costs: existing technology shares must be between 0% and 100% and total no more than 100%. Your original inputs were retained.")
            if unset:
                by_name = {row["name"]: row for row in template}
                weights = [by_name.get(row.get("name"), {}).get("share", 1) for row in unset]
                denominator = sum(weights)
                if not denominator:
                    weights, denominator = [1] * len(unset), len(unset)
                for row, weight in zip(unset, weights):
                    row["share"] = max(0, 1 - total) * weight / denominator
            if abs(sum(float(row.get("share") or 0) for row in rows) - 1) > .001:
                raise CountryCalibrationError("Cannot fill mock costs: existing shares do not total 100% and no blank shares are available. Your original inputs were retained.")
            for row in rows:
                if float(row.get("share") or 0) > 0 and missing(row.get("cost")):
                    match = next((item for item in template if item["name"] == row.get("name")), None)
                    row["cost"] = (match or {}).get("cost") or target
                if not missing(row.get("cost")) and (not math.isfinite(float(row["cost"])) or float(row["cost"]) < 0):
                    raise CountryCalibrationError("Cannot fill mock costs: existing technology costs must be finite and nonnegative. Your original inputs were retained.")
            weighted = sum(float(row.get("share") or 0) * float(row.get("cost") or 0) for row in rows)
            costs.update({mix_key: rows, field: round(weighted, 2)})
            assumptions.append({"field": field, "value": costs[field],
                                "basis": "Illustrative technology mix; USD costs multiplied by the supplied 2,309.58 CDF/USD."})
        fill(costs, "price_index_year", baseline, "Mock nominal price year equals the baseline.")
        fill(costs, "price_index", 100, "Baseline price-index normalization; nominal equals real.")

    technical = value.setdefault("technical", {})
    for prefix in ("ws", "san"):
        fill(technical, f"{prefix}_asset_life", 30, "Mock 30-year infrastructure life.")
        fill(technical, f"{prefix}_non_hh_pct", .10, "Mock 10% non-household share.")

    projections = economic_projections(value)
    position = projections["years"].index(baseline)
    population = projections["population"][position]
    bases = value.setdefault("revenue_bases", {})
    for sector, service, litres in (
        ("water", "water_service", 50), ("sanitation", "sanitation_service", 30),
    ):
        served = 0
        for key in (("serv1_ts", "serv2_ts") if sector == "water" else ("sserv1_ts", "sserv2_ts")):
            series = value[service].get(key) or []
            observations = [item for item in series[:position + 1] if item is not None]
            served += float(observations[-1]) if observations else 0
        base = bases.setdefault(sector, {})
        # population is millions; millions × litres/person/day = MLD.
        volume = round(population * min(1, max(0, served)) * litres, 4)
        defaults = {
            "version": 1, "reference_year": baseline,
            "volume_mld": volume,
            "tariff": round((.5 if sector == "water" and area == "urban" else .3) * CDF_PER_USD, 2),
            "collection_ratio": .8 if area == "urban" else .7,
        }
        for key, default in defaults.items():
            fill(base, key, default,
                 f"Mock {sector} billed-volume equivalent: {litres} L/served person/day; mock tariff and collection, not observed utility data.")
        base.setdefault("growth_rate", None)
        iv = value.setdefault(f"{sector}_interventions", {})
        for field, source_key in (("ce_target_ratio", "collection_ratio"), ("tariff_target", "tariff")):
            fill(iv, field, base[source_key], "Neutral mock reform target equals the entered revenue baseline.")

    metadata = value.setdefault("profile_metadata", {})
    metadata.update(status="mock_simulation", mock_setup_revision=MOCK_REVISION,
                    mock_assumptions=assumptions, cdf_per_usd=CDF_PER_USD,
                    notice="Illustrative mock inputs for graph simulation only; not validated DRC costing or utility data.")
    value["country_config"]["area_of_focus"] = "DRC mock simulation — illustrative inputs"
    return value


def populate_mock_bundle(bundle):
    """Fill only blanks in a copied current session; never modify the bundled profile."""
    result = deepcopy(bundle)
    primary = result.get("inputs") or {}
    metadata = primary.get("profile_metadata") or {}
    if primary.get("country_config", {}).get("currency") != "CDF" or metadata.get("status") != "data_preview":
        return {"applied": False, "bundle": result}
    result["inputs"] = mock_area(primary, "urban")
    for area, source in result.get("altInputs", {}).items():
        if source and source.get("country_config", {}).get("currency") == "CDF":
            result["altInputs"][area] = mock_area(source, area if area in MIXES else "urban")
    presentation = result.setdefault("presentation", {})
    settings = presentation.setdefault("currencyDisplay", {})
    settings.update(sourceCurrency="CDF", localPerUsd=CDF_PER_USD,
                    sourceNote="User-supplied 2,309.58 CDF/USD; not independently verified.")
    if missing(settings.get("rateReferenceYear")):
        settings["rateReferenceYear"] = primary["period"]["baseline_year"]
    settings.setdefault("mode", "local")
    return {"applied": True, "bundle": result}