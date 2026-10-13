# Verification record — Bugger 0.1.0

Date: 13 October 2026. Environment: macOS arm64; Node 25.2.1; Google Chrome for Testing 151.0.7922.34, isolated profiles; Playwright 1.64.0; Vitest 4.1.11. Runtime minimum is declared Chrome 120, but this does not mean Chrome 120 was tested. CI targets Node 22; CI has not run on GitHub yet.

## Commands and outcomes

- `npm ci --offline --no-audit --no-fund` — passed from the lockfile. One development-only transitive `whatwg-encoding` deprecation notice remains; no conflicting optional peer dependency remains after aligning esbuild.
- `npm run check` — passed strict TypeScript, Prettier formatting checks, 33 unit tests and production build.
- `npm run test:e2e` with `BROWSER_EXECUTABLE_PATH` set to the available Chrome for Testing executable — eight scenarios passing in isolated temporary browser profiles. The test suite grants activeTab using Chrome's real extension action through browser CDP, then invokes the activation handler from a bundled extension page; visible native popup clicking remains a manual check.
- `npm audit --json` — zero reported vulnerabilities in the final dependency graph. Saved result: dependency-audit.json. This is an advisory lookup, not a complete security audit.
- `npm run package` — passed manifest permission and distribution-file allowlist checks. Produces `release/bugger-0.1.0.zip` and SHA-256 file; repeated packaging with the same built files is deterministic.

## Browser scenarios

1. No pre-activation overlay; action-authorized capture; host click blocked; real PNG; edit; ZIP download and parsing; original pixels exclude toolbar/drawer; annotation location; privacy omissions; manager reload; confirmed deletion.
2. Region drag coordinates; screenshot-free save; stop removes UI/listeners and restores fixture button interaction.
3. Scroll invalidates stale evidence while retaining notes; restricted activation returns a clear error.
4. Five saves plus rejected sixth draft; worker stop/reload retains reports; offline JSON export.
5. Manual geography settings, focused-element keyboard shortcut, 430px viewport, SPA navigation preserves note, Escape confirmation.
6. Strict page CSP including Trusted Types still allows isolated capture controls and save.
7. Full browser shutdown/restart preserves report; cold offline manager loads; abandoned staged capture is cleared after session identity disappears.
8. Injected screenshot API failure keeps notes; capture without screenshot recovers; selector, XPath and reviewed report clipboard contents verified.

HiDPI testing emulates DPR 2. This browser's captureVisibleTab bitmap can still be 1x CSS width; pixel assertions validate scaling from actual bitmap dimensions. Physical display/zoom coverage is not inferred from this emulation.

## Unit coverage

- 15 domain tests: schema, geography provenance, limits, atomic concurrent creates, idempotent retries, stale edits, immutable captured evidence, corrupt records, injected quota rollback, retry after failed IDB open, safe ZIP paths, all 128 privacy projections, HTML safety and absent attachments.
- 9 capture tests: excluded sensitive DOM content, bounded depth/size, structural locator, URL redaction, safe styles, oversized locator fallback, viewport/document geometry.
- 8 worker tests: extension sender authorization, manager tabs, unsupported pages, session start/stop, stale/cross-frame capture rejection and unknown operations.
- 1 UUID test: RFC 4122 v4 shape and distinct values without secure-context-only randomUUID.

The desktop manager was visually inspected from a real test screenshot. See acceptance-traceability.md for gaps. No Windows test, screen-reader certification, physical low-disk test, real payment integration, Chrome Web Store submission or GitHub CI success is claimed.
