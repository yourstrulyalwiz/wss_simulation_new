---
name: Stale preview state
description: Distinguish retained browser preview state from missing Git changes without deleting saved work.
---
When a preview differs from a fresh screenshot, do not assume missing Git changes or clear browser storage. First compare the exact preview endpoint and its served assets with the current build.

**Why:** On 2026-10-04, the user's preview retained the old interface despite matching the development endpoint, current served assets, server restarts, and ordinary refresh attempts. The user confirmed that loading the same endpoint with a new query string displayed the updated app, but later reported that reloading the whole workspace restored the old interface. The precise browser/proxy caching layer was not identified.

**How to apply:** If the exact endpoint serves the correct assets but the user's preview remains old, use a fresh URL query to distinguish retained preview state from a build problem. Treat that as a diagnostic workaround, not a permanent fix: check full-workspace reload behavior before claiming resolution. Preserve localStorage and saved inputs; a successful fresh URL does not justify Git resets or speculative UI rewrites. Cache-only invalidation depends on browser support, so a successful agent-browser check does not establish that the user's browser honored it.