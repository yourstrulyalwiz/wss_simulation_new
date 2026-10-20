---
name: Browser verification limitations
description: Distinguish local browser-runner failures from application failures.
---

A local Chromium/CDP startup timeout does not establish that the application is
broken. The managed screenshot browser can still render the same running app.

**Why:** The local browser helper timed out at `Target.createTarget` with both the
tools Chromium launcher and an installed Chrome executable, while managed
screenshots successfully rendered the public gallery and a simulation.

**How to apply:** Diagnose the local browser launch/transport separately from app
access control. Never bypass authentication to resolve a browser-runner failure.
Screenshots verify visible states, not clicking; use API tests for permissions and
do not describe unexecuted interaction tests as passing.
