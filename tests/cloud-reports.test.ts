// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Issue } from "../src/shared/types";
import { DEFAULT_PRIVACY } from "../src/shared/types";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  fetch: vi.fn(),
  signOut: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../src/cloud/config", () => ({
  requiredConfig: () => ({ apiUrl: "https://api.example.com" }),
}));
vi.mock("../src/cloud/auth", () => ({
  session: mocks.session,
  safeFetch: mocks.fetch,
  signOut: mocks.signOut,
}));
vi.mock("../src/storage/repository", () => ({
  repository: { save: mocks.save },
}));
import {
  request,
  uploadReport,
  downloadReport,
  imageBlob,
  listCloudReports,
} from "../src/cloud/reports";
const auth = {
  accessToken: "access-a",
  subject: "owner-a",
  issuer: "https://issuer.example",
  clientId: "client",
  expiresAt: Date.now() + 3600000,
};
const storage: Record<string, unknown> = {};
function fixture(): Issue {
  const meta = { value: null, source: "not_collected" } as const;
  return {
    schemaVersion: 1,
    id: "550e8400-e29b-41d4-a716-446655440000",
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    type: "observation",
    title: "Test observation",
    description: "Written notes",
    severity: "medium",
    status: "open",
    expectedResult: null,
    actualResult: null,
    reproductionSteps: [],
    page: {
      url: "https://example.com/private",
      hostname: "example.com",
      title: null,
      scrollX: 0,
      scrollY: 0,
      viewport: { width: 800, height: 600 },
      screen: null,
      dpr: 1,
      document: null,
    },
    environment: {
      userAgent: meta,
      browserName: meta,
      browserVersion: meta,
      os: meta,
      deviceType: meta,
      language: meta,
      timezone: meta,
      country: meta,
      geoRegion: meta,
    },
    selection: {
      kind: "region",
      element: null,
      selectedRegion: { x: 1, y: 2, width: 10, height: 20, unit: "css_px" },
    },
    attachments: [],
    diagnostics: { console: "not_collected", network: "not_collected" },
    privacy: { urlQueryRemoved: true, fieldsOmitted: [], reviewedAt: null },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(storage)) delete storage[key];
  mocks.session.mockResolvedValue(auth);
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 1 })));
  mocks.save.mockResolvedValue(undefined);
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_name: string, callback: () => Promise<unknown>) =>
        callback(),
    },
  });
  vi.stubGlobal("chrome", {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: object) => Object.assign(storage, value)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
  });
});
describe("explicit cloud report copies", () => {
  it("uploads reviewed fields, omits screenshot, and tracks expected version", async () => {
    const record = { issue: fixture(), original: null };
    await uploadReport(record, {
      ...DEFAULT_PRIVACY,
      pageUrl: false,
      screenshot: false,
    });
    const body = JSON.parse(mocks.fetch.mock.calls[0]![1].body);
    expect(body).toMatchObject({
      expectedVersion: null,
      originalDataUrl: null,
      issue: { page: { url: null, hostname: null } },
    });
    expect(record.issue.page.url).toBe("https://example.com/private");
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ version: 2 })));
    await uploadReport(record, DEFAULT_PRIVACY);
    expect(JSON.parse(mocks.fetch.mock.calls[1]![1].body).expectedVersion).toBe(
      1,
    );
  });
  it("preserves version on conflict and distinguishes account quota", async () => {
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "VERSION_CONFLICT" }), {
        status: 409,
      }),
    );
    await expect(
      uploadReport({ issue: fixture(), original: null }, DEFAULT_PRIVACY),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(storage).toEqual({});
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ code: "ACCOUNT_QUOTA" }), { status: 409 }),
    );
    await expect(request("/v1/reports")).rejects.toMatchObject({
      code: "ACCOUNT_QUOTA",
    });
  });
  it("rejects account switch between version lookup and request, without leaking upload", async () => {
    mocks.session.mockResolvedValueOnce(auth).mockResolvedValue({
      ...auth,
      subject: "owner-b",
      accessToken: "access-b",
    });
    await expect(
      uploadReport({ issue: fixture(), original: null }, DEFAULT_PRIVACY),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(storage).toEqual({});
  });
  it("rejects stale responses after account change without clearing new account", async () => {
    mocks.session
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(auth)
      .mockResolvedValue({
        ...auth,
        subject: "owner-b",
        accessToken: "access-b",
      });
    mocks.fetch.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(request("/v1/reports")).rejects.toMatchObject({
      code: "ACCOUNT_CHANGED",
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
  });
  it("downloads a validated new-ID copy and propagates local quota failures", async () => {
    const issue = fixture(),
      report = { issue, version: 1, owner: auth.issuer + ":" + auth.subject };
    mocks.fetch.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ issue, version: 1, originalDataUrl: null }),
        ),
    );
    await downloadReport(report);
    expect(mocks.save.mock.calls[0]![0].issue.id).not.toBe(issue.id);
    expect(issue.id).toBe(fixture().id);
    mocks.save.mockRejectedValue(new Error("Local quota full"));
    await expect(downloadReport(report)).rejects.toThrow("quota");
  });
  it("refuses prior-account cloud report actions and invalid remote metadata/images", async () => {
    await expect(
      downloadReport({ issue: fixture(), version: 1, owner: "someone-else" }),
    ).rejects.toMatchObject({ code: "ACCOUNT_CHANGED" });
    expect(() => imageBlob("data:image/png;base64,c2VjcmV0")).toThrow();
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify([{ issue: { title: "bad" }, version: 1 }])),
    );
    await expect(listCloudReports()).rejects.toThrow();
  });
  it("maps expiry, size and rate errors without echoing server secrets", async () => {
    for (const [status, code] of [
      [401, "SIGNED_OUT"],
      [413, "TOO_LARGE"],
      [429, "RATE_LIMIT"],
      [503, "SERVER_ERROR"],
    ] as const) {
      mocks.fetch.mockResolvedValue(
        new Response("private-error-token", { status }),
      );
      await expect(request("/v1/reports")).rejects.toMatchObject({ code });
    }
  });
});
