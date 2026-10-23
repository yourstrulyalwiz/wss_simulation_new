---
name: Audit confidence
description: Verification standard when automatic audits disagree with specific dependency findings.
---

For a specifically reported advisory, verify the upstream affected range and
the resolved dependency version even if the ecosystem audit returns no findings.

**Why:** A Python requirements audit returned no vulnerabilities while the
installed versions were still affected by the advisories supplied with the
request. Audit services can differ in coverage and freshness.

**How to apply:** Check every project manifest and lockfile, verify the actual
installed versions, and distinguish active advisories from withdrawn ones.
Do not equate an empty result from one service with a clean workspace.

Verify installed runtime versions after merging dependency updates, not just
the committed manifests or checks from the isolated task environment.

**Why:** A merge with no configured setup hook left the main workspace running
older affected Python packages even though the merged requirements were patched.

**How to apply:** Run the post-merge setup and installed-version regression
checks before treating the main workspace as updated. Restart the services after
the dependencies have been installed.
