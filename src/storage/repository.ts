import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { Issue, StoredIssue } from "../shared/types";
import { validateIssue } from "../shared/validation";
import { licenseStatus } from "../licensing";
interface Stored extends StoredIssue {
  bytes: number;
  originalDigest: string | null;
}
interface Database extends DBSchema {
  issues: { key: string; value: Stored };
}
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024,
  MAX_ISSUE_BYTES = 10 * 1024 * 1024;
export type RepositoryErrorCode =
  | "INVALID_REPORT"
  | "CORRUPT_STORAGE"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_FULL"
  | "REPORT_TOO_LARGE"
  | "TRIAL_LIMIT"
  | "NOT_FOUND"
  | "CONFLICT";
export class RepositoryError extends Error {
  constructor(
    public code: RepositoryErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepositoryError";
  }
}
function storageError(error: unknown): never {
  if (error instanceof RepositoryError) throw error;
  if (error instanceof DOMException)
    throw new RepositoryError(
      error.name === "QuotaExceededError"
        ? "STORAGE_FULL"
        : "STORAGE_UNAVAILABLE",
      "Local storage is full or unavailable. Export accessible reports, free space and try again. Your saved data has not been deleted.",
    );
  throw error;
}
function byteSize(issue: Issue, original: Blob | null) {
  return (
    new TextEncoder().encode(JSON.stringify(issue)).byteLength +
    (original?.size ?? 0)
  );
}
function checkStored(raw: Stored): Stored {
  try {
    const issue = validateIssue(raw.issue);
    if (
      raw.original !== null &&
      (!(raw.original instanceof Blob) || raw.original.type !== "image/png")
    )
      throw new Error("Invalid image");
    if (
      !Number.isSafeInteger(raw.bytes) ||
      raw.bytes < 0 ||
      byteSize(issue, raw.original) !== raw.bytes ||
      raw.bytes > MAX_ISSUE_BYTES
    )
      throw new Error("Invalid size");
    if (
      raw.original !== null &&
      !/^[a-f0-9]{64}$/.test(raw.originalDigest ?? "")
    )
      throw new Error("Missing image integrity information");
    return { ...raw, issue };
  } catch {
    throw new RepositoryError(
      "CORRUPT_STORAGE",
      "A saved report is damaged or uses an unsupported format. Do not uninstall or clear storage. Preserve the Bugger browser profile and contact support for recovery.",
    );
  }
}
async function digest(blob: Blob | null) {
  if (!blob) return null;
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export class IssueRepository {
  private database: Promise<IDBPDatabase<Database>> | undefined;
  constructor(private name = "bugger-v1") {}
  private db() {
    if (this.database) return this.database;
    const opening = openDB<Database>(this.name, 1, {
      upgrade(db, _oldVersion, _newVersion, transaction) {
        // openDB rejects too; consume the upgrade transaction rejection separately.
        void transaction.done.catch(() => {});
        db.createObjectStore("issues", { keyPath: "issue.id" });
      },
      blocking: () => {
        void this.database?.then((db) => db.close());
        this.database = undefined;
      },
    });
    this.database = opening;
    // A transient open failure must not poison this repository until reload.
    void opening.catch(() => {
      if (this.database === opening) this.database = undefined;
    });
    return opening;
  }

  async list(): Promise<StoredIssue[]> {
    try {
      return (await (await this.db()).getAll("issues"))
        .map(checkStored)
        .sort((a, b) => b.issue.createdAt.localeCompare(a.issue.createdAt))
        .map(({ issue, original }) => ({ issue, original }));
    } catch (error) {
      storageError(error);
    }
  }
  async get(id: string): Promise<StoredIssue | undefined> {
    try {
      const raw = await (await this.db()).get("issues", id);
      if (!raw) return undefined;
      const { issue, original } = checkStored(raw);
      return { issue, original };
    } catch (error) {
      storageError(error);
    }
  }
  async save(record: StoredIssue): Promise<void> {
    await this.write(record, false);
  }
  async update(issue: Issue): Promise<void> {
    await this.write({ issue, original: null }, true);
  }
  private async write(input: StoredIssue, edit: boolean) {
    let issue: Issue;
    try {
      issue = validateIssue(input.issue);
    } catch {
      throw new RepositoryError(
        "INVALID_REPORT",
        "This report contains invalid fields. Review the form and retry.",
      );
    }
    if (
      !edit &&
      input.original !== null &&
      (!(input.original instanceof Blob) || input.original.type !== "image/png")
    )
      throw new RepositoryError(
        "INVALID_REPORT",
        "Screenshot must be a PNG image.",
      );
    if (!edit && byteSize(issue, input.original) > MAX_ISSUE_BYTES)
      throw new RepositoryError(
        "REPORT_TOO_LARGE",
        "This report exceeds the 10 MB limit. Retry without a screenshot.",
      );
    // Digest before opening the transaction: awaiting browser crypto inside an IDB transaction would close it.
    const incomingDigest = edit ? null : await digest(input.original);
    try {
      const db = await this.db(),
        tx = db.transaction("issues", "readwrite");
      try {
        const all = (await tx.store.getAll()).map(checkStored),
          existing = all.find((r) => r.issue.id === issue.id);
        if (edit && !existing)
          throw new RepositoryError(
            "NOT_FOUND",
            "This report no longer exists.",
          );
        if (!edit && existing) {
          if (
            JSON.stringify(existing.issue) === JSON.stringify(issue) &&
            existing.originalDigest === incomingDigest
          ) {
            await tx.done;
            return;
          }
          throw new RepositoryError(
            "CONFLICT",
            "A different report with this ID already exists. Reload before saving.",
          );
        }
        if (!existing && !licenseStatus(all.length).canCreate)
          throw new RepositoryError(
            "TRIAL_LIMIT",
            "Five-report trial limit reached. Export or delete an existing report to make space. Paid activation is not available yet.",
          );
        if (existing && existing.issue.updatedAt !== issue.updatedAt)
          throw new RepositoryError(
            "CONFLICT",
            "This report changed in another window. Reload before editing.",
          );
        if (existing) {
          const {
            title,
            description,
            type,
            severity,
            status,
            expectedResult,
            actualResult,
            reproductionSteps,
          } = issue;
          // Captured evidence is immutable. Only reporter-authored observation fields can be edited.
          issue = {
            ...existing.issue,
            title,
            description,
            type,
            severity,
            status,
            expectedResult,
            actualResult,
            reproductionSteps,
            updatedAt: new Date(
              Math.max(Date.now(), Date.parse(existing.issue.updatedAt) + 1),
            ).toISOString(),
          };
        }
        const original = existing ? existing.original : input.original,
          bytes = byteSize(issue, original);
        if (bytes > MAX_ISSUE_BYTES)
          throw new RepositoryError(
            "REPORT_TOO_LARGE",
            "This report exceeds the 10 MB limit. Shorten the report and try again.",
          );
        if (
          all.reduce(
            (sum, r) => sum + (r.issue.id === issue.id ? 0 : r.bytes),
            0,
          ) +
            bytes >
          MAX_TOTAL_BYTES
        )
          throw new RepositoryError(
            "STORAGE_FULL",
            "The 50 MB local storage limit was reached. Export reports and delete older ones, then retry.",
          );
        await tx.store.put({
          issue,
          original,
          bytes,
          originalDigest: existing?.originalDigest ?? incomingDigest,
        });
        await tx.done;
      } catch (error) {
        try {
          tx.abort();
        } catch {
          /* transaction may already be complete */
        }
        await tx.done.catch(() => {});
        throw error;
      }
    } catch (error) {
      storageError(error);
    }
  }
  async remove(id: string): Promise<void> {
    try {
      await (await this.db()).delete("issues", id);
    } catch (error) {
      storageError(error);
    }
  }
  async close() {
    if (this.database) (await this.database).close();
    this.database = undefined;
  }
}
export const repository = new IssueRepository();
