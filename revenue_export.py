"""Annual revenue diagnostics shared by spreadsheet and PowerPoint exports."""


FIELDS = (
    ('Billed-household equivalents', 'connection_billed_households', 'HH'),
    ('Household billed volume', 'household_billed_volume_million_m3', 'M m³'),
    ('Non-household billed volume', 'nonhousehold_billed_volume_million_m3', 'M m³'),
    ('Total billed volume', 'billed_volume_million_m3', 'M m³'),
    ('Reference billed volume', 'reference_billed_volume_million_m3', 'M m³'),
    ('Applicable tariff', 'applicable_tariff', '{currency}/m³, real'),
    ('Applicable collection ratio', 'applicable_collection_ratio', '0–1'),
    ('Reference collected revenue', 'reference_collected_revenue', '{currency} M'),
    ('Collected revenue', 'collected_revenue', '{currency} M'),
    ('Connection gross revenue difference', 'connection_revenue_delta', '{currency} M'),
    ('Incremental variable operating cost', 'incremental_variable_operating_cost', '{currency} M'),
    ('Connection net cash', 'connection_net_cash', '{currency} M'),
    ('Collection-efficiency cash', 'collection_cash', '{currency} M'),
    ('Tariff-reform cash', 'tariff_cash', '{currency} M'),
    ('Total additional net cash', 'additional_net_cash', '{currency} M'),
)


def revenue_table(result, sector, currency):
    headers = ['Year', 'Pass', 'Revenue mode']
    headers += [f'{label} ({unit.format(currency=currency)})' for label, _, unit in FIELDS]
    sec = result[sector]
    rows = []
    for prefix, label in (('', 'BAU'), ('scenario_', 'Scenario')):
        status = sec.get(prefix + 'connection_revenue') or {}
        mode = 'Mixed (see area configurations)' if status.get('mixed') else (
            'Connection-based' if status.get('effective') else 'Exogenous')
        for i, year in enumerate(result['years']):
            values = [(sec.get(prefix + field) or [0] * len(result['years']))[i]
                      for _, field, _ in FIELDS]
            rows.append([year, label, mode, *values])
    return headers, rows


def append_revenue_slides(prs, results, currency, money_factor=1.0, display_currency=None):
    """Annual revenue appendix; retain full calibration/provenance in slide speaker notes."""
    import json
    from pptx.util import Inches, Pt
    from pptx.dml.color import RGBColor
    from pptx.opc.packuri import PackURI
    display_currency = display_currency or currency
    labels = ['Year', 'Volume\n(M m³)', f'Reference\n({display_currency} M)',
              f'Collected\n({display_currency} M)', f'Connection gross\n({display_currency} M)',
              f'Variable cost\n({display_currency} M)', f'Connection net\n({display_currency} M)',
              f'Collection cash\n({display_currency} M)', f'Tariff cash\n({display_currency} M)',
              f'Total net\n({display_currency} M)']
    keys = ('billed_volume_million_m3', 'reference_collected_revenue', 'collected_revenue',
            'connection_revenue_delta', 'incremental_variable_operating_cost',
            'connection_net_cash', 'collection_cash', 'tariff_cash', 'additional_net_cash')
    for scope, result in results.items():
        for sector, title in (('water_supply', 'Water'), ('sanitation', 'Sanitation')):
            sec = result[sector]
            status = sec.get('connection_revenue') or {}
            if not (status.get('requested') or status.get('mixed')):
                continue
            forecast = [i for i, y in enumerate(result['years']) if y > result['end_asis_year']]
            for prefix, name in (('', 'BAU'), ('scenario_', 'Scenario')):
                for start in range(0, len(forecast), 8):
                    indexes = forecast[start:start + 8]
                    existing = {p.partname for p in prs.part.package.iter_parts()}
                    slide = prs.slides.add_slide(prs.slide_layouts[6])
                    if slide.part.partname in existing:
                        j = 1
                        while PackURI(f'/ppt/slides/slide{j}.xml') in existing:
                            j += 1
                        slide.part.partname = PackURI(f'/ppt/slides/slide{j}.xml')
                    box = slide.shapes.add_textbox(Inches(.45), Inches(.25), Inches(12.4), Inches(.6))
                    box.text = f'{scope.title()} — {title} revenue details: {name}'
                    p = box.text_frame.paragraphs[0]
                    p.font.size, p.font.bold = Pt(21), True
                    p.font.color.rgb = RGBColor(1, 73, 114)
                    mode = 'Mixed; see area results' if status.get('mixed') else (
                        'Connection-based' if status.get('effective') else 'Exogenous — configuration incomplete')
                    note = slide.shapes.add_textbox(Inches(.45), Inches(.92), Inches(12.4), Inches(.65))
                    note.text = f'{mode}. Annual signed cash flows, not financing-gap reductions. One-year billing lag; reference funding is not credited again.'
                    note.text_frame.paragraphs[0].font.size = Pt(11)
                    table = slide.shapes.add_table(len(indexes) + 1, len(labels), Inches(.45),
                                                  Inches(1.75), Inches(12.4), Inches(3.8)).table
                    rows = [labels]
                    for i in indexes:
                        values = [float((sec.get(prefix + key) or [0] * len(result['years']))[i])
                                  for key in keys]
                        rows.append([str(result['years'][i]), f'{values[0]:,.6f}',
                                     *[f'{v * money_factor:,.6f}' for v in values[1:]]])
                    for ri, row in enumerate(rows):
                        for ci, val in enumerate(row):
                            cell = table.cell(ri, ci)
                            cell.text = val
                            for paragraph in cell.text_frame.paragraphs:
                                paragraph.font.size = Pt(9)
                                paragraph.font.bold = ri == 0
                    # All diagnostics and empirical notes accompany the annual cash summary.
                    headers, raw = revenue_table(result, sector, currency)
                    notes = slide.notes_slide
                    if notes.notes_text_frame is None:
                        # The branded template's notes master omits a BODY placeholder.
                        # Create one explicitly so source assumptions are not dropped.
                        from pptx.enum.shapes import PP_PLACEHOLDER
                        notes.shapes._spTree.add_placeholder(
                            notes.shapes._next_shape_id, 'Revenue assumptions',
                            PP_PLACEHOLDER.BODY, 'horz', 'full', 1)
                    notes.notes_text_frame.text = json.dumps({
                        'configuration': sec.get(prefix + 'connection_revenue'),
                        'headers_native_currency': headers,
                        'annual_rows': [r for r in raw if r[1] == name and r[0] in [result['years'][i] for i in indexes]],
                        'limitations': status.get('warnings', []),
                    }, ensure_ascii=False)
