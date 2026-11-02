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


class DeckPreviewTests(unittest.TestCase):
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
        with patch("app.generated_deck", return_value=b"exact deck") as generate, \
             patch("deck_preview.preview_deck", return_value={"slides": []}) as render:
            self.assertEqual(preview_deck_api(payload), {"slides": []})
            generate.assert_called_once_with(payload)
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
