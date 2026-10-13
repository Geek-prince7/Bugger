// Schema snapshot shared with extension; maintain in lockstep.
export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
  unit: "css_px";
};
export type Source =
  | "browser_api"
  | "dom"
  | "derived_heuristic"
  | "user_provided"
  | "not_collected";
export type MetadataValue<T = string> = { value: T | null; source: Source };
export interface ElementSnapshot {
  cssSelector: string | null;
  xpath: string | null;
  domPath: string[];
  tagName: string | null;
  id: string | null;
  classes: string[];
  viewportBox: Box | null;
  documentBox: Box | null;
  attributes: Record<string, string>;
  computedStyles: Record<string, string>;
  sanitizedHtml: string | null;
  textExcerpt: string | null;
  locatorConfidence: "high" | "medium" | "low";
  limitations: string[];
}
export interface PageContext {
  url: string | null;
  hostname: string | null;
  title: string | null;
  scrollX: number;
  scrollY: number;
  viewport: { width: number; height: number };
  screen: { width: number; height: number } | null;
  dpr: number;
  document: { width: number; height: number } | null;
}
export interface EnvironmentContext {
  userAgent: MetadataValue;
  browserName: MetadataValue;
  browserVersion: MetadataValue;
  os: MetadataValue;
  deviceType: MetadataValue<"desktop" | "tablet" | "mobile" | "unknown">;
  language: MetadataValue;
  timezone: MetadataValue;
  country: MetadataValue;
  geoRegion: MetadataValue;
}
export interface CaptureSelection {
  kind: "element" | "region";
  element: ElementSnapshot | null;
  selectedRegion: Box | null;
}
export interface Attachment {
  id: string;
  kind: "original_screenshot" | "annotated_screenshot" | "element_html";
  fileName: string;
  mimeType: string;
  byteLength: number;
  sha256: string | null;
}
export const ISSUE_TYPES = [
  "functional_bug",
  "visual_bug",
  "content",
  "suggestion",
  "observation",
  "accessibility",
] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;
export const STATUSES = [
  "open",
  "in_progress",
  "resolved",
  "wont_fix",
] as const;
export interface Issue {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  type: (typeof ISSUE_TYPES)[number];
  title: string;
  description: string;
  severity: (typeof SEVERITIES)[number];
  status: (typeof STATUSES)[number];
  expectedResult: string | null;
  actualResult: string | null;
  reproductionSteps: string[];
  page: PageContext;
  environment: EnvironmentContext;
  selection: CaptureSelection;
  attachments: Attachment[];
  diagnostics: { console: "not_collected"; network: "not_collected" };
  privacy: {
    urlQueryRemoved: boolean;
    fieldsOmitted: string[];
    reviewedAt: string | null;
  };
}
export interface StoredIssue {
  issue: Issue;
  original: Blob | null;
}
export interface CaptureDraft {
  page: PageContext;
  environment: EnvironmentContext;
  selection: CaptureSelection;
}
export interface PrivacyOptions {
  screenshot: boolean;
  pageUrl: boolean;
  elementText: boolean;
  html: boolean;
  attributes: boolean;
  country: boolean;
  assetUrls: boolean;
}
export const DEFAULT_PRIVACY: PrivacyOptions = {
  screenshot: true,
  pageUrl: true,
  elementText: false,
  html: false,
  attributes: false,
  country: false,
  assetUrls: false,
};
