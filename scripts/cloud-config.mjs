export function readCloudConfig(env = process.env) {
  const vars = [
    "BUGGER_API_URL",
    "BUGGER_OIDC_ISSUER",
    "BUGGER_OIDC_CLIENT_ID",
    "BUGGER_COGNITO_DOMAIN",
  ];
  const configured = vars.filter((name) => env[name]);
  if (configured.length && configured.length !== vars.length)
    throw new Error(
      "Cloud build needs all four BUGGER cloud environment variables.",
    );
  function httpsUrl(value, originOnly = false) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname.includes("*") ||
      (originOnly && url.pathname !== "/")
    )
      throw new Error(
        "Cloud URLs must be explicit HTTPS URLs without credentials/query/fragment.",
      );
    return url.href.replace(/\/$/, "");
  }
  const cloud = configured.length
    ? {
        apiUrl: httpsUrl(env.BUGGER_API_URL),
        issuer: httpsUrl(env.BUGGER_OIDC_ISSUER),
        clientId: env.BUGGER_OIDC_CLIENT_ID,
        hostedDomain: httpsUrl(env.BUGGER_COGNITO_DOMAIN, true),
      }
    : null;
  if (cloud && !/^[a-zA-Z0-9]+$/.test(cloud.clientId))
    throw new Error("Invalid Cognito public client ID.");

  return cloud;
}
