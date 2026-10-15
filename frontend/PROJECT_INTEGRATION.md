# Project frontend handoff

## Build and runtime

- `npm run build --prefix frontend` produces **static/**, served by the authenticated gateway and Python SPA fallback for `/sign-in/*`, `/sign-up/*`, `/user-portal`, and `/simulations/*`.
- Existing workflows were not restarted. The server preview was still serving the old static workspace when checked; it was not the new bundle.
- The frontend resolves React and React DOM to the root installation with Vite aliases and deduplication, so root-installed Clerk and wouter share the same React instance.
- Clerk uses canonical host-derived publishable keys, unconditional proxy URL, themed sign-in/sign-up paths, and cookie transport only. The server must enforce verified identity/domain and owner/admin policies. Enterprise identity-provider configuration remains external.

## API expectations

The supplied `/api/me`, simulation CRUD/version/publication, country metadata and intentional blank initializer contract is implemented. No profile or development-preview endpoints are used by the controlled workspace.

- Normal project bundles must be frontend-shaped, including seed adapters provided by the backend. No automatic frontend Nepal-default substitution occurs.
- Return DRC Oct 12, DRC Oct 13, and Nepal Kathmandu Valley as **three distinct** read-only example cards. The gallery renders all returned examples and preserves notices.
- Calculation, projections, revenue resolution, templates and exports carry `calculation_scope`. Dormant sector data and future bundle fields remain stored. Server exports must also honor scope. Sanitation-only effective calculation requests disable the NRW link while stored configuration remains untouched.
- Legacy calculations, projections, revenue resolution and all server exports now include `x-simulation-id` while viewing a project. An ephemeral area-input marker and React context carry this ID; there is no global active-project variable. The marker is removed from request bodies and saved drafts. Table/chart exports receive the same ID explicitly from the workspace context. This is request routing metadata, not an authentication bypass; the backend still authorizes every operation.
- Publication uses a selected saved version ID. Admin actions are read-only unless `is_owner` is true.
- PATCH revision conflicts are not force-retried. Project/user-scoped recovery preserves pending drafts; explicit reload and download are offered. Setup edits use this same recovery/save path.
- Legacy browser recovery is opt-in after sign-in and does not delete old storage keys.

## Checks run

```sh
npx tsx --tsconfig frontend/tsconfig.json --test frontend/tests/project-management.test.ts
node frontend/tests/project-management-browser.mjs
npm run build --prefix frontend
git diff --check -- frontend
```

The browser checks bundle a **test-only harness in memory**, on a JSON-only same-origin page, with isolated request fixtures; the public defaults endpoint supplies its input-shape fixture (no anonymous access to the private blank endpoint is required). No authentication bypass is included in the app. Checks cover initial-load save suppression, edits arriving during an in-flight save, revision conflicts, pending recovery, read-only workflow panels, sector controls, scoped requests/project headers, transport-marker stripping and blank Rural initialization. They do not verify a real signed-in Clerk session, deployment authorization, persisted backend state, or seed numerical equivalence.

The production build reports the existing large financial-workspace chunk; that workspace is now lazy-loaded separately from landing/gallery/auth. A frontend dependency audit also reports existing transitive advisories; dependency upgrades were not mixed into this feature.
