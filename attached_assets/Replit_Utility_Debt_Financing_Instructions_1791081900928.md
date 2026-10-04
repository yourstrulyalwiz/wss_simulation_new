# Replit implementation instruction: Utility revenue allocation and debt financing

**Date:** 3 October 2026  
**Project:** WSS Strategic Simulation Tool  
**Scope:** New utility borrowing backed by additional revenue from tariff reform, collection efficiency and NRW.  
**Status:** Programming specification. This document does not certify that previous fixes are deployed.

## 1. Replace the earlier household-lending interpretation

This specification supersedes **Replit_Revenue_Allocation_to_Household_Loans.md** for the proposed revenue-allocation feature.

The borrower is the utility. Loan proceeds finance infrastructure through the existing investment and coverage model. Additional utility revenue supports annual principal and interest payments.

Do not implement the household lending fund, lending-capital constraint, or repayment recycling described in that superseded document. Keep the existing household microfinance intervention independent and unchanged. If any superseded feature was already implemented, isolate and disable that feature; do not delete unrelated household microfinance functionality or user data.

The intended chain is:

**Revenue reforms → additional net cash → debt-service capacity → utility borrowing → infrastructure investment → annual repayments.**

Borrowing advances the timing of investment. It does not create a grant or eliminate the obligation to repay.

## 2. First-version decisions and boundaries

Implement:

- A separate **Revenue Allocation and Debt Financing** panel.
- One new loan per sector and area, with one disbursement within the simulation period.
- Annual payments.
- A fixed annual interest rate applied to outstanding principal.
- Two repayment structures: **Equal annual total payments (annuity)**, the default; and **Equal annual principal repayments**.
- A repayment end year within or beyond the simulation target year.
- An optional principal grace period, during which annual interest is still paid.
- Loan sizing from the share of eligible additional revenue allocated to debt-service capacity.
- A complete debt schedule through final maturity and explicit outstanding debt at the simulation target year.
- Compatibility with local-currency/USD displays, contribution grouping, saved scenarios and relevant exports.

Do not add recurring annual loan originations, refinancing, balloon/bullet repayments, floating rates, capitalized interest, interest on arrears, household lending, default/recovery modelling or new connection-driven revenue in this phase. Do not silently introduce physical asset deterioration following an unfunded maintenance obligation.

This is an **incremental financing scenario**, not a lender credit assessment. The current capital-focused model does not contain a complete utility operating statement, credit covenants or debt portfolio.

### Implementation defaults where the discussion left details open

These are explicit design assumptions for version 1, not claims about a particular lender:

| Item | Default |
|---|---|
| Feature enabled | Off |
| Revenue allocation share | 0%; user must choose a positive share to generate borrowing |
| Repayment structure | Equal annual total payments |
| First principal repayment | Year after disbursement |
| Principal grace period | Zero |
| Interest rate | User input; do not silently assume a commercial rate |
| Borrowing amount | Calculated from affordable annual payments, subject to an optional user ceiling |
| Rate and money basis | Real terms, consistent with the reviewed model; see section 6 |
| Existing obligations | Baseline available capital assumed already net of operating obligations and existing debt service; show this assumption |
| After-target repayment capacity | Hold terminal recurring resources constant in real terms, excluding one-off funding |
| Undisbursed future loans / repeated borrowing | None |
| Unused loan proceeds | Carry as restricted investment cash; never count as debt-service capacity |

## 3. Verify the current Replit code before editing

The reviewed local snapshot contains these integration points. Confirm equivalent locations in the actual Replit checkout; do not assume the local snapshot equals production.

| Component | Expected responsibility |
|---|---|
| model/water_supply.py, shared sector calculation | Annual additional revenue, available capital, replacement, investment and coverage |
| model/sanitation.py | Sector-specific inputs and water-NRW-linked sanitation cash |
| model/funding_ledger.py, if present | Funded asset stock, outstanding expansion and financing-gap accounting |
| model/engine.py | BAU/scenario execution, context and result assembly |
| model/inputs.py and demo_adapter.py | Validated input schema and UI/API mapping |
| frontend/src/App.tsx | Shared state, area/scenario persistence and display settings |
| frontend/src/components/InterventionPanel.tsx | New panel placement and controls |
| frontend/src/components/LiveInterventionChart.tsx | Live contribution calculation and display |
| frontend/src/components/ResultsDashboard.tsx | Debt summary, charts and results |
| frontend/src/components/ExportButtons.tsx | Export payloads and presentation options |
| export_data.py, deck_data.py, export_deck.py, export_pptx.py | Excel/CSV and native or captured PowerPoint routes |

In the reviewed snapshot, annual available capital includes collection cash, tariff cash, NRW net cash and other funding. Replacement is paid before expansion. The debt module must integrate at that cash-allocation stage.

Verify these dependencies:

1. Available funding is counted once in the financing-gap calculation.
2. Replacement/maintenance is based on existing and actually funded assets, not unbuilt expansion.
3. Tariff and collection effects reconcile to the joint collected-revenue change, with separate attribution.
4. NRW remains under the agreed additional-sales-revenue interpretation; use its existing net cash after implementation costs.

If a prerequisite is missing, identify it and implement the already-approved prerequisite instruction in a separate commit before this feature. Do not silently incorporate the unapproved dynamic-revenue or false-basic-gap proposals.

## 4. UI placement and fields

Place the panel **below the five intervention categories and above Custom Interventions**, for the selected sector/area. It is a financing mechanism linked to the interventions, not a sixth intervention category.

Introductory text:

> Use part of the additional revenue from tariff reform, collection efficiency and NRW to support utility borrowing for infrastructure. Loan proceeds increase investment funding when disbursed; annual debt repayments reduce cash available for further investment.

Controls:

| Field | Behaviour |
|---|---|
| Enable utility debt financing | Default off; preserve configuration when switched off |
| Share of eligible additional revenue available for debt service (%) | 0–100; stored internally as 0–1 |
| Fixed annual real interest rate (%) | Required when enabled; finite, non-negative; zero is supported |
| Loan disbursement year | Forecast year on or before the simulation target year |
| First principal repayment year | At least the year after disbursement |
| Final principal repayment year | At least the first repayment year; may exceed target year |
| Repayment structure | Annuity or equal principal |
| Optional maximum loan amount | In model currency and units; blank means no user-imposed ceiling; zero explicitly means zero |
| After-target assumption | Read-only explanation of the constant-real recurring-resource assumption |

Derived, read-only fields:

- Number of principal installments = final year − first principal repayment year + 1.
- Principal grace years = first principal repayment year − disbursement year − 1.
- Number of interest-only installments during grace.
- Calculated loan proceeds.
- First and maximum annual payment.
- Outstanding principal at the simulation target year.
- Remaining principal and interest after the target year.
- Unspent loan proceeds at the target year.
- Minimum annual repayment headroom and any shortfall.

Do not expose mutually inconsistent controls for both tenor and end year. Dates are authoritative in this version. An end-year change updates installment count automatically.

The complement of the allocation percentage can be labelled **minimum share retained for direct investment**. Actual retained cash may be larger when payments use less than the allocated capacity. Do not imply the full allocation is automatically spent every year.

Show the eligible source list and source amounts, but keep tariff, collection and NRW assumptions in their existing intervention panels. A disabled revenue intervention contributes zero. No dependency on household microfinance being enabled.

Use separate water and sanitation debt configurations. No cross-sector or cross-area pooling of revenues, loan proceeds or balances.

## 5. Define eligible additional revenue and protected cash

Use the authoritative cash outputs from the sector model, not chart deltas or percentages.

For water, sources are the signed tariff-reform, collection-efficiency and net NRW cash streams. For sanitation, use the corresponding sector cash streams, including only the existing sanitation share of NRW-linked cash. Do not duplicate water revenue in sanitation.

Define for year t:

    R[t] = sum of eligible signed additional net revenue streams
    F[t] = total available capital before this new loan and its debt service
    H[t] = mandatory cash requirements not already deducted from F[t]
    S[t] = max(0, F[t] - H[t])
    E[t] = min(max(0, R[t]), S[t])
    C[t] = allocation_share * E[t]

Where:

- F includes R exactly once and retains negative intervention cash effects.
- H includes the existing model's annual replacement/capital-maintenance requirement.
- Any operating costs or existing debt payments already netted from F must not be deducted a second time.
- If current inputs are gross of operating obligations or existing debt, add an explicit reconciled deduction before claiming that this is cash available for new borrowing. Do not treat missing operating data as measured surplus.
- C is an annual payment limit, not an expense or a separate cash transfer.
- New loan proceeds, unused loan cash and household loan repayments are excluded from R, S and C.
- Budget-execution improvements, capital cost efficiency, financial commitments, exogenous injections and custom interventions are not additional eligible revenue sources. They can affect existing investment resources, but cannot independently create eligible revenue when R is zero.
- One-off funding must not be projected as permanent post-target resources.

Aggregate the signed source streams before taking max(0, R). For example, tariff +10 and NRW −15 produce no positive eligible revenue. Do not ignore the NRW deficit by clipping each source separately.

This implements the model's replacement-first planning assumption. It is not intended to specify legal creditor payment priority.

## 6. Price basis, currency and interest terminology

The reviewed model calculates budgets and investment in **real local-currency terms**, and its household affordability helper also uses a real interest rate.

For this first version, calculate utility borrowing and debt service in the same real price basis:

- Label the input **Fixed annual real interest rate (%)**.
- Label monetary balances with the model's real-price year.
- Use a real rate supplied by the user, not a quoted nominal bank rate without adjustment.
- Explain that a constant real debt schedule is a simplified planning representation, not a literal fixed-nominal lender contract.
- A rough constant-inflation conversion for help text is r_real = (1 + r_nominal) / (1 + inflation) − 1. Do not implement hidden conversions or infer inflation from USD display settings.
- Full nominal contracts, inflation-indexed conversions and foreign-currency borrowing can be added later.

If the current Replit model has changed its price basis, reconcile that first and consistently label the rate and every schedule amount. Do not subtract nominal payments from real investment cash.

The USD display toggle only converts the presentation. It does not change loan currency, interest, borrowing capacity or the simulation. Preserve the agreed user-supplied display exchange rate and units.

Avoid the ambiguous label “simple interest.” In both supported schedules:

    interest_due[t] = fixed_rate * opening_principal[t]

Interest paid each year is not added to principal. No flat interest charge on the original principal throughout an amortizing loan.

## 7. Annual repayment schedule

### 7.1 Annual timing convention

Use the following explicit annual simplification:

- Loan proceeds enter the investment allocation in disbursement year d.
- Interest and principal schedules begin in d + 1; no payment is booked in d.
- This is equivalent to treating the draw as occurring at year-end for interest timing, while the annual coverage model records investment in its draw-year bucket.
- Display this convention in the assumptions and exports. Do not claim within-year construction timing precision.

Let f be the first principal repayment year, m the final repayment year, and n = m − f + 1.

In d + 1 through f − 1, pay interest annually on the full outstanding principal and no principal. A principal grace period is not an interest holiday.

### 7.2 Equal annual total payments: default

For principal L, fixed rate r and n principal installments:

    A = L * r / (1 - (1 + r)^(-n))    if r > 0
    A = L / n                        if r = 0

For each year f through m:

    interest = r * opening_principal
    principal_payment = A - interest
    closing_principal = opening_principal - principal_payment

The annual total A is constant during amortization. During any preceding grace years, total payment is interest only.

### 7.3 Equal annual principal repayments

    principal_payment = L / n
    interest = r * opening_principal
    total_payment = principal_payment + interest

Annual total payments decline. During grace, pay interest only.

### 7.4 Schedule integrity

Use full precision internally. Round only for display. Adjust the final principal installment for floating-point residuals; do not forgive a material balance.

Validate dates and finite values on the backend as well as the UI. Reject negative rates, negative ceilings, NaN, infinity and invalid shares in this version. Do not silently truncate a maturity beyond the simulation horizon.

## 8. Size one loan from the full repayment horizon

Create a pure schedule helper that generates principal, interest and total debt service for a **unit loan** over every year d + 1 through m.

Let a[t] be the total payment for that unit loan. Given annual capacity C[t]:

    L_capacity = min(C[t] / a[t] for every year where a[t] > 0)
    L_proposed = min(L_capacity, optional_user_ceiling)

If there are no eligible revenues, allocation is zero, or any required payment year has zero capacity, affordable borrowing is zero. Do not use average capacity, sum revenues without discounting, or ignore the interest-only grace years.

This automatically handles both repayment structures and different annual revenue profiles.

### 8.1 Avoid circular borrowing assumptions

First run the chosen intervention scenario **without this new utility loan** to obtain a reference revenue and cash path. Existing intervention settings remain enabled. This reference scenario is not BAU.

Do not assume that loan-funded connections automatically generate additional billed revenue. Connection-driven revenue is a separate, unconfirmed feature.

Loan-funded assets will, however, create replacement obligations under the existing funded-stock accounting. Therefore a reference-based loan size is only a preliminary candidate:

1. Build the debt-free reference path and a candidate loan.
2. Simulate that candidate with its repayments, funded assets and resulting replacement requirements.
3. Recalculate C[t] using candidate-specific replacement and other protected costs, excluding loan cash from repayment capacity.
4. Check every required payment against candidate-specific capacity.
5. If any year fails, reduce the loan and rerun. A simple conservative update is L_next = L_current * min(1, min(C[t] / DS[t])) over payment years. Recheck the new result; it is not automatically feasible.
6. Stop only with a feasible loan within numerical tolerance. Bound iterations. If convergence fails, return a safe verified feasible amount or zero with a diagnostic; never silently accept an infeasible candidate.

This conservative sizing method need not claim a global maximum. Label the result **Estimated supportable borrowing**. Do not use binary search on a coverage/cost relationship unless monotonicity has been established for the implemented model.

### 8.2 Prevent accidental repeated borrowing

There is one origination and one debt ledger for this configuration. Each annual revenue value supports scheduled payments on that loan. Do not calculate a new annuity present value and add a new loan in every forecast year.

Changing inputs recalculates the scenario from scratch. Within one scenario run, the loan does not refinance or resize itself every year.

## 9. Repayments beyond the simulation target year

Compute the debt schedule through m even when m > T, the simulation target year.

Keep the coverage and service-target simulation ending at T. Add a separate financial tail for years T + 1 through m.

For first-version post-target capacity:

- Hold recurring eligible additional net revenue at its terminal level in real terms.
- Hold other recurring pre-debt resources at their terminal level in real terms.
- Exclude one-off injections, finite custom funding and other receipts whose funding window has ended. Preserve explicit expiry dates where known.
- Recompute annual replacement from the candidate's closing funded asset stock at T, using terminal real unit costs and existing asset-life rules. Include assets delivered in T, which may not enter replacement until T + 1.
- Hold that funded asset stock constant in the financial tail; do not generate new coverage, population growth or new borrowing beyond T.
- Do not assume known recurring operating or existing-debt obligations disappear at T.
- Apply the same eligible-revenue and capacity formula and check every remaining payment.

If a terminal source combines temporary implementation costs and recurring revenue, retain the actual recurring components and their known expiry rules. Do not extrapolate an arbitrary net one-off amount forever. If the distinction is unavailable, exclude unsupported positive cash from the tail and explain the limitation.

Display:

> Repayment continues beyond the service simulation. Later affordability assumes recurring resources remain constant in real terms and includes replacement of the assets funded by the target year. No additional coverage or revenue growth is assumed after that year.

Return all tail rows. Never declare the loan fully repaid just because the service simulation stops.

## 10. Integrate borrowing and debt service into annual investment

For a feasible scenario:

1. Calculate the year's existing funding and signed intervention revenues.
2. Calculate replacement from opening funded assets.
3. Obtain that year's scheduled debt service.
4. Deduct debt service once from cash available for investment.
5. Protect/pay replacement using the existing accounting.
6. Add loan disbursement, or release previously unspent restricted loan cash, for eligible expansion investment.
7. Run the existing basic/SM investment allocation, source-pool constraints and actual delivery logic.
8. Book only actual funded assets; calculate their future replacement under the existing timing.
9. Close both the funding ledger and the loan-cash ledger.

A useful reconciliation is:

    cash_after_debt[t] = F[t] - scheduled_debt_service[t]
    ordinary_expansion_cash[t] = max(0, cash_after_debt[t] - H[t])
    restricted_loan_cash[t] = opening_unspent_loan_cash[t] + disbursement[t]

    ending_unspent_loan_cash[t] =
        restricted_loan_cash[t] - actual_loan_financed_investment[t]

Loan cash finances expansion infrastructure; it must not be used to make its own debt payments or to conceal pre-existing replacement shortfalls.

Use ordinary expansion funding first and loan cash for remaining eligible expansion spending. Preserve the existing household/non-household allocation and source-pool limits. Reconcile loan use to actual capital expenditure, including associated infrastructure where the model accounts for it. Do not mark loan cash used solely because coverage was provisionally calculated before a cap.

If investment cannot absorb all proceeds immediately, carry unused proceeds as restricted cash without interest income. Do not call an unspent loan balance an investment or a coverage gain. Report it, including at T.

### 10.1 Allocation percentage is capacity, not an additional deduction

Only actual debt service reduces annual available investment funding. Do not subtract both the full allocated revenue share and debt service.

Example:

- Additional revenue available after protected costs: 100.
- Allocation share: 40%, so repayment capacity: 40.
- Scheduled debt service: 30.
- Additional revenue left for direct investment: 70, not 60 or 30.

There is no automatic reserve accumulation in version 1.

### 10.2 Financing-gap accounting

Keep separate:

- Infrastructure investment/replacement requirements.
- Sources of investment finance, including actual usable loan funds.
- Principal and interest payments.
- Outstanding debt and unspent loan cash.

Debt service reduces available capital once. Do not also add the same debt service to infrastructure requirements if it has already been deducted from capital available to those requirements.

A loan-financed delivery reduces the corresponding outstanding expansion need once. Do not count disbursement itself as a delivery, a grant, or a second gap reduction.

For carried loan cash, distinguish new financing inflow from release of an existing cash balance. Do not count the draw in one year's gap calculation and its later expenditure as a second new resource. Reconcile the cash-balance movement and actual funded delivery explicitly.

Preserve signed financing effects and the distinction between coverage gaps and financing gaps. Borrowing can improve early coverage while reducing later direct-investment capacity. Do not force it to appear beneficial in every year.

Do not change the unresolved safely-managed-overachievement/basic-gap methodology under this task.

### 10.3 Shortfalls

Automatic sizing should return a feasible schedule. If validation or a future stress case reveals a payment shortfall:

- Show scheduled payment, available capacity and shortfall.
- Mark the scenario as failing the repayment-capacity check.
- Never silently reduce contractual payments, add unpaid interest to principal or treat loan proceeds as repayment capacity.
- A scheduled principal balance is not proof of actual repayment in an infeasible case. Do not label it as a realized balance.
- Do not publish an unqualified “supportable loan” result for an infeasible schedule.

## 11. Results, contribution charts and exports

Add a compact debt summary in the panel and Results Dashboard:

- Estimated supportable borrowing and draw year.
- Annual debt service: principal and interest.
- Eligible additional revenue, allocated payment capacity and repayment headroom.
- Direct-investment cash remaining after debt service.
- Principal outstanding at target year and final repayment year.
- Remaining payments after target year, split into principal and interest.
- Unspent loan proceeds.
- The rate/price basis and post-target assumptions.

Include a debt schedule table:

    year
    within_service_simulation
    disbursement
    opening_principal
    principal_due
    interest_due
    total_debt_service
    closing_principal
    eligible_additional_revenue
    debt_service_capacity
    repayment_headroom
    payment_shortfall
    opening_unspent_loan_cash
    loan_financed_investment
    closing_unspent_loan_cash

Post-target investment-use fields are zero under the financial-tail assumption; retain any unspent loan balance as a separate asset. Do not net it from gross debt automatically.

### Contribution attribution

Keep the agreed tariff and collection intervention bands separate.

To make the financing effect reviewable and avoid circular attribution:

1. Calculate existing intervention contributions with this utility debt mechanism disabled, preserving the current ordering.
2. After all interventions, compare the same complete scenario with debt enabled versus disabled.
3. Attribute this final signed difference to **Utility debt financing**.
4. In individual view, show that as a separate mechanism band.
5. In category view, aggregate it under **Funding Mobilization**, with an explanation that its benefit depends on the revenue interventions.
6. Keep five categories. Do not add a sixth category.
7. Do not count loan proceeds as tariff or NRW revenue.
8. Do not clamp a negative debt contribution to zero.

Use a signed waterfall or a signed/diverging display where stacked area charts cannot faithfully show negative effects. For any existing individual contributions that are already clipped or non-additive, preserve their values but show an explicit reconciliation residual when needed; do not falsely claim that displayed components sum to the scenario total.

Apply the same attribution logic to live intervention graphs, Results Dashboard and export calculations. A view toggle must not rerun the model or change the financing assumptions.

### Export coverage

Include settings, assumptions, summary and full repayment schedule in Excel. CSV output should include the debt schedule through a dedicated relevant export or a clearly typed table.

For PowerPoint, include the summary, principal outstanding at T, later repayment obligations and a debt-service chart when the feature is enabled. Cover both captured-chart and native backend deck routes.

Use existing local/USD display preferences consistently. Preserve detailed local-currency values in workbook detail where that is the agreed export design. Changing the display currency must not change raw debt or coverage results.

Loan settings are model inputs and must be saved with each sector/area scenario. Display currency and contribution-view preferences remain presentation settings.

## 12. Suggested implementation structure

Create a dedicated debt helper module rather than embedding amortization formulas in UI components.

Suggested functions:

    build_unit_debt_schedule(config, extended_years)
    build_repayment_capacity(reference_or_candidate, config)
    estimate_supportable_loan(unit_schedule, capacity, ceiling)
    apply_debt_cashflows_to_sector(candidate, schedule)
    validate_candidate_capacity(candidate, schedule)
    summarize_debt(schedule, target_year)

Use typed input and output objects. Proposed input names:

    utility_debt.enabled
    utility_debt.allocation_share
    utility_debt.annual_real_interest_rate
    utility_debt.disbursement_year
    utility_debt.first_principal_year
    utility_debt.final_principal_year
    utility_debt.repayment_structure
    utility_debt.loan_ceiling
    utility_debt.post_target_assumption

Use enum values such as annuity and equal_principal. Store loan_ceiling as null when absent. Store a schema version for saved scenarios.

Construct fresh state for every sizing candidate, BAU pass and contribution pass. Never reuse mutable funded-asset or cash ledgers between trials.

BAU has the new borrowing mechanism off. Missing settings in old scenarios default to off and reproduce existing outputs. When the mechanism is off or allocation is zero, no new financing or debt-service flows occur.

Do not accidentally modify household microfinance because an existing annuity helper is reused. A pure shared mathematical helper is acceptable; shared loan state is not.

## 13. Acceptance tests and worked examples

Use focused tests for the financial logic and integration risks below.

### A. Five-year loan, 5%, no grace

L = 1,000,000; d = 2030; f = 2031; m = 2035.

Equal principal:

| Year | Opening principal | Principal | Interest | Total |
|---|---:|---:|---:|---:|
| 2031 | 1,000,000 | 200,000 | 50,000 | 250,000 |
| 2032 | 800,000 | 200,000 | 40,000 | 240,000 |
| 2033 | 600,000 | 200,000 | 30,000 | 230,000 |
| 2034 | 400,000 | 200,000 | 20,000 | 220,000 |
| 2035 | 200,000 | 200,000 | 10,000 | 210,000 |

Total interest = 150,000. Principal closes at zero.

Annuity: annual payment approximately 230,974.80; total interest approximately 154,873.99. Year-one interest = 50,000; principal approximately 180,974.80. Total principal over all installments = 1,000,000.

### B. Capacity differs by repayment structure

With constant annual capacity of 250,000 over five repayment years at 5%, no grace and no other binding constraints:

- Annuity supports approximately 1,082,369.17.
- Equal principal supports 1,000,000 because its first-year payment is the binding constraint.

Verify the unit-schedule sizing against these values. The result can be smaller after funded-asset replacement checks.

### C. Zero interest

A 1,000,000 loan repaid over five years pays 200,000 each year under both structures. Interest-only grace payments are zero. No division-by-zero errors.

### D. Grace period

Disbursement 2030; first principal 2033; final principal 2037. There are two interest-only years, 2031 and 2032, and five principal installments.

At 5% on 1,000,000, interest-only payments are 50,000 each. Interest is not added to principal. Zero capacity in either grace year prevents this loan size.

### E. Within and beyond the target year

For target T = 2040:

- First repayment 2031, final 2040: ten principal installments; zero principal outstanding after the 2040 payment.
- First repayment 2031, final 2045: fifteen principal installments; retain the balance after the 2040 payment and all five remaining payment rows.
- Equal-principal L = 1,500,000 in the second case: outstanding principal at T = 500,000.
- Do not include post-target coverage gains.

### F. Signed revenue and replacement protection

If tariff = 60, collection = 30, NRW net = −10, then R = 80.

If total pre-debt capital F = 100 and protected requirement H = 40:

    E = min(80, 60) = 60
    allocation_share = 50%
    C = 30

A proposed annual payment of 35 fails. A payment of 25 leaves F − H − 25 = 35 for ordinary expansion. Do not additionally subtract C.

### G. Debt does not fund its own repayment

If eligible revenue is zero but loan proceeds or unspent loan cash are positive, repayment capacity from eligible revenue remains zero.

Budget execution, capital efficiency or an exogenous injection alone must not produce a loan under this mechanism.

### H. Replacement feedback

Construct a case where the preliminary reference-based loan adds assets and raises subsequent replacement enough to breach capacity. The sizing loop must reduce the loan and return a candidate that passes every year.

Include closing-year assets in post-target replacement.

### I. No double counting; cash carry

With opening loan cash 0, draw 100 and actual loan-funded capital spending 60, ending loan cash is 40.

In the next year, opening loan cash is 40. Spending 25 leaves 15; there is no second draw of 40 and no new loan principal of 40.

Reconcile investment spending, loan balance, funding-gap credit and funded assets. No coverage is generated by the 15 unspent.

### J. Compatibility and persistence

- Disabled feature reproduces existing outputs.
- Enabled feature with zero allocation produces no loan and no payments.
- Old saved scenarios load with the mechanism off.
- Water and sanitation settings and cash do not leak across sectors or areas.
- Household microfinance outputs remain unchanged when utility debt is off.
- Each comparison/sizing run begins with fresh ledger state.
- Changing annual allocation or repayment structure recalculates all affected results.

### K. Charts and exports

- A case with a negative late-year debt contribution preserves its sign.
- Individual and category views reconcile using the specified financing adjustment/residual.
- All relevant Excel/PPT paths use the same loan settings, full schedule and target-year balance.
- USD display converts money only; rate, installment count, coverage and raw calculations are unchanged.
- Missing or invalid display exchange rate never silently changes debt mathematics.

### L. Numerical and boundary checks

Validate invalid dates, negative/NaN/infinite inputs, zero rates, one-installment loans, zero loan ceilings, all-zero cash paths and long maturities.

Final principal must be zero within tolerance on feasible schedules. Sum of principal installments equals the original draw. Total payments equal principal plus interest. Never round a small annual shortfall away before the capacity test.

## 14. Implementation sequence and completion report

1. Inspect the actual current branch and confirm prerequisites and money/price units.
2. Implement schema and pure schedule/capacity helpers.
3. Integrate single-loan cash flows, restricted cash carry and funded-asset replacement checks.
4. Implement the post-target financial tail.
5. Add the panel, saved settings and result summaries.
6. Integrate signed contribution attribution and exports.
7. Run the focused tests above plus the existing required regression checks.
8. Report changed files, numerical examples, any unresolved prerequisite and the test results.

Keep this change isolated for review. Do not publish or deploy as part of following this instruction unless the user separately requests that action. Do not claim that the model establishes actual lender approval or creditworthiness.

## 15. Background references

These references explain why repayment structure and interest-rate choice are separate. They do not prescribe exact loan terms for this simulation.

- World Bank Treasury, IBRD Flexible Loan: interest on disbursed/outstanding principal, repayment flexibility and rate options. https://treasury.worldbank.org/en/about/unit/treasury/ibrd-financial-products/ibrd-flexible-loan
- IBRD Flexible Loan Major Terms and Conditions, updated July 17, 2026: includes principal grace and semiannual contractual debt service. Annual frequency here is a modelling simplification. https://thedocs.worldbank.org/en/doc/f6bf43b93fd7b3fd1a30b4f3853fffe6-0340012021/original/IBRD-Flexible-Loan-IFL-Major-Terms-Product-Note-EN.pdf
- EIB finance contract example: equal principal or constant principal-plus-interest installments. https://www.sec.gov/Archives/edgar/data/1639691/000163969117000067/eibfinancecontract.htm
- US EPA WIFIA benefits: customized repayments can accommodate utility revenue and phased tariff increases. Such customized schedules are deferred from this first version. https://www.epa.gov/wifia/wifia-benefits-and-flexibilities

