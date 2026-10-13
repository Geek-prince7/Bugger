import { requiredConfig } from "./config";
import { safeFetch, session, signOut, type CloudSession } from "./auth";
import { validateIssue } from "../shared/validation";
import { projectIssue } from "../export";
import type { Issue, PrivacyOptions, StoredIssue } from "../shared/types";
import { repository } from "../storage/repository";
export interface CloudReport {
  issue: Issue;
  version: number;
  owner: string;
}
export class CloudError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "CloudError";
  }
}
function version(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new CloudError(
      "INVALID_RESPONSE",
      "Cloud returned an invalid report version.",
    );
  return value;
}
function id(value: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new Error("Invalid report ID.");
  return encodeURIComponent(value);
}
async function authenticated(): Promise<CloudSession> {
  const auth = await session();
  if (!auth)
    throw new CloudError(
      "SIGNED_OUT",
      "Sign in again to access your cloud reports.",
    );
  return auth;
}
async function checkSession(auth: CloudSession) {
  const current = await session();
  if (current?.accessToken !== auth.accessToken)
    throw new CloudError(
      "ACCOUNT_CHANGED",
      "Cloud account changed. Refresh and retry the action.",
    );
}
export async function request(
  path: string,
  init: RequestInit = {},
  auth?: CloudSession,
): Promise<unknown> {
  auth ??= await authenticated();
  await checkSession(auth);
  const response = await safeFetch(requiredConfig().apiUrl + path, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
    },
  });
  await checkSession(auth);
  if (response.status === 401) {
    await signOut();
    throw new CloudError(
      "SIGNED_OUT",
      "Your cloud session expired. Sign in again.",
    );
  }
  if (response.status === 409) {
    const detail = await response.json().catch(() => null);
    if (detail?.code === "ACCOUNT_QUOTA")
      throw new CloudError(
        "ACCOUNT_QUOTA",
        "Your cloud account storage or report limit is full. Delete an unneeded cloud copy or omit the screenshot.",
      );
    throw new CloudError(
      "CONFLICT",
      "Cloud report changed since your last upload. Nothing was overwritten. Download a copy to compare, or explicitly delete the cloud copy before uploading anew.",
    );
  }
  if (response.status === 404)
    throw new CloudError(
      "NOT_FOUND",
      "This cloud report no longer exists. Refresh the cloud list.",
    );
  if (response.status === 413)
    throw new CloudError(
      "TOO_LARGE",
      "The report is too large for cloud storage. Exclude its screenshot and retry.",
    );
  if (response.status === 429)
    throw new CloudError(
      "RATE_LIMIT",
      "Too many cloud requests. Wait briefly and try again.",
    );
  if (!response.ok)
    throw new CloudError(
      "SERVER_ERROR",
      "Cloud request failed. Your local report is unchanged. Try again later.",
    );
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length > 14 * 1024 * 1024)
    throw new CloudError(
      "INVALID_RESPONSE",
      "Cloud response exceeds the allowed size.",
    );
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    throw new CloudError(
      "INVALID_RESPONSE",
      "Cloud returned an invalid response.",
    );
  }
}
export async function listCloudReports(): Promise<CloudReport[]> {
  const auth = await authenticated();
  const data = await request("/v1/reports", {}, auth);
  if (!Array.isArray(data) || data.length > 1000)
    throw new CloudError(
      "INVALID_RESPONSE",
      "Cloud returned an invalid report list.",
    );
  return data.map((row) => ({
    issue: validateIssue(row.issue),
    version: version(row.version),
    owner: auth.issuer + ":" + auth.subject,
  }));
}
function versionKey(reportId: string, auth: CloudSession): string {
  return `cloudVersion:${auth.issuer}:${auth.subject}:${reportId}`;
}
function checkOwner(report: CloudReport, auth: CloudSession) {
  if (report.owner !== auth.issuer + ":" + auth.subject)
    throw new CloudError(
      "ACCOUNT_CHANGED",
      "Cloud account changed. Refresh the list before acting on reports.",
    );
}
export async function uploadReport(
  record: StoredIssue,
  privacy: PrivacyOptions,
): Promise<number> {
  return navigator.locks.request(
    "bugger-cloud-" + record.issue.id,
    async () => {
      const auth = await authenticated(),
        key = versionKey(record.issue.id, auth),
        saved = (await chrome.storage.local.get(key))[key];
      const expectedVersion = saved === undefined ? null : version(saved);
      const issue = projectIssue(record.issue, privacy);
      issue.attachments = [];
      const originalDataUrl =
        privacy.screenshot && record.original
          ? await blobDataUrl(record.original)
          : null;
      const result = (await request(
        "/v1/reports/" + id(issue.id),
        {
          method: "PUT",
          body: JSON.stringify({ issue, originalDataUrl, expectedVersion }),
        },
        auth,
      )) as { version?: unknown };
      const next = version(result?.version);
      await chrome.storage.local.set({ [key]: next });
      return next;
    },
  );
}
export async function deleteCloudReport(report: CloudReport): Promise<void> {
  const auth = await authenticated();
  checkOwner(report, auth);
  await request(
    "/v1/reports/" +
      id(report.issue.id) +
      "?expectedVersion=" +
      version(report.version),
    { method: "DELETE" },
    auth,
  );
  await chrome.storage.local.remove(versionKey(report.issue.id, auth));
}
export async function blobDataUrl(blob: Blob): Promise<string> {
  if (blob.type !== "image/png" || blob.size > 8 * 1024 * 1024)
    throw new CloudError(
      "TOO_LARGE",
      "Cloud screenshots must be PNG and at most 8 MB.",
    );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return "data:image/png;base64," + btoa(binary);
}
export function imageBlob(value: unknown): Blob | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 12 * 1024 * 1024 ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw new CloudError("INVALID_RESPONSE", "Cloud screenshot is invalid.");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value.slice(22)), (c) => c.charCodeAt(0));
  } catch {
    throw new CloudError("INVALID_RESPONSE", "Cloud screenshot is invalid.");
  }
  if (
    bytes.length > 8 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    throw new CloudError("INVALID_RESPONSE", "Cloud screenshot is invalid.");
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" });
}
/** Download always creates a new ID; quota/schema checks remain in the local repository. */
export async function downloadReport(report: CloudReport): Promise<void> {
  const auth = await authenticated();
  checkOwner(report, auth);
  const data = (await request(
    "/v1/reports/" + id(report.issue.id),
    {},
    auth,
  )) as { issue: unknown; version: unknown; originalDataUrl: unknown };
  const issue = validateIssue(data.issue);
  version(data.version);
  if (issue.id !== report.issue.id)
    throw new CloudError(
      "INVALID_RESPONSE",
      "Cloud returned a different report.",
    );
  const original = imageBlob(data.originalDataUrl);
  issue.id = crypto.randomUUID();
  issue.attachments = [];
  await repository.save({ issue, original });
}
