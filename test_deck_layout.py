"""Regression checks for editable, template-faithful deck output."""
import copy
import io
import unittest
import zipfile

from openpyxl import load_workbook
from pptx import Presentation
from pptx.oxml.ns import qn

from export_deck import build_deck, TEMPLATE_A
from pptx_template import find_shape, iter_shapes, clone_slide
from deck_layout import add_notes
from test_support import frontend_defaults


class DeckLayoutTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.inputs = frontend_defaults()
        cls.inputs['utility_debt'] = {'water': {
            'enabled': True, 'mode': 'indicative_lump_sum', 'allocation_share': .5,
            'annual_real_interest_rate': .05, 'loan_term_years': 25,
            'disbursement_year': 2026, 'revenue_sources': ['collection']}}
        cls.inputs['toggles']['ws_collection_efficiency_enabled'] = True
        cls.inputs['water_interventions'].update(ce_start_year=2026, ce_target_year=2030, ce_target_ratio=.99)
        original = copy.deepcopy(cls.inputs)
        cls.blob = build_deck({'urban': cls.inputs}, omitted_sections=['Rural sanitation: incomplete test inputs.'],
                             currency_display={'mode': 'local', 'factor': 1,
                                               'display_currency': 'LCU',
                                               'rate_note': 'TEST RATE NOTE',
                                               'price_basis_note': 'TEST PRICE BASIS'}).getvalue()
        assert cls.inputs == original
        cls.prs = Presentation(io.BytesIO(cls.blob))

    def test_cover_notes_are_not_visible(self):
        slide = self.prs.slides[0]
        visible = '\n'.join(s.text for s in slide.shapes if s.has_text_frame)
        self.assertNotIn('TEST RATE NOTE', visible)
        self.assertIn('TEST RATE NOTE', slide.notes_slide.notes_text_frame.text)
        self.assertIn('TEST PRICE BASIS', slide.notes_slide.notes_text_frame.text)

    def test_background_and_titles_preserve_template(self):
        template = Presentation(TEMPLATE_A)
        original_bg = template.slides[1]._element.cSld.find(qn('p:bg'))
        orig_id = original_bg.find('.//' + qn('a:blip')).get(qn('r:embed'))
        expected = template.slides[1].part.related_part(orig_id).blob
        for slide in list(self.prs.slides)[1:]:
            bg = slide._element.cSld.find(qn('p:bg'))
            self.assertIsNotNone(bg)
            image = bg.find('.//' + qn('a:blip'))
            self.assertIsNotNone(image)
            self.assertEqual(slide.part.related_part(image.get(qn('r:embed'))).blob, expected)
            self.assertIsNotNone(find_shape(slide, 'Text 0'))
            self.assertFalse(any(s.is_placeholder for s in slide.shapes))

    def test_native_charts_keep_embedded_editable_workbooks(self):
        charts = [s.chart for slide in self.prs.slides for s in iter_shapes(slide.shapes) if s.has_chart]
        self.assertGreaterEqual(len(charts), 3)
        for chart in charts:
            workbook = chart.part.chart_workbook.xlsx_part
            self.assertIsNotNone(workbook)
            wb = load_workbook(io.BytesIO(workbook.blob), data_only=True)
            self.assertGreater(wb.active.max_row, 1)
            self.assertGreater(wb.active.max_column, 1)
            self.assertTrue(any(p.series for p in chart.plots))
        # Only the template logo is an image on content slides, never a chart screenshot.
        for slide in list(self.prs.slides)[1:]:
            self.assertLessEqual(sum(s.shape_type == 13 for s in iter_shapes(slide.shapes)), 4)

    def test_appendices_fit_and_loan_assumptions_are_in_notes(self):
        loan = next(s for s in self.prs.slides if find_shape(s, 'Text 0') is not None and
                    'indicative loan funding' in find_shape(s, 'Text 0').text)
        visible = '\n'.join(s.text for s in loan.shapes if s.has_text_frame)
        self.assertNotIn('annuity factor', visible)
        self.assertIn('annuity factor', loan.notes_slide.notes_text_frame.text)
        self.assertIn('affordability', visible)
        for slide in self.prs.slides:
            for shape in slide.shapes:
                if shape.has_table:
                    self.assertLessEqual(shape.left + shape.width, self.prs.slide_width)
                    self.assertLessEqual(shape.top + shape.height, self.prs.slide_height)
        full_text = '\n'.join(s.text for slide in self.prs.slides for s in slide.shapes if s.has_text_frame)
        self.assertNotIn('[Talking points]', full_text)
        self.assertNotIn('Appendix B: [Title]', full_text)
        self.assertIn('Investment ledger:', full_text)

    def test_package_names_and_relationships_are_unique(self):
        with zipfile.ZipFile(io.BytesIO(self.blob)) as archive:
            self.assertEqual(len(archive.namelist()), len(set(archive.namelist())))
        for slide in self.prs.slides:
            for element in slide._element.iter():
                for attr in ('r:embed', 'r:id', 'r:link'):
                    value = element.get(qn(attr))
                    if value:
                        self.assertIn(value, slide.part.rels)

    def test_revenue_appendix_keeps_signed_data_and_source_notes(self):
        from revenue_export import append_revenue_slides
        import json
        prs = Presentation(TEMPLATE_A)
        start = len(prs.slides)
        result = {'years': [2025, 2026, 2027], 'end_asis_year': 2025, 'water_supply': {
            'connection_revenue': {'requested': True, 'effective': True},
            'scenario_connection_revenue': {'requested': True, 'effective': True},
            'billed_volume_million_m3': [0, 2, 3],
            'scenario_billed_volume_million_m3': [0, 4, 5],
            'nrw_net': [0, -50, 100], 'scenario_nrw_net': [0, -25, 200]}}
        append_revenue_slides(prs, {'urban': result}, 'NPR', .01, 'USD')
        out = io.BytesIO()
        prs.save(out)
        loaded = Presentation(io.BytesIO(out.getvalue()))
        self.assertEqual(len(loaded.slides), start + 2)
        for index, expected in [(start, '-0.500000'), (start + 1, '-0.250000')]:
            slide = loaded.slides[index]
            table = next(s.table for s in slide.shapes if s.has_table)
            self.assertEqual(table.cell(1, 7).text, expected)
            self.assertEqual(table.cell(1, 0).text, '2026')
            notes = json.loads(slide.notes_slide.notes_text_frame.text)
            self.assertIn('configuration', notes)
            self.assertIn('reference funding is not credited again', notes['interpretation'])
            self.assertTrue(slide._element.cSld.find(qn('p:bg')).find('.//' + qn('a:blip')) is not None)

    def test_notes_survive_clone_with_template_notes_master(self):
        prs = Presentation(TEMPLATE_A)
        add_notes(prs.slides[12], 'Keep this speaker guidance.')
        clone = clone_slide(prs, 12)
        self.assertIn('Keep this speaker guidance.', clone.notes_slide.notes_text_frame.text)


if __name__ == '__main__':
    unittest.main()
