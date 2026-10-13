import { registerCloud, type Auth, type ObjectStore } from "./cloud.js";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import type pg from "pg";
import type { Config } from "./config.js";
import {
  activate,
  hashKey,
  LicenseError,
  signer,
  status,
} from "./licensing.js";
export const activateSchema = z
  .object({
    licenseKey: z.string().regex(/^bugger_[A-Za-z0-9_-]{43}$/),
    installationId: z.uuid(),
    extensionVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:\.[0-9]+)?$/)
      .max(30),
  })
  .strict();
export const statusSchema = z
  .object({
    installationId: z.uuid(),
    entitlementToken: z.string().min(1).max(4096),
  })
  .strict();
export async function app(
  config: Config,
  pool: pg.Pool,
  cloudOverrides?: { auth: Auth; store: ObjectStore },
) {
  const tokens = await signer(
    config.signingKey,
    config.SIGNING_KEY_ID,
    config.JWT_ISSUER,
    config.JWT_AUDIENCE,
  );
  const server = Fastify({
    trustProxy: config.TRUST_PROXY === "false" ? false : config.TRUST_PROXY,
    bodyLimit: 8192,
    logger: {
      level: "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body",
        "licenseKey",
        "entitlementToken",
      ],
    },
    disableRequestLogging: true,
  });
  await server.register(rateLimit, {
    max: 30,
    timeWindow: "1 minute",
    skipOnError: false,
  });
  server.setErrorHandler((error, request, reply) => {
    if (error instanceof LicenseError)
      return reply.code(error.status).send({
        code: error.code,
        message: "Request could not be completed. Check the error code.",
      });
    if (error instanceof z.ZodError)
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "Request fields are invalid.",
      });
    const code = (error as { statusCode?: number }).statusCode;
    if (code === 429)
      return reply.code(429).send({
        code: "RATE_LIMITED",
        message: "Too many requests. Try again later.",
      });
    if (code && code >= 400 && code < 500)
      return reply.code(code).send({
        code: "INVALID_REQUEST",
        message: "Request could not be accepted.",
      });
    request.log.error({ requestId: request.id }, "Request failed");
    return reply.code(503).send({
      code: "UNAVAILABLE",
      message: "Service temporarily unavailable. Try again later.",
    });
  });
  server.get("/healthz", { config: { rateLimit: false } }, async () => ({
    ok: true,
  }));
  server.get(
    "/readyz",
    { config: { rateLimit: false } },
    async (_req, reply) => {
      try {
        await pool
          .query("SELECT 1 FROM schema_migrations WHERE version=2")
          .then((r) => {
            if (!r.rowCount) throw new Error();
          });
        return { ok: true };
      } catch {
        return reply.code(503).send({ ok: false });
      }
    },
  );
  server.get("/version", async () => ({
    version: "0.1.0",
    revision: config.GIT_SHA,
  }));
  server.get("/v1/licenses/public-key", async () => ({ keys: [tokens.jwk] }));
  server.post("/v1/licenses/activate", async (req) => {
    const body = activateSchema.parse(req.body);
    const id = await activate(
      pool,
      hashKey(body.licenseKey, config.LICENSE_KEY_PEPPER),
      body.installationId,
    );
    return tokens.issue(id, body.installationId);
  });
  server.post("/v1/licenses/status", async (req) => {
    const body = statusSchema.parse(req.body);
    const id = await tokens.verify(body.entitlementToken, body.installationId);
    await status(pool, id, body.installationId);
    return tokens.issue(id, body.installationId);
  });
  registerCloud(server, pool, config, cloudOverrides);
  return server;
}
