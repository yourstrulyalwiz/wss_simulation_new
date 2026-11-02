# Intervention draft validation

The authoritative raw-value inventory and activation rules are in
`intervention_validation.py`. The `/api/intervention-validation` endpoint is
consumed by the UI; calculation and scenario export endpoints independently
invoke the same rules before adapter defaults. Internal counterfactual
calculations use the adapter without validating intentionally disabled levers.

## Inventory and units

Every rule identifies the area, sector, owning intervention, payload path,
visible label, domain, severity and message. Rules cover public spending schedules
and growth, one-time/recurring external funding, collection, tariffs, NRW,
execution, unit-cost efficiency, technology mixes, microfinance/grants,
connection billing and sanitation NRW linkage. Shared revenue dependencies and
row-based mix/income/distribution requirements are expanded per consuming lever.

- Percentages and shares remain fractions; the UI converts displayed percentages.
- External funding and grant pools remain local-currency millions.
- Connection fees and technology costs remain local currency per household.
- Year fields require integer calendar years; amount fields require finite,
  nonnegative numbers. Mix totals use an absolute fraction tolerance of 0.005.
- Zero is a supplied value and generates a review notice, not a missing error.
- Optional volume-growth overrides remain optional; zero is zero growth.
- Disabled interventions and paused custom interventions create no issues.

## Calculation and persistence

`/api/calculate` withholds invalid sectors and returns `intervention_issues` and
`incomplete`. Valid independent sectors and macro/budget projections remain
available. Scenario export endpoints reject invalid raw inputs with structured
422 responses; the UI navigates to the relevant area/intervention rather than
showing an alert. Version saves can retain incomplete drafts without results.

Inputs are not changed by validation. Blank intervention numeric fields persist
as null, explicit zeros remain zero, and invalid numeric text in the shared
intervention field editor remains a draft instead of calculating an older value.
The UI cancels obsolete validation requests; existing calculation revision guards
remain in place.

## Zero semantics

The six formerly falsy NRW/execution defaults now distinguish zero from missing.
The engine and both sector wrappers preserve zero execution targets.
A zero microfinance fee creates no positive principal and does not borrow the
SM connection cost. Zero weighted technology costs are retained but produce a
domain error rather than unlimited household purchases or a BAU-cost substitute.
External funding remains independent of public execution and capital share.

## Verification boundaries

Automated tests cover raw missing/malformed values, both sectors, funding modes,
zero preservation, partial-sector calculations and independent budget forecasts.
Authenticated browser acceptance of every row editor, focus/blur interaction and
calculation-dependent table/chart export remains necessary before claiming the
entire attached acceptance matrix is verified.
