import { cloudOrigins, requiredConfig, type CloudConfig } from "./config";
export interface CloudSession {
  accessToken: string;
  subject: string;
  expiresAt: number;
  issuer: string;
  clientId: string;
}
const SESSION_KEY = "buggerCloudSession";
const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
function decode(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("Invalid authentication response.");
  return Uint8Array.from(
    atob(value.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
}
export async function pkce() {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  return { verifier, state, challenge };
}
export function authorizationCode(
  result: string | undefined,
  redirect: string,
  state: string,
): string {
  if (!result) throw new Error("Sign-in was cancelled.");
  const url = new URL(result),
    expected = new URL(redirect);
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.hash ||
    url.searchParams.getAll("state").length !== 1 ||
    url.searchParams.get("state") !== state
  )
    throw new Error("Sign-in response failed the redirect or state check.");
  if (url.searchParams.has("error"))
    throw new Error("Sign-in was declined or could not be completed.");
  const code = url.searchParams.get("code");
  if (
    !code ||
    code.length > 4096 ||
    url.searchParams.getAll("code").length !== 1
  )
    throw new Error("Sign-in returned no valid authorization code.");
  return code;
}
export async function safeFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "Cloud connection failed. Check your connection and permissions, then retry.",
    );
  }
}
export async function validateAccessToken(
  token: string,
  config: CloudConfig,
): Promise<CloudSession> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || token.length > 16000) throw new Error();
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0]!)));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1]!)));
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      header.kid.length > 200 ||
      claims.iss !== config.issuer ||
      claims.client_id !== config.clientId ||
      claims.token_use !== "access" ||
      typeof claims.sub !== "string" ||
      !claims.sub ||
      claims.sub.length > 200 ||
      !Number.isSafeInteger(claims.exp) ||
      claims.exp * 1000 <= Date.now() + 30000 ||
      !Number.isSafeInteger(claims.iat) ||
      claims.iat * 1000 > Date.now() + 60000
    )
      throw new Error();
    const response = await safeFetch(config.issuer + "/.well-known/jwks.json");
    if (!response.ok) throw new Error();
    const jwks = await response.json();
    if (!Array.isArray(jwks.keys) || jwks.keys.length > 10) throw new Error();
    const jwk = jwks.keys.find(
      (k: JsonWebKey & { kid?: string }) =>
        k.kid === header.kid &&
        k.kty === "RSA" &&
        k.use === "sig" &&
        k.alg === "RS256",
    );
    if (!jwk) throw new Error();
    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    if (
      !(await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        key,
        decode(parts[2]!) as Uint8Array<ArrayBuffer>,
        new TextEncoder().encode(parts[0] + "." + parts[1]),
      ))
    )
      throw new Error();
    return {
      accessToken: token,
      subject: claims.sub,
      expiresAt: claims.exp * 1000,
      issuer: config.issuer,
      clientId: config.clientId,
    };
  } catch {
    throw new Error(
      "The sign-in token could not be verified. No session was saved.",
    );
  }
}
export async function session(): Promise<CloudSession | null> {
  const config = requiredConfig();
  const result = await chrome.storage.session.get(SESSION_KEY);
  const value = result[SESSION_KEY] as CloudSession | undefined;
  if (!value) return null;
  if (
    value.issuer !== config.issuer ||
    value.clientId !== config.clientId ||
    typeof value.accessToken !== "string" ||
    typeof value.subject !== "string" ||
    !Number.isFinite(value.expiresAt) ||
    value.expiresAt <= Date.now() + 30000
  ) {
    await signOut();
    return null;
  }
  return value;
}
export async function signIn(): Promise<void> {
  const config = requiredConfig();
  // Permission prompt stays directly in the user gesture before asynchronous work.
  if (!(await chrome.permissions.request({ origins: cloudOrigins(config) })))
    throw new Error(
      "Cloud access was not granted. Local reports remain available.",
    );
  const { verifier, state, challenge } = await pkce(),
    redirect = chrome.identity.getRedirectURL("cognito");
  const url = new URL("/oauth2/authorize", config.hostedDomain);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: redirect,
    scope: "openid",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
  }).toString();
  const code = authorizationCode(
    await chrome.identity.launchWebAuthFlow({
      url: url.href,
      interactive: true,
    }),
    redirect,
    state,
  );
  const response = await safeFetch(
    new URL("/oauth2/token", config.hostedDomain).href,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: redirect,
        code,
        code_verifier: verifier,
      }).toString(),
    },
  );
  if (!response.ok)
    throw new Error(
      "Sign-in could not exchange the authorization code. Please retry.",
    );
  const tokens = await response.json();
  if (
    tokens.token_type?.toLowerCase() !== "bearer" ||
    typeof tokens.access_token !== "string"
  )
    throw new Error("Invalid sign-in response.");
  const verified = await validateAccessToken(tokens.access_token, config);
  await chrome.storage.session.set({ [SESSION_KEY]: verified });
}
export async function signOut(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}
