// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanUrl,
  sanitizeStyle,
  locator,
  sanitizeSubtree,
  snapshotElement,
} from "../src/content/capture";
beforeAll(() => {
  Object.defineProperty(globalThis, "CSS", {
    value: { escape: (s: string) => s },
  });
});
describe("privacy-first capture", () => {
  it("omits text, attributes, input values, hidden and executable nodes", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-secret="token">alice@example.com<input value="secret"><textarea>private</textarea><script>secret()</script><span hidden>hidden</span><div contenteditable>secret</div><strong>readable</strong></div>';
    const html = sanitizeSubtree(root);
    expect(html).not.toMatch(
      /alice|secret|private|hidden|script|input|textarea|data-secret/,
    );
    expect(html).toContain("[redacted]");
  });
  it("bounds serialized bytes and depth on huge trees", () => {
    const el = document.createElement("div");
    el.innerHTML =
      "<section><div><p><strong>deep</strong></p></div></section>".repeat(1000);
    expect(
      new TextEncoder().encode(sanitizeSubtree(el, 400)).length,
    ).toBeLessThanOrEqual(400);
    expect(sanitizeSubtree(el)).not.toContain("strong");
  });
  it("removes URL credentials, query and fragment", () => {
    expect(
      cleanUrl("https://name:password@example.com/path?token=secret#private"),
    ).toBe("https://example.com/path");
  });
  it("locates nested sibling without leaking sensitive IDs", () => {
    document.body.innerHTML =
      '<section><button id="email-secret">A</button><button>B</button></section>';
    const el = document.querySelector("button:nth-child(2)")!;
    const l = locator(el);
    expect(document.querySelector(l.css!)).toBe(el);
    expect(l.xpath).toContain("*[local-name()='button'][2]");
    expect(l.css).not.toContain("secret");
  });
  it("retains bounding coordinates but omits sensitive attributes and excerpt", () => {
    document.body.innerHTML =
      '<div id="private" class="secret" aria-label="name">hello</div>';
    const s = snapshotElement(document.body.firstElementChild!);
    expect(s.id).toBeNull();
    expect(s.classes).toEqual([]);
    expect(s.attributes).toEqual({});
    expect(s.textExcerpt).toBeNull();
    expect(s.viewportBox?.unit).toBe("css_px");
  });
});

describe("bounded private context", () => {
  it("redacts decoded email and token paths but preserves normal routes", () => {
    expect(
      cleanUrl("https://example.com/users/alice%40example.com/report"),
    ).not.toContain("alice");
    expect(cleanUrl("https://example.com/reset/shortsecret")).not.toContain(
      "shortsecret",
    );
    expect(cleanUrl("https://example.com/token/shortsecret")).not.toContain(
      "shortsecret",
    );
    expect(
      cleanUrl("https://example.com/a/eyJhbGciOiJIUzI1NiJ9eyJzdWIiOiI"),
    ).not.toContain("eyJ");
    expect(cleanUrl("https://example.com/products/widget-123/details")).toBe(
      "https://example.com/products/widget-123/details",
    );
  });
  it("bounds styles and removes custom names and resource values", () => {
    expect(sanitizeStyle("[customer-secret] 100px [email-alice] 1fr")).toBe(
      "[redacted] 100px [redacted] 1fr",
    );
    expect(sanitizeStyle("var(--secret-token)")).toBe("[omitted]");
    expect(sanitizeStyle('url("https://private.example")')).toBe("[omitted]");
    expect(sanitizeStyle("x".repeat(501))).toBe("[omitted]");
    expect(sanitizeStyle("rgb(12, 20, 30)")).toBe("rgb(12, 20, 30)");
  });
  it("omits oversized locators and bounds DOM breadcrumbs", () => {
    const root = document.createElement("div");
    document.body.append(root);
    let current = root;
    for (let i = 0; i < 130; i++) {
      const next = document.createElement("div");
      current.append(next);
      current = next;
    }
    const loc = locator(current);
    expect(loc.css).toBeNull();
    expect(loc.xpath).toBeNull();
    expect(loc.path.length).toBe(100);
    expect(snapshotElement(current).limitations.join(" ")).toContain(
      "safe size limits",
    );
  });
});

it("maps viewport bounds to document coordinates after scrolling", () => {
  const element = document.createElement("button");
  document.body.append(element);
  const rect = {
    x: 20,
    y: 30,
    width: 100,
    height: 40,
    top: 30,
    left: 20,
    right: 120,
    bottom: 70,
    toJSON: () => ({}),
  };
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(rect);
  vi.stubGlobal("scrollX", 15);
  vi.stubGlobal("scrollY", 600);
  try {
    const capture = snapshotElement(element);
    expect(capture.viewportBox).toEqual({
      x: 20,
      y: 30,
      width: 100,
      height: 40,
      unit: "css_px",
    });
    expect(capture.documentBox).toEqual({
      x: 35,
      y: 630,
      width: 100,
      height: 40,
      unit: "css_px",
    });
  } finally {
    vi.unstubAllGlobals();
    element.remove();
  }
});
