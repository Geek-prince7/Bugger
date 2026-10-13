import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import JSZip from "jszip";

const API = "https://chromewebstore.googleapis.com";
const modes = new Set(["package", "upload", "submit-review"]);
class ReleaseError extends Error {}
const fail = (message) => {
  throw new ReleaseError(message);
};

export function validateConfig(env, mode) {
  if (!modes.has(mode)) fail("Choose package, upload, or submit-review.");
  if (mode === "package") return {};
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(env.CWS_PUBLISHER_ID || ""))
    fail("CWS_PUBLISHER_ID must be a bounded publisher identifier.");
  if (!/^[a-p]{32}$/.test(env.CWS_EXTENSION_ID || ""))
    fail("CWS_EXTENSION_ID must be a 32-character Chrome extension ID.");
  for (const key of ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN"])
    if (
      typeof env[key] !== "string" ||
      !env[key].trim() ||
      env[key].length > 8192
    )
      fail(`Configure ${key} in the chrome-web-store environment.`);
  return {
    name: `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`,
    itemId: env.CWS_EXTENSION_ID,
    clientId: env.CWS_CLIENT_ID,
    clientSecret: env.CWS_CLIENT_SECRET,
    refreshToken: env.CWS_REFRESH_TOKEN,
  };
}

export async function validatePackage(bytes, expectedVersion) {
  if (
    !/^\d+(?:\.\d+){0,3}$/.test(expectedVersion || "") ||
    expectedVersion.split(".").some((v) => Number(v) > 65535)
  )
    fail("Invalid expected extension version.");
  if (!bytes?.byteLength || bytes.byteLength > 100 * 1024 * 1024)
    fail("Package must be a nonempty ZIP below 100 MB.");
  let manifest;
  try {
    const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
    const entry = archive.file("manifest.json");
    if (!entry) fail("Package has no root manifest.json.");
    manifest = JSON.parse(await entry.async("string"));
  } catch {
    fail("Package ZIP or manifest could not be validated.");
  }
  if (
    manifest.name !== "Bugger" ||
    manifest.manifest_version !== 3 ||
    manifest.version !== expectedVersion
  )
    fail("Package manifest does not match Bugger and the expected version.");
  return manifest.version;
}

export async function releaseExtension({
  mode,
  env,
  bytes,
  expectedVersion,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxPolls = 30,
}) {
  const config = validateConfig(env, mode);
  await validatePackage(bytes, expectedVersion);
  if (mode === "package")
    return { mode, version: expectedVersion, state: "PACKAGE_VALIDATED" };
  if (!Number.isInteger(maxPolls) || maxPolls < 1 || maxPolls > 30)
    fail("Invalid upload polling limit.");
  async function request(url, init, stage) {
    let response;
    try {
      response = await fetchImpl(url, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
    } catch {
      fail(
        `${stage} request failed or timed out. Inspect the Developer Dashboard before retrying.`,
      );
    }
    if (!response.ok)
      fail(
        `${stage} failed (HTTP ${response.status}). Inspect the Developer Dashboard and OAuth configuration.`,
      );
    try {
      const data = await response.json();
      if (!data || typeof data !== "object" || Array.isArray(data))
        throw new Error();
      return data;
    } catch {
      fail(
        `${stage} returned an invalid response. No further action was taken.`,
      );
    }
  }
  const auth = await request(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        client_secret: config.clientSecret,
        refresh_token: config.refreshToken,
      }),
    },
    "OAuth refresh",
  );
  if (
    typeof auth.access_token !== "string" ||
    !auth.access_token ||
    auth.access_token.length > 16384 ||
    /[\r\n]/.test(auth.access_token)
  )
    fail("OAuth refresh returned no usable access token.");
  const headers = { Authorization: `Bearer ${auth.access_token}` };
  function identity(data) {
    if (data.name !== config.name || data.itemId !== config.itemId)
      fail("Store response item does not match the configured extension.");
  }
  async function status() {
    const data = await request(
      `${API}/v2/${config.name}:fetchStatus`,
      { headers },
      "Status check",
    );
    identity(data);
    if (data.takenDown || data.warned)
      fail(
        "Store item has policy warnings. Resolve them in the Developer Dashboard.",
      );
    return data;
  }
  // Prevent a rerun from interacting with a previously staged or active review.
  const before = await status();
  if (
    ["PENDING_REVIEW", "STAGED"].includes(
      before.submittedItemRevisionStatus?.state,
    )
  )
    fail(
      "An active review or staged revision already exists. Resolve it in the Developer Dashboard before uploading.",
    );
  const upload = await request(
    `${API}/upload/v2/${config.name}:upload`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/zip" },
      body: bytes,
    },
    "Package upload",
  );
  identity(upload);
  let state = upload.uploadState;
  if (state === "SUCCEEDED" && upload.crxVersion !== expectedVersion)
    fail("Uploaded version does not match the package version.");
  // Official enum names IN_PROGRESS; the upload/guide text also uses UPLOAD_IN_PROGRESS.
  const pending = (value) =>
    value === "IN_PROGRESS" || value === "UPLOAD_IN_PROGRESS";
  for (let i = 0; pending(state) && i < maxPolls; i++) {
    await sleep(10000);
    state = (await status()).lastAsyncUploadState;
  }
  if (pending(state))
    fail(
      "Upload processing timed out. Check the Developer Dashboard before retrying; review was not submitted.",
    );
  if (state !== "SUCCEEDED")
    fail(
      "Upload failed or returned an unknown state. Review was not submitted.",
    );
  if (mode === "upload")
    return { mode, version: expectedVersion, state: "UPLOADED" };
  const current = await status();
  if (
    ["PENDING_REVIEW", "STAGED"].includes(
      current.submittedItemRevisionStatus?.state,
    )
  )
    fail(
      "Review state changed during upload. Resolve it in the Developer Dashboard.",
    );
  const submitted = await request(
    `${API}/v2/${config.name}:publish`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        publishType: "STAGED_PUBLISH",
        blockOnWarnings: true,
      }),
    },
    "Staged review submission",
  );
  identity(submitted);
  if (submitted.warningInfo?.warnings?.length)
    fail("Store returned review warnings. Inspect the Developer Dashboard.");
  if (!["PENDING_REVIEW", "STAGED"].includes(submitted.state))
    fail(
      "Unexpected review state. Inspect the Developer Dashboard; do not assume the submission succeeded.",
    );
  return { mode, version: expectedVersion, state: submitted.state };
}

export async function main(args = process.argv.slice(2), env = process.env) {
  if (args.length !== 2)
    fail(
      "Usage: node scripts/cws-release.mjs package|upload|submit-review release/bugger-VERSION.zip",
    );
  const [mode, file] = args;
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
  if (pkg.version !== manifest.version)
    fail("package.json and public/manifest.json versions differ.");
  const bytes = await readFile(file);
  const checksum = (await readFile(`${file}.sha256`, "utf8")).split(/\s+/)[0];
  if (
    !/^[a-f0-9]{64}$/.test(checksum) ||
    createHash("sha256").update(bytes).digest("hex") !== checksum
  )
    fail("Package SHA-256 verification failed.");
  const result = await releaseExtension({
    mode,
    env,
    bytes,
    expectedVersion: pkg.version,
  });
  console.log(`Bugger ${result.version}: ${result.state}.`);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(
      error instanceof ReleaseError
        ? error.message
        : "Release failed. Check package files and configuration; no response or credentials have been logged.",
    );
    process.exitCode = 1;
  });
}
