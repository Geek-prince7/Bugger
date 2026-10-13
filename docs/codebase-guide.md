# Bugger codebase guide

## Two applications

The root package is a Chrome Manifest V3 extension. `backend/` is a separate Node.js HTTP service with its own package and lockfile. The browser service worker in `src/background/` is part of Chrome; it is not the EC2 backend. Local capture, editing and export continue to work without EC2.

## Capture to saved report

1. The user activates capture from the popup. `src/background/index.ts` checks the requesting extension page and active tab, then injects the content script using the temporary `activeTab` grant.
2. `src/content/index.ts` renders a shadow-root toolbar and observation form. `src/content/capture.ts` extracts bounded structural DOM context, selection coordinates and a small computed-style whitelist. It deliberately omits page text and form values.
3. The worker captures the visible tab only after the capture UI is hidden. It checks tab/session identity before and after capture and stages the screenshot in a separate IndexedDB database.
4. Saving combines authoritative capture evidence with user-written observation fields. `src/shared/validation.ts` validates the report shape. `src/storage/repository.ts` commits the issue and screenshot together in IndexedDB.
5. `src/ui/index.tsx` manages saved issues. Edits supply the last `updatedAt` value so an older editor cannot silently overwrite a newer change.
6. `src/export/index.ts` applies one privacy projection for JSON, Markdown, PNG and ZIP. Export omission changes the export, not the saved original. Screenshot annotation uses actual bitmap/viewport scale rather than assuming device pixel ratio.

## Data stores and why they are separate

- **IndexedDB:** local reports and screenshot Blobs. Transactions enforce the current five-report trial, per-report and total local storage limits. It remains the offline source of saved captures.
- **Chrome storage:** lightweight preferences and transient session state. It is not the cloud report database.
- **PostgreSQL:** backend license-key hashes, registered installations, cloud account identifiers, report metadata, byte counts and optimistic versions. Row locks serialize device-limit, report-quota and version decisions.
- **Private S3:** screenshot bytes. PostgreSQL records the current immutable object key; the browser never receives S3 credentials.
- **Cognito:** user authentication for personal cloud reports. Its access-token subject is the owner namespace. It is separate from paid-license entitlements.

The cloud API does not accept a client-supplied owner ID. It verifies the JWT signature, issuer, client ID, token use and expiry, then uses the verified subject in every report query. Report creation expects a null version; updates and deletes expect the version the client last saw. A conflict returns 409 instead of silently overwriting newer cloud data.

## Backend modules

- `src/server.ts` loads configuration, starts the server and handles shutdown.
- `src/config.ts` validates environment variables and reads the signing key from a mounted file.
- `src/app.ts` registers routes, bounded request bodies, rate limiting, safe error responses and health checks.
- `src/licensing.ts` hashes opaque license keys with a server-held pepper and signs installation-bound ES256 entitlements. Activation serializes on the license row and permits three installations.
- `src/cloud.ts` verifies Cognito access tokens, implements owner-scoped CRUD and stores screenshot objects through an injectable object-store adapter.
- `src/db.ts` defines the PostgreSQL pool and versioned migrations. Migrations run explicitly during deployment, not on application startup.
- `src/operator.ts` supports protected license provisioning, revocation and device release. It is not a public purchasing endpoint.

Backend paths in this section are relative to `backend/`. The backend carries a copy of the extension report schema to remain independently buildable. A schema change must update and test both copies.

## Deployment boundaries

The extension is a ZIP installed by Chrome, distributed through the Chrome Web Store. The backend is a Docker image hosted on EC2 behind HTTPS. These are independent releases. EC2 configuration must supply the database, bucket, identity provider, signing key and domain. Creating a pipeline does not create those resources or make a release live.

The store workflow validates and packages a build, optionally uploads it, and can submit it for staged review. Store approval and final public publishing remain separate. See `extension-release.md` for the exact workflow inputs and secrets.

## Production work still required

The code is a tested implementation foundation, not evidence of a live production service. Before commercial launch, complete real AWS/Cognito/S3 and Chrome Store verification, billing-provider integration, extension paid-entitlement enforcement, key rotation, account deletion and retention handling, orphan-object reconciliation, backups and restore drills, monitoring/alerts, edge abuse protection, finalized privacy disclosures and the manual browser/platform release checks. Cloud access currently has no paid-license gate.
