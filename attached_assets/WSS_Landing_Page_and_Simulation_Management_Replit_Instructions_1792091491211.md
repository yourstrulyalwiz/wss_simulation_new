# Replit programming brief: simulation landing page, scope, saving, and access

Prepared 15 October 2026. This is an implementation specification following a source review; these changes have not been implemented or deployed.

Repository: [yourstrulyalwiz/wss_simulation_new](https://github.com/yourstrulyalwiz/wss_simulation_new). Reviewed main commit: [958f3f7112f99dcf21cfc5957dbeadd60d394f33](https://github.com/yourstrulyalwiz/wss_simulation_new/tree/958f3f7112f99dcf21cfc5957dbeadd60d394f33).

Use this alongside the separate stepwise public-spending instructions. Before implementation, compare this commit with the latest checkout and reconcile subsequent changes. Keep the existing model calculations and saved assumptions intact.

## 1. Requested outcome

Replace the automatic entry into a working simulation with a landing page that lets users:

- Find current and previous simulations through searchable cards and filters.
- Open the preserved DRC Oct 12 and Nepal examples.
- Create a simulation by choosing country, sectors, and geographic scope.
- See only the relevant inputs, interventions, results, and exports.
- Change scope later without losing previously entered data.
- Save incomplete work and resume it across sessions and devices.
- Make a saved simulation available for public viewing or keep it private.
- Sign in using a verified `@worldbankgroup.org` identity.
- Give allowlisted administrators read access to all simulations.
- Display current World Bank country region, income classification, and lending group.

Keep “simulation project” distinct from the existing comparison scenarios. A project owns its working draft, selected scope, saved versions, and comparison scenarios.

## 2. Findings from the reviewed code

| Location | Current behavior | Required change |
| --- | --- | --- |
| `frontend/src/App.tsx` | One workspace; named JSON profiles; comparison scenarios and working progress in global browser-storage keys | Separate landing/setup/workspace views; open an explicit project ID; persist project state on the server |
| `frontend/src/areaBundle.ts` | Bundles preserve primary and alternate area inputs plus geographic flags; no saved sector selection | Extend scope with selected sectors and centralize normalization |
| `frontend/src/api.ts` | `runCalculation(required)` filters response errors in the browser; it does not send sector scope | Send actual calculation scope and validate it server-side |
| `model/engine.py` | Calculates both sectors; sanitation can depend on water when the NRW link is enabled | Execute and validate selected sectors, with an explicit cross-sector dependency rule |
| `app.py` | Profile list/load/save/delete endpoints use server JSON files; no application-level owner or permission checks | Introduce persistent project storage and server-enforced access rules |
| `app.py`, `demo_adapter.py` | “Blank” starts from Nepal defaults and zeros selected sections; legacy engine and frontend input shapes coexist | Build an intentional blank initializer and a lossless legacy-import path |
| `countries.py` | Static country list | Add a cached World Bank country-metadata service |
| `frontend/src/developmentPreview.ts` and startup logic | One-time preview/profile switches can replace the working session after backing it up | Keep explicit project loading authoritative; previews must not replace an opened project |

The reviewed application code has no authentication or authorization implementation. Any hosting-level access control is separate and was not verified in this review.

Two additional risks matter for migration:

1. Adding Rural or National currently deep-copies the primary inputs. That must not silently turn urban population, costs, or service data into another area's observations.
2. Loading a bare legacy input object does not fully reset the existing workspace scope. Migration must assign explicit scope instead of inheriting whichever scope was previously open.

## 3. Preserve the existing simulations first

Create immutable source backups before migration. Import each seed idempotently using a stable source identifier and content hash; restarting the application must not duplicate seeds or overwrite user edits.

| Featured seed | Source | Required identity and preservation |
| --- | --- | --- |
| DRC — Oct 12 | `profiles/Oct 12.json` | Congo, Dem. Rep. / COD; Water + Sanitation; Urban + Rural; preserve the entire bundle, alternate Rural inputs, presentation settings, and all assumptions |
| Nepal — Kathmandu Valley | `profiles/nepal_kv.json` | Nepal / NPL; Water + Sanitation; Urban; retain Kathmandu Valley and its provider/currency information |

The DRC file identifies itself as an illustrative mock simulation, not validated DRC costing or utility data. Keep that notice on the card and in the opened project. Preserve its supplied values and existing forecasting behavior.

The Nepal file is engine-shaped, whereas the normal editor uses frontend-shaped inputs. The backend's ability to calculate both shapes does not establish that the editor can display or round-trip both. Implement and test an explicit migration adapter. Preserve the original raw payload with its source hash.

The Nepal values produced by `frontend_defaults()` are another source and are not identical in all fields to `nepal_kv.json`. Capture the existing default snapshot too; do not silently replace either dataset with the other. Feature the saved Kathmandu Valley profile, and retain the default snapshot as a labeled legacy example/version if needed.

An `Oct 13.json` DRC profile also exists and differs from Oct 12. Honor the requested Oct 12 starting card. Retain Oct 13 and other legacy profiles as archived source records; do not delete them or silently substitute Oct 13.

Make these two examples available as read-only seed simulations in the gallery. “Use as starting point” creates an owned private copy. Seed stewardship must use an explicit server-side role/account assignment, not whichever visitor first opens the page.

## 4. Landing page and setup

### Gallery

Provide a prominent **New simulation** button and sections or filters for **My simulations**, **Public simulations**, and **Archived**. Administrators additionally have **All simulations**.

Each card shows:

- Simulation name, country, and local area name where relevant.
- Water/Sanitation badges and geographic scope.
- Last saved time, forecast period, and Draft/Calculated status.
- Public/Private status and any illustrative-data notice.
- Resume for the owner, View for a permitted reader, and Version history where authorized.

Search by simulation name, country/code, and area name. Filter by country, World Bank region, income group, lending group, sector, geography, visibility, and status. Default sort: most recently saved. Keep filter controls compact.

Enforce visibility before searching, counting, paginating, or returning card metadata. Private names, owner addresses, counts, and snippets must not leak into another user's search results.

### New simulation

Collect these fields in a short setup flow:

1. **Name and country** — searchable country selector; optional area/provider label.
2. **Sectors** — Water supply, Sanitation, or both; require at least one.
3. **Geography** — Urban only, Rural only, Urban + Rural, or National.
4. **Visibility** — Private by default; Public makes an explicitly selected saved version viewable.

“Urban + Rural” preserves the existing dual-area functionality. “National” means an independently entered national dataset. A national overview aggregated from Urban + Rural is derived output, not a third input dataset to add to the other two.

Choosing a country populates identity and classification metadata. It must not silently import Nepal values, GDP series, costs, exchange rates, revenue, or service assumptions. Country selection alone does not calibrate a simulation.

Initialize new projects with blank country/area-specific assumptions, established model constants and supported forecasting configuration, and the existing blank technology catalogue. Preserve the distinction between missing data and an explicit zero. Keep intervention settings inactive until selected. Preserve existing economic/demographic projections that can run from the available data; incomplete financial calibration must not block navigation or saving a draft.

### Edit setup later

Put **Edit simulation setup** in the workspace header. Changing sector/geography scope retains excluded inputs as dormant data. Re-enabling an area or sector restores its earlier values.

For an area without prior inputs, initialize it from the blank template, copying only genuinely shared metadata such as country, currency convention, and model years. An optional explicit “Copy assumptions from another area” action must identify what will be copied; never do this automatically.

Changing the country of a populated simulation is different from changing scope. Do not relabel an existing DRC dataset as another country. Direct the user to create a new project, with deliberate copying of selected assumptions if appropriate.

## 5. Scope must govern the full application

Keep one normalized scope definition, used by setup, navigation, inputs, validation, calculations, charts, tables, imports, and exports.

For compatibility, extend the existing bundle's `scope` with a sector list, while retaining `scopeMode`, `areaUrban`, and `areaRural`. Validate legal combinations. The server derives active area keys from those flags; avoid maintaining a second independently editable area selection.

Use an enclosing storage schema version for migrations. Preserve existing bundle fields, alternate inputs, presentation settings, custom interventions, debt configuration, and future fields. Explicitly test round-tripping the proposed multi-target public-spending schedule when that feature is added.

### Visible workspace

- Hide unselected sector tabs and their input/intervention sections.
- Hide excluded area navigation and prevent direct routes from opening an excluded editable view.
- Keep shared macroeconomic/demographic inputs where relevant.
- Show the selected scope in the header, with a nearby Edit setup action.
- Use the same scope in results, comparison views, printed reports, CSV, Excel, and PowerPoint.
- Apply the same filtering to template generation and import previews. An import must not silently expand scope or overwrite dormant data.

A selected display tab is not the simulation scope. Derive the initial tab from the project's allowed sectors/areas and restore the last valid workspace location on resume.

### Backend

Pass scope into the calculation request and propagate it through input coercion, active-sector validation, revenue-base resolution, connection revenue, and engine dispatch. The existing `required` browser argument is insufficient.

Water-only projects must not need sanitation inputs or execute sanitation calculations. Sanitation-only projects must not need water inputs unless the user deliberately enables a supported water dependency. Do not weaken validation for active inputs or insert invented zeros for missing active assumptions.

For the existing water-to-sanitation NRW linkage:

- Make it unavailable in sanitation-only scope, with “Add Water supply to use this linkage.”
- In a newly created sanitation-only project, leave it off.
- If narrowing an existing dual-sector project, explain that the link becomes inactive for that scope. Preserve its saved settings as dormant, but disable it in the effective calculation configuration.
- When Water is restored, restore the configured linkage and normal dependency validation.
- With both sectors selected, preserve the current matching BAU/scenario water-to-sanitation behavior.

Scope changes must not alter the underlying financing equations, GDP-growth assumptions, pooled Vt attribution, debt rules, or the fixed BAU counterfactual. In particular, do not reallocate an excluded sector's spending to a selected sector or count Urban + Rural and a derived national total together. The separate stepwise-spending feature remains governed by its own specification.

Existing master intervention switches currently update alternate areas too. Restrict edits to their intended active areas/sectors; do not mutate dormant data merely because a global-looking control was changed.

## 6. Save progress and version history

Use a persistent database as the authoritative store; PostgreSQL is a suitable implementation choice. Confirm deployment persistence and backups in the actual hosting environment. Repository files and browser storage should not be the primary store for user work.

Suggested logical entities:

| Entity | Essential contents |
| --- | --- |
| User | Stable identity-provider subject, verified email, created/last-sign-in timestamps |
| Simulation | Stable UUID, owner ID, name, country code, visibility, status, current revision, published revision ID, created/updated/archived timestamps |
| Working draft | Complete bundle, normalized scope, schema version, country metadata snapshot, comparison scenarios, last workspace location |
| Saved version | Immutable input bundle and scope, version label/time, model version/commit, optional results snapshot and input hash |
| Country metadata cache | World Bank code/name, region, income/lending codes and labels, source URL, retrieved timestamp |

Store filtering metadata transactionally with the authoritative bundle so cards cannot describe a different scope from the actual project.

Implement:

- **Save progress** plus debounced server autosave. Show Saving, Saved with timestamp, or Could not save.
- Saving incomplete work must not require a successful model calculation.
- **Save version** for meaningful historical checkpoints; do not create hundreds of visible versions from every keystroke.
- **Restore version** as a new working revision, retaining history.
- **Duplicate** as a new private project with a new ID and owner.
- Optimistic concurrency using a revision/ETag. A stale browser must not silently overwrite newer work.
- Namespace recovery storage by verified user ID and simulation ID. Clear loaded private state on sign-out/account change.
- Offer one-time recovery/import of existing `wss_working_bundle` and `wss_demo_scenarios`; do not assume the identity of legacy browser data or discard it during migration.

Do not claim old results are reproducible merely because inputs were saved. Retain calculated-result snapshots with input hashes and the model version where historical results matter. If a legacy version has no results snapshot, label a new calculation as recalculated with the current engine.

Pending or failed autosaves must remain recoverable. Switching cards should cancel/ignore stale calculation responses and prevent a previous project's response or save from being applied to the newly opened project.

## 7. Public/private access and administrators

An email address is an identifier, not a password. Typing a valid-looking World Bank address does not prove ownership.

Prefer the organization's verified institutional sign-in if it can be configured. Otherwise use a supported authentication provider with a one-time code or magic link sent to the exact `worldbankgroup.org` mailbox. Do not create a shared password derived from an email address.

Validate the exact allowed domain after normalization; do not accept lookalike domains or an email supplied only by the browser. Use a stable verified account identity for ownership. Keep sessions and admin-role decisions on the server.

Recommended access policy:

| Action | Owner | Allowlisted admin, not owner | Other viewer |
| --- | --- | --- | --- |
| View private project and versions | Yes | Yes | No |
| Edit draft, rename, change scope/visibility | Yes | No by default | No |
| View published public version | Yes | Yes | Yes within configured public audience |
| Overwrite/delete someone else's project | No | No by default | No |
| Create an owned copy of a public version | Yes | Yes | After permitted sign-in |

The requested admin privilege is **view all**, not automatically edit/delete all. Maintain a server-configured allowlist of verified admin identities/emails; do not place it in frontend code or accept a client-supplied admin flag.

**Public audience is a deployment choice:** public can mean anonymous internet viewers or all signed-in World Bank users. Make that audience an explicit deployment setting. Use signed-in World Bank users as the initial conservative default until the intended audience is set. Public viewing remains read-only either way.

Keep working drafts and publication separate. Switching to Public publishes a selected saved version; later autosaves remain drafts until **Update public version**. Public readers see that version's selected scope and permitted results/inputs, not the owner's unpublished revisions or dormant excluded datasets. Switching to Private removes public access to the published record.

Apply the policy to list/search, detail, versions, calculation/result retrieval, copies, and every export route. Do not rely on hidden buttons or unguessable IDs. Scope is a model configuration, not an ownership boundary.

Retire or protect the old `/api/profiles` read/write/delete routes so they cannot bypass the new permissions. Keep new private data out of Git, static frontend assets, and public seed JSON. Set private-response caching and session protections appropriately; restrict credentialed cross-origin access to the actual frontend origin.

## 8. Verified World Bank country metadata API

Use the World Bank **Indicators API v2 country endpoint**, which also underpins WDI access, for this first release. The official documentation describes country region, income level, and lending type, and the API does not require an API key.

Verified live on 15 October 2026:

- All records: https://api.worldbank.org/v2/country?format=json&per_page=400
- DRC: https://api.worldbank.org/v2/country/COD?format=json
- Nepal: https://api.worldbank.org/v2/country/NPL?format=json

| Country | API code | Region returned | Income level returned | Lending type returned |
| --- | --- | --- | --- | --- |
| Congo, Dem. Rep. | COD | Sub-Saharan Africa | Low income | IDA |
| Nepal | NPL | South Asia | Lower middle income | IDA |

Mapping:

| Application field | Response field |
| --- | --- |
| Stable World Bank country code | `id` |
| Country name | `name` |
| Two-letter code | `iso2Code` |
| Statistical region | `region.id`, `region.value` |
| Income classification | `incomeLevel.id`, `incomeLevel.value` |
| Lending group | `lendingType.id`, `lendingType.value` |

Implementation rules:

1. Fetch server-side; parse the response as a pagination object followed by a record array. Follow the reported number of pages rather than assuming the current record count.
2. Exclude aggregate records from the country picker. Observed aggregate records have `region.id == "NA"` and `region.value == "Aggregates"`. Three-letter IDs alone do not identify countries.
3. Trim labels and retain both codes and labels. Display missing classifications as unavailable instead of inventing them.
4. Cache successful responses, refresh periodically, and keep the last successful data if the API is unavailable. Show its retrieval date. Country metadata outages must not prevent opening saved simulations.
5. Use current metadata for country selection/gallery filtering, but store the metadata snapshot used by each saved version. Do not rewrite historical simulation assumptions when classifications change.
6. Record a classification vintage only if the source supplies or independently verifies it; retrieval time alone is not an effective classification date.
7. Keep currency mapping separate: this endpoint does not supply the simulation's currency or exchange-rate assumptions.

**Region distinction:** this endpoint returns statistical regions, such as Sub-Saharan Africa for DRC. Its `adminregion` field does not supply an AFE/AFW operational-region assignment. If operational regions are needed, add a separately verified, dated World Bank operational-region mapping. Do not label the statistical field “AFE/AFW region” or infer membership from the existence of aggregate records.

Data360 was also investigated, but an equivalent country-classification endpoint was not verified in this review. Its public API information page was not fully accessible from the review environment. There is no need to block this feature on Data360: the v2 country endpoint directly supplies the requested first-release fields. Evaluate Data360 separately if broader indicator imports are added.

Authoritative references:

- [Country API Queries](https://datahelpdesk.worldbank.org/knowledgebase/articles/898590-country-api-queries)
- [API Basic Call Structures](https://datahelpdesk.worldbank.org/knowledgebase/articles/898581-api-basic-call-structures)
- [Indicators API documentation](https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation)
- [World Bank country and lending groups](https://datahelpdesk.worldbank.org/knowledgebase/articles/906519-world-bank-country-and-lending-groups)

## 9. Implementation sequence and code ownership

These are proposed modules/routes, not existing features.

1. **Back up and characterize legacy data.** Record source hashes and baseline outputs for the two seeds. Preserve browser recovery data. Build schema migrations and verify engine-to-editor conversion for Nepal.
2. **Add project persistence and identity.** Implement authenticated simulation CRUD, read permissions, revisions, immutable versions, and the country cache. Replace filename-based identity with UUIDs.
3. **Build the gallery and setup.** Separate the project workspace from `App.tsx`; introduce gallery/setup components and routes such as `/`, `/simulations/new`, and `/simulations/:id`. Existing SPA fallback can support these paths.
4. **Apply scope throughout the model pipeline.** Extend `areaBundle.ts`, `api.ts`, input/intervention/result components, `demo_adapter.py`, `model/inputs.py`, `model/engine.py`, revenue preparation, and export entry points. Keep the numerical model unchanged for equivalent selected inputs.
5. **Connect save/resume/history and public viewing.** Replace global session ownership with project state; add publication controls and read-only views.
6. **Migrate seeds and release.** Run idempotent import, confirm persistent storage after restart/redeployment, and retain a rollback path.

Suggested service routes include:

- `GET /api/simulations` — authorized, filtered, paginated card metadata.
- `POST /api/simulations` — create an owned draft.
- `GET/PATCH /api/simulations/{id}` — authorized read/update with revision checking.
- `GET/POST /api/simulations/{id}/versions` — permitted history/create checkpoint.
- `POST /api/simulations/{id}/publish` — owner selects a saved version for public view.
- Simulation-specific calculation/export routes that resolve the permitted draft or published version.
- `GET /api/countries` — cached country metadata, with compatibility handling for existing consumers.

Keep auth, database access, country fetching, and migrations in separate backend modules rather than enlarging `app.py` into a single service implementation. Update frontend consumers together if the country endpoint changes shape.

## 10. Acceptance checks

The change is complete only when these outcomes are demonstrated:

1. Both featured seeds retain their source inputs, geography, assumptions, and labels. Equivalent migrated inputs reproduce the pre-change outputs within the model's existing numerical tolerances.
2. Oct 12 remains the featured DRC version; Oct 13 and raw legacy sources remain recoverable.
3. Nepal opens as Kathmandu Valley Urban with correct editable values; round-tripping does not substitute frontend defaults or relabel it National.
4. Water-only and sanitation-only projects work without unrelated sector validation errors. Selected sectors still report their own missing data.
5. The sanitation NRW dependency is explicit and behaves correctly when narrowing and restoring scope.
6. Deselecting and restoring a sector/area restores its values exactly. Adding Rural/National does not fabricate area-specific observations.
7. Inputs, interventions, charts, comparisons, imports, and all exports use the same scope.
8. A partially completed draft survives logout/login on another browser and a server restart. Failed saves and concurrent edits cannot silently lose work.
9. Public readers cannot edit, access private projects by ID, retrieve unpublished history, or use old profile/export routes to bypass access checks. An allowlisted verified admin can view all; a forged email or admin flag grants nothing.
10. Private gallery metadata is excluded before filtering/counts/pagination. Publication and switching back to Private have the documented effect.
11. Country metadata survives API downtime using a dated cache; aggregates never appear as countries; stored historical snapshots remain intact.
12. Existing BAU/scenario separation, pooled Vt, attribution, debt, GDP scaling, and saved interventions remain unchanged for equivalent scope. The separate multi-target spending fields survive saving, restoring, copying, and exporting when implemented.
13. Opening a project does not trigger a development-preview switch. Late saves/calculations from another project do not overwrite the current one.

Use the existing backend and browser test patterns for these regression checks. Add focused tests for persistence/access/scope behavior; do not redesign the financial model as part of this work.

