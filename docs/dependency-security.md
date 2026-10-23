# Dependency security verification

Checked on 2026-10-23. Scope: the 38 reported dependency findings.

## Inventory

A filesystem walk with dependency, VCS, cache and build directories pruned found:

| Directory | Manifest | Lockfile | Package manager |
| --- | --- | --- | --- |
| root | package.json | package-lock.json | npm |
| frontend | package.json | package-lock.json | npm |
| artifacts/mockup-sandbox | package.json | package-lock.json | npm |
| tools | package.json | package-lock.json | npm |
| root | requirements.txt | none | pip |

`npm audit fix` was attempted separately in all four npm directories.
The root and frontend encountered an npm 10 optional-peer-resolution crash;
running the lockfile fix with npm 11 succeeded. Clean `npm ci` installs also
succeeded. `pip-audit -r requirements.txt --fix` returned no findings even before
the Python upgrades, so its negative result was not treated as sufficient:
the affected Python packages were upgraded using upstream advisory information.

## Resolved versions

- Root and frontend: Vite 8.3.5, PostCSS 8.5.31, Nano ID 3.3.20,
  source-map-js 1.2.2.
- Sandbox: Vite 8.3.5, source-map-js 1.2.2. Replaced fast-glob with
  tinyglobby to remove its braces dependency; discovery has a regression test.
  Also upgraded Zod and its form resolver to clear the sandbox's remaining audit.
- Python: FastAPI 0.162.0, Starlette 1.9.0, python-multipart 0.0.32.
  FastAPI was upgraded because the old release constrained Starlette to an
  affected version. Starlette is explicitly pinned to prevent reintroducing it.

Each npm project reports zero audit findings. Python dependency compatibility
checks pass. A workspace dependency scan returned none of the original 38 IDs
or the affected package/version findings. That workspace scan also returned
other findings outside this task's scope; this is not a claim that the entire
workspace has no security findings.

## Withdrawn braces advisory

[GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
was withdrawn on 2026-10-23 at 12:53:02 UTC:

> This advisory has been withdrawn because it's not a practically exploitable vulnerability.

No patched braces version exists. The root lockfile still includes braces 3.0.3
through http-proxy-middleware → micromatch. The latest proxy release also depends
on micromatch, so upgrading that parent would not remove it.

The proxy's micromatch call processes configured glob path filters, not
request-supplied patterns. Both application proxy instances omit `pathFilter`
and use its default literal `/` prefix; Clerk's path rewrite is a separate
fixed regular expression. Thus the reported recursive-pattern path is not
reachable from requests in this application. Retaining this withdrawn,
unreachable dependency avoids a security-sensitive authentication-proxy rewrite.
There are no remaining active listed vulnerable pins; braces is the explicit
exception to the original request to remove every listed version string.

## Verification

- Main frontend production build, including TypeScript checking.
- Sandbox production build, including TypeScript checking. Vite 7 stalled
  during verification, so the sandbox was aligned with the patched Vite 8 used
  by the main frontend; its existing plugin versions support Vite 8.
- Python unit/integration suite, including public/private access boundaries.
- TypeScript authentication and project-management tests.
- Sandbox typecheck and preview-discovery regression test.
- Restarted both workflows; checked main-page/API responses and public UI.
- Repeated the pruned manifest walk and checked every discovered manifest and
  lockfile for the reported vulnerable versions, with only the withdrawn braces
  exception above.

Signed-in UI was not visually verified; authenticated behavior was checked by
the automated access-boundary tests without disabling authentication.
