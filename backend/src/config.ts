import { readFileSync } from "node:fs";
import { z } from "zod";
export function config(env = process.env) {
  const e = z
    .object({
      DATABASE_URL: z.string().min(1),
      OIDC_ISSUER: z.string().url().optional(),
      COGNITO_CLIENT_ID: z.string().min(1).optional(),
      REPORTS_BUCKET: z.string().min(3).optional(),
      AWS_REGION: z.string().min(1).optional(),
      LICENSE_KEY_PEPPER: z.string().min(32),
      SIGNING_KEY_FILE: z.string().min(1),
      SIGNING_KEY_ID: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      JWT_ISSUER: z.string().url(),
      JWT_AUDIENCE: z.string().min(1).default("bugger-extension"),
      HOST: z.string().default("0.0.0.0"),
      PORT: z.coerce.number().int().min(1).max(65535).default(3000),
      TRUST_PROXY: z
        .union([z.literal("false"), z.literal("loopback"), z.ipv4(), z.ipv6()])
        .default("false"),
      GIT_SHA: z.string().max(100).default("unknown"),
    })
    .parse(env);
  if (Buffer.byteLength(e.LICENSE_KEY_PEPPER) < 32)
    throw new Error("Pepper must contain at least 32 bytes");
  return { ...e, signingKey: readFileSync(e.SIGNING_KEY_FILE, "utf8") };
}
export type Config = ReturnType<typeof config>;
