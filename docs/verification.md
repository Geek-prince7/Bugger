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

## Backend, cloud and deployment verification — 2026-10-13

The extension and release/deployment unit suite now has **90 passing tests**. This includes the original capture/storage/export checks, cloud PKCE and JWT validation, report privacy and conflict handling, account-switch protection, build configuration, report-schema parity, Chrome Store API mocks and SSM deployment mocks. The actual deployment Bash state machine is exercised with mocked external commands for successful rollout, candidate failure and restoration of the previous container after production failure. These tests do not constitute a real EC2 rollback drill.

Backend checks: TypeScript build and **7 unit tests pass** (including signed entitlements, access-token validation, disabled-cloud behavior, limits and proxy trust). **3 integration tests pass against a real isolated PostgreSQL 16 container**: migration concurrency, device limits and revocation; account isolation, version races and image round-trip through an in-memory object adapter; concurrent report-count quota and object-upload failure rollback. Cognito and S3 themselves were not contacted.

The **8 local-extension browser scenarios pass** on the existing macOS Chrome for Testing 151 runtime. A clipboard assertion initially raced the asynchronous write; it now polls the actual clipboard result. The full rerun passed. These browser scenarios exercise the default local-only build; live hosted sign-in remains a deployment acceptance item.

Both local-only and example cloud-configured extension packages were built and passed package validation. The final local release ZIP is local-only; SHA-256 `fae08762435a5f25b4f06fbd5e34172172bea41babcd6309c716fbb127afddef`. Root lint/typecheck/build pass. Workflow YAML and IAM JSON parse; Bash syntax passes.

The final backend Docker image builds using Node 22. Its production dependency audit during the build reports zero known vulnerabilities. A local smoke run uses UID 1000, a read-only filesystem, dropped capabilities, temporary test-only signing material and the isolated PostgreSQL database; readiness and revision endpoints respond successfully. This does not validate EC2 network rules, RDS TLS, instance IAM, Cognito callbacks, S3 policies or public DNS/TLS.

No AWS resources were provisioned, no real payment processed, and no store upload or public release occurred. Configure and execute the documented live acceptance checks before calling the product production-ready. Pending commercial and operational items are enumerated in `implementation-plan.md`, `codebase-guide.md` and the deployment guides.

### Clean-checkout correction — 2026-10-14

Hosted CI exposed a missing direct `@types/node` dependency that the original workstation resolved from its surrounding environment. The root package now declares Node 22 types explicitly and includes them in TypeScript's configured types. A separate clean copy under `/private/tmp` passed `npm ci --offline` and the full `npm run check` (90 tests, formatting, typecheck and build). Backend CI now also watches root dependency/configuration changes and checks shared-schema parity. Hosted CI results must be checked against the corrected commit, not the earlier failed run.
