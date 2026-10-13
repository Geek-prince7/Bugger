import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, generateKeyPairSync } from "node:crypto";
import { poolFor, migrate } from "../src/db.js";
import { provision, activate, hashKey, status } from "../src/licensing.js";
import { app } from "../src/app.js";
if (!process.env.DATABASE_URL)
  throw new Error(
    "DATABASE_URL must point to a dedicated test PostgreSQL database",
  );
test("PostgreSQL migrations, device race, idempotency, revocation and HTTP authorization", async () => {
  const pool = poolFor(process.env.DATABASE_URL!);
  let id: string | undefined;
  try {
    await Promise.all([migrate(pool), migrate(pool)]);
    const pepper = "integration-test-pepper-not-production",
      license = await provision(pool, pepper);
    id = license.id;
    const installs = Array.from({ length: 8 }, () => randomUUID());
    const outcomes = await Promise.allSettled(
      installs.map((install) =>
        activate(pool, hashKey(license.licenseKey, pepper), install),
      ),
    );
    assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 3);
    const accepted =
      installs[outcomes.findIndex((r) => r.status === "fulfilled")];
    assert.equal(
      await activate(pool, hashKey(license.licenseKey, pepper), accepted),
      id,
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM activations WHERE license_id=$1",
          [id],
        )
      ).rows[0].n,
      3,
    );
    await assert.rejects(
      activate(pool, hashKey("invalid", pepper), randomUUID()),
    );
    const pem = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    }).privateKey;
    const server = await app(
      {
        DATABASE_URL: process.env.DATABASE_URL!,
        LICENSE_KEY_PEPPER: pepper,
        SIGNING_KEY_FILE: "unused",
        signingKey: pem,
        SIGNING_KEY_ID: "integration",
        JWT_ISSUER: "https://test.invalid",
        JWT_AUDIENCE: "bugger-extension",
        PORT: 3000,
        HOST: "127.0.0.1",
        TRUST_PROXY: "false",
        GIT_SHA: "test",
      },
      pool,
    );
    try {
      assert.equal((await server.inject("/readyz")).statusCode, 200);
      const r = await server.inject({
        method: "POST",
        url: "/v1/licenses/activate",
        payload: {
          licenseKey: license.licenseKey,
          installationId: accepted,
          extensionVersion: "0.1.0",
        },
      });
      assert.equal(r.statusCode, 200);
      const entitlementToken = r.json().entitlementToken;
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/v1/licenses/status",
            payload: { installationId: accepted, entitlementToken },
          })
        ).statusCode,
        200,
      );
      await pool.query("UPDATE licenses SET status='revoked' WHERE id=$1", [
        id,
      ]);
      assert.equal(
        (
          await server.inject({
            method: "POST",
            url: "/v1/licenses/status",
            payload: { installationId: accepted, entitlementToken },
          })
        ).statusCode,
        401,
      );
      await assert.rejects(status(pool, id!, accepted));
    } finally {
      await server.close();
    }
  } finally {
    if (id) {
      await pool.query("DELETE FROM activations WHERE license_id=$1", [id]);
      await pool.query("DELETE FROM licenses WHERE id=$1", [id]);
    }
    await pool.end();
  }
});
import { report } from "./fixture.js";
import type { ObjectStore } from "../src/cloud.js";
import { LicenseError } from "../src/licensing.js";
test("cloud owner isolation, optimistic concurrency and private image roundtrip", async () => {
  const pool = poolFor(process.env.DATABASE_URL!),
    a = randomUUID(),
    b = randomUUID(),
    issue = report(),
    objects = new Map<string, Buffer>();
  const store: ObjectStore = {
    async put(k, v) {
      objects.set(k, v);
    },
    async get(k) {
      const v = objects.get(k);
      if (!v) throw new Error("Missing");
      return v;
    },
    async remove(k) {
      objects.delete(k);
    },
  };
  const pem = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  }).privateKey;
  await migrate(pool);
  const server = await app(
    {
      DATABASE_URL: process.env.DATABASE_URL!,
      LICENSE_KEY_PEPPER: "test-only-pepper-not-production-32",
      SIGNING_KEY_FILE: "unused",
      signingKey: pem,
      SIGNING_KEY_ID: "test",
      JWT_ISSUER: "https://test.invalid",
      JWT_AUDIENCE: "bugger-extension",
      PORT: 3000,
      HOST: "127.0.0.1",
      TRUST_PROXY: "false",
      GIT_SHA: "test",
    },
    pool,
    {
      store,
      auth: async (header) => {
        if (header === `Bearer ${a}`) return a;
        if (header === `Bearer ${b}`) return b;
        throw new LicenseError("UNAUTHORIZED", 401);
      },
    },
  );
  const headers = { authorization: `Bearer ${a}` },
    other = { authorization: `Bearer ${b}` },
    url = `/v1/reports/${issue.id}`;
  try {
    assert.equal((await server.inject("/v1/reports")).statusCode, 401);
    const payload = {
      issue,
      originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
      expectedVersion: null,
    };
    assert.equal(
      (await server.inject({ method: "PUT", url, headers, payload }))
        .statusCode,
      200,
    );
    assert.equal(
      (await server.inject({ url, headers })).json().originalDataUrl,
      payload.originalDataUrl,
    );
    assert.equal(
      (await server.inject({ url, headers: other })).statusCode,
      404,
    );
    assert.deepEqual(
      (await server.inject({ url: "/v1/reports", headers: other })).json(),
      [],
    );
    assert.equal(
      (
        await server.inject({
          method: "DELETE",
          url: url + "?expectedVersion=1",
          headers: other,
        })
      ).statusCode,
      409,
    );
    const attempts = await Promise.all(
      [1, 2].map(() =>
        server.inject({
          method: "PUT",
          url,
          headers,
          payload: { ...payload, expectedVersion: 1 },
        }),
      ),
    );
    assert.deepEqual(attempts.map((r) => r.statusCode).sort(), [200, 409]);
    assert.equal(
      (
        await server.inject({
          method: "DELETE",
          url: url + "?expectedVersion=1",
          headers,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await server.inject({
          method: "DELETE",
          url: url + "?expectedVersion=2",
          headers,
        })
      ).statusCode,
      200,
    );
    assert.equal(objects.size, 0);
  } finally {
    await server.close();
    await pool.query("DELETE FROM reports WHERE owner=ANY($1::uuid[])", [
      [a, b],
    ]);
    await pool.query(
      "DELETE FROM report_accounts WHERE owner=ANY($1::uuid[])",
      [[a, b]],
    );
    await pool.end();
  }
});

test("report count quota serializes concurrent creates and object failure leaves no metadata", async () => {
  const { putReport } = await import("../src/cloud.js");
  const pool = poolFor(process.env.DATABASE_URL!),
    owner = randomUUID();
  const store: ObjectStore = {
    async put() {
      throw new Error("simulated object storage failure");
    },
    async get() {
      throw new Error("unused");
    },
    async remove() {},
  };
  try {
    await migrate(pool);
    const failed = report();
    await assert.rejects(
      putReport(pool, store, owner, failed.id, {
        issue: failed,
        originalDataUrl: "data:image/png;base64,iVBORw0KGgo=",
        expectedVersion: null,
      }),
    );
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM reports WHERE owner=$1",
          [owner],
        )
      ).rows[0].n,
      0,
    );
    for (let i = 0; i < 49; i++) {
      const issue = report();
      await putReport(pool, store, owner, issue.id, {
        issue,
        originalDataUrl: null,
        expectedVersion: null,
      });
    }
    const results = await Promise.allSettled(
      [1, 2, 3].map(async () => {
        const issue = report();
        return putReport(pool, store, owner, issue.id, {
          issue,
          originalDataUrl: null,
          expectedVersion: null,
        });
      }),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    for (const r of results)
      if (r.status === "rejected") assert.equal(r.reason.code, "ACCOUNT_QUOTA");
    assert.equal(
      (
        await pool.query(
          "SELECT count(*)::int AS n FROM reports WHERE owner=$1",
          [owner],
        )
      ).rows[0].n,
      50,
    );
  } finally {
    await pool.query("DELETE FROM reports WHERE owner=$1", [owner]);
    await pool.query("DELETE FROM report_accounts WHERE owner=$1", [owner]);
    await pool.end();
  }
});
