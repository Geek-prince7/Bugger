import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type pg from "pg";
import {
  importPKCS8,
  exportJWK,
  SignJWT,
  jwtVerify,
  importJWK,
  type JWK,
} from "jose";
export class LicenseError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export const hashKey = (key: string, pepper: string) =>
  createHmac("sha256", pepper).update(key).digest("hex");
export async function provision(pool: pg.Pool, pepper: string) {
  const key = `bugger_${randomBytes(32).toString("base64url")}`,
    id = randomUUID();
  await pool.query(
    "INSERT INTO licenses(id,key_hash,status) VALUES($1,$2,'active')",
    [id, hashKey(key, pepper)],
  );
  return { id, licenseKey: key };
}
export async function signer(
  pem: string,
  kid: string,
  issuer: string,
  audience: string,
) {
  const key = await importPKCS8(pem, "ES256", { extractable: true });
  const privateJwk = await exportJWK(key);
  const { d: _, ...publicJwk } = privateJwk;
  const jwk: JWK = { ...publicJwk, kid, alg: "ES256", use: "sig" };
  const publicKey = await importJWK(jwk, "ES256");
  return {
    jwk,
    async issue(licenseId: string, installationId: string) {
      const now = Math.floor(Date.now() / 1000),
        next = now + 7 * 86400,
        expiry = now + 14 * 86400;
      return {
        active: true,
        plan: "lifetime_local",
        entitlementToken: await new SignJWT({
          installationId,
          plan: "lifetime_local",
          nextCheckAt: next,
        })
          .setProtectedHeader({ alg: "ES256", kid })
          .setSubject(licenseId)
          .setIssuer(issuer)
          .setAudience(audience)
          .setIssuedAt(now)
          .setExpirationTime(expiry)
          .sign(key),
        validatedAt: new Date(now * 1000).toISOString(),
        nextCheckAt: new Date(next * 1000).toISOString(),
        offlineGraceUntil: new Date(expiry * 1000).toISOString(),
      };
    },
    async verify(token: string, installationId: string) {
      try {
        const { payload, protectedHeader } = await jwtVerify(token, publicKey, {
          issuer,
          audience,
          algorithms: ["ES256"],
          requiredClaims: ["exp", "iat", "sub", "installationId", "plan"],
          maxTokenAge: "14d",
        });
        if (
          protectedHeader.kid !== kid ||
          payload.installationId !== installationId ||
          payload.plan !== "lifetime_local" ||
          typeof payload.sub !== "string" ||
          !/^[a-f0-9-]{36}$/i.test(payload.sub)
        )
          throw new Error();
        return payload.sub;
      } catch {
        throw new LicenseError("INVALID_ENTITLEMENT", 401);
      }
    },
  };
}
export async function activate(
  pool: pg.Pool,
  keyHash: string,
  installationId: string,
) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query(
      "SELECT id,status FROM licenses WHERE key_hash=$1 FOR UPDATE",
      [keyHash],
    );
    if (!r.rows.length || r.rows[0].status !== "active")
      throw new LicenseError("INVALID_LICENSE", 401);
    const id = r.rows[0].id;
    const exists = await c.query(
      "SELECT 1 FROM activations WHERE license_id=$1 AND installation_id=$2",
      [id, installationId],
    );
    if (!exists.rowCount) {
      const count = await c.query(
        "SELECT count(*)::int AS count FROM activations WHERE license_id=$1",
        [id],
      );
      if (count.rows[0].count >= 3) throw new LicenseError("DEVICE_LIMIT", 409);
    }
    await c.query(
      "INSERT INTO activations(license_id,installation_id) VALUES($1,$2) ON CONFLICT(license_id,installation_id) DO UPDATE SET last_seen_at=now()",
      [id, installationId],
    );
    await c.query("COMMIT");
    return id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export async function status(
  pool: pg.Pool,
  licenseId: string,
  installationId: string,
) {
  const r = await pool.query(
    "SELECT 1 FROM licenses l JOIN activations a ON a.license_id=l.id WHERE l.id=$1 AND a.installation_id=$2 AND l.status='active'",
    [licenseId, installationId],
  );
  if (!r.rowCount) throw new LicenseError("LICENSE_INACTIVE", 401);
}
