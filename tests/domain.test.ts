// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { openDB } from "idb";
import { IssueRepository, MAX_ISSUE_BYTES } from "../src/storage/repository";
import { buildExport, projectIssue, markdown } from "../src/export";
import { validateIssue } from "../src/shared/validation";
import { licenseStatus } from "../src/licensing";
import {
  DEFAULT_PRIVACY,
  type Issue,
  type PrivacyOptions,
} from "../src/shared/types";
function fixture(): Issue {
  const meta = { value: null, source: "not_collected" } as const;
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    createdAt: "2026-10-12T00:00:00.000Z",
    updatedAt: "2026-10-12T00:00:00.000Z",
    type: "visual_bug",
    title: "Button overlaps",
    description: "Observed overlap",
    severity: "medium",
    status: "open",
    expectedResult: null,
    actualResult: null,
    reproductionSteps: [],
    page: {
      url: "https://example.com/path?secret=yes#token",
      hostname: "example.com",
      title: "Page",
      scrollX: 0,
      scrollY: 100,
      viewport: { width: 800, height: 600 },
      screen: null,
      dpr: 2,
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
      country: { value: "US", source: "user_provided" },
      geoRegion: meta,
    },
    selection: {
      kind: "element",
      selectedRegion: null,
      element: {
        cssSelector: '[aria-label="private@example.com"]',
        xpath: "private@example.com",
        domPath: ["private@example.com"],
        tagName: "BUTTON",
        id: "private@example.com",
        classes: [],
        viewportBox: { x: 1, y: 2, width: 3, height: 4, unit: "css_px" },
        documentBox: null,
        attributes: { "aria-label": "private@example.com" },
        computedStyles: { color: "red" },
        sanitizedHtml: "<button>private@example.com</button>",
        textExcerpt: "private@example.com",
        locatorConfidence: "low",
        limitations: [],
      },
    },
    attachments: [],
    diagnostics: { console: "not_collected", network: "not_collected" },
    privacy: { urlQueryRemoved: true, fieldsOmitted: [], reviewedAt: null },
  };
}
describe("versioned domain contract", () => {
  it("rejects invalid UUID, bounds, title, unknown keys and inconsistent selection", () => {
    for (const change of [
      { id: "bad" },
      { title: " " },
      { schemaVersion: 2 },
      { surprise: true },
      { selection: { kind: "region", element: null, selectedRegion: null } },
    ])
      expect(() => validateIssue({ ...fixture(), ...change })).toThrow();
  });
  it("license remains trial only", () => {
    expect(licenseStatus(5)).toMatchObject({
      canCreate: false,
      purchaseAvailable: false,
    });
    expect(licenseStatus(0).remaining).toBe(5);
  });
});
describe("transactional local reports", () => {
  it("persists across repository instances and guards concurrent free-limit creates", async () => {
    const name = crypto.randomUUID(),
      repo = new IssueRepository(name);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 7 }, () =>
        repo.save({ issue: fixture(), original: null }),
      ),
    );
    expect(outcomes.filter((v) => v.status === "fulfilled")).toHaveLength(5);
    const second = new IssueRepository(name);
    expect(await second.list()).toHaveLength(5);
    const record = (await second.list())[0];
    await second.remove(record.issue.id);
    expect(await repo.get(record.issue.id)).toBeUndefined();
    await repo.close();
    await second.close();
  });
  it("preserves creation time, increments updates, rejects stale writes and duplicate creates", async () => {
    const repo = new IssueRepository(crypto.randomUUID()),
      issue = fixture();
    await repo.save({ issue, original: null });
    await repo.save({ issue, original: null });
    await expect(
      repo.save({
        issue: { ...issue, title: "Different title" },
        original: null,
      }),
    ).rejects.toThrow("already exists");
    await repo.update({
      ...issue,
      title: "Updated title",
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    const updated = (await repo.get(issue.id))!.issue;
    expect(updated.createdAt).toBe(issue.createdAt);
    expect(updated.updatedAt > issue.updatedAt).toBe(true);
    await expect(repo.update(issue)).rejects.toThrow("another window");
    await repo.close();
  });
  it("compares screenshot bytes on retries and preserves captured evidence during edits", async () => {
    const repo = new IssueRepository(crypto.randomUUID()),
      issue = fixture(),
      original = new Blob(["one"], { type: "image/png" });
    await repo.save({ issue, original });
    await repo.save({
      issue,
      original: new Blob(["one"], { type: "image/png" }),
    });
    await expect(
      repo.save({ issue, original: new Blob(["two"], { type: "image/png" }) }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await repo.update({
      ...issue,
      title: "Edited note",
      page: { ...issue.page, url: "https://forged.example/" },
      environment: {
        ...issue.environment,
        country: { value: "GB", source: "user_provided" },
      },
      selection: {
        kind: "region",
        element: null,
        selectedRegion: { x: 1, y: 1, width: 10, height: 10, unit: "css_px" },
      },
    });
    const saved = (await repo.get(issue.id))!;
    expect(saved.issue.page).toEqual(issue.page);
    expect(saved.issue.selection).toEqual(issue.selection);
    expect(saved.issue.environment).toEqual(issue.environment);
    expect(await saved.original!.text()).toBe("one");
    await repo.close();
  });
  it("returns actionable corruption errors without deleting data", async () => {
    const name = crypto.randomUUID(),
      repo = new IssueRepository(name),
      issue = fixture();
    await repo.save({ issue, original: null });
    const db = await openDB(name);
    const raw = await db.get("issues", issue.id);
    raw.issue.schemaVersion = 99;
    await db.put("issues", raw);
    await expect(repo.get(issue.id)).rejects.toMatchObject({
      code: "CORRUPT_STORAGE",
    });
    await expect(repo.list()).rejects.toMatchObject({
      code: "CORRUPT_STORAGE",
    });
    expect(await db.count("issues")).toBe(1);
    db.close();
    await repo.close();
  });
  it("maps a quota failure to STORAGE_FULL and rolls back an enqueued write", async () => {
    const repo = new IssueRepository(crypto.randomUUID()),
      before = fixture(),
      next = fixture();
    await repo.save({ issue: before, original: null });
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey,
      ) {
        originalPut.call(this, value, key);
        throw new DOMException(
          "Simulated disk quota exhaustion",
          "QuotaExceededError",
        );
      });
    try {
      await expect(
        repo.save({ issue: next, original: null }),
      ).rejects.toMatchObject({ code: "STORAGE_FULL" });
    } finally {
      put.mockRestore();
    }
    expect(await repo.get(next.id)).toBeUndefined();
    expect((await repo.list()).map((r) => r.issue.id)).toEqual([before.id]);
    await repo.save({ issue: next, original: null });
    expect(await repo.list()).toHaveLength(2);
    await repo.close();
  });
  it("retries after an asynchronous database-open failure on the same repository", async () => {
    const repo = new IssueRepository(crypto.randomUUID());
    const nativeOpen = indexedDB.open.bind(indexedDB);
    const open = vi
      .spyOn(indexedDB, "open")
      .mockImplementationOnce((name, version) => {
        const request = nativeOpen(name, version);
        request.addEventListener("upgradeneeded", () =>
          request.transaction!.abort(),
        );
        return request;
      });
    try {
      await expect(repo.list()).rejects.toMatchObject({
        code: "STORAGE_UNAVAILABLE",
      });
    } finally {
      open.mockRestore();
    }
    const issue = fixture();
    await repo.save({ issue, original: null });
    expect((await repo.get(issue.id))!.issue.id).toBe(issue.id);
    await repo.close();
  });
  it("rejects oversized screenshots without leaving a partial report", async () => {
    const repo = new IssueRepository(crypto.randomUUID());
    await expect(
      repo.save({
        issue: fixture(),
        original: new Blob([new Uint8Array(MAX_ISSUE_BYTES)], {
          type: "image/png",
        }),
      }),
    ).rejects.toThrow("10 MB");
    expect(await repo.list()).toHaveLength(0);
    await repo.close();
  });
});
describe("export privacy consistency", () => {
  it("keeps all 128 privacy projections valid and enforces omitted-field invariants", () => {
    const issue = fixture();
    issue.selection.element!.sanitizedHtml = "<button>[redacted]</button>";
    issue.attachments = [
      {
        id: "original_screenshot",
        kind: "original_screenshot",
        fileName: "screenshots/original.png",
        mimeType: "image/png",
        byteLength: 10,
        sha256: null,
      },
      {
        id: "element_html",
        kind: "element_html",
        fileName: "snapshots/element.html",
        mimeType: "text/html",
        byteLength: 29,
        sha256: null,
      },
    ];
    const original = JSON.stringify(issue),
      keys = Object.keys(DEFAULT_PRIVACY) as (keyof PrivacyOptions)[];
    for (let mask = 0; mask < 128; mask++) {
      const privacy = Object.fromEntries(
        keys.map((key, index) => [key, Boolean(mask & (1 << index))]),
      ) as unknown as PrivacyOptions;
      const result = projectIssue(issue, privacy);
      expect(() => validateIssue(result), `combination ${mask}`).not.toThrow();
      expect(result.id).toBe(issue.id);
      expect(JSON.stringify(result)).not.toContain("private@example.com");
      expect(result.privacy.fieldsOmitted.sort()).toEqual(
        keys.filter((k) => !privacy[k]).sort(),
      );
      if (!privacy.screenshot)
        expect(
          result.attachments.some((a) => a.kind.includes("screenshot")),
        ).toBe(false);
      if (!privacy.html) {
        expect(result.selection.element!.sanitizedHtml).toBeNull();
        expect(result.attachments.some((a) => a.kind === "element_html")).toBe(
          false,
        );
      }
      if (!privacy.pageUrl) {
        expect(result.page.url).toBeNull();
        expect(result.page.hostname).toBeNull();
        expect(result.page.title).toBeNull();
      }
      if (!privacy.country) {
        expect(result.environment.country.value).toBeNull();
        expect(result.environment.geoRegion.value).toBeNull();
      }
      if (!privacy.elementText)
        expect(result.selection.element!.textExcerpt).toBeNull();
      if (!privacy.attributes)
        expect(result.selection.element!.attributes).toEqual({});
    }
    expect(JSON.stringify(issue)).toBe(original);
  });
  it("removes derivative fields and strips query and fragment", () => {
    const source = fixture(),
      projected = projectIssue(source, {
        ...DEFAULT_PRIVACY,
        screenshot: false,
      });
    expect(projected.page.url).toBe("https://example.com/path");
    expect(JSON.stringify(projected)).not.toContain("private@example.com");
    expect(projected.selection.element).toMatchObject({
      cssSelector: null,
      xpath: null,
      domPath: [],
      sanitizedHtml: null,
      attributes: {},
      textExcerpt: null,
    });
    expect(source.selection.element!.cssSelector).not.toBeNull();
    expect(markdown(projected)).not.toContain("private@example.com");
  });
  it("preserves safe structural evidence while rejecting executable HTML even with every toggle enabled", () => {
    const issue = fixture();
    issue.selection.element!.cssSelector =
      "html:nth-of-type(1) > body:nth-of-type(1)";
    issue.selection.element!.xpath =
      "/*[local-name()='html'][1]/*[local-name()='body'][1]";
    issue.selection.element!.sanitizedHtml = "<button>[redacted]</button>";
    expect(
      projectIssue(issue, { ...DEFAULT_PRIVACY, html: true }).selection.element!
        .sanitizedHtml,
    ).toBe("<button>[redacted]</button>");
    expect(
      projectIssue(issue, DEFAULT_PRIVACY).selection.element!.cssSelector,
    ).toBe(issue.selection.element!.cssSelector);
    issue.selection.element!.sanitizedHtml = "<script>alert(1)</script>";
    expect(
      projectIssue(issue, {
        screenshot: true,
        pageUrl: true,
        elementText: true,
        html: true,
        attributes: true,
        country: true,
        assetUrls: true,
      }).selection.element!.sanitizedHtml,
    ).toBeNull();
  });
  it("omits all screenshot and HTML files and references from ZIP", async () => {
    const result = await buildExport(
      { issue: fixture(), original: null },
      { ...DEFAULT_PRIVACY, screenshot: false, pageUrl: false },
      "zip",
    );
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual([
      "metadata.json",
      "report.md",
    ]);
    const metadata = JSON.parse(
      await zip.file("metadata.json")!.async("string"),
    );
    expect(metadata.attachments).toEqual([]);
    expect(metadata.page.url).toBeNull();
    expect(await zip.file("report.md")!.async("string")).not.toContain(
      "example.com",
    );
  });
  it("ZIP attachment metadata resolves to the actual safe relative path", async () => {
    const issue = fixture();
    issue.selection.element!.sanitizedHtml = "<button>[redacted]</button>";
    const result = await buildExport(
      { issue, original: null },
      { ...DEFAULT_PRIVACY, html: true },
      "zip",
    );
    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer()),
      metadata = JSON.parse(await zip.file("metadata.json")!.async("string"));
    expect(metadata.attachments[0].fileName).toBe("snapshots/element.html");
    expect(zip.file(metadata.attachments[0].fileName)).not.toBeNull();
    expect(() => validateIssue(metadata)).not.toThrow();
    for (const path of ["../element.html", "/tmp/element.html", "element.html"])
      expect(() =>
        validateIssue({
          ...metadata,
          attachments: [{ ...metadata.attachments[0], fileName: path }],
        }),
      ).toThrow();
  });
  it("standalone metadata cannot claim absent attachments", async () => {
    const issue = fixture();
    issue.attachments = [
      {
        id: "image",
        kind: "original_screenshot",
        fileName: "screenshots/original.png",
        mimeType: "image/png",
        byteLength: 42,
        sha256: null,
      },
    ];
    const result = await buildExport(
      { issue, original: null },
      DEFAULT_PRIVACY,
      "json",
    );
    expect(JSON.parse(await result.blob.text()).attachments).toEqual([]);
    await expect(
      buildExport({ issue, original: null }, DEFAULT_PRIVACY, "image"),
    ).rejects.toThrow("screenshot");
  });
});
