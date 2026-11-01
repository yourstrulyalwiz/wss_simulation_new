---
name: Stale preview state
description: Distinguish retained browser preview state from missing Git changes without deleting saved work.
---
When a preview differs from a fresh screenshot, do not assume missing Git changes or clear browser storage. First compare the exact preview endpoint and its served assets with the current build.

A failed workflow can coexist with surviving processes from an earlier run. Check port ownership before restarting when startup reports an occupied port.

**Why:** Both preview workflows reported failure while earlier processes still held their service ports. The simulation gateway had stopped accepting requests even though its backend remained alive; restarting without clearing the verified leftovers would reproduce the conflicts.

**How to apply:** Identify the exact processes and their parent/child relationships, stop only the confirmed leftover application processes, then restart the existing managed workflows. Verify both the external page and a JSON backend endpoint. Do not create replacement workflows or indiscriminately kill unrelated processes.

**Why:** On 2026-10-04, the user's preview retained the old interface despite matching the development endpoint, current served assets, server restarts, and ordinary refresh attempts. The user confirmed that loading the same endpoint with a new query string displayed the updated app, but later reported that reloading the whole workspace restored the old interface. They subsequently reported that it worked after cache-only invalidation was introduced, without establishing which action resolved it or whether future workspace reloads remained correct. The precise browser/proxy caching layer was not identified.

**How to apply:** If the exact endpoint serves the correct assets but the user's preview remains old, use a fresh URL query to distinguish retained preview state from a build problem. Treat that as a diagnostic workaround, not a permanent fix: check full-workspace reload behavior before claiming resolution. Preserve localStorage and saved inputs; a successful fresh URL does not justify Git resets or speculative UI rewrites. Cache-only invalidation depends on browser support, so a successful agent-browser check does not establish that the user's browser honored it.

Verify the actual served bundle after delegated frontend work; a helper's
successful build is not proof that the main app's served assets were updated.

**Why:** A helper-reported build left the main app serving its previous
interface while its API already implemented the new behavior. A fresh isolated
browser confirmed it was old served code, not retained user-browser state.

**How to apply:** Compare the entry page's actual asset references with the
intended build and run the project's normal frontend build in the main workspace
when they differ. Check the live UI before diagnosing a proxy-cache problem.
Keep saved profiles and browser inputs intact.

After a Git pull, verify the running entry point and installed dependencies separately
from the branch and static build. A matching Git revision does not establish that
the workspace is running that revision's server or has its authentication configured.

**Why:** An imported workspace retained the older Python-only process after the
project moved to an authentication gateway. Restarting exposed missing declared
dependencies and missing Clerk configuration; Git synchronization alone did not
make the new application runnable.

**How to apply:** Inspect the actual process and startup logs, install declared
dependencies, and resolve workspace-specific authentication setup without bypassing
auth or replacing the database. Preserve saved work and distinguish successful
source synchronization from verified runtime startup.

A gateway opening its public port does not establish that its Python child is
ready. Verify the child's startup completion and real JSON service responses,
not just the landing page or the workflow's initial ready status.

**Why:** Missing Python database dependencies and an unapplied development schema
caused the backend to exit after the gateway had opened its port. An older
Python-only server also returned HTML with status 200 for newer API routes,
which had been converted to an empty object and caused a misleading frontend
undefined-length crash.

**How to apply:** Check the example-list response structure and private-route
authentication after environment reconciliation. Treat unexpected HTML as a
service error rather than empty JSON. Resolve missing development tables using
the existing schema without startup-time DDL, data resets, or authentication
bypasses.