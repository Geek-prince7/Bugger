# Extension release pipeline

The **Release Bugger extension** GitHub Actions workflow builds, checks, browser-tests and packages the extension. It runs only when manually dispatched from `main`. Pushes and pull requests cannot deploy it. Its default mode is `package`, which needs no store credentials and creates a ZIP plus SHA-256 checksum artifact.

Two optional modes use the official Chrome Web Store API v2:

- `upload`: upload the tested ZIP as a draft to an existing store item; no review request.
- `submit-review`: upload the tested ZIP, then request review with `STAGED_PUBLISH` and `blockOnWarnings: true`. Review is not skipped. Once approved, a staged submission still needs a separate publisher action in the Developer Dashboard before users receive it. This workflow has no public-publish mode. See the official [publish method and staging semantics](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/publish).

## First-time setup

1. Create a Chrome Web Store publisher account and enable its required account security. Create Bugger's initial item in the Developer Dashboard to obtain its extension ID. This pipeline updates an existing item; it does not create a listing. Complete the listing, privacy disclosures, support information and required assets before requesting review. Resolve the launch checklist and any remaining product release blockers first.
2. In a Google Cloud project, enable the Chrome Web Store API and create an OAuth client. Follow Google's [API setup and OAuth guide](https://developer.chrome.com/docs/webstore/using-api) to obtain a refresh token using your own OAuth credentials, the publishing account, and the `https://www.googleapis.com/auth/chromewebstore` scope. Keep credentials out of this repository and chat.
3. In the GitHub repository, create the environment **`chrome-web-store`**. Restrict deployment branches to **`main`** and configure required reviewers where your GitHub plan supports them. The workflow also checks `github.ref`; the environment restriction must be configured in GitHub because YAML cannot create that protection.
4. Add these environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, `CWS_REFRESH_TOKEN`. Add environment variables `CWS_PUBLISHER_ID` (Publisher → Settings in the store dashboard) and `CWS_EXTENSION_ID` (32 lowercase letters a–p). Secrets are exposed only to the deployment step, not the build, tests or artifacts.
5. Keep `package.json`, `package-lock.json` and `public/manifest.json` versions consistent. Increase the manifest version for a new upload. Release validation verifies both the ZIP's embedded manifest and package version. Run the `package` mode first and inspect the artifact before choosing an API mode.

Store listing and visibility changes may require dashboard actions before API submission works. OAuth refresh tokens can expire or be revoked; reauthorize using Google's guide when required. Do not paste token responses in issue reports.

## Run a release

In GitHub **Actions → Release Bugger extension → Run workflow**, select `main`, then the intended mode. All modes run `npm ci`, `npm run check`, Chromium browser tests and `npm run package`. The artifact `bugger-extension-<commit SHA>` contains the release ZIP and its checksum. API modes download that same tested artifact and verify its checksum; they do not rebuild with credentials present.

For a local package verification, after `npm run package`:

```sh
node scripts/cws-release.mjs package release/bugger-0.1.0.zip
```

Replace the example version with the version you built. Local `upload` or `submit-review` use the same named environment variables/secrets; the script accepts secrets only from the environment, never command-line arguments. Prefer the protected workflow for release operations.

## Failure handling and state verification

The script checks item identity on store responses, validates synchronous upload version, blocks items with policy warnings and refuses to overwrite a pending review or staged revision. It accepts only known successful upload/submission states. It does not retry mutating requests automatically. Concurrent workflow releases are serialized; avoid uploading the same item manually while a workflow is running.

An asynchronous upload is polled using [`fetchStatus`](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/fetchStatus), at most 30 times with 10-second gaps. Each request has a 60-second deadline, and the deployment job has a 15-minute deadline. Google documents `IN_PROGRESS` in the [upload-state enum](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/UploadState) but also references `UPLOAD_IN_PROGRESS` in the [upload method](https://developer.chrome.com/docs/webstore/api/reference/rest/v2/media/upload); the script accepts both pending spellings and only `SUCCEEDED` as completion. The status response does not expose an uploaded draft version, so asynchronous success relies on that item's upload state after sending the locally validated bytes; synchronous replies additionally verify `crxVersion`.

A timeout does not mean Google discarded the upload. Inspect the Developer Dashboard before rerunning, including after a lost submission response. Unknown states, HTTP errors, wrong item/version, warnings and processing failures stop the pipeline. Logs use fixed messages and HTTP status codes, never OAuth response bodies, arbitrary server errors or access tokens. An accepted review request is not an approval or completed release. Final public publishing is a separate action in the Developer Dashboard after product sign-off.

## Verification status

Automated release tests use mocked responses only. They cover package-only operation without network, malformed configuration and packages, identity/version mismatches, upload success, both pending-state spellings, polling exhaustion, failed/unknown states, active review protection, staged submission parameters and sanitized errors. No live store credentials were available when this pipeline was implemented, so no store upload, review submission or public release has been executed or verified.
