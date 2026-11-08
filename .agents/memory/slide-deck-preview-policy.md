---
name: Slide deck preview fidelity
description: Preview/download identity, temporary rendering and validation boundaries.
---

The Slide Deck tab previews the existing branded PowerPoint, not a separately authored HTML
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
missing inputs explicitly. The user subsequently authorized PPT-only omission of
incomplete sections: omit the affected area/sector scenario and its dependent
National block, not just an individual intervention from an otherwise relabeled
scenario. Show omitted sections and reasons both in the viewer and in the deck.
Replace the cross-sector executive summary with an explicit completed-scope
summary. If nothing is complete, return a clear error.

**Why:** The user wants presentations for completed work without filling every
active intervention first; unchanged scenario assumptions and honest National
coverage remain essential. This permission does not relax model/UI validation.

LibreOffice previews can differ in fonts/layout from Microsoft PowerPoint;
identify the renderer rather than promising pixel-identical Office rendering.

Large preview responses must remain streamed through the serving gateway.

**Why:** Real decks can produce JSON responses above 32 MiB. Cloud Run's HTTP/1
non-streamed response ceiling is 32 MiB; its documented exception is streaming
or chunked transfer. Successful generation and an application-side HTTP 200 do
not establish that the complete preview reached the browser.

**How to apply:** Preserve streaming when changing serialization or proxies.
Verify large-response delivery in a browser, not just successful rendering.
Avoid string-to-array conversions that allocate an intermediate JavaScript
collection for every byte of a large PowerPoint.
