// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("extension and backend report contract", () => {
  it("keeps independent build schemas and report types in lockstep", () => {
    const normalize = (file: string) =>
      readFileSync(file, "utf8")
        .replace(/^\/\/ Schema snapshot.*\n/, "")
        .replace(/import\s*\{[^}]*\}\s*from\s*["']\.\/[^"']+["'];?/gs, "")
        .split("export type Request =")[0]!
        .replace(/\s+/g, "");
    expect(normalize("backend/src/report-schema.ts")).toBe(
      normalize("src/shared/validation.ts"),
    );
    expect(normalize("backend/src/report-types.ts")).toBe(
      normalize("src/shared/types.ts"),
    );
  });
});
