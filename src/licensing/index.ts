/** The release is a five-report trial until a real signed-entitlement provider ships. */
export const FREE_REPORT_LIMIT = 5;
export interface LicenseStatus {
  plan: "trial";
  limit: number;
  used: number;
  remaining: number;
  canCreate: boolean;
  purchaseAvailable: false;
  message: string;
}
export function licenseStatus(savedCount: number): LicenseStatus {
  const used = Math.max(0, Math.floor(savedCount));
  return {
    plan: "trial",
    limit: FREE_REPORT_LIMIT,
    used,
    remaining: Math.max(0, FREE_REPORT_LIMIT - used),
    canCreate: used < FREE_REPORT_LIMIT,
    purchaseAvailable: false,
    message:
      "Five locally saved reports. Payments and paid activation are not available in this build. Existing reports remain editable and exportable.",
  };
}
export function assertCanCreate(count: number): void {
  if (!licenseStatus(count).canCreate)
    throw new Error(
      "Five-report trial limit reached. Export or delete an existing report to make space. Paid activation is not available yet.",
    );
}
