import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  DEFAULT_PRIVACY,
  ISSUE_TYPES,
  SEVERITIES,
  STATUSES,
  rpc,
  type Issue,
  type PrivacyOptions,
  type StoredIssue,
} from "../shared/types";
import { buildExport } from "../export/index";
import "./styles.css";
const label = (value: string) => value.replaceAll("_", " ");
const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon" aria-hidden="true">
        b
      </span>
      Bugger<span className="brand-tag">LOCAL FIRST</span>
    </div>
  );
}
function App() {
  const popup = document.body.dataset.view === "popup";
  const [page, setPage] = useState<"issues" | "settings" | "license">("issues");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<StoredIssue | null>(null);
  const [image, setImage] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [remove, setRemove] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyOptions>({
    ...DEFAULT_PRIVACY,
  });
  const [preview, setPreview] = useState("");
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [count, setCount] = useState(0);
  const [country, setCountry] = useState("");
  const [region, setRegion] = useState("");
  const requestSequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const previewSequence = useRef(0);
  async function refresh() {
    const [list, status] = await Promise.all([
      rpc<Issue[]>({ type: "ISSUE_LIST" }),
      rpc<{ count: number }>({ type: "STATUS" }),
    ]);
    setIssues(list);
    setCount(status.count);
  }
  useEffect(() => {
    void refresh()
      .catch((e) => setError(errorText(e)))
      .finally(() => setLoading(false));
    void chrome.storage.local
      .get<{ preferences?: { country?: string; geoRegion?: string } }>(
        "preferences",
      )
      .then((result) => {
        setCountry(result.preferences?.country || "");
        setRegion(result.preferences?.geoRegion || "");
      })
      .catch((e) => setError(errorText(e)));
  }, []);
  useEffect(() => {
    let active = true;
    let pending = false;
    const refreshList = async () => {
      if (document.visibilityState === "hidden" || pending) return;
      pending = true;
      try {
        const [list, status] = await Promise.all([
          rpc<Issue[]>({ type: "ISSUE_LIST" }),
          rpc<{ count: number }>({ type: "STATUS" }),
        ]);
        if (active) {
          setIssues(list);
          setCount(status.count);
        }
      } catch (error) {
        if (active) setError(errorText(error));
      } finally {
        pending = false;
      }
    };
    window.addEventListener("focus", refreshList);
    document.addEventListener("visibilitychange", refreshList);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshList);
      document.removeEventListener("visibilitychange", refreshList);
    };
  }, []);
  useEffect(() => {
    if (!edit) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [edit]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (remove) dialog.current?.showModal();
    else dialog.current?.close();
  }, [remove]);
  useEffect(() => {
    const sequence = ++previewSequence.current;
    setPreview("Preparing privacy preview…");
    if (!selected) return;
    void buildExport(selected, privacy, "json")
      .then((result) => result.blob.text())
      .then((text) => {
        if (sequence === previewSequence.current) setPreview(text);
      })
      .catch((e) => {
        if (sequence === previewSequence.current) setPreview(errorText(e));
      });
  }, [selected, privacy]);
  async function act(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function leaveEditor() {
    return !edit || window.confirm("Discard your unsaved edits?");
  }
  async function choose(issue: Issue) {
    if (!leaveEditor()) return;
    const sequence = ++requestSequence.current;
    await act(async () => {
      const value = await rpc<{ issue: Issue; originalDataUrl: string | null }>(
        { type: "ISSUE_GET", id: issue.id },
      );
      const original = value.originalDataUrl
        ? await (await fetch(value.originalDataUrl)).blob()
        : null;
      if (sequence !== requestSequence.current) return;
      setSelected({ issue: value.issue, original });
      setImage(value.originalDataUrl);
      setPrivacy({ ...DEFAULT_PRIVACY, screenshot: Boolean(original) });
      setEdit(false);
    });
  }
  async function start() {
    await act(async () => {
      await rpc({ type: "START_CAPTURE" });
      window.close();
    });
  }
  function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function exportFile(format: "zip" | "json" | "markdown" | "image") {
    if (!selected) return;
    await act(async () => {
      const result = await buildExport(selected, privacy, format);
      download(result.blob, result.filename);
      setToast("Export prepared. Check your browser downloads.");
    });
  }
  const filtered = issues.filter((item) =>
    `${item.title} ${item.page.hostname ?? ""}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const issue = selected?.issue;
  const evidenceAvailable: Record<keyof PrivacyOptions, boolean> = {
    screenshot: Boolean(selected?.original),
    pageUrl: Boolean(issue?.page.url),
    elementText: Boolean(issue?.selection.element?.textExcerpt),
    html: Boolean(issue?.selection.element?.sanitizedHtml),
    attributes: Boolean(
      issue?.selection.element &&
      Object.keys(issue.selection.element.attributes).length,
    ),
    country: Boolean(
      issue?.environment.country.value || issue?.environment.geoRegion.value,
    ),
    assetUrls: Boolean(
      issue?.selection.element &&
      Object.entries(issue.selection.element.attributes).some(
        ([key, value]) =>
          /(?:href|src|url|action)/i.test(key) && Boolean(value),
      ),
    ),
  };
  return (
    <div className={popup ? "app popup" : "app"}>
      <aside className="sidebar">
        <Brand />
        <p className="tagline">
          Small observations.
          <br />
          Better fixes.
        </p>
        <nav aria-label="Main navigation">
          <button
            className={page === "issues" ? "nav active" : "nav"}
            onClick={() => {
              if (leaveEditor()) {
                setEdit(false);
                setPage("issues");
              }
            }}
          >
            ▧ <span>My issues</span>
            <span className="count">{count}</span>
          </button>
          <button
            className={page === "settings" ? "nav active" : "nav"}
            onClick={() => {
              if (leaveEditor()) {
                setEdit(false);
                setPage("settings");
              }
            }}
          >
            ⚙ <span>Settings</span>
          </button>
          <button
            className={page === "license" ? "nav active" : "nav"}
            onClick={() => {
              if (leaveEditor()) {
                setEdit(false);
                setPage("license");
              }
            }}
          >
            ◇ <span>License</span>
          </button>
        </nav>
        <div className="sidebar-bottom">
          <span className="dot" /> Saved on this device
          <p>No account. No page uploads.</p>
        </div>
      </aside>
      <main>
        {error && (
          <div className="alert" role="alert">
            {error}
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {page === "issues" && popup ? (
          <section className="popup-content">
            <span className="eyebrow">YOUR NEXT FIX STARTS HERE</span>
            <h1>
              Point it out.
              <br />
              Pass it on.
            </h1>
            <p>
              Capture a page element or region, add your observation, and share
              the context.
            </p>
            <button
              className="primary full"
              disabled={busy}
              onClick={() => void start()}
            >
              Start capture <span>↗</span>
            </button>
            <button
              className="secondary full"
              onClick={() =>
                void chrome.tabs
                  .create({ url: chrome.runtime.getURL("issues.html") })
                  .catch((e) => setError(errorText(e)))
              }
            >
              View my issues <span>{count}/5</span>
            </button>
            <small>
              Activate on an ordinary website tab. Press Esc to stop capture.
            </small>
          </section>
        ) : page === "issues" ? (
          <>
            <header className="page-header">
              <div>
                <span className="eyebrow">YOUR LOCAL WORKSPACE</span>
                <h1>
                  My issues
                  <span className="heading-count">{issues.length}</span>
                </h1>
                <p>Useful context, ready for the person fixing it.</p>
              </div>
              <div className="local-pill">
                <span className="dot" /> On this device
              </div>
            </header>
            <div className="workspace">
              <section className="issue-list" aria-label="Saved issues">
                <label className="search">
                  <span aria-hidden="true">⌕</span>
                  <input
                    aria-label="Search by title or hostname"
                    placeholder="Search issues or websites"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                <div className="list-heading">
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "OBSERVATION" : "OBSERVATIONS"}
                  <span>Newest first</span>
                </div>
                {loading ? (
                  <p className="empty-small">Loading your issues…</p>
                ) : filtered.length === 0 ? (
                  <div className="empty-small">
                    <h3>{query ? "No matches" : "A clean slate."}</h3>
                    <p>
                      {query
                        ? "Try another title or website."
                        : "Open a website, then choose Start capture from the Bugger toolbar icon."}
                    </p>
                  </div>
                ) : (
                  filtered.map((item) => (
                    <button
                      key={item.id}
                      className={`issue-card ${issue?.id === item.id ? "selected" : ""}`}
                      disabled={busy}
                      onClick={() => void choose(item)}
                      aria-pressed={issue?.id === item.id}
                    >
                      <div className="card-top">
                        <span className={`severity ${item.severity}`}>
                          {item.severity}
                        </span>
                        <span>{date(item.createdAt)}</span>
                      </div>
                      <h3>{item.title}</h3>
                      <p>{item.page.hostname || "Unknown website"}</p>
                      <div className="card-bottom">
                        <span>{label(item.type)}</span>
                        <span>{label(item.status)}</span>
                      </div>
                    </button>
                  ))
                )}
              </section>
              <section className="detail" aria-label="Issue details">
                {!issue ? (
                  <div className="empty-detail">
                    <div className="empty-icon">⌖</div>
                    <span className="eyebrow">
                      A LITTLE CONTEXT GOES A LONG WAY
                    </span>
                    <h2>Select an observation.</h2>
                    <p>
                      Review the evidence, refine your notes, and choose exactly
                      what leaves your device.
                    </p>
                    <div className="tip">
                      Your reports live in this browser. Export a backup before
                      uninstalling Bugger.
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="detail-head">
                      <span className="eyebrow">
                        ISSUE / {issue.id.slice(0, 8)}
                      </span>
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() => {
                            if (leaveEditor()) setEdit(!edit);
                          }}
                        >
                          {edit ? "Cancel editing" : "Edit issue"}
                        </button>
                        <button
                          className="danger-text"
                          disabled={busy}
                          onClick={() => {
                            setError("");
                            setRemove(true);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    {edit ? (
                      <form
                        className="edit-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const data = new FormData(event.currentTarget);
                          const steps = String(data.get("steps") || "")
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean);
                          if (
                            steps.length > 20 ||
                            steps.some((step) => step.length > 1000)
                          ) {
                            setError(
                              "Use no more than 20 reproduction steps, each up to 1,000 characters.",
                            );
                            return;
                          }
                          if (String(data.get("title")).trim().length < 3) {
                            setError(
                              "Enter a title with at least 3 non-space characters.",
                            );
                            return;
                          }
                          const changed: Issue = {
                            ...issue,
                            title: String(data.get("title")).trim(),
                            description: String(data.get("description")),
                            type: data.get("type") as Issue["type"],
                            severity: data.get("severity") as Issue["severity"],
                            status: data.get("status") as Issue["status"],
                            expectedResult:
                              String(data.get("expected")) || null,
                            actualResult: String(data.get("actual")) || null,
                            reproductionSteps: steps,
                          };
                          void act(async () => {
                            await rpc({ type: "ISSUE_UPDATE", issue: changed });
                            const saved = await rpc<{
                              issue: Issue;
                              originalDataUrl: string | null;
                            }>({ type: "ISSUE_GET", id: changed.id });
                            setSelected({ ...selected!, issue: saved.issue });
                            setEdit(false);
                            await refresh();
                            setToast("Changes saved locally.");
                          });
                        }}
                      >
                        <label>
                          Title
                          <input
                            name="title"
                            required
                            minLength={3}
                            maxLength={140}
                            defaultValue={issue.title}
                          />
                        </label>
                        <div className="form-grid">
                          <label>
                            Type
                            <select name="type" defaultValue={issue.type}>
                              {ISSUE_TYPES.map((v) => (
                                <option key={v} value={v}>
                                  {label(v)}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Severity
                            <select
                              name="severity"
                              defaultValue={issue.severity}
                            >
                              {SEVERITIES.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </select>
                          </label>
                          <label>
                            Status
                            <select name="status" defaultValue={issue.status}>
                              {STATUSES.map((v) => (
                                <option key={v} value={v}>
                                  {label(v)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <label>
                          Description
                          <textarea
                            name="description"
                            maxLength={5000}
                            defaultValue={issue.description}
                          />
                        </label>
                        <label>
                          Expected result
                          <textarea
                            name="expected"
                            maxLength={5000}
                            defaultValue={issue.expectedResult || ""}
                          />
                        </label>
                        <label>
                          Actual result
                          <textarea
                            name="actual"
                            maxLength={5000}
                            defaultValue={issue.actualResult || ""}
                          />
                        </label>
                        <label>
                          Reproduction steps · one per line
                          <textarea
                            name="steps"
                            maxLength={20019}
                            defaultValue={issue.reproductionSteps.join("\n")}
                          />
                        </label>
                        <button className="primary" disabled={busy}>
                          Save changes
                        </button>
                      </form>
                    ) : (
                      <>
                        <h2 className="issue-title">{issue.title}</h2>
                        <div className="chips">
                          <span className={`severity ${issue.severity}`}>
                            {issue.severity}
                          </span>
                          <span>{label(issue.type)}</span>
                          <span>{label(issue.status)}</span>
                        </div>
                        {image ? (
                          <figure className="screenshot">
                            <img
                              src={image}
                              alt="Original captured viewport, before export privacy exclusions"
                            />
                            <figcaption>
                              Original captured viewport ·{" "}
                              {issue.page.viewport.width} ×{" "}
                              {issue.page.viewport.height} CSS px
                            </figcaption>
                          </figure>
                        ) : (
                          <div className="no-image">
                            No screenshot collected
                          </div>
                        )}
                        <p className="description">
                          {issue.description || "No additional description."}
                        </p>
                        {issue.expectedResult && (
                          <div className="note">
                            <h4>Expected result</h4>
                            <p>{issue.expectedResult}</p>
                          </div>
                        )}
                        {issue.actualResult && (
                          <div className="note">
                            <h4>Actual result</h4>
                            <p>{issue.actualResult}</p>
                          </div>
                        )}
                        {issue.reproductionSteps.length > 0 && (
                          <div className="note">
                            <h4>Reproduction steps</h4>
                            <ol>
                              {issue.reproductionSteps.map((step, i) => (
                                <li key={i}>{step}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <details className="context">
                          <summary>
                            Developer context{" "}
                            <span>{issue.selection.kind}</span>
                          </summary>
                          <dl>
                            <dt>Page</dt>
                            <dd>{issue.page.url || "Not collected"}</dd>
                            <dt>Captured</dt>
                            <dd>{issue.createdAt}</dd>
                            <dt>Browser</dt>
                            <dd>
                              {issue.environment.browserName.value || "Unknown"}{" "}
                              {issue.environment.browserVersion.value}
                            </dd>
                            <dt>Selector</dt>
                            <dd>
                              <code>
                                {issue.selection.element?.cssSelector ||
                                  "Region selection"}
                              </code>
                              {issue.selection.element?.cssSelector && (
                                <button
                                  onClick={() =>
                                    void act(async () => {
                                      await navigator.clipboard.writeText(
                                        issue.selection.element!.cssSelector!,
                                      );
                                      setToast("Selector copied.");
                                    })
                                  }
                                >
                                  Copy selector
                                </button>
                              )}
                            </dd>
                            <dt>XPath</dt>
                            <dd>
                              <code>
                                {issue.selection.element?.xpath ||
                                  "Not available"}
                              </code>
                              {issue.selection.element?.xpath && (
                                <button
                                  onClick={() =>
                                    void act(async () => {
                                      await navigator.clipboard.writeText(
                                        issue.selection.element!.xpath!,
                                      );
                                      setToast("XPath copied.");
                                    })
                                  }
                                >
                                  Copy XPath
                                </button>
                              )}
                            </dd>
                            <dt>Bounds (CSS px)</dt>
                            <dd>
                              <code>
                                {JSON.stringify(
                                  issue.selection.element?.viewportBox ||
                                    issue.selection.selectedRegion,
                                )}
                              </code>
                              <button
                                onClick={() =>
                                  void act(async () => {
                                    await navigator.clipboard.writeText(
                                      JSON.stringify(
                                        {
                                          viewport:
                                            issue.selection.element
                                              ?.viewportBox ||
                                            issue.selection.selectedRegion,
                                          document:
                                            issue.selection.element
                                              ?.documentBox ?? null,
                                        },
                                        null,
                                        2,
                                      ),
                                    );
                                    setToast("Bounds copied.");
                                  })
                                }
                              >
                                Copy bounds
                              </button>
                            </dd>
                          </dl>
                          <p>
                            Selectors are best effort. This snapshot does not
                            reproduce the full page. Console and network
                            diagnostics were not collected.
                          </p>
                        </details>
                      </>
                    )}
                    <section className="export">
                      <div className="section-title">
                        <span className="eyebrow">BEFORE YOU SHARE</span>
                        <h3>Review your export</h3>
                        <p>
                          Choose the evidence to include. Your saved original
                          stays unchanged.
                        </p>
                      </div>
                      <div className="privacy-options">
                        {(Object.keys(privacy) as (keyof PrivacyOptions)[]).map(
                          (key) => (
                            <label key={key}>
                              <input
                                type="checkbox"
                                checked={evidenceAvailable[key] && privacy[key]}
                                disabled={!evidenceAvailable[key]}
                                aria-describedby={
                                  !evidenceAvailable[key]
                                    ? "uncollected-evidence"
                                    : undefined
                                }
                                onChange={(e) =>
                                  setPrivacy({
                                    ...privacy,
                                    [key]: e.target.checked,
                                  })
                                }
                              />
                              {
                                {
                                  screenshot: "Screenshot",
                                  pageUrl: "Page URL",
                                  elementText: "Element text",
                                  html: "HTML fragment",
                                  attributes: "Element attributes",
                                  country: "Country / region",
                                  assetUrls: "Asset URLs",
                                }[key]
                              }
                            </label>
                          ),
                        )}
                      </div>
                      <p id="uncollected-evidence" className="preview-note">
                        Disabled options were not collected in this report. This
                        version omits element text, attributes, and asset URLs
                        from captures; enabling export cannot recover them.
                      </p>
                      <p className="privacy-warning">
                        Screenshots can contain personal or confidential
                        information. Inspect the image above, or exclude it.
                        Pixel redaction is not available in this version. Review
                        your written notes too.
                      </p>
                      <details>
                        <summary>Preview standalone JSON</summary>
                        <p className="preview-note">
                          Standalone JSON has no attached files. ZIP also
                          includes the selected screenshot and HTML when
                          available. Written notes are included in every report.
                        </p>
                        <pre className="preview">{preview}</pre>
                      </details>
                      <div className="export-actions">
                        <button
                          className="primary"
                          disabled={busy || edit}
                          onClick={() => void exportFile("zip")}
                        >
                          Download ZIP ↗
                        </button>
                        <button
                          disabled={busy || edit}
                          onClick={() => void exportFile("json")}
                        >
                          JSON
                        </button>
                        <button
                          disabled={busy || edit}
                          onClick={() => void exportFile("markdown")}
                        >
                          Markdown
                        </button>
                        <button
                          disabled={
                            busy ||
                            edit ||
                            !privacy.screenshot ||
                            !selected?.original
                          }
                          onClick={() => void exportFile("image")}
                        >
                          Image
                        </button>
                        <button
                          disabled={busy || edit}
                          onClick={() =>
                            void act(async () => {
                              const output = await buildExport(
                                selected!,
                                privacy,
                                "markdown",
                              );
                              await navigator.clipboard.writeText(
                                await output.blob.text(),
                              );
                              setToast("Reviewed report copied.");
                            })
                          }
                        >
                          Copy report
                        </button>
                      </div>
                    </section>
                  </>
                )}
              </section>
            </div>
          </>
        ) : page === "settings" ? (
          <section className="settings">
            <span className="eyebrow">MAKE IT YOURS</span>
            <h1>Settings</h1>
            <p>Your preferences stay in this browser.</p>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void act(async () => {
                  await chrome.storage.local.set({
                    preferences: {
                      country: country.trim(),
                      geoRegion: region.trim(),
                    },
                  });
                  setToast("Preferences saved. These apply to new captures.");
                });
              }}
            >
              <h3>Optional location</h3>
              <p>
                Manually provided context for new reports. Bugger never infers
                your country or requests your location.
              </p>
              <label>
                Country
                <input
                  maxLength={100}
                  value={country}
                  placeholder="Not provided"
                  onChange={(e) => setCountry(e.target.value)}
                />
              </label>
              <label>
                State or region
                <input
                  maxLength={100}
                  value={region}
                  placeholder="Not provided"
                  onChange={(e) => setRegion(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Save preferences
              </button>
            </form>
            <div className="tip">
              Reports and screenshots are stored locally. Export reports before
              uninstalling the extension or clearing browser data.
            </div>
          </section>
        ) : (
          <section className="settings">
            <span className="eyebrow">EARLY ACCESS</span>
            <h1>Local trial</h1>
            <div className="license-count">
              {count}
              <span> / 5 saved reports</span>
            </div>
            <progress
              max={5}
              value={count}
              aria-label={`${count} of 5 trial reports saved`}
            />
            <p>
              You can always view, edit, delete, and export your existing
              reports. Delete a report to make room for another.
            </p>
            <div className="tip">
              <strong>Payments are not configured.</strong>
              <p>
                The planned one-time license is not available in this build. No
                purchase or license activation is offered yet.
              </p>
            </div>
          </section>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          ✓ {toast}
        </div>
      )}
      <dialog
        ref={dialog}
        onCancel={(event) => {
          if (busy) event.preventDefault();
          else setRemove(false);
        }}
        aria-labelledby="delete-title"
      >
        <h2 id="delete-title">Delete this issue?</h2>
        <p>
          “{issue?.title}” and its screenshot will be removed from this device.
          Export a copy first if you need it.
        </p>
        <div className="actions">
          {error && (
            <p role="alert" className="dialog-error">
              {error}
            </p>
          )}
          <button autoFocus disabled={busy} onClick={() => setRemove(false)}>
            Keep issue
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                if (!issue) return;
                await rpc({ type: "ISSUE_DELETE", id: issue.id });
                setRemove(false);
                setSelected(null);
                setImage(null);
                await refresh();
                setToast("Issue deleted.");
              })
            }
          >
            Delete permanently
          </button>
        </div>
      </dialog>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
