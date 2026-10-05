import copy
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

from app import mock_drc_inputs, development_preview
from mock_drc import populate_mock_bundle, GROUPS, CDF_PER_USD
from demo_adapter import coerce_to_engine
from model.engine import calculate


class MockDRCTests(unittest.TestCase):
    def setUp(self):
        self.raw = Path("profiles/DRC_Data_Preview_Settings_Pending.json").read_bytes()
        self.bundle = json.loads(self.raw)

    def test_costs_rate_and_full_graph_series(self):
        result = populate_mock_bundle(self.bundle)
        self.assertTrue(result["applied"])
        for area, expected in (
            (result["bundle"]["inputs"], [2771496, 923832, 4157244, 808353]),
            (result["bundle"]["altInputs"]["rural"], [3464370, 1154790, 2771496, 577395]),
        ):
            self.assertEqual([area[s][f] for s, m, f in GROUPS], expected)
            for section, mix, field in GROUPS:
                rows = area[section][mix]
                self.assertAlmostEqual(sum(row["share"] for row in rows), 1)
                self.assertAlmostEqual(sum(row["share"] * (row["cost"] or 0) for row in rows), area[section][field])
            self.assertGreater(area["revenue_bases"]["water"]["volume_mld"], 0)
            self.assertGreater(area["revenue_bases"]["sanitation"]["volume_mld"], 0)
            self.assertEqual(area["profile_metadata"]["status"], "mock_simulation")
            outputs = calculate(coerce_to_engine(area))
            for sector in ("water_supply", "sanitation"):
                self.assertEqual(len(outputs[sector]["bau_hh"][0]), 25)
                self.assertEqual(len(outputs[sector]["bau_hh"][1]), 25)
        self.assertEqual(result["bundle"]["presentation"]["currencyDisplay"]["localPerUsd"], CDF_PER_USD)

    def test_input_and_profile_unchanged_and_supplied_data_retained(self):
        original = copy.deepcopy(self.bundle)
        result = populate_mock_bundle(self.bundle)["bundle"]
        self.assertEqual(self.bundle, original)
        self.assertEqual(Path("profiles/DRC_Data_Preview_Settings_Pending.json").read_bytes(), self.raw)
        for source, area in ((original["inputs"], result["inputs"]),
                             (original["altInputs"]["rural"], result["altInputs"]["rural"])):
            for key in ("macro", "population", "water_service", "sanitation_service", "toggles"):
                self.assertEqual(source[key], area[key])

    def test_custom_drafts_explicit_zero_and_reference_year_preserved(self):
        source = self.bundle["inputs"]
        source["water_costs"]["sm_tech_mix"] = [
            {"name": "My own technology", "share": .25, "cost": 400},
            {"name": "Another custom technology", "share": None, "cost": None},
        ]
        source["water_costs"]["network_cost_per_hh_serv2"] = 0
        source["technical"]["ws_non_hh_pct"] = 0
        source["revenue_bases"]["water"] = {"version": 1, "volume_mld": 12, "tariff": 800,
                                            "collection_ratio": .9, "reference_year": 2024}
        self.bundle["presentation"] = {"currencyDisplay": {"localPerUsd": 2309.58, "rateReferenceYear": 2024, "mode": "usd"}}
        result = populate_mock_bundle(self.bundle)["bundle"]
        area = result["inputs"]
        self.assertEqual(area["water_costs"]["sm_tech_mix"][0], source["water_costs"]["sm_tech_mix"][0])
        self.assertEqual(area["water_costs"]["sm_tech_mix"][1]["share"], .75)
        self.assertEqual(area["water_costs"]["network_cost_per_hh_serv2"], 0)
        self.assertEqual(area["technical"]["ws_non_hh_pct"], 0)
        self.assertEqual(area["revenue_bases"]["water"]["tariff"], 800)
        self.assertEqual(result["presentation"]["currencyDisplay"]["rateReferenceYear"], 2024)

    def test_idempotent_and_not_applied_to_other_profiles(self):
        first = populate_mock_bundle(self.bundle)["bundle"]
        second = populate_mock_bundle(first)
        self.assertFalse(second["applied"])
        self.assertEqual(first, second["bundle"])
        self.bundle["inputs"]["country_config"]["currency"] = "NPR"
        self.assertFalse(populate_mock_bundle(self.bundle)["applied"])

    def test_production_disabled(self):
        with patch.dict(os.environ, {"REPLIT_DEPLOYMENT": "1"}):
            self.assertEqual(mock_drc_inputs(self.bundle).status_code, 403)
            self.assertIsNone(development_preview()["profile"])