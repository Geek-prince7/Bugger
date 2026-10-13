# Bugger release checklist

This is a release gate, not a record of completed testing. See actual test output and the acceptance traceability document for evidence. Version 0.1.0 is an early-access local trial; do not label it commercially production-ready yet.

## Commercial and publication blockers

- [ ] Decide whether first public release is explicitly a free five-report trial or completes the PRD's paid P0. Do not advertise purchase availability in the current build.
- [ ] For paid release: configure checkout/licensing provider and backend; verify signed entitlement activation, expiry/grace, refund/revocation, offline behavior and real test-purchase flow. No private keys in extension bundles. Define device limits and support recovery.
- [ ] Set legal owner, public support channel, policy URL, refund/license terms and retention practices; review policy against actual behavior. Remove every publication placeholder.
- [ ] Check product name/trademark and store availability; provide original screenshots/demo assets and accurate limitations. No universal compatibility or automatic bug-detection claims.
- [ ] Publish privacy policy and complete store data-use/permission disclosures. Submit only with owner authorization and developer-account access; submission is not done by building a ZIP.

## Engineering and security gates

- [x] Clean lockfile install, typecheck/formatting, 33 unit tests, build and dependency advisory check completed locally. Evidence in verification.md; full independent security review remains optional additional assurance.
- [ ] Run extension browser tests on supported Chromium; document any skipped/unsupported tests. Verify current stable Chrome on macOS and Windows manually.
- [ ] Exercise activation/no pre-activation collection, stop cleanup, selection without click-through, scroll/zoom/HiDPI/region alignment, overlays absent from originals, navigation invalidation and service-worker restart.
- [ ] Exercise five-report concurrent boundary, idempotent retries, stale edits, immutable evidence, 10 MB and 50 MB limits, real quota failure, malformed/corrupted storage and recovery messaging. Browser eviction/low-disk behavior requires real-browser checks.
- [ ] Verify every export format and privacy switch combination, ZIP attachment paths/content, screenshot omission and HTML safety. Review notes/URL paths as residual sensitivity. Check generated image pixels and marker placement.
- [ ] Verify offline creation/export and no outbound product traffic. Test unsupported pages, frames, shadow content, SVG/canvas and representative permitted public sites.
- [ ] Complete keyboard-only and screen-reader checks, visible focus, modal cancellation, reduced motion, narrow viewport and error announcements. Measure capture speed/activation performance; do not assume targets are achieved.
- [x] Package allowlist and permissions audit: MV3, bundled icons/scripts, no host_permissions/content_scripts, no test fixtures/source maps. Browser suite loads dist. Native stable-Chrome release inspection remains part of the manual browser gate.
- [x] Versioned ZIP and SHA-256 checksum produced with local test evidence. Git source revision/remote and distribution rollback process still require release setup. No unknown-schema import is implemented.

## Explicitly deferred

P1: pixel annotation/redaction/crop, PDF, templates/tags/batch operations, backup import, better locators, consent-based diagnostics and optional coarse geo lookup. P2: opt-in cloud/team/guest collaboration and ticketing integrations. P3: AI assistance and verified workflow recording. These are proposals, not customer commitments.
