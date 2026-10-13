export interface CloudConfig {
  apiUrl: string;
  issuer: string;
  clientId: string;
  hostedDomain: string;
}
declare const __BUGGER_CLOUD__: CloudConfig | null;
export const cloudConfig: CloudConfig | null =
  typeof __BUGGER_CLOUD__ === "undefined" ? null : __BUGGER_CLOUD__;
export function requiredConfig(): CloudConfig {
  if (!cloudConfig)
    throw new Error(
      "This build is local-only. Cloud service is not configured.",
    );
  return cloudConfig;
}
export function cloudOrigins(config: CloudConfig): string[] {
  return [
    ...new Set(
      [config.apiUrl, config.issuer, config.hostedDomain].map(
        (value) => new URL(value).origin + "/*",
      ),
    ),
  ];
}
