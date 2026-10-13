# Bugger architecture and low-level design

Version 0.1, 2026-10-13. Source requirements: source-prd.md, originally named BugSnap Lite. Product and executable UI name: **Bugger**. P0 is the implementation boundary; roadmap is not a shipped feature promise.

## Components and trust boundaries

1. Extension popup authorizes activeTab and asks the MV3 worker to activate the current HTTP(S) tab. No manifest content scripts or persistent host grants exist.
2. Worker injects one bundled isolated-world content script. An isolated open Shadow DOM UI separates styles from host CSS; page DOM remains untrusted and the page can still remove/obscure the host.
3. Content controller owns transient selection and unsaved form state. It produces bounded, conservative DOM evidence on explicit capture. Structural locators deliberately avoid copying identifiers that can contain PII. This sacrifices locator durability.
4. Worker authorizes sender extension ID, top frame, tab and session. Manager-only operations reject content-script senders. A serial operation queue prevents overlapping session switches and capture/save races. Queue is not durable; callers receive failure if Chrome suspends an in-flight operation and can retry.
5. chrome.storage.session stores active tab/session identity, surviving worker restart but not browser restart. Full navigation, stop, and tab close invalidate it; SPA navigation invalidates evidence while preserving typed notes. The separate extension-owned bugger-captures IndexedDB stages one capture and its Blob. No screenshot is stored in chrome.storage or host-page IndexedDB.
6. IssueRepository owns versioned issue persistence, transactional free-report and storage limits. Domain runtime validation occurs before writes. Reports have UUIDs; exports use human-friendly date/short-ID names.
7. Extension manager loads reports, edits fields, previews privacy projection and exports entirely on-device. ExportService works on copies; omission choices affect metadata, Markdown, HTML, image inclusion, and attachment references consistently. HTML evidence is never inserted as live DOM.

## Capture sequence

Popup START_CAPTURE → worker stops previous session → HTTP(S)/restricted-page check → script injection → session persisted → START_SESSION → user chooses element/region → explicit capture → hide extension UI → two rendering frames → CAPTURE → verify active tab before/after screenshot → validate draft → stage original Blob + authoritative context → restore UI → user submits notes → SAVE_ISSUE → authorize session → merge notes with staged context → validate → transactionally save → report accessible from manager.

Screenshot failure leaves notes in the drawer. Screenshot coordinate mapping uses measured image width/viewport width and height/viewport height rather than assuming DPR equals bitmap scale. Original image is kept distinct from export annotation. Screenshots can expose any visible page data; user review and omission are mandatory usability surfaces. Pixel redaction is P1.

## Data model

See src/shared/types.ts for canonical TypeScript model; src/shared/validation.ts for runtime enforcement. schemaVersion=1; timestamps ISO UTC; boxes use CSS pixels. Environment values carry source provenance; unknowns are null/not_collected, country is manual. Console/network explicitly not_collected. Attachments describe files actually generated for the selected export.

Persisted records pair Issue with an optional Blob. Edit preserves capture evidence and original creation timestamp. Export never changes stored originals. There is no import yet; future migrations must be accompanied by backup/recovery design before bumping schema version.

## Failure and security model

No remote scripts, eval, external analytics, page-content uploads, cookies, request bodies or automatic diagnostics. activeTab, scripting and storage are the entire permission set. Sender checks do not make hostile page content trustworthy: sanitization and schema bounds remain necessary. Error messages distinguish unsupported pages, stale sessions, screenshot and storage failures. A tab switch during screenshot causes discard. SPA route or scroll changes require fresh capture.

No payment provider is configured. The trial is enforced locally; this is not DRM and a technically capable user controls their local extension. Never ship fake payment success. A future LicenseProvider must verify server-signed entitlements with bundled public keys, expiry/grace/revocation handling; private keys and checkout secrets belong only on a server.

## Deliberate tradeoffs

- Conservative snapshot excludes textual page content by default and identifiers/attributes likely to contain secrets. Source context is useful but never a full reproduction.
- Cross-origin frames, closed shadow roots and browser pages are unsupported; canvas is visual evidence only.
- User notes can contain sensitive information intentionally entered by the reporter; review them before export.
- Service-worker capture staging may survive unexpected termination; start/stop clears it and saves require a live matching session and a 30-minute lifetime.
- Paid launch requires external checkout/licensing, legal/support details, actual Chrome matrix, accessibility and store review gates listed in release-checklist.md.
