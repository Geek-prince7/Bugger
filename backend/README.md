# Bugger licensing and personal cloud API

Node 22 / PostgreSQL 16 service for licensing and opt-in personal report storage. PostgreSQL holds license records, report metadata and versions; a private S3 bucket holds screenshots. Cognito access tokens identify cloud report owners. **No payment adapter, automatic purchase fulfillment, extension-side paid integration or real cloud deployment is completed by this code.** Operator provisioning is an authenticated infrastructure operation, not proof of payment. Never expose it as a public endpoint.

## Run

`npm ci && npm run build && npm test`. Set environment from `.env.example` (the application does not automatically load dotenv), then `npm run migrate` explicitly, followed by `npm start`. `npm run test:integration` requires `DATABASE_URL` to a dedicated PostgreSQL test database and must not run against production. Migration obtains a transaction-scoped advisory lock, rejects unknown versions and atomically applies versions 1 and 2. Start never runs migrations.

Generate an ES256 PKCS8 signing key outside the repository using `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out signing-private.pem`. Mount read-only as `SIGNING_KEY_FILE`; allow container UID 1000 to read it without making it world-readable. Set a random pepper of at least 32 bytes (for example `openssl rand -hex 32`). Retain secure backups: changing pepper invalidates lookup of existing license keys. No key material is committed. Environment is supplied by the deployment layer; S3 uses the AWS SDK default credential chain with the EC2 instance role in production. Optional `DATABASE_CA_FILE` enables validated PostgreSQL TLS; use a hostname matching the server certificate and avoid conflicting SSL query parameters in `DATABASE_URL`.

Docker: build with `docker build --platform linux/amd64 -t bugger-api .`. Runtime is non-root Node 22 and readiness healthchecked. Supply `--env-file` and mount secrets at `/run/secrets:ro`. Port defaults to 3000; HOST defaults to 0.0.0.0. Do not expose PostgreSQL publicly. Termination closes HTTP and DB connections. Run `npm run migrate` in the same image as a distinct deployment step before routing traffic.

## HTTP contract

- `GET /healthz`: process alive. `GET /readyz`: schema version 2 query succeeds (503 otherwise). `GET /version`: app version and `GIT_SHA`.
- `GET /v1/licenses/public-key`: public JWKS with configured `kid`; private material is never returned.
- `POST /v1/licenses/activate`: `{licenseKey, installationId: UUID, extensionVersion: "0.1.0"}`. Returns active, lifetime_local plan, entitlementToken, validatedAt, nextCheckAt and offlineGraceUntil. License lookup uses keyed HMAC-SHA256, never raw-key persistence. A per-license row lock serializes device registrations: at most three distinct installations, repeated activation is idempotent.
- `POST /v1/licenses/status`: `{installationId: UUID, entitlementToken}`. Verifies ES256 algorithm/signature, issuer, audience, key ID, installation binding, token age and expiry, then checks active license and registered device before renewal.

Tokens request online checking after seven days and expire fourteen days after verification. Offline revocation cannot be immediate: previously issued tokens remain cryptographically valid until expiry. The future extension must enforce these boundaries with a trusted/bundled public key; downloading a key alone is not entitlement validation. Current signing configuration supports one key; rotation requires a deliberate compatibility/migration plan before production.

Invalid requests: 400. Invalid/revoked entitlement: 401. Device limit: 409. Rate limited: 429. Storage/service failure: 503. No diagnostic exception or submitted secret is returned. Body limit 8 KB. No request-body logging; sensitive headers are redacted. Basic per-IP in-memory limit is 30 requests/minute; resets on process restart and is not a distributed limiter. `skipOnError:false` fails closed if limiter fails. Liveness/readiness are exempt and should be reachable only by infrastructure.

`TRUST_PROXY=false` by default. Opt in with `loopback` or one exact IPv4/IPv6 address for the immediate trusted proxy. With a host Caddy proxy and Docker bridge networking, configure the actual bridge gateway address as observed by the container. Keep the API published only on host loopback and configure Caddy to replace untrusted forwarded headers. Never trust arbitrary client-supplied proxy addresses. With the default false, users behind the same proxy share a conservative aggregate rate limit. Put a configured edge limiter/TLS proxy in front for public production traffic. See [Fastify proxy documentation](https://fastify.dev/docs/latest/Reference/Server/) and [PostgreSQL row locking](https://www.postgresql.org/docs/current/sql-select.html).

## Operator commands

Run within protected administrative access using a DB role authorized for these changes:

- `npm run operator -- provision`: prints raw key once to interactive terminal. For deliberate secure machine delivery only, `ALLOW_LICENSE_STDOUT=1` permits redirected output. Never log this in CI, tickets or chat.
- `npm run operator -- revoke LICENSE_UUID`: blocks activation and online renewal. Does not remotely erase an already issued offline token.
- `npm run operator -- release-device LICENSE_UUID INSTALLATION_UUID`: releases one slot after verifying the customer's request.

No web operator endpoint, fake checkout callback or test paid bypass exists. Public provisioning, payment webhooks, merchant reconciliation, purchase emails, device self-service, key rotation and extension verification remain release work. Use separate migration/operator and runtime DB roles before production; keep privileged credentials out of the serving process where feasible. Monitor aggregate errors without logging tokens, install IDs or raw license keys. Define retention/support policies before collecting real customer data.

## Personal cloud reports

Cloud routes return 503 unless `OIDC_ISSUER`, `COGNITO_CLIENT_ID`, `REPORTS_BUCKET` and `AWS_REGION` are all configured. Cognito access JWTs must have a verified RS256 signature, matching issuer and client ID, access token use, expiry and a UUID subject. Owner IDs never come from request bodies. This is personal storage, not shared organizations or guest access.

- `GET /v1/reports`: up to 50 `{issue, version}` entries belonging to the signed-in subject.
- `GET /v1/reports/:id`: `{issue, originalDataUrl, version}`; another user's report returns 404.
- `PUT /v1/reports/:id`: `{issue, originalDataUrl, expectedVersion}`. Use null version to create, the last fetched version to update. A stale version returns 409.
- `DELETE /v1/reports/:id?expectedVersion=N`: version-checked deletion of the signed-in user's report.

Cloud requests use `Authorization: Bearer ACCESS_TOKEN`. Report metadata uses the same strict schema as the extension. `report-schema.ts` and `report-types.ts` are copies to keep the Docker build self-contained; changes must remain synchronized with `src/shared/validation.ts` and `src/shared/types.ts` in the extension.

Each account has a 50-report / 100 MiB budget, and each report is limited to 10 MiB including metadata. The HTTP upload envelope permits 14 MiB for base64 expansion. Screenshots must have PNG framing; this check does not constitute full image decoding or malware inspection. Objects are written with AES256 server-side encryption and opaque owner-derived keys. Enable S3 Block Public Access and bucket-owner-enforced ownership. Never configure a public bucket or grant the extension AWS credentials.

Account-row locking serializes quota and version checks. Uploads use immutable unique object keys; database transactions determine the current object. Failed deletes and ambiguous commits can leave orphaned objects. An operational reconciliation job with an age safety window is still required; do not apply an unconditional expiry lifecycle rule to live screenshot objects. Back up PostgreSQL and configure S3 retention/versioning consistently; restoring only one can produce missing or orphaned evidence.

Cloud storage currently has no paid entitlement gate. Payment-provider integration and commercial cloud limits remain later release work. A signed license is not a Cognito login and does not grant access to another user's reports. Production release also requires real Cognito/S3 integration tests, recovery drills, account deletion/retention policy, monitoring and an edge rate limiter.
