// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from "vitest";
const config = {
  apiUrl: "https://api.example.com",
  issuer: "https://cognito-idp.us-east-1.amazonaws.com/pool",
  clientId: "publicclient",
  hostedDomain: "https://auth.example.com",
};
vi.mock("../src/cloud/config", () => ({
  requiredConfig: () => config,
  cloudOrigins: () => ["https://api.example.com/*"],
}));
import {
  pkce,
  authorizationCode,
  validateAccessToken,
  session,
  signOut,
  signIn,
} from "../src/cloud/auth";
const storage: Record<string, unknown> = {};
beforeEach(() => {
  for (const key of Object.keys(storage)) delete storage[key];
  vi.stubGlobal("chrome", {
    storage: {
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async (value: object) => Object.assign(storage, value)),
        remove: vi.fn(async (key: string) => {
          delete storage[key];
        }),
      },
    },
    permissions: { request: vi.fn(async () => true) },
    identity: {
      getRedirectURL: () => "https://extension.chromiumapp.org/cognito",
      launchWebAuthFlow: vi.fn(async () => undefined),
    },
  });
  vi.restoreAllMocks();
});
describe("Cognito authentication boundary", () => {
  it("generates independent cryptographic verifier/state and S256 challenge", async () => {
    const a = await pkce(),
      b = await pkce();
    expect(a.verifier).toMatch(/^[\w-]{43}$/);
    expect(a.state).not.toBe(a.verifier);
    expect(a.state).not.toBe(b.state);
    expect(a.challenge).toBe(
      Buffer.from(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(a.verifier),
        ),
      ).toString("base64url"),
    );
  });
  it("rejects wrong callback, duplicate state and provider errors", () => {
    const redirect = "https://extension.chromiumapp.org/cognito";
    for (const result of [
      "https://evil.example/cognito?state=s&code=c",
      redirect + "?state=x&code=c",
      redirect + "?state=s&state=s&code=c",
      redirect + "?state=s&error=denied",
      redirect + "?state=s&code=c#token",
    ])
      expect(() => authorizationCode(result, redirect, "s")).toThrow();
    expect(authorizationCode(redirect + "?state=s&code=c", redirect, "s")).toBe(
      "c",
    );
  });
  it("does not save a session when user cancels sign-in", async () => {
    await expect(signIn()).rejects.toThrow("cancelled");
    expect(storage).toEqual({});
  });
  it("clears expired session and signs out without persistent token storage", async () => {
    storage.buggerCloudSession = {
      accessToken: "secret",
      subject: "owner",
      expiresAt: 0,
      issuer: config.issuer,
      clientId: config.clientId,
    };
    expect(await session()).toBeNull();
    expect(storage).toEqual({});
    await signOut();
  });
  it("verifies RSA signature and issuer/client/token-use claims", async () => {
    const keys = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              keys: [{ ...jwk, kid: "test", use: "sig", alg: "RS256" }],
            }),
          ),
      ),
    );
    const claims = {
      iss: config.issuer,
      client_id: config.clientId,
      token_use: "access",
      sub: "owner",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    async function token(payload: object) {
      const input =
        Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString(
          "base64url",
        ) +
        "." +
        Buffer.from(JSON.stringify(payload)).toString("base64url");
      return (
        input +
        "." +
        Buffer.from(
          await crypto.subtle.sign(
            "RSASSA-PKCS1-v1_5",
            keys.privateKey,
            new TextEncoder().encode(input),
          ),
        ).toString("base64url")
      );
    }
    expect(
      (await validateAccessToken(await token(claims), config)).subject,
    ).toBe("owner");
    for (const change of [
      { iss: "https://evil.example" },
      { client_id: "other" },
      { token_use: "id" },
      { exp: 0 },
    ])
      await expect(
        validateAccessToken(await token({ ...claims, ...change }), config),
      ).rejects.toThrow("verified");
    const valid = await token(claims),
      parts = valid.split(".");
    parts[2] = "A".repeat(parts[2]!.length);
    await expect(validateAccessToken(parts.join("."), config)).rejects.toThrow(
      "verified",
    );
  });
});
