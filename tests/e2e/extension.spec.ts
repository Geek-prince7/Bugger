import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import path from "node:path";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import JSZip from "jszip";
let context: BrowserContext, worker: Worker, id: string, page: Page;
let profile: string;
let launchOptions: NonNullable<
  Parameters<typeof chromium.launchPersistentContext>[1]
>;
const fixtureUrl = "http://bugger.test/";
test.beforeEach(async () => {
  profile = await mkdtemp(path.join(os.tmpdir(), "bugger-e2e-"));
  launchOptions = {
    ...(process.env.BROWSER_EXECUTABLE_PATH
      ? { executablePath: process.env.BROWSER_EXECUTABLE_PATH }
      : { channel: "chromium" }),
    headless: true,
    args: [
      `--disable-extensions-except=${path.resolve("dist")}`,
      `--load-extension=${path.resolve("dist")}`,
      "--enable-unsafe-extension-debugging",
    ],
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
  };
  context = await chromium.launchPersistentContext(profile, launchOptions);
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  id = worker.url().split("/")[2];
  await context.route("http://bugger.test/**", async (route) =>
    route.fulfill({
      body: await readFile("tests/fixture.html", "utf8"),
      contentType: "text/html",
    }),
  );
  page = await context.newPage();
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.goto(fixtureUrl);
  await page.bringToFront();
});
test.afterEach(async () => {
  await context?.close();
  if (profile) await rm(profile, { recursive: true, force: true });
});
async function activate() {
  const cdp = await context.browser()!.newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets", {
    filter: [{ type: "tab", exclude: false }],
  });
  const targetInfo = targetInfos.find((t) => t.url === page.url())!;

  await cdp.send("Extensions.triggerAction", {
    id,
    targetId: targetInfo.targetId,
  });
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${id}/popup.html`);
  await expect(
    popup.getByRole("button", { name: "Start capture" }),
  ).toBeVisible();
  await page.bringToFront();
  const result = await popup.evaluate(() =>
    chrome.runtime.sendMessage({ type: "START_CAPTURE" }),
  );
  expect(result.ok, JSON.stringify(result)).toBe(true);
  await popup.close();
  await expect(page.locator("#bugger-capture")).toBeAttached();
  await cdp.detach();
}
async function save(title: string, screenshot = true) {
  await page.locator("#checkout").click();
  await page.getByLabel("Title (required)").fill(title);
  if (!screenshot)
    await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved locally");
}
async function manager() {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/issues.html`);
  return p;
}
test("no passive injection; real activation, screenshot, persistence, edit, ZIP and deletion", async () => {
  expect(await page.locator("#bugger-capture").count()).toBe(0);
  await activate();
  await save("Checkout button does not respond");
  expect(
    await page.locator("#checkout").getAttribute("data-clicked"),
  ).toBeNull();
  const p = await manager();
  await p
    .getByRole("button")
    .filter({ hasText: "Checkout button does not respond" })
    .click();
  await expect(
    p.getByAltText(
      "Original captured viewport, before export privacy exclusions",
    ),
  ).toBeVisible();
  await p.screenshot({
    path: "test-results/bugger-workspace.png",
    fullPage: true,
  });
  await p.getByRole("button", { name: "Edit issue", exact: true }).click();
  await p.getByLabel("Title", { exact: true }).fill("Checkout review updated");
  await p.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    p.getByRole("heading", {
      name: "Checkout review updated",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  const downloading = p.waitForEvent("download");
  await p.getByRole("button", { name: "Download ZIP" }).click();
  const dl = await downloading;
  const zip = await JSZip.loadAsync(await readFile((await dl.path())!));
  expect(Object.keys(zip.files)).toContain("screenshots/original.png");
  expect(Object.keys(zip.files)).toContain("screenshots/annotated.png");
  const meta = JSON.parse(await zip.file("metadata.json")!.async("string"));
  expect(meta.title).toBe("Checkout review updated");
  expect(
    meta.attachments.map((a: { fileName: string }) => a.fileName),
  ).toContain("screenshots/annotated.png");
  expect(JSON.stringify(meta)).not.toContain("secret-password");
  const pixels = await p.evaluate(
    async ({ original, annotated, bounds, viewport }) => {
      async function sample(base64: string, x: number, y: number) {
        const bitmap = await createImageBitmap(
          await (await fetch(`data:image/png;base64,${base64}`)).blob(),
        );
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const sample = Array.from(
          ctx.getImageData(
            Math.round((x * bitmap.width) / viewport.width),
            Math.round((y * bitmap.height) / viewport.height),
            1,
            1,
          ).data,
        );
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        return { sample, size };
      }
      return {
        toolbar: await sample(original, 20, 20),
        drawer: await sample(original, 1000, 100),
        marker: await sample(annotated, bounds.x + bounds.width / 2, bounds.y),
      };
    },
    {
      original: await zip.file("screenshots/original.png")!.async("base64"),
      annotated: await zip.file("screenshots/annotated.png")!.async("base64"),
      bounds: meta.selection.element.viewportBox,
      viewport: meta.page.viewport,
    },
  );
  expect(pixels.toolbar.sample.slice(0, 3)).toEqual([246, 245, 239]);
  expect(pixels.drawer.sample.slice(0, 3)).toEqual([246, 245, 239]);
  expect(pixels.marker.sample.slice(0, 3)).toEqual([239, 68, 68]);
  expect(meta.page.dpr).toBe(2);
  expect(pixels.toolbar.size.width).toBeGreaterThanOrEqual(
    meta.page.viewport.width,
  );

  await p.getByLabel("Screenshot", { exact: true }).uncheck();
  await p.getByLabel("Page URL", { exact: true }).uncheck();
  const noImage = p.waitForEvent("download");
  await p.getByRole("button", { name: "Download ZIP" }).click();
  const omitted = await JSZip.loadAsync(
    await readFile((await (await noImage).path())!),
  );
  expect(Object.keys(omitted.files).sort()).toEqual([
    "metadata.json",
    "report.md",
  ]);
  expect(await omitted.file("metadata.json")!.async("string")).not.toContain(
    "bugger.test",
  );
  await p.reload();
  await p
    .getByRole("button")
    .filter({ hasText: "Checkout review updated" })
    .click();
  await expect(
    p.getByRole("heading", {
      name: "Checkout review updated",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await p.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(p.getByRole("dialog")).toBeVisible();
  await p.getByRole("button", { name: "Delete permanently" }).click();
  await expect(p.getByText("A clean slate.")).toBeVisible();
});
test("region capture, screenshot-free save, keyboard alternative and stop cleanup", async () => {
  await activate();
  await page
    .getByRole("button", { name: "Select region", exact: true })
    .click();
  await page.mouse.move(100, 200);
  await page.mouse.down();
  await page.mouse.move(300, 350);
  await page.mouse.up();
  await page.getByLabel("Title (required)").fill("Region overlap");
  await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved locally");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#bugger-capture")).toHaveCount(0);
  await page.locator("#checkout").click();
  expect(await page.locator("#checkout").getAttribute("data-clicked")).toBe(
    "yes",
  );
  const p = await manager();
  await p.getByRole("button").filter({ hasText: "Region overlap" }).click();
  await expect(p.getByText("No screenshot collected")).toBeVisible();
  const raw = await p.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "ISSUE_LIST" }),
  );
  expect(raw.data[0].selection).toMatchObject({
    kind: "region",
    selectedRegion: { x: 100, y: 200, width: 200, height: 150 },
  });
});
test("scroll invalidates capture while keeping notes; restricted activation fails clearly", async () => {
  await activate();
  await page.locator("#checkout").click();
  await page.getByLabel("Title (required)").fill("Keep my unsaved note");
  await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.evaluate(() => scrollTo(0, 400));
  await expect(page.locator("#status")).toContainText("Capture evidence again");
  await expect(page.getByLabel("Title (required)")).toHaveValue(
    "Keep my unsaved note",
  );
  const p = await manager();
  const result = await p.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "START_CAPTURE" }),
  );
  expect(result).toMatchObject({
    ok: false,
    error: { code: "UNSUPPORTED_PAGE" },
  });
});
test("five-report limit retains sixth draft; offline exports and browser worker restart preserve reports", async () => {
  await activate();
  for (let n = 1; n <= 5; n++) await save(`Observation number ${n}`, false);
  await page.locator("#checkout").click();
  await page.getByLabel("Title (required)").fill("Sixth report draft");
  await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.locator("#status")).toContainText(
    "Five-report trial limit",
  );
  await expect(page.getByLabel("Title (required)")).toHaveValue(
    "Sixth report draft",
  );
  const p = await manager();
  const cdp = await context.newCDPSession(p);
  await cdp.send("ServiceWorker.enable");
  await cdp.send("ServiceWorker.stopAllWorkers");
  await cdp.detach();
  await p.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
  await context.setOffline(true);
  await p
    .getByRole("button")
    .filter({ hasText: "Observation number 1" })
    .click();
  const downloading = p.waitForEvent("download");
  await p.getByRole("button", { name: "JSON", exact: true }).click();
  const downloaded = await downloading;
  expect(
    JSON.parse(await readFile((await downloaded.path())!, "utf8")).title,
  ).toBe("Observation number 1");
});
test("keyboard selection, settings provenance, narrow viewport and SPA draft retention", async () => {
  const settings = await manager();
  await settings
    .getByRole("button", { name: "Settings", exact: false })
    .click();
  await settings.getByLabel("Country", { exact: true }).fill("India");
  await settings
    .getByLabel("State or region", { exact: true })
    .fill("Maharashtra");
  await settings.getByRole("button", { name: "Save preferences" }).click();
  await expect(settings.getByRole("status")).toContainText("Preferences saved");
  await settings.close();
  await page.setViewportSize({ width: 430, height: 900 });
  await page.bringToFront();
  await activate();
  await page.locator("#checkout").focus();
  await page.keyboard.press("Alt+Shift+KeyB");
  await expect(page.getByLabel("Title (required)")).toBeFocused();
  await expect(page.getByLabel("Country (optional)")).toHaveValue("India");
  await page.getByLabel("Title (required)").fill("Keyboard observation");
  await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.evaluate(() => history.pushState({}, "", "/changed-route"));
  await expect(page.locator("#status")).toContainText("navigation changed");
  await expect(page.getByLabel("Title (required)")).toHaveValue(
    "Keyboard observation",
  );
  await expect(page.locator("#bugger-capture")).toBeAttached();
  page.once("dialog", (d) => d.accept());
  await page.keyboard.press("Escape");
  await expect(page.locator("#bugger-capture")).toHaveCount(0);
});
test("strict page CSP does not prevent isolated capture controls", async () => {
  await context.route("http://bugger.test/csp", async (route) =>
    route.fulfill({
      body: await readFile("tests/fixture.html", "utf8"),
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'self'; script-src 'self'; style-src 'unsafe-inline'; require-trusted-types-for 'script'",
      },
    }),
  );
  await page.goto("http://bugger.test/csp");
  await activate();
  await save("Strict CSP observation", false);
  await expect(page.locator("#status")).toContainText("Saved locally");
});
test("cold browser restart preserves reports and opens the manager offline", async () => {
  await activate();
  await save("Survives a browser restart", false);
  await context.close();
  context = await chromium.launchPersistentContext(profile, launchOptions);
  await context.setOffline(true);
  const p = await context.newPage();
  await p.goto(`chrome-extension://${id}/issues.html`, {
    waitUntil: "domcontentloaded",
    timeout: 10000,
  });
  await p
    .getByRole("button")
    .filter({ hasText: "Survives a browser restart" })
    .click();
  await expect(
    p.getByRole("heading", { name: "Survives a browser restart", level: 2 }),
  ).toBeVisible();
  const request = await p.evaluate(() =>
    chrome.runtime.sendMessage({ type: "ISSUE_LIST" }),
  );
  expect(request.data).toHaveLength(1);
  const staged = await p.evaluate(async () => {
    const open = indexedDB.open("bugger-captures");
    return await new Promise<number>((resolve, reject) => {
      open.onsuccess = () => {
        const db = open.result;
        const count = db.transaction("pending").objectStore("pending").count();
        count.onsuccess = () => {
          resolve(count.result);
          db.close();
        };
        count.onerror = () => reject(count.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  expect(staged).toBe(0);
});
test("clipboard actions copy locators and reviewed report; screenshot failure preserves draft", async () => {
  await activate();
  await page.locator("#checkout").click();
  await page.getByLabel("Title (required)").fill("Screenshot failure recovery");
  await worker.evaluate(() => {
    chrome.tabs.captureVisibleTab = async () => {
      throw new Error("Injected test failure");
    };
  });
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Screenshot unavailable");
  await expect(page.getByLabel("Title (required)")).toHaveValue(
    "Screenshot failure recovery",
  );
  await page.getByLabel("Include visible-tab screenshot").uncheck();
  await page
    .getByRole("button", { name: "Capture evidence", exact: true })
    .click();
  await expect(page.locator("#status")).toContainText("Evidence captured");
  await page.getByRole("button", { name: "Save locally", exact: true }).click();
  await expect(page.locator("#status")).toContainText("Saved locally");
  const p = await manager();
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await p
    .getByRole("button")
    .filter({ hasText: "Screenshot failure recovery" })
    .click();
  await p.getByText("Developer context", { exact: false }).click();
  await p.getByRole("button", { name: "Copy selector", exact: true }).click();
  await expect
    .poll(() => p.evaluate(() => navigator.clipboard.readText()))
    .toContain("button:nth-of-type");
  await p.getByRole("button", { name: "Copy XPath", exact: true }).click();
  await expect
    .poll(() => p.evaluate(() => navigator.clipboard.readText()))
    .toContain("local-name()='button'");
  await p.getByRole("button", { name: "Copy report", exact: true }).click();
  await expect
    .poll(() => p.evaluate(() => navigator.clipboard.readText()))
    .toContain("Screenshot failure recovery");
});
