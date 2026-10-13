import React, { useEffect, useState, useRef } from "react";
import { cloudConfig } from "./config";
import { session, signIn, signOut } from "./auth";
import {
  listCloudReports,
  uploadReport,
  downloadReport,
  deleteCloudReport,
  type CloudReport,
} from "./reports";
import type { StoredIssue, PrivacyOptions } from "../shared/types";
export function CloudPanel({
  selected,
  privacy,
  editing,
  onLocalChanged,
}: {
  selected: StoredIssue | null;
  privacy: PrivacyOptions;
  editing: boolean;
  onLocalChanged: () => Promise<void>;
}) {
  const [signedIn, setSignedIn] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [reports, setReports] = useState<CloudReport[]>([]),
    [loaded, setLoaded] = useState(false);
  const sessionGeneration = useRef(0);
  useEffect(() => {
    const listener = (changes: Record<string, unknown>, area: string) => {
      if (area === "session" && "buggerCloudSession" in changes) {
        sessionGeneration.current++;
        setReports([]);
        setLoaded(false);
        setMessage("Cloud session changed. Refresh the list.");
        void session()
          .then((value) => setSignedIn(!!value))
          .catch(() => setSignedIn(false));
      }
    };
    if (cloudConfig) chrome.storage.onChanged.addListener(listener);
    if (cloudConfig)
      void session()
        .then((value) => setSignedIn(!!value))
        .catch(() =>
          setMessage("Could not read cloud session. Try signing in again."),
        );
    return () => {
      if (cloudConfig) chrome.storage.onChanged.removeListener(listener);
    };
  }, []);
  if (!cloudConfig) return null;
  async function refreshRemote() {
    const generation = sessionGeneration.current;
    const result = await listCloudReports();
    if (generation === sessionGeneration.current) {
      setReports(result);
      setLoaded(true);
    }
  }
  async function act(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.message
          : "Cloud operation failed. Local reports are unchanged.",
      );
    } finally {
      setSignedIn(!!(await session().catch(() => null)));
      setBusy(false);
    }
  }
  return (
    <details
      className="cloud-panel"
      style={{
        padding: 16,
        border: "1px solid #ced7e4",
        borderRadius: 12,
        marginBottom: 20,
      }}
    >
      <summary>Personal cloud reports · optional</summary>
      <p>
        Sign in to copy individual reports to your private cloud account. Local
        reports are never uploaded automatically. This service receives the
        report fields you approve and any included screenshot.
      </p>
      <p>
        <small>Cloud destination: {cloudConfig.apiUrl}</small>
      </p>
      {!signedIn ? (
        <button
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await signIn();
              setReports([]);
              setLoaded(false);
              setMessage(
                "Signed in. Choose Refresh cloud list or explicitly upload a reviewed report.",
              );
            })
          }
        >
          Sign in to cloud
        </button>
      ) : (
        <>
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await signOut();
                setReports([]);
                setLoaded(false);
                setMessage(
                  "Signed out on this browser. Cloud reports remain saved; the identity provider browser session may still exist.",
                );
              })
            }
          >
            Sign out
          </button>{" "}
          <button
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await refreshRemote();
              })
            }
          >
            Refresh cloud list
          </button>
          {selected && (
            <div style={{ marginTop: 12 }}>
              <p>
                Selected local report: <strong>{selected.issue.title}</strong>.
                The privacy review controls below apply to cloud upload,
                including URL, HTML and country exclusions. Written notes are
                always included.
              </p>
              <button
                disabled={busy || editing}
                onClick={() => {
                  if (
                    !confirm(
                      `Upload this report to your private cloud account?\n\n${privacy.screenshot && selected.original ? "The original screenshot will be uploaded and may expose personal or confidential information. Inspect it first." : "No screenshot will be uploaded."}\n\nThe selected privacy exclusions apply to metadata. Your written notes remain included. This will update your last uploaded cloud version only if it has not changed.`,
                    )
                  )
                    return;
                  void act(async () => {
                    const v = await uploadReport(selected, privacy);
                    setMessage(
                      `Uploaded cloud version ${v}. Local original unchanged.`,
                    );
                    await refreshRemote();
                  });
                }}
              >
                Upload selected report after privacy review
              </button>
            </div>
          )}
          {loaded && reports.length === 0 && <p>No cloud reports.</p>}
          <ul>
            {reports.map((report) => (
              <li key={report.issue.id} style={{ marginTop: 12 }}>
                <strong>{report.issue.title}</strong> · version {report.version}{" "}
                <button
                  disabled={busy || editing}
                  onClick={() =>
                    void act(async () => {
                      await downloadReport(report);
                      await onLocalChanged();
                      setMessage(
                        "Downloaded as a new local copy. Existing local edits were preserved.",
                      );
                    })
                  }
                >
                  Download as new local copy
                </button>{" "}
                <button
                  disabled={busy}
                  onClick={() => {
                    if (
                      confirm(
                        `Delete cloud version ${report.version} of “${report.issue.title}”? Local copies stay saved.`,
                      )
                    )
                      void act(async () => {
                        await deleteCloudReport(report);
                        setReports(
                          reports.filter(
                            (row) => row.issue.id !== report.issue.id,
                          ),
                        );
                        setMessage("Cloud copy deleted.");
                      });
                  }}
                >
                  Delete cloud copy
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Working…" : message}
      </p>
      <small>
        Sign-in expires with your access token or browser session. Downloads use
        a new local report ID and count toward local storage and trial limits.
        Deleting local reports does not delete cloud copies.
      </small>
    </details>
  );
}
