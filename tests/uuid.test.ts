import { expect, it } from "vitest";
import { uuid } from "../src/shared/uuid";
it("creates distinct RFC 4122 version 4 identifiers without the secure-context randomUUID API", () => {
  const values = Array.from({ length: 100 }, () => uuid());
  expect(new Set(values).size).toBe(100);
  for (const value of values)
    expect(value).toMatch(
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
    );
});
