import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { signer, hashKey } from "../src/licensing.js";
import { app, activateSchema, statusSchema } from "../src/app.js";
import type { Config } from "../src/config.js";
import type pg from "pg";
const pem = generateKeyPairSync("ec", {
  namedCurve: "prime256v1",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
}).privateKey;
const cfg: Config = {
  DATABASE_URL: "postgres://unused",
  LICENSE_KEY_PEPPER: "a".repeat(32),
  SIGNING_KEY_FILE: "unused",
  signingKey: pem,
  SIGNING_KEY_ID: "test",
  JWT_ISSUER: "https://test.invalid",
  JWT_AUDIENCE: "bugger-extension",
  HOST: "127.0.0.1",
  PORT: 3000,
  TRUST_PROXY: "false",
  GIT_SHA: "test",
};
test("schema rejects extra fields, malformed keys and installation IDs", () => {
  assert.throws(() =>
    activateSchema.parse({
      licenseKey: "x",
      installationId: randomUUID(),
      extensionVersion: "1.0.0",
    }),
  );
  assert.throws(() =>
    statusSchema.parse({ installationId: "bad", entitlementToken: "x" }),
  );
  assert.throws(() =>
    statusSchema.parse({
      installationId: randomUUID(),
      entitlementToken: "x",
      pageUrl: "https://private.test",
    }),
  );
  assert.notEqual(
    hashKey("key", "a".repeat(32)),
    hashKey("key", "b".repeat(32)),
  );
});
test("signed entitlement verifies binding and rejects tamper, expiration, issuer and audience", async () => {
  const tokens = await signer(pem, "test", cfg.JWT_ISSUER, cfg.JWT_AUDIENCE),
    id = randomUUID(),
    install = randomUUID();
  const issued = await tokens.issue(id, install);
  assert.equal(await tokens.verify(issued.entitlementToken, install), id);
  assert.equal("d" in tokens.jwk, false);
  assert.equal(
    Date.parse(issued.offlineGraceUntil) - Date.parse(issued.validatedAt),
    14 * 86400000,
  );
  await assert.rejects(tokens.verify(issued.entitlementToken, randomUUID()));
  await assert.rejects(tokens.verify(issued.entitlementToken + "x", install));
  const key = await importPKCS8(pem, "ES256");
  for (const [issuer, audience, expiry] of [
    [cfg.JWT_ISSUER, cfg.JWT_AUDIENCE, 1],
    ["https://wrong.invalid", cfg.JWT_AUDIENCE, 9999999999],
    [cfg.JWT_ISSUER, "wrong", 9999999999],
  ] as const) {
    const token = await new SignJWT({
      installationId: install,
      plan: "lifetime_local",
    })
      .setProtectedHeader({ alg: "ES256", kid: "test" })
      .setSubject(id)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(key);
    await assert.rejects(tokens.verify(token, install));
  }
});
test("HTTP readiness fails closed and limiter resists spoofed forwarded IPs", async () => {
  const pool = {
    query: async () => {
      throw new Error("secret database detail");
    },
  } as unknown as pg.Pool;
  const server = await app(cfg, pool);
  try {
    assert.equal((await server.inject("/healthz")).statusCode, 200);
    assert.equal((await server.inject("/readyz")).statusCode, 503);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/v1/licenses/status",
          payload: { installationId: randomUUID(), entitlementToken: "fake" },
        })
      ).statusCode,
      401,
    );
    for (let i = 0; i < 35; i++) {
      const r = await server.inject({
        url: "/version",
        headers: { "x-forwarded-for": `1.2.3.${i}` },
      });
      if (i === 34) assert.equal(r.statusCode, 429);
    }
  } finally {
    await server.close();
  }
});
import { pngBytes, uploadSchema } from "../src/cloud.js";
import { report } from "./fixture.js";
test("cloud input validates schema, optimistic version, PNG signature and extra owner rejection", () => {
  const issue = report();
  assert.doesNotThrow(() =>
    uploadSchema.parse({ issue, originalDataUrl: null, expectedVersion: null }),
  );
  assert.throws(() =>
    uploadSchema.parse({
      issue,
      originalDataUrl: null,
      expectedVersion: null,
      owner: randomUUID(),
    }),
  );
  assert.throws(() =>
    uploadSchema.parse({ issue, originalDataUrl: null, expectedVersion: 0 }),
  );
  assert.throws(() => pngBytes("data:image/png;base64,dGV4dA=="));
  assert.throws(() => pngBytes("data:image/jpeg;base64,iVBORw0KGgo="));
  assert.equal(pngBytes(null), null);
  assert.equal(pngBytes("data:image/png;base64,iVBORw0KGgo=")!.length, 8);
});
test("cloud routes disabled without explicit cloud configuration", async () => {
  const server = await app(cfg, {} as pg.Pool);
  try {
    assert.equal((await server.inject("/v1/reports")).statusCode, 503);
  } finally {
    await server.close();
  }
});

test("Cognito verifier rejects wrong client, ID tokens, expiry, issuer and signatures", async () => {
  const { generateKeyPair, exportJWK, createLocalJWKSet } =
    await import("jose");
  const { cognitoAuth } = await import("../src/cloud.js");
  const keys = await generateKeyPair("RS256");
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: "test",
    alg: "RS256",
  };
  const verify = cognitoAuth(
    "https://issuer.example",
    "client",
    createLocalJWKSet({ keys: [jwk] }) as unknown as ReturnType<
      typeof import("jose").createRemoteJWKSet
    >,
  );
  const sub = randomUUID();
  async function token(
    extra: Record<string, unknown> = {},
    issuer = "https://issuer.example",
    expires: number | string = "1h",
  ) {
    return new SignJWT({ token_use: "access", client_id: "client", ...extra })
      .setProtectedHeader({ alg: "RS256", kid: "test" })
      .setSubject(sub)
      .setIssuer(issuer)
      .setIssuedAt()
      .setExpirationTime(expires)
      .sign(keys.privateKey);
  }
  assert.equal(await verify(`Bearer ${await token()}`), sub);
  for (const invalid of [
    undefined,
    "Bearer invalid",
    `Bearer ${await token({ client_id: "other" })}`,
    `Bearer ${await token({ token_use: "id" })}`,
    `Bearer ${await token({}, "https://other.example")}`,
    `Bearer ${await token({}, "https://issuer.example", 1)}`,
    `Bearer ${await token()}tamper`,
  ]) {
    await assert.rejects(verify(invalid), { code: "UNAUTHORIZED" });
  }
});

test("only the configured immediate proxy may supply client addresses", async () => {
  const server = await app(
    { ...cfg, TRUST_PROXY: "172.17.0.1" },
    {} as pg.Pool,
  );
  try {
    for (let i = 0; i < 35; i++) {
      const trusted = await server.inject({
        url: "/version",
        remoteAddress: "172.17.0.1",
        headers: { "x-forwarded-for": `203.0.113.${i + 1}` },
      });
      assert.equal(trusted.statusCode, 200);
      const untrusted = await server.inject({
        url: "/version",
        remoteAddress: "192.0.2.1",
        headers: { "x-forwarded-for": `198.51.100.${i + 1}` },
      });
      if (i === 34) assert.equal(untrusted.statusCode, 429);
    }
  } finally {
    await server.close();
  }
});
