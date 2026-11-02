"""Household-only PowerPoint appendix shared by both deck export paths."""
from deck_layout import add_notes, new_content_slide, native_table, text_box


def append_service_access_slides(prs, results):
    """Append one endline diagnostic slide per scope and sector.

    Results must already contain sums of locally assessed gaps for national scope.
    Household quantities never receive the deck's currency conversion factor.
    """
    fields = [
        ('Original SM target', 'target_hh', 0),
        ('Original basic-only target', 'target_hh', 1),
        ('SM coverage', 'bau_hh', 0),
        ('Basic-only coverage', 'bau_hh', 1),
        ('SM overachievement', 'sm_overachievement', None),
        ('Effective basic-only target after SM credit', 'effective_basic_only_target', None),
        ('Basic-only shortfall after SM credit (diagnostic)', 'adjusted_basic_only_gap', None),
        ('SM access gap', 'sm_access_gap', None),
        ('At-least-basic access gap (basic-entry costing)', 'at_least_basic_access_gap', None),
        ('Outstanding SM upgrades', 'closing_outstanding_hh', 0),
        ('Outstanding lower-to-basic entries', 'closing_outstanding_hh', 1),
    ]
    for scope, result in results.items():
        for sector, title in (('water_supply', 'Water Supply'), ('sanitation', 'Sanitation')):
            sec = result.get(sector)
            if sec is None:
                continue
            slide = new_content_slide(prs, f'{scope.title()} - {title}: service access gaps, {result["years"][-1]}')
            rows = [['Measure (million households)', 'BAU', 'Scenario']]
            for label, key, rung in fields:
                values = []
                for prefix in ('', 'scenario_'):
                    name = 'scenario_hh' if prefix and key == 'bau_hh' else prefix + key
                    series = sec[name]
                    value = series[rung][-1] if rung is not None else series[-1]
                    values.append(f'{value:,.6f}')
                rows.append([label, *values])
            native_table(slide, rows, [8.2, 2, 1.99], top=1.5, height=4.85, size=12)
            qualification = (
                'Basic-only coverage can decline as households upgrade to safely managed service. '
                'SM above its target counts toward the basic minimum. Basic-entry costs follow SM + basic access. '
                'Gaps are assessed per area before aggregation; surplus elsewhere does not cancel a local deficit. '
                'Zero access gaps do not erase replacement, ancillary or accumulated financial shortfalls.'
            )
            add_notes(slide, qualification)
            text_box(slide, 'Local access gaps are assessed before aggregation. Financial shortfalls may remain even when access gaps close.',
                     .65, 6.45, 12, .35, size=10)
