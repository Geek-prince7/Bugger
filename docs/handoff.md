# Bugger 0.1.0 handoff

Bugger is built as a local-first early-access Chrome extension. The unpacked build is in `dist/`; the installable submission-style ZIP and checksum are in `release/`. It is not yet a paid production launch.

## Implemented

- Explicit activeTab capture; one active session; stop/escape cleanup; element/region selection and keyboard alternative.
- Issue form with type, severity, status, notes, expected/actual results and manual reproduction steps.
- Optional visible-page PNG, structural CSS/XPath, geometry, bounded sanitized HTML, filtered computed styles and provenance-labelled environment/geography.
- Local IndexedDB reports and image Blobs; search, detail, edit, delete; conflict detection; safe duplicate retry; five-report trial and application byte limits.
- Original screenshot review, privacy choices, annotated image, JSON, Markdown, clipboard and ZIP export.
- Responsive React manager, country preferences, accessible native delete dialog, error feedback, isolated capture styles.
- Build, formatting/type checks, unit/browser suites, CI workflow, deterministic release packaging and permission checks.
- Architecture/LLD, nested implementation plan, data map, draft policy/listing and acceptance/release checklists.

## Verified in this workspace

33 unit tests cover snapshots, redaction, scroll geometry, UUIDs on HTTP pages, validation/provenance, repository persistence/concurrency/conflicts/limits/corruption, worker authorization and export privacy/contracts. Eight browser scenarios pass, including cold offline startup, real screenshot/ZIP output, clipboard, trial limits and screenshot failure recovery. Precise coverage and limits are recorded in acceptance-traceability.md and verification.md. Dependency audit was run after updating vulnerable test tooling; its saved output is dependency-audit.json.

## Still required for production launch

1. Decide paid merchant/licensing provider and implement/test real payment activation, signed entitlements, offline grace and refunds/revocation. Payments are visibly disabled in this build.
2. Supply owner/support information and publish reviewed privacy/license/refund terms. Check the Bugger name before store submission.
3. Complete stable Chrome Windows/macOS, real websites, screen-reader/keyboard, clipboard, disk/quota and cold offline checks. Measure activation/capture timing with target users.
4. Review deliberate snapshot omissions against the original P0 requirement and decide whether safe optional title/attribute/text capture is necessary before charging.
5. Connect the GitHub origin when supplied; run CI there; complete beta feedback and Web Store submission under the owner's account.

## Later phases

P1: pixel redaction/arrows/crop, PDF, backup/import, templates, tags/bulk actions, improved locators and explicitly opted-in diagnostics research. P2: opt-in cloud/team/guest collaboration and GitHub/Linear/Jira integrations. P3: opt-in AI assistance and verified workflow recording. None is silently enabled.

## Code reading map

`src/shared/types.ts` defines the report and messages. `src/shared/validation.ts` enforces runtime contracts. `src/background/index.ts` owns session authorization, screenshot orchestration and repository messaging. `src/content/index.ts` owns selection/draft UI; `capture.ts` contains bounded privacy-first DOM inspection. `src/storage/repository.ts` owns transactions and immutable evidence. `src/export/index.ts` owns the shared privacy projection, annotation and portable files. `src/licensing/index.ts` is explicitly trial-only. `src/ui/index.tsx` is the popup/report manager.
