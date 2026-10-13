// @vitest-environment node
import "fake-indexeddb/auto";
import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
let listener: (
  message: unknown,
  sender: unknown,
  reply: (value: any) => void,
) => void;
let sessionData: Record<string, unknown> = {};
const mock = vi.hoisted(() => ({
  list: vi.fn(async () => []),
  get: vi.fn(),
  save: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("../src/storage/repository", () => ({ repository: mock }));
const api = {
  runtime: {
    id: "test-extension",
    getURL: (path: string) => `chrome-extension://test-extension/${path}`,
    onMessage: {
      addListener: (fn: typeof listener) => {
        listener = fn;
      },
    },
  },
  storage: {
    session: {
      get: async (key: string) => ({ [key]: sessionData[key] }),
      set: async (values: Record<string, unknown>) => {
        Object.assign(sessionData, values);
      },
      remove: async (key: string) => {
        delete sessionData[key];
      },
    },
  },
  tabs: {
    query: vi.fn(async () => [
      { id: 1, windowId: 2, url: "https://fixture.test/" },
    ]),
    get: vi.fn(async () => ({ id: 1, url: "https://fixture.test/" })),
    sendMessage: vi.fn(async () => ({ ok: true })),
    captureVisibleTab: vi.fn(),
    create: vi.fn(),
    onRemoved: { addListener: vi.fn() },
    onUpdated: { addListener: vi.fn() },
  },
  scripting: { executeScript: vi.fn(async () => []) },
  action: {
    setBadgeText: vi.fn(async () => {}),
    setBadgeBackgroundColor: vi.fn(async () => {}),
  },
};
const extension = {
  id: "test-extension",
  url: "chrome-extension://test-extension/popup.html",
};
function send(message: unknown, sender: unknown = extension): Promise<any> {
  return new Promise((resolve) => listener(message, sender, resolve));
}
beforeAll(async () => {
  vi.stubGlobal("chrome", api);
  await import("../src/background/index");
});
beforeEach(() => {
  sessionData = {};
  vi.clearAllMocks();
  api.tabs.query.mockResolvedValue([
    { id: 1, windowId: 2, url: "https://fixture.test/" },
  ]);
});
describe("worker authorization boundary", () => {
  it("rejects foreign senders before accessing records", async () => {
    expect(
      await send({ type: "ISSUE_LIST" }, { id: "other", url: extension.url }),
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(mock.list).not.toHaveBeenCalled();
  });
  it("rejects manager operations from content scripts", async () => {
    expect(
      await send(
        { type: "ISSUE_LIST" },
        {
          id: "test-extension",
          url: "https://fixture.test/",
          tab: { id: 1 },
          frameId: 0,
        },
      ),
    ).toMatchObject({ ok: false, error: { code: "PERMISSION_DENIED" } });
    expect(mock.list).not.toHaveBeenCalled();
  });
  it("serves authorized manager requests", async () => {
    expect(await send({ type: "ISSUE_LIST" })).toEqual({ ok: true, data: [] });
    expect(mock.list).toHaveBeenCalledOnce();
  });
  it("allows extension-owned manager tabs", async () => {
    expect(
      await send(
        { type: "ISSUE_LIST" },
        { ...extension, tab: { id: 7 }, frameId: 0 },
      ),
    ).toEqual({ ok: true, data: [] });
  });
  it("rejects unknown operations", async () => {
    expect(await send({ type: "READ_COOKIES" })).toMatchObject({
      ok: false,
      error: { code: "SCHEMA_INVALID" },
    });
  });
  it("does not inject into browser pages", async () => {
    api.tabs.query.mockResolvedValue([
      { id: 1, windowId: 2, url: "chrome://settings" },
    ]);
    expect(await send({ type: "START_CAPTURE" })).toMatchObject({
      ok: false,
      error: { code: "UNSUPPORTED_PAGE" },
    });
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("starts one explicit session and stops it", async () => {
    const result = await send({ type: "START_CAPTURE" });
    expect(result.ok).toBe(true);
    expect(api.scripting.executeScript).toHaveBeenCalledWith({
      target: { tabId: 1 },
      files: ["content.js"],
    });
    expect(sessionData.captureSession).toMatchObject({
      tabId: 1,
      id: result.data.sessionId,
    });
    await send({ type: "STOP_CAPTURE" });
    expect(sessionData.captureSession).toBeUndefined();
  });
  it("rejects stale capture and child frames before taking a screenshot", async () => {
    await send({ type: "START_CAPTURE" });
    const s = sessionData.captureSession as { id: string };
    for (const sender of [
      { id: "test-extension", tab: { id: 99 }, frameId: 0 },
      { id: "test-extension", tab: { id: 1 }, frameId: 1 },
    ])
      expect(
        await send(
          { type: "CAPTURE", sessionId: s.id, screenshot: true },
          sender,
        ),
      ).toMatchObject({ ok: false, error: { code: "STALE_SESSION" } });
    expect(api.tabs.captureVisibleTab).not.toHaveBeenCalled();
  });
});
