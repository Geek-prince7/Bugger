# Personal cloud report copies

The default extension build remains local-only: no identity permission, cloud host access, cloud account controls, or network calls. Cloud is enabled only when **all four** build variables are present. Values are public deployment configuration, never client secrets.

```sh
BUGGER_API_URL=https://api.your-domain.example \
BUGGER_OIDC_ISSUER=https://cognito-idp.REGION.amazonaws.com/POOL_ID \
BUGGER_OIDC_CLIENT_ID=PUBLIC_APP_CLIENT_ID \
BUGGER_COGNITO_DOMAIN=https://YOUR_DOMAIN.auth.REGION.amazoncognito.com \
npm run package
```

`BUGGER_API_URL` is the API base URL without `/v1/reports`; the issuer is the exact user-pool issuer. The domain is the HTTPS Cognito hosted-login origin. URLs must be HTTPS, explicit hosts, and contain no user credentials, query or fragment. Partial configuration fails the build. Never set a Cognito client secret in the extension; configure a public app client using authorization code grant, PKCE S256 and `openid` scope.

The cloud build adds `identity` and optional host permissions limited to the configured API, issuer and hosted-login HTTPS origins. The extension asks for those optional origins only when the user chooses **Sign in to cloud**. The standard source manifest stays local-only. A granted origin is not permission to upload page content automatically.

## Cognito redirect and session

Register the exact callback returned by `chrome.identity.getRedirectURL('cognito')`, normally `https://EXTENSION_ID.chromiumapp.org/cognito`, in the Cognito app client. Register the actual Chrome Web Store extension ID and an explicit development extension ID if testing unpacked. Do not use wildcard redirects. Domain, issuer and app-client values must match the backend configuration.

Sign-in opens Chrome's interactive auth window with random 256-bit state and PKCE verifier. The callback's exact origin/path/state are checked before code exchange. RS256 signature is verified against the configured issuer JWKS; issuer, client ID, token use, issued-at and expiration are checked. Only the access token and account/session metadata are stored in `chrome.storage.session`, which is not exposed to content scripts by default. Refresh and ID tokens are discarded. Expiration/browser restart requires another explicit sign-in; no silent refresh is implemented.

Sign out removes the extension session. It does not delete reports or guarantee removal of Cognito's web cookie; subsequent sign-in requests `prompt=login`. No access tokens, authorization codes, verifier or report bodies are logged.

## User flow and privacy

In **My issues**, expand **Personal cloud reports · optional**. Sign in, then explicitly refresh the remote list. Nothing uploads on login, capture, save, local edit, export, or refresh.

Select a saved local report, inspect its screenshot and written notes, and use the existing privacy review checkboxes. **Upload selected report after privacy review** asks for explicit confirmation. The same privacy projection used for local exports removes unchecked URL, country, HTML and other metadata. The screenshot is omitted when unchecked; when included it is the **original captured PNG**, without pixel redaction. Written notes are always included and must be manually reviewed. A cloud copy is private to its authenticated account, not a public share link.

Each upload sends a version precondition. The first upload expects no existing report; later uploads use the last version successfully uploaded by this browser/account. The stored version is namespaced by issuer and account subject. Version conflicts never automatically overwrite remote changes or advance the expected version. Refresh, download a copy and compare; if needed explicitly delete the remote copy before a new upload. A network failure after a server commit can produce a later conflict; no unsafe blind retry resolves it.

**Download as new local copy** validates report metadata and PNG envelope, assigns a new UUID, and uses the existing repository validation, five-report trial and storage quota rules. It never replaces an existing local report or edits. This is manual copying, not automatic bidirectional synchronization or merge. Uploading the downloaded copy creates a distinct report. Local/cloud delete operations are independent. Remote delete requires confirmation and a matching version.

Local sign-out/account changes clear the displayed remote list. Requests use a single account snapshot and reject responses if the account changes while a request is in progress. Data already sent by an explicitly approved request cannot be recalled by signing out.

## API contract

- `GET /v1/reports` → `[{issue, version}]` (backend currently caps account reports at 50).
- `GET /v1/reports/:id` → `{issue, originalDataUrl, version}`.
- `PUT /v1/reports/:id` ← `{issue, originalDataUrl, expectedVersion: null | positive integer}` → `{version}`.
- `DELETE /v1/reports/:id?expectedVersion=N` deletes only that version.

All use an access-token Bearer header. The backend derives ownership from verified token `sub`, never a client-supplied owner. Account quota, version conflict, session expiry, size, rate limiting and generic server failures have distinct safe UI messages. The extension limits cloud screenshots to 8 MB and downloaded response size to 14 MB; backend limits also apply.

## GitHub release configuration

Set these GitHub repository **Variables** (Settings → Secrets and variables → Actions → Variables): `BUGGER_API_URL`, `BUGGER_OIDC_ISSUER`, `BUGGER_OIDC_CLIENT_ID`, `BUGGER_COGNITO_DOMAIN`. Leave all four unset to release local-only. `release-extension.yml` injects them only into the packaging step, preserving offline local-only unit/browser checks. Values will be embedded in the public extension bundle, so none may contain secrets. CWS publishing credentials remain separate GitHub environment secrets.

Configured packaging was locally exercised with example HTTPS hosts and its manifest/ZIP validated. This proves build behavior, **not live Cognito login or AWS report transfers**. Release still requires deployment-specific Cognito signup/login/expiry, permission denial, API ownership, cloud quota, original screenshot, version-conflict, account-switch, deletion and store-disclosure acceptance tests with real accounts.

## Verification and references

Unit tests cover PKCE generation; callback origin/state/duplicate checks; cancelled sign-in; signed RSA access tokens and bad signature/claims; session clearing; upload privacy projection; version tracking and conflicts; account changes; remote quota/auth/rate/size failures; safe download copying; invalid metadata/images; and complete/partial/insecure build configuration.

Authoritative implementation references: [Chrome identity API](https://developer.chrome.com/docs/extensions/reference/api/identity), [Cognito PKCE](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html), [Cognito authorization endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/authorization-endpoint.html), and [Cognito token endpoint](https://docs.aws.amazon.com/cognito/latest/developerguide/token-endpoint.html).
