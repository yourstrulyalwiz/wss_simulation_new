import base64
import copy
import io
import shutil
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pptx import Presentation
from app import generated_deck, preview_deck_api
from deck_preview import preview_deck, preview_slot, slide_titles
from test_support import frontend_defaults
from deck_completion import completed_deck_areas
import deck_data


class DeckPreviewTests(unittest.TestCase):
    def test_incomplete_sectors_are_omitted_without_changing_drafts(self):
        urban, rural = frontend_defaults(), frontend_defaults()
        for inputs, sector, prefix in [(urban, 'sanitation', 'san'), (rural, 'water', 'ws')]:
            inputs['calculation_scope'] = ['water', 'sanitation']
            inputs.setdefault('toggles', {})[prefix + '_collection_efficiency_enabled'] = True
            inputs.setdefault(sector + '_interventions', {})['ce_start_year'] = None
        areas = {'urban': urban, 'rural': rural}
        before = copy.deepcopy(areas)
        completed, omitted = completed_deck_areas(areas)
        self.assertEqual(areas, before)
        self.assertEqual(completed['urban']['calculation_scope'], ['water'])
        self.assertEqual(completed['rural']['calculation_scope'], ['sanitation'])
        self.assertEqual(len(omitted), 4)
        data = deck_data.build(completed)
        self.assertEqual(set(data['blocks']), {('urban', 'water_supply'), ('rural', 'sanitation')})
        pptx = generated_deck({'areas': areas})
        prs = Presentation(io.BytesIO(pptx))
        text = '\n'.join(shape.text for slide in prs.slides for shape in slide.shapes if shape.has_text_frame)
        self.assertIn('completed sections only', text)
        self.assertIn('Omitted incomplete sections', text)

    def test_no_completed_sector_is_explicit_error(self):
        inputs = frontend_defaults()
        inputs['calculation_scope'] = ['water']
        inputs.setdefault('toggles', {})['ws_collection_efficiency_enabled'] = True
        inputs.setdefault('water_interventions', {})['ce_start_year'] = None
        with self.assertRaises(HTTPException) as error:
            completed_deck_areas({'urban': inputs})
        self.assertEqual(error.exception.status_code, 422)

    def test_busy_and_release(self):
        with preview_slot():
            with self.assertRaises(HTTPException) as error:
                with preview_slot():
                    pass
            self.assertEqual(error.exception.status_code, 429)
        with preview_slot():
            pass

    def test_empty_inputs_rejected(self):
        with self.assertRaises(HTTPException) as error:
            generated_deck({"areas": {}})
        self.assertEqual(error.exception.status_code, 422)

    def test_unavailable_renderer(self):
        with patch("deck_preview.shutil.which", return_value=None):
            with self.assertRaises(HTTPException) as error:
                preview_deck(b"not reached")
        self.assertEqual(error.exception.status_code, 503)

    def test_endpoint_uses_exact_generated_bytes(self):
        payload = {"areas": {"urban": {"test": True}}}
        with patch("app.generated_deck", return_value=(b"exact deck", [])) as generate, \
             patch("deck_preview.preview_deck", return_value={"slides": []}) as render:
            self.assertEqual(preview_deck_api(payload), {"slides": [], "omitted_sections": []})
            generate.assert_called_once_with(payload, with_omissions=True)
            render.assert_called_once_with(b"exact deck")

    @unittest.skipUnless(shutil.which("libreoffice"), "LibreOffice required for real rendering")
    def test_actual_template_round_trip(self):
        inputs = frontend_defaults()
        payload = {"areas": {"urban": inputs}, "contribution_view": "category"}
        original = copy.deepcopy(payload)
        pptx = generated_deck(payload)
        self.assertEqual(payload, original)
        prs = Presentation(io.BytesIO(pptx))
        result = preview_deck(pptx)
        self.assertEqual(base64.b64decode(result["pptx_base64"]), pptx)
        self.assertEqual(len(result["slides"]), len(prs.slides))
        self.assertEqual([s["title"] for s in result["slides"]], slide_titles(prs))
        self.assertEqual([s["number"] for s in result["slides"]], list(range(1, len(prs.slides) + 1)))
        for slide in result["slides"]:
            image = base64.b64decode(slide["image"].split(",")[1])
            self.assertTrue(image.startswith(b"\x89PNG"))
            self.assertEqual(slide["width"], 1440)
        self.assertGreater(len(prs.slides), 5)


if __name__ == "__main__":
    unittest.main()
