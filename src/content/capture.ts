import type {
  Box,
  CaptureDraft,
  ElementSnapshot,
  EnvironmentContext,
  MetadataValue,
} from "../shared/types";
const box = (r: DOMRect, dx = 0, dy = 0): Box => ({
  x: r.x + dx,
  y: r.y + dy,
  width: r.width,
  height: r.height,
  unit: "css_px",
});
const omitted =
  "input,textarea,select,option,script,style,iframe,object,embed,[contenteditable], [hidden]";
/** Structural locators deliberately omit IDs and classes: they can contain personal data. */
export function locator(el: Element): {
  css: string | null;
  xpath: string | null;
  path: string[];
} {
  const css: string[] = [],
    xpath: string[] = [],
    path: string[] = [];
  let truncated = false;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (path.length >= 100) {
      truncated = true;
      break;
    }
    const tag = n.localName;
    const siblings = n.parentElement
      ? Array.from(n.parentElement.children).filter((x) => x.localName === tag)
      : [n];
    const index = siblings.indexOf(n) + 1;
    css.unshift(`${CSS.escape(tag)}:nth-of-type(${index})`);
    xpath.unshift(`*[local-name()='${tag.replace(/'/g, "")}'][${index}]`);
    path.unshift(tag);
  }
  const cssValue = css.join(" > "),
    xpathValue = "/" + xpath.join("/");
  return {
    css: truncated || cssValue.length > 2000 ? null : cssValue,
    xpath: truncated || xpathValue.length > 2000 ? null : xpathValue,
    path,
  };
}
export function sanitizeSubtree(el: Element, maxBytes = 20000): string {
  let remaining = Math.min(20000, Math.max(0, maxBytes)),
    visited = 0;
  function walk(n: Element, depth: number): string {
    if (depth > 3 || ++visited > 150 || n.matches(omitted) || remaining < 30)
      return "";
    const tag = /^[a-z][a-z0-9-]{0,63}$/.test(n.localName)
      ? n.localName
      : "span";
    const open = `<${tag}>`,
      close = `</${tag}>`;
    if (open.length + close.length > remaining) return "";
    remaining -= open.length + close.length;
    let inside = "";
    for (let i = 0; i < Math.min(n.children.length, 100); i++) {
      inside += walk(n.children[i]!, depth + 1);
    }
    if (
      !inside &&
      Array.from(n.childNodes)
        .slice(0, 100)
        .some((child) => child.nodeType === 3 && child.nodeValue?.trim()) &&
      remaining >= 10
    ) {
      inside = "[redacted]";
      remaining -= 10;
    }
    return open + inside + close;
  }
  return walk(el, 0);
}
/** Only layout keywords and numeric values survive; custom grid names and URLs do not. */
export function sanitizeStyle(value: string): string {
  if (value.length > 500) return "[omitted]";
  const clean = value.replace(/\[[^\]]*\]/g, "[redacted]");
  const allowed = new Set(
    "redacted auto none normal block inline inline-block flex inline-flex grid inline-grid table table-row table-cell contents flow-root list-item static relative absolute fixed sticky row column row-reverse column-reverse visible hidden clip scroll border-box content-box collapse inherit initial unset transparent currentcolor solid rgb rgba hsl hsla matrix matrix3d translate translatex translatey translatez translate3d scale scalex scaley scalez scale3d rotate rotatex rotatey rotatez rotate3d skew skewx skewy perspective minmax repeat fit-content min-content max-content subgrid masonry px em rem vh vw vmin vmax svh dvh lv h ch ex fr deg rad turn calc min max clamp srgb display-p3 color".split(
      " ",
    ),
  );
  const words = clean.toLowerCase().match(/[a-z][a-z0-9-]*/g) ?? [];
  return words.every((word) => allowed.has(word)) && !/["'{};@\\]/.test(clean)
    ? clean
    : "[omitted]";
}
export function snapshotElement(el: Element): ElementSnapshot {
  const l = locator(el),
    r = el.getBoundingClientRect(),
    style = getComputedStyle(el),
    computedStyles: Record<string, string> = {};
  for (const key of [
    "display",
    "position",
    "flexDirection",
    "gridTemplateColumns",
    "overflow",
    "width",
    "height",
    "margin",
    "padding",
    "fontSize",
    "lineHeight",
    "color",
    "backgroundColor",
    "zIndex",
    "transform",
    "boxSizing",
    "visibility",
    "opacity",
  ])
    computedStyles[key] = sanitizeStyle(
      (style as unknown as Record<string, string>)[key] || "",
    );
  return {
    cssSelector: l.css,
    xpath: l.xpath,
    domPath: l.path,
    tagName: el.localName,
    id: null,
    classes: [],
    viewportBox: box(r),
    documentBox: box(r, scrollX, scrollY),
    attributes: {},
    computedStyles,
    sanitizedHtml: sanitizeSubtree(el),
    textExcerpt: null,
    locatorConfidence: "low",
    limitations: [
      "Structural locator may change when the page changes.",
      ...(!l.css || !l.xpath
        ? ["Locator omitted because the DOM path exceeds safe size limits."]
        : []),
      "Custom computed-style names and oversized values are omitted.",
      "Text, attributes, IDs, classes and form fields omitted for privacy.",
      "Shadow roots, iframe content and external assets are not captured.",
    ],
  };
}
export function cleanUrl(raw: string): string {
  const u = new URL(raw);
  u.username = "";
  u.password = "";
  u.search = "";
  u.hash = "";
  let previous = "";
  u.pathname = u.pathname
    .split("/")
    .map((segment) => {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return "[redacted]";
      }
      const sensitive =
        /@|%40/i.test(decoded) ||
        /(?:token|secret|password|session|auth|apikey|api-key)/i.test(
          decoded,
        ) ||
        /^(?:reset|verify|invite|token|secret|password|session|auth|apikey|api-key)$/i.test(
          previous,
        ) ||
        /[A-Za-z0-9_-]{24,}/.test(decoded) ||
        /[a-f0-9]{8}-[a-f0-9-]{20,}/i.test(decoded);
      previous = decoded;
      return sensitive ? "[redacted]" : segment;
    })
    .join("/");
  return u.href;
}
export function collectDraft(
  element: Element | null,
  region: Box | null,
): CaptureDraft {
  const val = (
    value: string | null,
    source: MetadataValue["source"] = "browser_api",
  ): MetadataValue => ({ value, source: value ? source : "not_collected" });
  const ua = navigator.userAgent;
  const match = ua.match(/(?:Chrome|Chromium)\/([\d.]+)/);
  const environment: EnvironmentContext = {
    userAgent: val(ua),
    browserName: val(
      match ? "Chromium-based browser" : null,
      "derived_heuristic",
    ),
    browserVersion: val(match?.[1] ?? null, "derived_heuristic"),
    os: val(
      /Windows/.test(ua)
        ? "Windows"
        : /Macintosh/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : null,
      "derived_heuristic",
    ),
    deviceType: {
      value: /Mobile/.test(ua) ? "mobile" : "desktop",
      source: "derived_heuristic",
    },
    language: val(navigator.language),
    timezone: val(Intl.DateTimeFormat().resolvedOptions().timeZone),
    country: val(null),
    geoRegion: val(null),
  };
  return {
    page: {
      url: cleanUrl(location.href),
      hostname: location.hostname,
      title: null,
      scrollX,
      scrollY,
      viewport: { width: innerWidth, height: innerHeight },
      screen: { width: screen.width, height: screen.height },
      dpr: devicePixelRatio,
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
    },
    environment,
    selection: {
      kind: element ? "element" : "region",
      element: element ? snapshotElement(element) : null,
      selectedRegion: region,
    },
  };
}
