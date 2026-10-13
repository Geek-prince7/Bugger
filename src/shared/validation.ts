import { z } from "zod";
import { ISSUE_TYPES, SEVERITIES, STATUSES, type Issue } from "./types";
const text = z.string().max(5000),
  short = z.string().max(2000),
  nullable = short.nullable();
const finite = z.number().finite().min(-10000000).max(10000000);
const size = z
  .object({ width: finite.nonnegative(), height: finite.nonnegative() })
  .strict();
const box = z
  .object({
    x: finite,
    y: finite,
    width: finite.nonnegative(),
    height: finite.nonnegative(),
    unit: z.literal("css_px"),
  })
  .strict();
const source = z.enum([
  "browser_api",
  "dom",
  "derived_heuristic",
  "user_provided",
  "not_collected",
]);
const meta = <T extends z.ZodType>(value: T) =>
  z
    .object({ value: value.nullable(), source })
    .strict()
    .refine(
      (m) =>
        (m as unknown as { value: unknown }).value === null
          ? m.source === "not_collected"
          : m.source !== "not_collected",
      "Metadata value and provenance disagree",
    );
const geo = z
  .object({
    value: z.string().max(100).nullable(),
    source: z.enum(["user_provided", "not_collected"]),
  })
  .strict()
  .refine(
    (m) =>
      m.value === null
        ? m.source === "not_collected"
        : m.source === "user_provided",
    "Geography must be supplied by the user",
  );
export const issueSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    type: z.enum(ISSUE_TYPES),
    title: z.string().trim().min(3).max(140),
    description: text,
    severity: z.enum(SEVERITIES),
    status: z.enum(STATUSES),
    expectedResult: text.nullable(),
    actualResult: text.nullable(),
    reproductionSteps: z.array(z.string().max(1000)).max(20),
    page: z
      .object({
        url: z.string().max(8192).nullable(),
        hostname: nullable,
        title: nullable,
        scrollX: finite,
        scrollY: finite,
        viewport: z
          .object({ width: finite.positive(), height: finite.positive() })
          .strict(),
        screen: size.nullable(),
        dpr: finite.positive().max(20),
        document: size.nullable(),
      })
      .strict(),
    environment: z
      .object({
        userAgent: meta(short),
        browserName: meta(short),
        browserVersion: meta(short),
        os: meta(short),
        deviceType: meta(z.enum(["desktop", "tablet", "mobile", "unknown"])),
        language: meta(short),
        timezone: meta(short),
        country: geo,
        geoRegion: geo,
      })
      .strict(),
    selection: z
      .object({
        kind: z.enum(["element", "region"]),
        selectedRegion: box.nullable(),
        element: z
          .object({
            cssSelector: nullable,
            xpath: nullable,
            domPath: z.array(short).max(100),
            tagName: nullable,
            id: nullable,
            classes: z.array(short).max(100),
            viewportBox: box.nullable(),
            documentBox: box.nullable(),
            attributes: z.record(z.string().max(100), short),
            computedStyles: z.record(z.string().max(100), short),
            sanitizedHtml: z
              .string()
              .refine(
                (s) => new TextEncoder().encode(s).byteLength <= 20480,
                "HTML snapshot exceeds 20 KB",
              )
              .nullable(),
            textExcerpt: nullable,
            locatorConfidence: z.enum(["high", "medium", "low"]),
            limitations: z.array(short).max(100),
          })
          .strict()
          .nullable(),
      })
      .strict()
      .refine(
        (s) =>
          s.kind === "element"
            ? s.element !== null && s.selectedRegion === null
            : s.selectedRegion !== null && s.element === null,
        "Selection must match its kind",
      ),
    attachments: z
      .array(
        z
          .object({
            id: z.string().max(200),
            kind: z.enum([
              "original_screenshot",
              "annotated_screenshot",
              "element_html",
            ]),
            fileName: z.enum([
              "screenshots/original.png",
              "screenshots/annotated.png",
              "snapshots/element.html",
            ]),
            mimeType: z.string().max(100),
            byteLength: z.number().int().nonnegative(),
            sha256: z
              .string()
              .regex(/^[a-f0-9]{64}$/i)
              .nullable(),
          })
          .strict()
          .refine(
            (a) =>
              a.fileName ===
                {
                  original_screenshot: "screenshots/original.png",
                  annotated_screenshot: "screenshots/annotated.png",
                  element_html: "snapshots/element.html",
                }[a.kind] &&
              a.mimeType ===
                (a.kind === "element_html" ? "text/html" : "image/png"),
            "Attachment kind, path and media type must match",
          ),
      )
      .max(3)
      .refine(
        (a) => new Set(a.map((x) => x.kind)).size === a.length,
        "Duplicate attachment",
      ),
    diagnostics: z
      .object({
        console: z.literal("not_collected"),
        network: z.literal("not_collected"),
      })
      .strict(),
    privacy: z
      .object({
        urlQueryRemoved: z.boolean(),
        fieldsOmitted: z.array(short).max(100),
        reviewedAt: z.iso.datetime().nullable(),
      })
      .strict(),
  })
  .strict()
  .refine(
    (i) => i.updatedAt >= i.createdAt,
    "Update time cannot precede creation",
  );
export function validateIssue(value: unknown): Issue {
  return issueSchema.parse(value);
}
