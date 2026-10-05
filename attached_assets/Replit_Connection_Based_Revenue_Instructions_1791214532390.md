# Replit instruction — Revenue from delivered billed connections

## 1. Objective and scope

Add an optional connection-based revenue mode. Household billed volume should depend on delivered billed households, rather than automatically following total population. Apply the already corrected tariff and collection formula to that volume, then recognize only the additional net cash relative to the revenue represented in baseline funding.

Work from the current Replit development code and create a checkpoint. Assume the prior capital double-counting, annual expansion/funded-stock, service-target and tariff/collection corrections are in place. Preserve their tested behaviour. Do not apply older patch files. Implement and test the feature; do not publish automatically.

Existing scenarios remain in the current exogenous-volume mode unless the user selects and configures dynamic mode. Do not invent empirical values for billing shares, household volume share or operating costs. The feature must be usable with explicit assumptions as well as observed data, with their provenance visible. No external data download is required.

This version retains existing service transitions, funding allocations, tariff schedules and collection schedules. Do not introduce demand elasticity, direct lower-service-to-SM delivery, construction delays, detailed utility accounts or an NRW redesign. Keep the existing separate tariff and collection contributions in financing-gap and coverage charts.

## 2. Why SM coverage alone is insufficient

An SM household is not necessarily a newly billed customer. A basic household may already pay the utility. If it upgrades to SM without changing billed status, consumption or tariff, it must not generate a whole new customer's revenue.

Use billed shares for both service levels. An SM-only assumption is allowed as an explicit configuration (`billed_share_SM=1`, `billed_share_basic=0`), not as an undocumented universal rule. Limited and lower service categories are outside the initial household billing module; disclose this scope and flag datasets where these categories materially contribute billed revenue. Do not assign their revenue to SM implicitly.

## 3. Configuration and data provenance

Create a versioned revenue configuration per sector and modeled geography. Reuse the canonical tariff/collection revenue base from the prior correction wherever possible.

| Field or quantity | Source | Initial implementation |
|---|---|---|
| Population, households, SM/basic service counts | Existing model | Reuse the actual delivered coverage series. |
| Reference annual billed volume, tariff, collection ratio | Existing user inputs | Reconcile units and use one canonical base. |
| Tariff/collection targets and schedules | Existing user inputs and interpolation | Preserve. |
| Reference year | Existing volume anchor, possibly different from model baseline | Align calibration to the model baseline; see below. |
| Share of SM households billed | New user data or explicit assumption | Number in [0,1]. |
| Share of basic households billed | New user data or explicit assumption | Number in [0,1]. |
| Household share of reference billed volume | New user data or explicit assumption | Number in [0,1]; non-household volume is the remainder. |
| Reference billed households | Derived from coverage and billed shares | Optional observed count for a consistency check, not a conflicting second denominator. |
| Annual billed consumption per billed household | Derived calibration | One common value for basic and SM in version 1. Hold constant. |
| Non-household volume path | Existing exogenous rule or explicit user growth assumption | Separate series; do not scale by household connections. |
| Reference household volume represented in baseline funding | User-confirmed funding assumption or external series | Explicitly configure; never infer from GDP/budget amounts. |
| Marginal operating cost per additional billed m³ | New user data or explicit simplified assumption | Nonnegative real-currency value. Zero requires an explicit gross-revenue simplification. |
| Revenue timing | New fixed modeling assumption | End-of-previous-year delivered households generate this year's volume. |

For new empirical assumptions, store value, source type (`observed` or `assumed`), reference year where applicable and a short source/note. Do not require document uploads. Clearly label all monetary values as real local currency in the model's price basis.

Dynamic mode requires a complete, internally consistent configuration. Show the specific missing or conflicting inputs and retain exogenous mode; do not silently use SM-only billing or 100% household volume. Retain valid zeros by distinguishing missing values from zero.

### Reference-year alignment

Use the model baseline year for calibration so the forecast does not depend on an unknown future customer count. If the existing billed volume is anchored to an intervention start year instead:

- Prefer a user-supplied baseline-year observation; or
- Allow an explicit conversion using the existing exogenous growth rule, label it as an estimate, and preserve the original value/year.

Do not silently treat a future-year volume as baseline volume. Do not obtain the calibration denominator from future simulated coverage. Resolve migration independently of intervention toggles so every cumulative chart pass uses the same calibration.

## 4. Calibrate and calculate volume

The following equations use raw households and m³/year for clarity. Adapt consistently if the engine stores millions.

```python
S0, B0 = delivered_SM_at_baseline, delivered_basic_at_baseline
fS, fB = billed_share_SM, billed_share_basic
Q0 = baseline_total_billed_volume
h = household_share_of_billed_volume

N0 = fS * S0 + fB * B0
Qhh0 = h * Q0
Qnh0 = (1 - h) * Q0
q = Qhh0 / N0  # m³ per billed household per year

# Each forecast year t; the first forecast uses baseline households:
N_t = fS * delivered_SM[t-1] + fB * delivered_basic[t-1]
Qhh_dynamic_t = q * N_t
Qdynamic_t = Qhh_dynamic_t + Qnh_t
```

`Qnh_t` is the configured non-household exogenous series anchored at `Qnh0`. In dynamic mode, do not also multiply `Qhh_dynamic_t` by population growth. Population continues to determine total households and service needs; only funded/delivered service contributes to the billing calculation.

For `N0=0`, do not divide by zero or infer infinite consumption. A positive `Qhh0` with zero modeled billed households is inconsistent and must be resolved. If both are zero but future billing is expected, require a user-supplied consumption assumption; zero starting volume cannot calibrate it. Allow a true non-household-only configuration with the household component disabled.

The common-consumption assumption means moving a household between basic and SM changes revenue only when its assumed billed status changes. Constant billed shares represent average billing propensities by service level, not identified customer cohorts. Explain that limitation. Version 1 does not infer separate basic and SM consumption rates from one aggregate volume.

If an observed billed-household count is supplied, compare it to `N0`; reconcile inconsistent shares rather than calibrating against one count and forecasting against another. Do not divide household volume by total population or by a count of non-household meters.

## 5. Define the revenue already represented in funding

The sector's baseline budget is not a full utility revenue account. Before adding dynamic revenue, define `Qhh_reference_t`: the household billed-volume path whose net contribution is assumed already included in the baseline funding projection, valued at baseline tariff and collection.

Provide these explicit choices:

1. **Existing exogenous path:** the previous population/fixed-growth household-volume path is already represented in funding. This is a reasonable proposed comparison when retaining existing projections, but the user must confirm it.
2. **Fixed baseline volume:** only baseline-volume revenue is represented; later customer growth is additional.
3. **User-supplied reference series:** for an independently documented funding assumption.

None of these can be established from the funding amount alone. Label the choice and store it with the scenario. A reference path may be a budget assumption rather than physically delivered service. If baseline funding already assumes future tariff/collection reforms, flag that incompatibility: the version-1 comparison assumes baseline `p0` and `c0`, and the funding input/reference needs reconciliation before dynamic mode is enabled.

Use the same `Qhh_reference_t` and non-household reference path for BAU and every intervention pass. Freeze them as inputs, not as a function of current scenario coverage. Do not use one dynamically recalculated scenario as the cash benchmark for another.

## 6. Revenue and net cash decomposition

Let `p0` and `c0` be baseline tariff and collection; `p_t` and `c_t` follow the existing reform schedules and sector toggles. Let `v_t` be the configured marginal variable operating cost per billed m³ for household volume differences. Keep non-household volume identical in dynamic and reference paths in this version.

```python
Qreference_t = Qhh_reference_t + Qnh_t
delta_Qhh = Qhh_dynamic_t - Qhh_reference_t

reference_collected_revenue = Qreference_t * p0 * c0
dynamic_collected_revenue = Qdynamic_t * p_t * c_t

connection_revenue_delta = delta_Qhh * p0 * c0
collection_cash = Qdynamic_t * p0 * (c_t - c0)
tariff_cash = Qdynamic_t * (p_t - p0) * c_t

incremental_variable_operating_cost = delta_Qhh * v_t
connection_net_cash = (
    connection_revenue_delta - incremental_variable_operating_cost
)
additional_net_cash = connection_net_cash + collection_cash + tariff_cash
```

Verify the identity:

```text
additional_net_cash = dynamic_collected_revenue
                    - reference_collected_revenue
                    - incremental_variable_operating_cost
```

The algebra assigns connection-volume effects at baseline tariff/collection, collection effects at baseline tariff, and tariff effects at the applicable collection ratio. It captures all interactions once. Do not add a separately calculated “new connection revenue” on top of this total. Replace the previous exogenous-volume tariff/collection cash streams with these dynamic-volume streams in dynamic mode only.

Retain the existing 100% reinvestment assumption for this incremental net cash. Do not introduce a new reinvestment percentage in version 1. A user-confirmed `v=0` is the simplified assumption that all incremental collected revenue is available for capital; show that assumption in outputs. `v>0` represents variable operating costs, not asset replacement, depreciation or existing fixed costs. Preserve the separate capital-replacement ledger.

Keep signed differences. If delivered billed volume is below what baseline funding assumed, the adjustment can be negative. Do not zero negative volume/revenue changes, as this would credit growth while ignoring a shortfall. A negative variable-cost difference is an avoided variable cost under this symmetric marginal-cost assumption; it does not reduce fixed costs or remove funded assets. Explain this assumption and use the established negative-available-cash handling.

## 7. Annual calculation order and scenarios

For each forecast year:

1. Read the previous year's delivered SM/basic households.
2. Calculate dynamic billed volume, applicable tariff/collection and additional net cash.
3. Feed `connection_net_cash`, `collection_cash` and `tariff_cash` into available capital once.
4. Apply existing replacement priority and expansion allocation.
5. Close the annual funding/asset ledger and record delivered households for next year's revenue.

Dynamic mode applies to BAU and scenario runs under the same assumptions. BAU can receive a connection-related net adjustment even with all intervention toggles off. Do not gate the entire dynamic module behind the tariff or collection toggle. Changing scenario toggles must not mutate the BAU counterfactual. Recalculate every cumulative intervention pass independently from the same baseline and reference inputs; never reuse full-scenario future volume in partial passes.

Preserve the service-gap correction, annual backlog rules, signed cash handling and funded-asset replacement. Additional revenue does not count as delivered service until the existing allocation engine funds a connection.

## 8. Charts and outputs

Retain separate **Collection efficiency** and **Tariff reform** contributions in both financing-gap and coverage charts, and preserve the full existing cumulative intervention order. Derive outcome contributions from successive full model runs. Each intervention's contribution includes the later revenue effects of the connections it causes. Do not add a duplicate “dynamic revenue” intervention band.

The BAU line changes when dynamic mode is enabled; label that mode clearly. With the mode disabled and the same inputs, reproduce the existing corrected model results.

Expose annual diagnostic outputs for billed household equivalents, household/non-household billed volume, reference volume, applicable tariff and collection, reference/dynamic collected revenue, gross connection-revenue difference, incremental variable operating cost, connection net cash and total additional net cash. These can appear in a revenue details table and exports, without redesigning the intervention charts. Preserve original inputs, provenance and the explicit reference-funding choice in saved scenarios.

Treat service coverage and billing separately in explanations. Do not relabel all SM households as utility customers. Apply the logic consistently to water and sanitation with separate sector configurations; do not copy water billing shares or marginal costs into sanitation silently. Preserve explicit, documented existing input links where appropriate.

Leave existing NRW cash and physical effects unchanged. Report any overlap found between NRW-valued water and the new billed-volume calculation as a separate unresolved issue; do not claim full utility revenue reconciliation while such overlap remains. Isolate NRW in the core acceptance examples.

## 9. Acceptance tests

### Calibration and billing examples

Use 100 baseline households: 60 SM and 40 basic; both billed shares equal 100%; household billed volume 10,000 m³/year; no non-household volume. Then `N0=100` and `q=100` m³/year.

- Upgrade 10 basic households to SM: 70 SM/30 basic still gives 100 billed households and 10,000 m³. No volume-driven revenue increase.
- In a separate fixture with 10 additional previously unbilled households below basic, connect those 10 to a billed service: billed households become 110 and next-year volume becomes 11,000 m³. Ensure total population supports the fixture; do not fabricate households.
- With explicitly configured SM-only billing, a basic-to-SM upgrade increases modeled billed households; label that as an assumption-driven result.
- Reproduce baseline volume exactly; test missing shares, valid zero shares, zero denominator and reference-year conversion.

### Revenue and cost example

Use a year with `Qdynamic=11,000`, `Qreference=10,000`, `p0=1.00`, `c0=0.80`, `p_t=1.20`, `c_t=0.90` and `v=0.20`, all in raw m³ and currency units:

| Quantity | Expected value |
|---|---:|
| Reference collected revenue | 8,000 |
| Dynamic collected revenue | 11,880 |
| Connection revenue difference at baseline rates | 800 |
| Collection cash | 1,100 |
| Tariff cash | 1,980 |
| Incremental variable operating cost | 200 |
| Connection net cash | 600 |
| Total additional net cash | 3,680 |

The total is `11,880 - 8,000 - 200 = 3,680`. With both reforms off, additional net cash is 600. With equal dynamic/reference volumes, the connection component is zero and the prior tariff/collection formula is recovered. With `v=0`, additional net cash is 3,880. Verify raw-unit and model-million-unit calculations agree.

### Integration tests

- Funded connections in year t affect revenue in t+1, not t. Unfunded target households create no revenue.
- Population growth without new billed connections leaves household dynamic volume unchanged. Do not multiply it again by population growth.
- Fixed-reference and exogenous-reference choices give the expected different cash adjustments. Frozen reference inputs are identical across BAU and scenario passes.
- Lower dynamic than reference volume gives a signed negative connection-revenue difference, with only the specified variable-cost offset.
- All tariff/collection toggle combinations and independent schedules reconcile annually.
- Check both sectors, non-household-only volume and mixed volume, multi-year feedback, scenario save/reload and unchanged exogenous-mode outputs.
- Additional net cash enters capital once. Prior funding, expansion, service-target and replacement tests still pass.
- Separate tariff/collection bands and exports reconcile to cumulative scenario outcomes. Include a case where replacement or eligible service pools limit coverage gains.

## 10. Completion report

Report changed files and schema fields, configuration and provenance requirements, migration behaviour, calibration results, the revenue example above, tests run and chart/export checks. Explain differences between BAU and scenario outcomes and between gross revenue and capital cash. Identify unresolved baseline-budget, billing-scope or NRW overlaps separately. Leave development ready for review without publishing.
