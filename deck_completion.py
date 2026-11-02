"""PPT-only eligibility; never edit drafts or switch interventions off."""
from copy import deepcopy
from fastapi import HTTPException
from intervention_validation import validate_interventions
from simulation_scope import sectors_of


def completed_deck_areas(areas):
    completed, omitted = {}, []
    selected = {}
    for area, inputs in areas.items():
        selected[area] = sectors_of(inputs)
        issues = validate_interventions(inputs, area)
        blocked = {issue['sector'] for issue in issues if issue['severity'] == 'error'}
        keep = [sector for sector in selected[area] if sector not in blocked]
        for sector in selected[area]:
            if sector in blocked:
                reasons = list(dict.fromkeys(issue['message'] for issue in issues
                              if issue['severity'] == 'error' and issue['sector'] == sector))
                omitted.append(f"{area.title()} — {'Water Supply' if sector == 'water' else 'Sanitation'}: " + " ".join(reasons))
        if keep:
            completed[area] = deepcopy(inputs)
            completed[area]['calculation_scope'] = keep
    if 'national' not in areas and 'urban' in areas and 'rural' in areas:
        for sector in ('water', 'sanitation'):
            if all(sector in selected[area] for area in ('urban', 'rural')) and not all(
                    area in completed and sector in completed[area]['calculation_scope'] for area in ('urban', 'rural')):
                omitted.append(f"National — {'Water Supply' if sector == 'water' else 'Sanitation'}: both Urban and Rural results must be complete.")
    if not completed:
        raise HTTPException(422, detail="No complete sector sections are available for this presentation. " + " ".join(omitted))
    return completed, omitted
