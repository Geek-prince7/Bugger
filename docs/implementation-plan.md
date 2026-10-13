# Implementation milestones

## 1. Foundation

- 1.1 Create independent bugger folder and preserve original PRD.
- 1.2 Rename executable product, UI and package to Bugger.
- 1.3 Define versioned Issue/selection/environment/attachment contracts.
- 1.4 Runtime validate cross-context and persisted data.
- 1.5 Bundle MV3 worker, isolated injected script and React extension pages; lock dependencies.

## 2. Capture engine

- 2.1 Explicit activation: permission, supported URL check, one-session identity, badge, cleanup.
- 2.2 Element selection: hover geometry, block click-through, structural CSS/XPath, document versus viewport bounds.
- 2.3 Region: normalize drag direction, cancel/retry and keyboard alternative.
- 2.4 Snapshot: bounded depth/bytes, secret form exclusion, computed-style whitelist, provenance.
- 2.5 Screenshot: hide UI, paint wait, active-tab verification, original Blob, deterministic export marker.
- 2.6 Drawer: validated fields, draft retention, recapture when geometry/navigation changes.

## 3. Local reports

- 3.1 IndexedDB schema and transaction boundary.
- 3.2 Atomic trial/storage limits and actionable quota errors.
- 3.3 Search/list/details; controlled edit and confirmed deletion.
- 3.4 Privacy projection shared by all formats; accurate attachments.
- 3.5 Markdown, JSON, image and portable ZIP; no account/network required.

## 4. Verification and hardening

- 4.1 Unit fixtures for sanitizer, geometry, schema, projection, ZIP, repository and limits.
- 4.2 Browser integration fixtures for selection, persistence, export and permission boundaries.
- 4.3 Build/package permission and CSP audit, keyboard/responsive checks.
- 4.4 Acceptance traceability with precise passed/not-run/blocked state.

## 5. Commercial release gates

- 5.1 Choose merchant/license provider and refund/device policies with owner.
- 5.2 Implement real server verification, offline grace and revocation; integration tests with test purchaser.
- 5.3 Supply support/legal identity, publish policy; name/trademark checks.
- 5.4 Windows/macOS current stable Chrome QA and target-user beta.
- 5.5 Store screenshots/listing review, sign off and submit under owner's account.

## Later phases

P1: pixel blur/redaction, annotation arrows, PDF, backup/import, templates/tags/bulk actions, opt-in diagnostic research. P2: opt-in cloud, guest feedback and ticketing integrations. P3: opt-in AI assistance and verified workflow recording. None are enabled or promised by this build.

## Backend and cloud expansion — October 2026

This scope was explicitly added after the original local-first PRD. It does not retroactively make optional cloud features a requirement for local capture.

1. Identity and transport
   - Configure a Cognito public client and exact Chrome redirect URL.
   - Implement authorization-code PKCE, redirect/state validation and signed access-token verification.
   - Keep browser credentials in session storage; request only the configured optional origins.
   - Bind each cloud operation and version record to a single authenticated account snapshot.
2. Personal report persistence
   - Add PostgreSQL account/report migrations and owner-scoped queries.
   - Add private immutable screenshot objects in S3.
   - Serialize quota/version checks and return explicit conflicts.
   - Add explicit upload privacy review, remote listing, copy-download and remote delete.
   - Preserve local offline capture and local quota enforcement.
3. Licensing foundation
   - HMAC-hash license keys; operator-only provisioning/revocation.
   - Serialize the three-installation limit.
   - Issue installation-bound signed entitlements with bounded offline validity.
   - Pending: payment-provider adapter, purchase reconciliation, extension enforcement and signing-key rotation.
4. Delivery
   - Build/test backend and extension separately.
   - Pass the tested backend image artifact to the deployment job.
   - Use GitHub OIDC, ECR digests and SSM for EC2 deployment.
   - Check candidate health/revision before switching; restore the previous container after a failed production startup.
   - Package/store upload/staged review are distinct extension release actions.
5. Production acceptance still requiring real configured services
   - AWS IAM/network/TLS validation and Cognito/S3 end-to-end sign-in and report tests.
   - Real EC2 rollout and rollback drill; database/S3 backup and restore drill.
   - Cloud account deletion, orphan-object reconciliation and retention policy.
   - Monitoring, alerting, edge rate limits and operational ownership.
   - Chrome Store registration, privacy declarations, review and manual cross-platform browser checks.

Detailed code responsibilities are in `codebase-guide.md`; deployment settings are in `backend-deployment.md`, `cloud-sync.md` and `extension-release.md`. No live infrastructure or store publication is implied by the checked-in workflows.
