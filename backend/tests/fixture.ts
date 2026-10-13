import { randomUUID } from "node:crypto";
export function report() {
  const missing = { value: null, source: "not_collected" as const },
    now = new Date().toISOString();
  return {
    schemaVersion: 1 as const,
    id: randomUUID(),
    createdAt: now,
    updatedAt: now,
    type: "observation" as const,
    title: "Example report",
    description: "",
    severity: "medium" as const,
    status: "open" as const,
    expectedResult: null,
    actualResult: null,
    reproductionSteps: [],
    page: {
      url: "https://example.com/",
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
      userAgent: missing,
      browserName: missing,
      browserVersion: missing,
      os: missing,
      deviceType: missing,
      language: missing,
      timezone: missing,
      country: missing,
      geoRegion: missing,
    },
    selection: {
      kind: "region" as const,
      element: null,
      selectedRegion: {
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        unit: "css_px" as const,
      },
    },
    attachments: [],
    diagnostics: {
      console: "not_collected" as const,
      network: "not_collected" as const,
    },
    privacy: { urlQueryRemoved: true, fieldsOmitted: [], reviewedAt: null },
  };
}
