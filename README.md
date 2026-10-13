# Bugger

A local-first Chrome extension for capturing webpage observations, structural developer context and optional visible-viewport screenshots. This repository implements an early-access P0 trial, not a commercially launched product. The product name is **Bugger**; the supplied PRD used BugSnap Lite.

## Build and install

Use Node.js 22.12 or newer (prefer an LTS release) and npm.

```sh
npm ci
npm run check
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this repository's `dist` directory. Pin Bugger to the Chrome toolbar. On a regular HTTP(S) page, open Bugger and start capture. Choose an element or draw a region, capture evidence, write the observation, and save locally. Open **My Issues** to edit, review export privacy and download files.

After rebuilding, reload Bugger in `chrome://extensions` and refresh the page before starting another capture. Source repository: [Geek-prince7/Bugger](https://github.com/Geek-prince7/Bugger). Chrome Web Store publication has not been performed.

## Development and verification

```sh
npm run typecheck
npm test
npm run build
npm run fixture
npm run package
```

The fixture is served at `http://127.0.0.1:4173`. It includes scrolling, nested elements and sensitive-field examples. `npm run check` runs typechecking, unit tests and the build; it does not imply that manual or browser release checks passed.

Browser tests use `npm run test:e2e`. Install the Playwright Chromium runtime with `npx playwright install chromium` when needed. The browser harness may use an existing compatible Chromium executable through `BROWSER_EXECUTABLE_PATH=/absolute/path/to/chromium npm run test:e2e`. Extension loading support differs between browser distributions; record the exact browser and operating system used. Review the release checklist before treating any build as production ready.

## What is implemented

- Explicit activation and stop; element and rectangular-region selection.
- Issue title, type, severity, status, description, expected/actual result and reproduction steps.
- Optional visible-tab screenshot, export marker, viewport/document bounds, structural CSS/XPath locators, whitelisted computed styles and a bounded structural HTML fragment.
- Local list/search/edit/delete; immutable captured evidence during observation edits.
- JSON, Markdown, annotated PNG and ZIP exports with a shared privacy projection. ZIP metadata points to relative attachment paths that exist inside the archive.
- Five concurrently saved reports, 10 MB per report and 50 MB saved-report budget. A pending capture can occupy additional temporary space. Editing, exporting and deleting remain available at the trial limit. Browser quota can be lower.
- Transactional persistence, duplicate retry protection, stale-edit protection and validation errors.

## Important scope limits

Core capture and export work locally without a Bugger account or backend. Payments and paid license activation are **unavailable**. No real checkout, signed entitlement verification, revocation or offline license grace has been implemented. The planned commercial P0 release is blocked on these and the release checklist.

Capture deliberately omits page text, IDs, classes, arbitrary attributes, accessible names and asset URLs. Page titles are not collected. HTML is structural, depth/size bounded, and text is replaced with `[redacted]`. Export toggles cannot restore information that was never captured. Structural locators may change when the page changes; a snapshot is evidence, not a replay or automatic bug diagnosis.

Screenshots can contain personal information. Review them and your written notes before export. There is no pixel blur/redaction, full-page capture, backup import, console/network logging, cloud sync, ticketing integration or guest capture. Restricted browser/store pages and inaccessible frames/shadow content are unsupported or limited. Drafts are transient; navigation can invalidate them. Export before uninstalling or clearing browser data. Export omission changes exported files, not the saved original.

## Technical reference

- [Feature handoff](docs/handoff.md)
- [Acceptance traceability](docs/acceptance-traceability.md)
- [Verification evidence](docs/verification.md)
- [Architecture and low-level design](docs/architecture.md)
- [Implementation plan](docs/implementation-plan.md)
- [Privacy data map](docs/privacy-data-map.md)
- [Draft privacy policy](docs/privacy-policy.md)
- [Release checklist](docs/release-checklist.md)
- [Draft store listing](docs/store-listing.md)
- [Original requirements](docs/source-prd.md)

No payment secrets belong in this extension. Future licensing requires a separately configured service and verified provider integration; there is no production paid bypass or secret-key configuration in this build.

`npm run package` audits the distribution file set and permissions, then creates `release/bugger-0.1.0.zip` and its SHA-256 checksum. The ZIP contains only the built extension. GitHub Actions is configured to verify pushes and pull requests; check the repository’s Actions page for hosted results.
