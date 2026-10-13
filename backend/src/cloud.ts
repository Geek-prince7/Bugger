import { createHash, randomUUID } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { z } from "zod";
import type pg from "pg";
import type { FastifyInstance } from "fastify";
import type { Config } from "./config.js";
import { issueSchema } from "./report-schema.js";
import { LicenseError } from "./licensing.js";
export interface ObjectStore {
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}
export type Auth = (authorization: string | undefined) => Promise<string>;
export function cognitoAuth(
  issuer: string,
  clientId: string,
  resolveKey?: ReturnType<typeof createRemoteJWKSet>,
): Auth {
  const parsed = new URL(issuer);
  if (parsed.protocol !== "https:" || parsed.search || parsed.hash)
    throw new Error("OIDC issuer must be HTTPS");
  const jwks =
    resolveKey ??
    createRemoteJWKSet(
      new URL(`${issuer.replace(/\/$/, "")}/.well-known/jwks.json`),
    );
  return async (authorization) => {
    try {
      if (!authorization?.startsWith("Bearer ") || authorization.length > 8192)
        throw new Error();
      const { payload } = await jwtVerify(authorization.slice(7), jwks, {
        issuer,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub", "token_use", "client_id"],
      });
      if (
        payload.token_use !== "access" ||
        payload.client_id !== clientId ||
        typeof payload.sub !== "string" ||
        !z.uuid().safeParse(payload.sub).success
      )
        throw new Error();
      return payload.sub;
    } catch {
      throw new LicenseError("UNAUTHORIZED", 401);
    }
  };
}
export function s3Store(bucket: string, region: string): ObjectStore {
  const s3 = new S3Client({ region });
  return {
    async put(key, bytes) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ContentType: "image/png",
          ServerSideEncryption: "AES256",
        }),
      );
    },
    async get(key) {
      const r = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!r.Body || !r.ContentLength || r.ContentLength > 10 * 1024 * 1024)
        throw new Error("Invalid stored image");
      return Buffer.from(await r.Body.transformToByteArray());
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
export const uploadSchema = z
  .object({
    issue: issueSchema,
    originalDataUrl: z
      .string()
      .max(14 * 1024 * 1024)
      .nullable(),
    expectedVersion: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
  })
  .strict();
export function pngBytes(value: string | null) {
  if (value === null) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value))
    throw new LicenseError("INVALID_IMAGE", 400);
  const raw = value.slice(22),
    bytes = Buffer.from(raw, "base64");
  if (
    bytes.length > 10 * 1024 * 1024 ||
    bytes.length < 8 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.toString("base64") !== raw
  )
    throw new LicenseError("INVALID_IMAGE", 400);
  return bytes;
}
export async function putReport(
  pool: pg.Pool,
  store: ObjectStore,
  owner: string,
  id: string,
  body: z.infer<typeof uploadSchema>,
) {
  if (body.issue.id !== id) throw new LicenseError("INVALID_REQUEST", 400);
  const bytes = pngBytes(body.originalDataUrl),
    metadata = JSON.stringify(body.issue),
    size = Buffer.byteLength(metadata) + (bytes?.length ?? 0);
  if (size > 10 * 1024 * 1024) throw new LicenseError("REPORT_TOO_LARGE", 413);
  // Content-addressed keys make overwrites immutable. A nonce isolates failed transactions
  // from concurrent uploads; unused objects require the documented lifecycle sweep.
  const key = bytes
    ? `${createHash("sha256").update(owner).digest("hex")}/${id}/${createHash("sha256").update(bytes).digest("hex")}-${randomUUID()}.png`
    : null;
  const c = await pool.connect();
  let uploaded = false,
    commitStarted = false;
  try {
    await c.query("BEGIN");
    await c.query(
      "INSERT INTO report_accounts(owner) VALUES($1) ON CONFLICT DO NOTHING",
      [owner],
    );
    await c.query(
      "SELECT owner FROM report_accounts WHERE owner=$1 FOR UPDATE",
      [owner],
    );
    const found = await c.query(
      "SELECT version,object_key FROM reports WHERE owner=$1 AND id=$2",
      [owner, id],
    );
    const old = found.rows[0];
    if (
      old
        ? Number(old.version) !== body.expectedVersion
        : body.expectedVersion !== null
    )
      throw new LicenseError("VERSION_CONFLICT", 409);
    const totals = await c.query(
      "SELECT count(*)::int AS count,coalesce(sum(bytes),0)::bigint AS bytes FROM reports WHERE owner=$1 AND id<>$2",
      [owner, id],
    );
    if (
      totals.rows[0].count >= 50 ||
      Number(totals.rows[0].bytes) + size > 100 * 1024 * 1024
    )
      throw new LicenseError("ACCOUNT_QUOTA", 409);
    if (key && bytes) {
      await store.put(key, bytes);
      uploaded = true;
    }
    const version = old ? Number(old.version) + 1 : 1;
    await c.query(
      "INSERT INTO reports(owner,id,issue,object_key,bytes,version) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(owner,id) DO UPDATE SET issue=excluded.issue,object_key=excluded.object_key,bytes=excluded.bytes,version=excluded.version",
      [owner, id, metadata, key, size, version],
    );
    commitStarted = true;
    await c.query("COMMIT");
    if (old?.object_key) await store.remove(old.object_key).catch(() => {});
    return { version };
  } catch (e) {
    await c.query("ROLLBACK");
    if (uploaded && key && !commitStarted)
      await store.remove(key).catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
export function registerCloud(
  server: FastifyInstance,
  pool: pg.Pool,
  config: Config,
  overrides?: { auth: Auth; store: ObjectStore },
) {
  const enabled =
    overrides ||
    Boolean(
      config.OIDC_ISSUER &&
      config.COGNITO_CLIENT_ID &&
      config.REPORTS_BUCKET &&
      config.AWS_REGION,
    );
  const auth =
      overrides?.auth ??
      (enabled
        ? cognitoAuth(config.OIDC_ISSUER!, config.COGNITO_CLIENT_ID!)
        : null),
    store =
      overrides?.store ??
      (enabled ? s3Store(config.REPORTS_BUCKET!, config.AWS_REGION!) : null);
  async function owner(header: string | undefined) {
    if (!auth || !store) throw new LicenseError("CLOUD_NOT_CONFIGURED", 503);
    return auth(header);
  }
  server.get("/v1/reports", async (req) => {
    const sub = await owner(req.headers.authorization);
    const r = await pool.query(
      "SELECT issue,version FROM reports WHERE owner=$1 ORDER BY id LIMIT 50",
      [sub],
    );
    return r.rows.map((row) => ({
      issue: issueSchema.parse(row.issue),
      version: Number(row.version),
    }));
  });
  server.get("/v1/reports/:id", async (req) => {
    const sub = await owner(req.headers.authorization),
      id = z.uuid().parse((req.params as { id: string }).id);
    const r = await pool.query(
      "SELECT issue,version,object_key FROM reports WHERE owner=$1 AND id=$2",
      [sub, id],
    );
    if (!r.rows.length) throw new LicenseError("REPORT_NOT_FOUND", 404);
    const row = r.rows[0],
      image = row.object_key ? await store!.get(row.object_key) : null;
    return {
      issue: issueSchema.parse(row.issue),
      version: Number(row.version),
      originalDataUrl: image
        ? `data:image/png;base64,${image.toString("base64")}`
        : null,
    };
  });
  server.put(
    "/v1/reports/:id",
    { bodyLimit: 14 * 1024 * 1024 },
    async (req) => {
      const sub = await owner(req.headers.authorization),
        id = z.uuid().parse((req.params as { id: string }).id),
        body = uploadSchema.parse(req.body);
      return putReport(pool, store!, sub, id, body);
    },
  );
  server.delete("/v1/reports/:id", async (req) => {
    const sub = await owner(req.headers.authorization),
      id = z.uuid().parse((req.params as { id: string }).id),
      version = z.coerce
        .number()
        .int()
        .positive()
        .max(Number.MAX_SAFE_INTEGER)
        .parse((req.query as { expectedVersion?: string }).expectedVersion);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        "SELECT owner FROM report_accounts WHERE owner=$1 FOR UPDATE",
        [sub],
      );
      const result = await c.query(
        "DELETE FROM reports WHERE owner=$1 AND id=$2 AND version=$3 RETURNING object_key",
        [sub, id, version],
      );
      if (!result.rowCount) throw new LicenseError("VERSION_CONFLICT", 409);
      await c.query("COMMIT");
      if (result.rows[0].object_key)
        await store!.remove(result.rows[0].object_key).catch(() => {});
      return { deleted: true };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  });
}
