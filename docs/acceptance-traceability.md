# Bugger acceptance traceability

Baseline: 0.1.0, 13 October 2026. “Automated” describes the listed fixture coverage, not universal browser/site certification. Test source is the executable evidence. Commercial P0 is not complete.

- **AC-01 — Automated + manifest inspection.** No content script before activation; no persistent content_scripts or host_permissions. Browser test checks absent overlay before activation. No network surveillance APIs exist.
- **AC-02 — Automated.** Real Chrome action grants activeTab; activation handler injects the overlay; Stop removes it and host button interaction resumes. Native visible toolbar interaction still needs manual stable-Chrome checks.
- **AC-03 — Automated.** Element selection blocks fixture button click-through; structural selector unit test resolves the intended nested/sibling element. CSS, XPath and bounds are present. Dynamic locator durability is explicitly not guaranteed.
- **AC-04 — Automated.** Nonzero scroll geometry unit test verifies viewport (20,30) maps to document (35,630) at scroll (15,600). Browser scroll invalidates old evidence without losing title.
- **AC-05 — Automated, limited.** Browser drag yields exact CSS rectangle (100,200,200,150). Shared screenshot annotation is checked at emulated DPR 2 using actual bitmap/viewport ratio. Broader physical monitor/zoom matrix is pending.
- **AC-06 — Automated.** Save, manager reload, repository reopen, worker-stop/reload and a full browser restart retain records.
- **AC-07 — Automated schema; manual native validation pending.** Empty/short title and malformed records rejected by runtime schema; required/min/max browser form controls implemented.
- **AC-08 — Automated.** PNG persists and appears in manager. Pixel checks at toolbar/drawer locations confirm original image has page background; annotated marker pixel is red. Actual capture bitmap scale may differ from emulated DPR; implementation uses measured scale.
- **AC-09 — Automated, limited.** Browser clipboard checks verify selector, XPath and reviewed report copies from the manager. Bounds copy is implemented. Native permission-prompt behavior still needs manual checks; HTTP page clipboard can be unavailable and errors are surfaced.
- **AC-10 — Automated.** Downloaded ZIP opens with JSZip; actual image filenames match metadata relative attachment paths. Standalone exports have no phantom attachment references.
- **AC-11 — Automated representative combinations.** Shared projection removes omitted data across formats; ZIP omission removes screenshots/HTML and URL. Structural HTML safety and derivative locator privacy unit tests pass. All 128 privacy projection toggle combinations pass schema and omission-invariant tests; varied real-page export review remains pending.
- **AC-12 — Automated.** Form values, hidden/contenteditable data, scripts, text and attributes removed from DOM fixtures; sensitive URL paths and computed-style names filtered. Screenshots intentionally retain visible page pixels and require review.
- **AC-13 — Partial.** Restricted-page rejection and strict page CSP fixture pass. Frames/closed shadow internals are unsupported; full cross-origin frame UX validation remains pending.
- **AC-14 — Automated, limited.** Browser sends worker-stop command and successfully reloads manager with saved records; repository reopen tests persist data. Crash during a write/capture and browser shutdown recovery require additional fault injection/manual checks.
- **AC-15 — Partial.** Domain tests cover oversized reports, corrupted records, injected quota failure with transaction rollback, and retry after database-open failure. Real disk exhaustion/browser quota rejection and recovery on Windows/macOS remain pending.
- **AC-16 — Partial.** Offline export and manager access after a full browser restart pass. All core code is local. License offline grace is unavailable because no paid provider is configured. A broader offline capture/site matrix remains a manual gate.
- **AC-17 — Automated.** Five reports save; sixth fails with explicit trial message and retains typed draft. Existing reports remain accessible/exportable. Concurrent repository saves also enforce limit.
- **AC-18 — Blocked.** No paid activation, invalid/refunded license verification or real checkout. No reports are deleted by trial state. Provider integration is required before charging.
- **AC-19 — Partial automated.** Keyboard focused-element shortcut, form focus, Esc draft confirmation and native modal exist. Complete keyboard-only, screen-reader and clipboard pass remains pending.
- **AC-20 — Automated fixture.** 430px viewport keyboard capture works. Visual review performed for desktop manager. Physical narrow-display/browser zoom checks remain pending.
- **AC-21 — Automated fixture.** SPA route change invalidates evidence while preserving notes; no stale save. Representative public-site matrix and complex animated layouts remain pending.
- **AC-22 — Automated.** Screenshot-free report shows no image; exports contain no screenshot files or attachment claims.

## Product deviations and remaining P0 work

The implementation deliberately collects structural HTML/locators rather than the PRD's broader text/attribute/ID/class snapshot. Page title, text excerpt, accessible names and asset references are not collected. No automatic claim is made that this meets the broader snapshot acceptance without product sign-off. Text/attribute/asset toggles do not restore uncollected data.

Paid checkout/licensing, refund/revocation and grace verification are release blockers, not completed mock integrations. A save-and-review shortcut opens the issue manager rather than immediately downloading unchecked evidence. Screenshot compression/resampling is not offered; PNGs above the application cap receive a retry-without-image error. Individual stored fields cannot be permanently redacted yet; deleting the whole report removes it. Screenshot blur/crop remains P1.

Release decisions must also use release-checklist.md. Automated coverage does not establish legal approval, store acceptance, accessibility certification, performance targets or market readiness.
