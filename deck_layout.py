"""Native slide layout and speaker notes shared by the deck appendices.

The authored template owns its background, title banner, theme and fonts.
Charts and tables remain PowerPoint objects with their original editable data.
"""
import copy

from pptx.dml.color import RGBColor
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Inches, Pt

from pptx_template import _ensure_unique_partname, _remap_rels, delete_shape, find_shape


def add_notes(slide, text):
    """Append notes, including for templates with no notes BODY placeholder."""
    if not text or not text.strip():
        return
    notes = slide.notes_slide
    if notes.notes_text_frame is None:
        notes.shapes._spTree.add_placeholder(
            notes.shapes._next_shape_id, 'Speaker notes',
            PP_PLACEHOLDER.BODY, 'horz', 'full', 1)
    frame = notes.notes_text_frame
    frame.text = (frame.text.rstrip() + '\n\n' + text.strip()).strip()


def text_box(slide, text, x, y, w, h, size=14, bold=False, color='29343B'):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    box.text_frame.word_wrap = True
    box.text_frame.text = text
    for p in box.text_frame.paragraphs:
        p.font.name = 'Arial'
        p.font.size = Pt(size)
        p.font.bold = bold
        p.font.color.rgb = RGBColor.from_string(color)
        p.space_after = Pt(5)
    return box


def new_content_slide(prs, title):
    """Reuse the template banner and logo without inherited content placeholders."""
    source = next((s for s in prs.slides if find_shape(s, 'Text 0') is not None), None)
    layout = source.slide_layout if source else min(prs.slide_layouts, key=lambda l: len(l.placeholders))
    slide = prs.slides.add_slide(layout)
    _ensure_unique_partname(prs, slide.part)
    for shape in list(slide.shapes):
        delete_shape(shape)
    if source is not None:
        bg = source._element.cSld.find(qn('p:bg'))
        if bg is not None:
            slide._element.cSld.insert(0, copy.deepcopy(bg))
        for shape in source.shapes:
            if shape.name in ('Text 0', 'Image 3'):
                slide.shapes._spTree.append(copy.deepcopy(shape._element))
        _remap_rels(source, slide)
        heading = find_shape(slide, 'Text 0')
        from pptx_template import set_text
        set_text(heading, title)
        # Fit long headings without changing the white-on-teal template styling.
        for paragraph in heading.text_frame.paragraphs:
            for run in paragraph.runs:
                run.font.size = Pt(24 if len(title) < 85 else 20)
    else:
        text_box(slide, title, .55, .25, 12.2, .85, size=23, bold=True, color='014972')
    return slide


def native_table(slide, rows, widths, top=1.8, height=4.7, size=11):
    """Editable, wrapped table with a readable header and consistent row spacing."""
    shape = slide.shapes.add_table(len(rows), len(widths), Inches(.57), Inches(top),
                                   Inches(sum(widths)), Inches(height))
    table = shape.table
    for col, width in zip(table.columns, widths):
        col.width = Inches(width)
    header_height = .65
    table.rows[0].height = Inches(header_height)
    for row in list(table.rows)[1:]:
        row.height = Inches(min(.65 if size >= 15 else .45,
                               (height - header_height) / max(1, len(rows)-1)))
    for ri, row in enumerate(rows):
        for ci, value in enumerate(row):
            cell = table.cell(ri, ci)
            cell.text = str(value)
            cell.margin_left = cell.margin_right = Inches(.07)
            cell.margin_top = cell.margin_bottom = Inches(.04)
            cell.text_frame.word_wrap = True
            cell.fill.solid()
            cell.fill.fore_color.rgb = RGBColor.from_string('195B80' if ri == 0 else ('E8F4F5' if ri % 2 else 'FFFFFF'))
            for paragraph in cell.text_frame.paragraphs:
                paragraph.alignment = PP_ALIGN.LEFT if ci == 0 else PP_ALIGN.RIGHT
                paragraph.font.name = 'Arial'
                paragraph.font.size = Pt(size)
                paragraph.font.bold = ri == 0
                paragraph.font.color.rgb = RGBColor.from_string('FFFFFF' if ri == 0 else '29343B')
    return shape


def move_to_notes(slide, shape):
    """Remove a narrative box and its enclosing empty card, retaining all text."""
    add_notes(slide, shape.text)
    for card in list(slide.shapes):
        if (card is not shape and card.has_text_frame and not card.text.strip()
            and card.left <= shape.left and card.top <= shape.top
            and card.left + card.width >= shape.left + shape.width
            and card.top + card.height >= shape.top + shape.height):
            delete_shape(card)
    delete_shape(shape)


def prepare_template_content(prs):
    """Move presenter prompts off the canvas and use the space for native visuals."""
    for slide in prs.slides:
        moved_sidebar = False
        for shape in list(slide.shapes):
            if not shape.has_text_frame:
                continue
            text = shape.text.strip()
            if text.startswith('[Talking points]'):
                moved_sidebar |= shape.left > Inches(8.5)
                move_to_notes(slide, shape)
            elif text.startswith('Annual new expansion + current replacement:'):
                # Keep the result headline; accounting definitions belong in notes.
                add_notes(slide, text)
                shape.text_frame.text = '\n'.join(text.splitlines()[:2])
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(15)
            elif text.startswith(('Design and delivery', 'Evidence and benchmarks')) and '[' in text:
                add_notes(slide, text)
                shape.text_frame.text = text.splitlines()[0] + '\nNot supplied in scenario inputs. Add programme details and supporting evidence in speaker notes.'
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(16)
            elif text.startswith('Costs and targets') and '[User input:' in text:
                add_notes(slide, text)
                shape.text_frame.text = text.split('[User input:', 1)[0].strip()
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(15)
            elif 'Figures are placeholders populated by the tool.' in text:
                shape.text_frame.text = text.replace('Figures are placeholders populated by the tool.', '').replace(
                    'Targets are drawn from [source of target].', 'Targets use the entered scenario assumptions.').strip()
                for paragraph in shape.text_frame.paragraphs:
                    paragraph.font.size = Pt(10)
        if moved_sidebar:
            for shape in slide.shapes:
                if getattr(shape, 'has_chart', False) and shape.name != 'Fan chart':
                    shape.width = Inches(12.19)
                if getattr(shape, 'has_table', False) and shape.name == 'Table 502':
                    old = sum(col.width for col in shape.table.columns)
                    for col in shape.table.columns:
                        col.width = int(col.width * Inches(12.19) / old)
        heading = find_shape(slide, 'Text 0')
        if heading is not None and len(heading.text) > 45:
            heading.text_frame.margin_top = heading.text_frame.margin_bottom = 0
            for paragraph in heading.text_frame.paragraphs:
                paragraph.space_before = paragraph.space_after = Pt(0)
                for run in paragraph.runs:
                    run.font.size = Pt(20 if len(heading.text) > 80 else 24)
        # The narrative card below the intervention ledger no longer limits its height.
        ledger = find_shape(slide, 'Table 501')
        if find_shape(slide, 'Fan chart') is not None and ledger is not None:
            from pptx_template import fit_table
            for row in ledger.table.rows:
                for cell in row.cells:
                    for paragraph in cell.text_frame.paragraphs:
                        for run in paragraph.runs:
                            run.font.size = Pt(11)
            fit_table(ledger.table, 4.86)


def compact_investment_slide(slide):
    """Keep headline balances on the slide and return the complete editable ledger."""
    shape = find_shape(slide, 'Table 501')
    if shape is None or len(shape.table.rows) <= 12:
        return None
    rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
    # Select by meaning, preserving the export's exact values and period headings.
    prefixes = ('Annual planned expansion', 'Replacement requirement', 'Closing outstanding expansion',
                'Closing replacement backlog', 'Negative cash', 'Endline:', 'Total available capital')
    summary = [rows[0]] + [row for row in rows[1:] if row[0].startswith(prefixes)]
    title = find_shape(slide, 'Text 0').text
    delete_shape(shape)
    native_table(slide, summary, [6.5] + [5.69/(len(rows[0])-1)]*(len(rows[0])-1),
                 top=1.55, height=3.35, size=12)
    add_notes(slide, 'The complete investment ledger follows in the appendices. '
              'Flows are summed within periods; opening and closing balances are snapshots.')
    return title, rows


def append_investment_ledgers(prs, ledgers):
    for title, rows in ledgers:
        for start in range(1, len(rows), 10):
            slide = new_content_slide(prs, title.replace('Investment gap:', 'Investment ledger:'))
            native_table(slide, [rows[0], *rows[start:start+10]],
                         [6.5] + [5.69/(len(rows[0])-1)]*(len(rows[0])-1),
                         top=1.55, height=4.9, size=11)
            text_box(slide, 'Flows are summed within periods; opening and closing balances are snapshots.',
                     .65, 6.5, 12, .3, size=10)
            add_notes(slide, 'Full investment ledger, continued. Values and period aggregation '
                      'are unchanged from the model. Endline requirement combines closing expansion, '
                      'closing replacement backlog and accumulated cash shortfalls.')
