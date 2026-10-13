import JSZip from "jszip";
import type {
  Issue,
  PrivacyOptions,
  StoredIssue,
  Attachment,
} from "../shared/types";
import { validateIssue } from "../shared/validation";
const redact = (s: string) =>
  s
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted email]")
    .replace(/\b(?:bearer\s+)?[A-Za-z0-9_-]{32,}\b/gi, "[redacted token]");
function cleanUrl(value: string): string {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return "[removed URL]";
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return redact(url.toString());
  } catch {
    return "[removed URL]";
  }
}
/** One projection feeds every export format; toggles must never be implemented separately. */
export function projectIssue(input: Issue, privacy: PrivacyOptions): Issue {
  const issue = structuredClone(validateIssue(input));
  issue.privacy = {
    urlQueryRemoved: true,
    fieldsOmitted: Object.entries(privacy)
      .filter(([, v]) => !v)
      .map(([k]) => k),
    reviewedAt: new Date().toISOString(),
  };
  if (issue.page.url) issue.page.url = cleanUrl(issue.page.url);
  if (!privacy.pageUrl) {
    issue.page.url = null;
    issue.page.hostname = null;
    issue.page.title = null;
  }
  if (!privacy.country) {
    issue.environment.country = { value: null, source: "not_collected" };
    issue.environment.geoRegion = { value: null, source: "not_collected" };
  }
  const e = issue.selection.element;
  if (e) {
    if (!privacy.elementText) e.textExcerpt = null;
    if (!privacy.html) e.sanitizedHtml = null;
    // Selectors/paths and HTML can repeat identifiers, labels and text. Remove these
    // derivatives when the associated source is withheld, rather than leak via a second format.
    const structuralHtml =
      e.sanitizedHtml !== null &&
      /^(?:<\/?[a-z][a-z0-9-]*>|\[redacted\])*$/.test(e.sanitizedHtml);
    if (
      !structuralHtml ||
      /<\/?(?:script|style|iframe|object|embed|input|textarea|select|option|link|meta|base)\b/i.test(
        e.sanitizedHtml ?? "",
      )
    )
      e.sanitizedHtml = null;
    const structuralCss =
      e.cssSelector !== null &&
      /^[a-z][a-z0-9-]*:nth-of-type\(\d+\)(?: > [a-z][a-z0-9-]*:nth-of-type\(\d+\))*$/.test(
        e.cssSelector,
      );
    const structuralXpath =
      e.xpath !== null &&
      /^(?:\/\*\[local-name\(\)='[a-z][a-z0-9-]*'\]\[\d+\])+$/.test(e.xpath);
    const stripLocators = () => {
      if (!structuralCss) e.cssSelector = null;
      if (!structuralXpath) e.xpath = null;
      e.domPath = e.domPath.filter((p) => /^[a-z][a-z0-9-]*$/.test(p));
    };
    if (!privacy.attributes) {
      e.attributes = {};
      e.id = null;
      e.classes = [];
      stripLocators();
    }
    if (!privacy.elementText) {
      e.attributes = {};
      e.id = null;
      e.classes = [];
      stripLocators();
    }
    if (!privacy.pageUrl || !privacy.assetUrls) {
      stripLocators();
      e.attributes = Object.fromEntries(
        Object.entries(e.attributes).filter(
          ([key, value]) =>
            !/(?:href|src|url|action)/i.test(key) &&
            !/(?:https?:|\/\/)/i.test(value),
        ),
      );
    }
    e.computedStyles = Object.fromEntries(
      Object.entries(e.computedStyles).filter(
        ([, value]) => !/(?:url\s*\(|https?:)/i.test(value),
      ),
    );
  }
  issue.attachments = issue.attachments.filter((a) =>
    a.kind === "element_html" ? Boolean(e?.sanitizedHtml) : privacy.screenshot,
  );
  // Defense in depth on all strings, including user-written prose and locators.
  const projected = JSON.parse(
    JSON.stringify(issue, (key, value: unknown) =>
      typeof value === "string" && key !== "sha256" ? redact(value) : value,
    ),
  ) as Issue;
  projected.id = issue.id;
  return projected;
}
function md(value: string | null): string {
  return (value ?? "Not collected").replace(/[\\`*_{}\[\]()<>#!|]/g, "\\$&");
}
export function markdown(issue: Issue): string {
  const element = issue.selection.element;
  return `# ${md(issue.title)}\n\n**Type:** ${md(issue.type)} · **Severity:** ${md(issue.severity)} · **Status:** ${md(issue.status)}\n\n${md(issue.description)}\n\n## Observation\n\n**Expected:** ${md(issue.expectedResult)}\n\n**Actual:** ${md(issue.actualResult)}\n\n## Reproduction steps\n\n${issue.reproductionSteps.map((step, i) => `${i + 1}. ${md(step)}`).join("\n") || "Not provided"}\n\n## Developer context\n\n- Page: ${md(issue.page.url)}\n- Captured: ${issue.createdAt}\n- Viewport: ${issue.page.viewport.width} × ${issue.page.viewport.height} CSS pixels\n- DPR: ${issue.page.dpr}\n- Selector: ${md(element?.cssSelector ?? null)}\n- XPath: ${md(element?.xpath ?? null)}\n- Browser: ${md(issue.environment.browserName.value)}\n- OS: ${md(issue.environment.os.value)}\n- Country: ${md(issue.environment.country.value)} (${issue.environment.country.source})\n\n## Attachments\n\n${issue.attachments.map((a) => `- ${md(a.fileName)} (${a.byteLength} bytes)`).join("\n") || "None"}\n\nSnapshot is diagnostic evidence, not a full reproduction. Locators are best effort. Console and network diagnostics were not collected.\n`;
}
export async function annotate(original: Blob, issue: Issue): Promise<Blob> {
  const bitmap = await createImageBitmap(original);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image annotation is unavailable.");
    ctx.drawImage(bitmap, 0, 0);
    const bounds =
      issue.selection.selectedRegion ?? issue.selection.element?.viewportBox;
    if (bounds) {
      const sx = bitmap.width / issue.page.viewport.width,
        sy = bitmap.height / issue.page.viewport.height;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3 * Math.max(sx, sy);
      ctx.strokeRect(
        bounds.x * sx,
        bounds.y * sy,
        bounds.width * sx,
        bounds.height * sy,
      );
      ctx.beginPath();
      ctx.arc(
        Math.max(14 * sx, bounds.x * sx),
        Math.max(14 * sy, bounds.y * sy),
        12 * Math.max(sx, sy),
        0,
        2 * Math.PI,
      );
      ctx.fillStyle = "#ef4444";
      ctx.fill();
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `bold ${14 * Math.max(sx, sy)}px sans-serif`;
      ctx.fillText(
        "1",
        Math.max(14 * sx, bounds.x * sx),
        Math.max(14 * sy, bounds.y * sy),
      );
    }
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob
            ? resolve(blob)
            : reject(new Error("Could not create annotated screenshot.")),
        "image/png",
      ),
    );
  } finally {
    bitmap.close();
  }
}
export async function buildExport(
  record: StoredIssue,
  privacy: PrivacyOptions,
  format: "zip" | "json" | "markdown" | "image",
): Promise<{ blob: Blob; filename: string }> {
  const issue = projectIssue(record.issue, privacy),
    base = `BUG-${issue.createdAt.slice(0, 10).replaceAll("-", "")}-${issue.id.slice(0, 6)}`;
  issue.attachments = [];
  const original = privacy.screenshot ? record.original : null;
  if (format === "image") {
    if (!original)
      throw new Error("Include a captured screenshot to export an image.");
    return { blob: await annotate(original, issue), filename: `${base}.png` };
  }
  // Standalone documents have no attachments; a ZIP receives the actual files below.
  const zip = new JSZip();
  const attachment = (kind: Attachment["kind"], fileName: string, blob: Blob) =>
    issue.attachments.push({
      id: kind,
      kind,
      fileName,
      mimeType: blob.type,
      byteLength: blob.size,
      sha256: null,
    });
  if (format === "zip") {
    if (original) {
      const annotated = await annotate(original, issue);
      zip.file("screenshots/original.png", await original.arrayBuffer());
      zip.file("screenshots/annotated.png", await annotated.arrayBuffer());
      attachment("original_screenshot", "screenshots/original.png", original);
      attachment(
        "annotated_screenshot",
        "screenshots/annotated.png",
        annotated,
      );
    }
    if (issue.selection.element?.sanitizedHtml) {
      const html = new Blob([issue.selection.element.sanitizedHtml], {
        type: "text/html",
      });
      zip.file("snapshots/element.html", await html.arrayBuffer());
      attachment("element_html", "snapshots/element.html", html);
    }
  }
  const json = JSON.stringify(issue, null, 2),
    report = markdown(issue);
  if (format === "json")
    return {
      blob: new Blob([json], { type: "application/json" }),
      filename: `${base}.json`,
    };
  if (format === "markdown")
    return {
      blob: new Blob([report], { type: "text/markdown" }),
      filename: `${base}.md`,
    };
  zip.file("metadata.json", json);
  zip.file("report.md", report);
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
    filename: `${base}.zip`,
  };
}
