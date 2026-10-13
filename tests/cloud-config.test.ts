// @vitest-environment node
import { execFileSync } from "node:child_process";
import { describe, it, expect } from "vitest";
function config(env: Record<string, string>) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {readCloudConfig} from './scripts/cloud-config.mjs';console.log(JSON.stringify(readCloudConfig(${JSON.stringify(env)})))`,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ),
  );
}
const valid = {
  BUGGER_API_URL: "https://api.example.com",
  BUGGER_OIDC_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/pool",
  BUGGER_OIDC_CLIENT_ID: "publicclient",
  BUGGER_COGNITO_DOMAIN: "https://auth.example.com",
};
describe("cloud build configuration", () => {
  it("defaults to local-only", () => expect(config({})).toBeNull());
  it("accepts a complete explicit HTTPS configuration", () =>
    expect(config(valid).apiUrl).toBe(valid.BUGGER_API_URL));
  it("rejects partial configuration, wildcard hosts, insecure URL and credentials", () => {
    for (const env of [
      { BUGGER_API_URL: valid.BUGGER_API_URL },
      { ...valid, BUGGER_API_URL: "http://api.example.com" },
      { ...valid, BUGGER_API_URL: "https://*.example.com" },
      { ...valid, BUGGER_API_URL: "https://name:secret@example.com" },
      { ...valid, BUGGER_COGNITO_DOMAIN: "https://auth.example.com/path" },
    ])
      expect(() => config(env)).toThrow();
  });
});
