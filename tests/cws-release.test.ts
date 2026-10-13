// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
// The release CLI is native Node ESM, intentionally outside the extension TS build.
// @ts-expect-error Native .mjs release module has no declaration file.
import * as release from "../scripts/cws-release.mjs";
const { releaseExtension, validateConfig, validatePackage } = release;

const env = {
  CWS_PUBLISHER_ID: "publisher-123",
  CWS_EXTENSION_ID: "a".repeat(32),
  CWS_CLIENT_ID: "test-client",
  CWS_CLIENT_SECRET: "never-print-secret",
  CWS_REFRESH_TOKEN: "never-print-refresh",
};
const identity = {
  name: `publishers/${env.CWS_PUBLISHER_ID}/items/${env.CWS_EXTENSION_ID}`,
  itemId: env.CWS_EXTENSION_ID,
};
async function zip(version = "0.1.0") {
  return new JSZip()
    .file(
      "manifest.json",
      JSON.stringify({ name: "Bugger", manifest_version: 3, version }),
    )
    .generateAsync({ type: "uint8array" });
}
function responses(...data: unknown[]) {
  const queue = [...data];
  return vi.fn(async () => {
    if (!queue.length) throw new Error("Unexpected network request");
    const next = queue.shift();
    return next instanceof Response
      ? next
      : new Response(JSON.stringify(next), { status: 200 });
  });
}
async function run(
  fetchImpl: ReturnType<typeof responses>,
  mode = "upload",
  extra = {},
) {
  return releaseExtension({
    mode,
    env,
    bytes: await zip(),
    expectedVersion: "0.1.0",
    fetchImpl,
    sleep: vi.fn(async () => {}),
    ...extra,
  });
}
const token = { access_token: "test-access-token" };
const ready = { ...identity };
const uploaded = { ...identity, uploadState: "SUCCEEDED", crxVersion: "0.1.0" };

describe("Chrome Web Store release boundaries", () => {
  it("validates a package without credentials or any network", async () => {
    const fetchImpl = responses();
    expect(await run(fetchImpl, "package", { env: {} })).toEqual({
      mode: "package",
      version: "0.1.0",
      state: "PACKAGE_VALIDATED",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects bad mode, missing secrets, and path-like identifiers before network", async () => {
    expect(() => validateConfig(env, "publish")).toThrow("Choose");
    expect(() =>
      validateConfig({ ...env, CWS_CLIENT_SECRET: "" }, "upload"),
    ).toThrow("CWS_CLIENT_SECRET");
    expect(() =>
      validateConfig({ ...env, CWS_PUBLISHER_ID: "../other" }, "upload"),
    ).toThrow("identifier");
    expect(() =>
      validateConfig({ ...env, CWS_EXTENSION_ID: "bad" }, "upload"),
    ).toThrow("extension ID");
  });
  it("rejects corrupt ZIPs and package version mismatches", async () => {
    await expect(
      validatePackage(new Uint8Array([1, 2]), "0.1.0"),
    ).rejects.toThrow("validated");
    await expect(validatePackage(await zip("0.2.0"), "0.1.0")).rejects.toThrow(
      "expected version",
    );
  });
  it("uploads exact bytes and stops before review in upload mode", async () => {
    const fetchImpl = responses(token, ready, uploaded);
    expect(await run(fetchImpl)).toMatchObject({ state: "UPLOADED" });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls).toHaveLength(3);
    expect(calls[2]![0]).toBe(
      `https://chromewebstore.googleapis.com/upload/v2/${identity.name}:upload`,
    );
    expect(calls[2]![1].body).toBeInstanceOf(Uint8Array);
    expect(calls[2]![1].redirect).toBe("error");
  });
  it.each(["UPLOAD_IN_PROGRESS", "IN_PROGRESS"])(
    "polls async %s uploads to success",
    async (uploadState) => {
      const fetchImpl = responses(
        token,
        ready,
        { ...identity, uploadState },
        { ...identity, lastAsyncUploadState: "IN_PROGRESS" },
        { ...identity, lastAsyncUploadState: "SUCCEEDED" },
      );
      expect(await run(fetchImpl)).toMatchObject({ state: "UPLOADED" });
      expect(fetchImpl).toHaveBeenCalledTimes(5);
    },
  );
  it("stops bounded polling without submitting review", async () => {
    const fetchImpl = responses(
      token,
      ready,
      { ...identity, uploadState: "IN_PROGRESS" },
      { ...identity, lastAsyncUploadState: "IN_PROGRESS" },
    );
    await expect(
      run(fetchImpl, "submit-review", { maxPolls: 1 }),
    ).rejects.toThrow("timed out");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it.each([
    "FAILED",
    "NOT_FOUND",
    "UPLOAD_STATE_UNSPECIFIED",
    "SURPRISE",
    undefined,
  ])("rejects unsuccessful or unknown upload state %s", async (uploadState) => {
    const fetchImpl = responses(token, ready, { ...identity, uploadState });
    await expect(run(fetchImpl, "submit-review")).rejects.toThrow(
      "Upload failed",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
  it("blocks mismatched remote item and version", async () => {
    await expect(
      run(responses(token, { ...identity, itemId: "b".repeat(32) })),
    ).rejects.toThrow("does not match");
    await expect(
      run(responses(token, ready, { ...uploaded, crxVersion: "0.0.9" })),
    ).rejects.toThrow("version");
  });
  it.each(["STAGED", "PENDING_REVIEW"])(
    "does not upload over existing %s work",
    async (state) => {
      const fetchImpl = responses(token, {
        ...identity,
        submittedItemRevisionStatus: { state },
      });
      await expect(run(fetchImpl, "submit-review")).rejects.toThrow(
        "already exists",
      );
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    },
  );
  it("only submits staged review with blocking warnings and no skipReview", async () => {
    const fetchImpl = responses(token, ready, uploaded, ready, {
      ...identity,
      state: "PENDING_REVIEW",
    });
    expect(await run(fetchImpl, "submit-review")).toMatchObject({
      state: "PENDING_REVIEW",
    });
    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(JSON.parse(calls[4]![1].body as string)).toEqual({
      publishType: "STAGED_PUBLISH",
      blockOnWarnings: true,
    });
  });
  it("fails closed on publish state, warnings and HTTP errors without leaking bodies", async () => {
    await expect(
      run(
        responses(token, ready, uploaded, ready, {
          ...identity,
          state: "PUBLISHED",
        }),
        "submit-review",
      ),
    ).rejects.toThrow("Unexpected review state");
    await expect(
      run(responses(token, { ...identity, warned: true })),
    ).rejects.toThrow("policy warnings");
    const fetchImpl = responses(
      new Response("never-print-secret", { status: 401 }),
    );
    await expect(run(fetchImpl)).rejects.toThrow("HTTP 401");
    await expect(
      run(responses(new Response("never-print-secret", { status: 401 }))),
    ).rejects.not.toThrow("never-print-secret");
  });
  it("sanitizes arbitrary fetch exceptions", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("never-print-refresh");
    });
    await expect(run(fetchImpl)).rejects.toThrow("request failed");
  });
});
