import { openDB } from "idb";
import { repository } from "../storage/repository";
import { validateIssue } from "../shared/validation";
import type { CaptureDraft, Issue, Request } from "../shared/types";

type Session = { tabId: number; windowId: number; id: string; url: string };
type Pending = {
  id: string;
  sessionId: string;
  draft: CaptureDraft;
  original: Blob | null;
  created: number;
};
const staging = openDB("bugger-captures", 1, {
  upgrade(db) {
    db.createObjectStore("pending", { keyPath: "id" });
  },
}).then(async (db) => {
  // Browser restart removes session storage. Do not retain an abandoned image
  // once the worker wakes without its authorizing capture session.
  if (!(await session())) await db.clear("pending");
  return db;
});
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const task = queue.then(fn, fn);
  queue = task.catch(() => {});
  return task;
}
const fail = (code: string, message: string) =>
  Object.assign(new Error(message), { code });
async function session(): Promise<Session | undefined> {
  return (await chrome.storage.session.get("captureSession")).captureSession as
    Session | undefined;
}
async function stop() {
  const s = await session();
  if (s)
    await chrome.tabs
      .sendMessage(s.tabId, { type: "STOP_SESSION" })
      .catch(() => {});
  await chrome.storage.session.remove("captureSession");
  await chrome.action.setBadgeText({ text: "" });
  await (await staging).clear("pending");
}
async function check(sender: chrome.runtime.MessageSender, id: string) {
  const s = await session();
  if (!s || s.id !== id || s.tabId !== sender.tab?.id || sender.frameId !== 0)
    throw fail(
      "STALE_SESSION",
      "Capture expired. Start Bugger again from its toolbar icon.",
    );
  const tab = await chrome.tabs.get(s.tabId);
  if (tab.url !== s.url)
    throw fail("STALE_SESSION", "The page changed. Start a new capture.");
  return s;
}
async function start() {
  await stop();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (
    !tab?.id ||
    !tab.url ||
    !/^https?:\/\//.test(tab.url) ||
    /^https:\/\/(chromewebstore.google.com|chrome.google.com\/webstore)/.test(
      tab.url,
    )
  )
    throw fail(
      "UNSUPPORTED_PAGE",
      "Bugger supports regular HTTP and HTTPS pages. Browser settings and extension stores cannot be captured.",
    );
  const s: Session = {
    tabId: tab.id,
    windowId: tab.windowId,
    id: crypto.randomUUID(),
    url: tab.url,
  };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    await chrome.storage.session.set({ captureSession: s });
    await chrome.tabs.sendMessage(tab.id, {
      type: "START_SESSION",
      sessionId: s.id,
    });
    await chrome.action.setBadgeBackgroundColor({ color: "#087f75" });
    await chrome.action.setBadgeText({ text: "ON" });
    return { sessionId: s.id };
  } catch {
    await stop();
    throw fail(
      "PERMISSION_DENIED",
      "Chrome could not activate Bugger on this page. Refresh the page and try again.",
    );
  }
}
function draftIssue(draft: CaptureDraft): Issue {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    title: "Capture validation",
    description: "",
    type: "observation",
    severity: "medium",
    status: "open",
    expectedResult: null,
    actualResult: null,
    reproductionSteps: [],
    ...draft,
    attachments: [],
    diagnostics: { console: "not_collected", network: "not_collected" },
    privacy: { urlQueryRemoved: true, fieldsOmitted: [], reviewedAt: null },
  };
}
async function handle(request: Request, sender: chrome.runtime.MessageSender) {
  const trusted =
    sender.id === chrome.runtime.id &&
    [
      chrome.runtime.getURL("popup.html"),
      chrome.runtime.getURL("issues.html"),
    ].includes(sender.url ?? "") &&
    (sender.frameId === undefined || sender.frameId === 0);
  if (sender.id !== chrome.runtime.id)
    throw fail("PERMISSION_DENIED", "Unknown message sender.");
  if (request.type === "CAPTURE") {
    const s = await check(sender, request.sessionId);
    const checked = validateIssue(draftIssue(request.draft));
    const draft: CaptureDraft = {
      page: checked.page,
      environment: checked.environment,
      selection: checked.selection,
    };
    let original: Blob | null = null;
    if (request.screenshot) {
      const [active] = await chrome.tabs.query({
        active: true,
        windowId: s.windowId,
      });
      if (active?.id !== s.tabId)
        throw fail(
          "SCREENSHOT_FAILED",
          "Return to the selected tab before capturing.",
        );
      const url = await chrome.tabs
        .captureVisibleTab(s.windowId, { format: "png" })
        .catch(() => {
          throw fail(
            "SCREENSHOT_FAILED",
            "Screenshot unavailable. Retry or capture without an image.",
          );
        });
      const [after] = await chrome.tabs.query({
        active: true,
        windowId: s.windowId,
      });
      await check(sender, request.sessionId);
      if (after?.id !== s.tabId)
        throw fail(
          "SCREENSHOT_FAILED",
          "The active tab changed during capture. Please retry.",
        );
      original = await (await fetch(url)).blob();
      if (original.size > 10 * 1024 * 1024)
        throw fail(
          "STORAGE_FULL",
          "Screenshot exceeds 10 MB. Capture without an image or reduce your viewport.",
        );
    }
    const id = crypto.randomUUID();
    const db = await staging;
    await db.clear("pending");
    await db.put("pending", {
      id,
      sessionId: s.id,
      draft,
      original,
      created: Date.now(),
    } satisfies Pending);
    return { captureId: id };
  }
  if (request.type === "SAVE_ISSUE") {
    await check(sender, request.sessionId);
    const pending = (await (
      await staging
    ).get("pending", request.captureId || "")) as Pending | undefined;
    if (
      !pending ||
      pending.sessionId !== request.sessionId ||
      Date.now() - pending.created > 30 * 60 * 1000
    )
      throw fail(
        "STALE_SESSION",
        "Capture expired. Capture the selection again; your notes are still here.",
      );
    const issue = validateIssue({
      ...request.issue,
      ...pending.draft,
      environment: {
        ...pending.draft.environment,
        country: request.issue.environment.country,
        geoRegion: request.issue.environment.geoRegion,
      },
      attachments: [],
    });
    await repository.save({ issue, original: pending.original });
    return { id: issue.id };
  }
  if (request.type === "OPEN_ISSUES") {
    if (!trusted) {
      const s = await session();
      if (s?.tabId !== sender.tab?.id || sender.frameId !== 0)
        throw fail("PERMISSION_DENIED", "Unknown session.");
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL("issues.html") });
    return {};
  }
  if (request.type === "STOP_CAPTURE") {
    if (!trusted) {
      const s = await session();
      if (s?.tabId !== sender.tab?.id || sender.frameId !== 0)
        throw fail("PERMISSION_DENIED", "Unknown session.");
    }
    await stop();
    return {};
  }
  if (!trusted)
    throw fail(
      "PERMISSION_DENIED",
      "This operation is only available inside Bugger.",
    );
  switch (request.type) {
    case "START_CAPTURE":
      return start();
    case "ISSUE_LIST":
      return (await repository.list()).map((r) => r.issue);
    case "ISSUE_GET": {
      const record = await repository.get(request.id);
      if (!record) throw fail("SELECTION_NOT_FOUND", "Report not found.");
      let originalDataUrl: string | null = null;
      if (record.original) {
        const bytes = new Uint8Array(await record.original.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 8192)
          binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        originalDataUrl = `data:${record.original.type};base64,${btoa(binary)}`;
      }
      return { issue: record.issue, originalDataUrl };
    }
    case "ISSUE_UPDATE":
      await repository.update(validateIssue(request.issue));
      return {};
    case "ISSUE_DELETE":
      await repository.remove(request.id);
      return {};
    case "STATUS":
      return {
        count: (await repository.list()).length,
        limit: 5,
        license: "trial",
        commercialReady: false,
      };
    default:
      throw fail("SCHEMA_INVALID", "Unknown request.");
  }
}
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== "object" || !("type" in message))
    return false;
  serial(() => handle(message as Request, sender)).then(
    (data) => respond({ ok: true, data }),
    (error) =>
      respond({
        ok: false,
        error: {
          code: error?.code || "SCHEMA_INVALID",
          message:
            error instanceof Error
              ? error.message
              : "Action failed. Please retry.",
          retryable: true,
        },
      }),
  );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void serial(async () => {
    if ((await session())?.tabId === tabId) await stop();
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status || change.url)
    void serial(async () => {
      const current = await session();
      if (current?.tabId !== tabId) return;
      // Same-document navigation can report loading too. Keep notes while the
      // existing content controller survives; a full navigation removes it.
      if (change.url) {
        await chrome.storage.session.set({
          captureSession: { ...current, url: change.url },
        });
        await (await staging).clear("pending");
      }
      if (change.status === "complete") {
        const pong = await chrome.tabs
          .sendMessage(tabId, { type: "PING_SESSION" })
          .catch(() => null);
        if (pong?.sessionId !== current.id) await stop();
      }
    }).catch(() => {});
});
