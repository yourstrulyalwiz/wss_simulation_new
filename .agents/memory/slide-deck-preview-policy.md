---
name: Slide deck preview fidelity
description: Preview/download identity, temporary rendering and validation boundaries.
---

Tab 6 previews the existing branded PowerPoint, not a separately authored HTML
presentation. Its download must use the exact bytes that produced the displayed
slides. Changing inputs, currency, contribution view or borrowing selection must
invalidate both together. Use the same all-entered-area scope as Results export.

**Why:** The user requested slide-by-slide review with contents navigation and
a download option. A regenerated download could disagree with the reviewed deck.
Do not modernize deck content or redesign the template as an incidental viewer
change; that is separate from previewing the existing exporter.

**How to apply:** Render locally with an isolated temporary office profile, do
not upload scenario documents to a third-party viewer, and keep no public/shared
artifact cache. Bound rendering concurrency, duration and response size. Report
missing inputs explicitly rather than omitting invalid areas or inventing values.
LibreOffice previews can differ in fonts/layout from Microsoft PowerPoint;
identify the renderer rather than promising pixel-identical Office rendering.
