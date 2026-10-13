import { uuid } from "../shared/uuid";
import { rpc, ISSUE_TYPES, SEVERITIES, STATUSES } from "../shared/types";
import type { Box, CaptureDraft, Issue } from "../shared/types";
import { cleanUrl, collectDraft } from "./capture";

const global = window as unknown as { __buggerInstalled?: boolean };
if (!global.__buggerInstalled) {
  global.__buggerInstalled = true;
  install();
}
function install() {
  let stop: () => void = () => {};
  let activeSession: string | null = null;
  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === "START_SESSION") {
      stop();
      stop = start(message.sessionId);
      activeSession = message.sessionId;
      reply({ ok: true });
    }
    if (message.type === "PING_SESSION") reply({ sessionId: activeSession });
    if (message.type === "STOP_SESSION") {
      activeSession = null;
      stop();
      stop = () => {};
      reply({ ok: true });
    }
  });
}
function start(sessionId: string): () => void {
  const priorFocus = document.activeElement as HTMLElement | null;
  const host = document.createElement("div");
  host.id = "bugger-capture";
  host.style.cssText =
    "all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
 :host{color-scheme:light}*{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer;background:#fff;border:1px solid #a4b1c5;border-radius:7px;padding:9px;color:#17243a}button:hover{background:#eaf8f7}button:disabled{opacity:.5;cursor:wait}:focus-visible{outline:3px solid #087f8c;outline-offset:2px} .bar,.drawer{pointer-events:auto;background:#fff;color:#17243a;font:14px/1.5 system-ui;box-shadow:0 8px 35px #10243b40;border:1px solid #ced7e4}.bar{position:fixed;left:12px;top:12px;max-width:calc(100vw - 24px);display:flex;gap:6px;flex-wrap:wrap;padding:8px;border-radius:12px}.drawer{position:fixed;right:12px;top:78px;bottom:12px;width:390px;max-width:calc(100vw - 24px);padding:20px;border-radius:12px;overflow:auto}.drawer[hidden]{display:none}h2{margin:0 0 12px;font-size:21px}label{display:block;margin:12px 0}input:not([type=checkbox]),textarea,select{display:block;width:100%;border:1px solid #9baac1;border-radius:6px;padding:8px;background:white;color:#17243a}textarea{min-height:68px;resize:vertical}small{display:block;color:#495970} .row{display:flex;gap:8px}.row>*{flex:1}.primary{background:#075c67;color:white}.primary:hover{background:#064752}.outline{position:fixed;border:2px solid #087f8c;background:#087f8c18;pointer-events:none}#status{white-space:pre-wrap;overflow-wrap:anywhere} .hint{font-size:12px;max-width:290px} </style>
 <div class="outline" hidden></div><nav class="bar" aria-label="Bugger capture"><strong style="align-self:center">Bugger</strong><button id="element">Select element</button><button id="region">Select region</button><button id="focused" title="Or press Alt+Shift+B on a focused page element">Use focused element</button><button id="pins" aria-pressed="true">Hide pin</button><button id="draft">Show draft</button><button id="stop">Stop</button></nav>
 <section class="drawer" aria-label="New issue" hidden><h2>Capture an observation</h2><form><label>Title (required)<input name="title" required minlength="3" maxlength="140" placeholder="What did you notice?"></label><div class="row"><label>Type<select name="type">${ISSUE_TYPES.map((v) => `<option>${v}</option>`).join("")}</select></label><label>Severity<select name="severity">${SEVERITIES.map((v) => `<option ${v === "medium" ? "selected" : ""}>${v}</option>`).join("")}</select></label></div><label>Description<textarea name="description" maxlength="5000"></textarea></label><label>Expected result<textarea name="expected" maxlength="5000"></textarea></label><label>Actual result<textarea name="actual" maxlength="5000"></textarea></label><label>Reproduction steps (one per line, up to 20)<textarea name="steps" maxlength="10000"></textarea></label><label>Status<select name="state">${STATUSES.map((v) => `<option>${v}</option>`).join("")}</select></label><div class="row"><label>Country (optional)<input name="country" maxlength="100"></label><label>State / region<input name="geoRegion" maxlength="100"></label></div><label><input name="screenshot" type="checkbox" checked> Include visible-tab screenshot</label><small>Screenshots can contain personal data. Inspect the saved screenshot and review export privacy settings. Text, form values, IDs and classes are omitted from DOM context.</small><p id="context" style="overflow-wrap:anywhere"></p><div class="row"><button type="button" id="copy-css">Copy CSS selector</button><button type="button" id="copy-xpath">Copy XPath</button></div><button type="button" id="capture">Capture evidence</button> <button class="primary" type="submit">Save locally</button> <button type="submit" id="save-review">Save + review export</button><p id="status" role="status" aria-live="polite">Select an element or drag a region first.</p></form></section>`;
  document.documentElement.append(host);
  const $ = <T extends HTMLElement>(s: string) => shadow.querySelector<T>(s)!;
  const drawer = $(".drawer"),
    outline = $(".outline"),
    form = $<HTMLFormElement>("form");
  let mode: "element" | "region" | "idle" = "element",
    element: Element | null = null,
    region: Box | null = null,
    origin: { x: number; y: number } | null = null,
    draft: CaptureDraft | null = null,
    captureId: string | null = null,
    busy = false,
    alive = true,
    version = 0,
    saved = false,
    lastUrl = location.href,
    issueId = uuid(),
    createdAt = new Date().toISOString(),
    pinsVisible = true;
  const abort = new AbortController();
  const opt = { capture: true, signal: abort.signal };
  void chrome.storage.local
    .get("preferences")
    .then(({ preferences }) => {
      if (!alive || !preferences || typeof preferences !== "object") return;
      for (const key of ["country", "geoRegion"]) {
        const input = $<HTMLInputElement>(`input[name=${key}]`);
        const value = (preferences as Record<string, unknown>)[key];
        if (!input.value && typeof value === "string")
          input.value = value.slice(0, 100);
      }
    })
    .catch(() => {});
  const status = (text: string) => {
    $("#status").textContent = text;
  };
  function invalidate(text: string) {
    version++;
    draft = null;
    captureId = null;
    if (alive) status(text);
  }
  function draw(r: { x: number; y: number; width: number; height: number }) {
    outline.hidden = !pinsVisible;
    outline.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.width}px;height:${r.height}px`;
  }
  function choose(el: Element | null, r: Box | null) {
    element = el;
    region = r;
    mode = "idle";
    invalidate("Selection ready. Capture evidence before saving.");
    drawer.hidden = false;
    if (el) draw(el.getBoundingClientRect());
    if (r) draw(r);
    $("input[name=title]").focus();
  }
  function own(e: Event) {
    return e.composedPath().includes(host);
  }
  function suppress(e: Event) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  function getTarget(e: Event) {
    return e.composedPath().find((n) => n instanceof Element && n !== host) as
      Element | undefined;
  }
  document.addEventListener(
    "pointermove",
    (e) => {
      if (own(e) || mode === "idle" || busy) return;
      if (mode === "element") {
        const target = getTarget(e);
        if (target) draw(target.getBoundingClientRect());
      } else if (origin) {
        region = {
          x: Math.min(origin.x, e.clientX),
          y: Math.min(origin.y, e.clientY),
          width: Math.abs(e.clientX - origin.x),
          height: Math.abs(e.clientY - origin.y),
          unit: "css_px",
        };
        draw(region);
      }
    },
    opt,
  );
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (own(e) || mode === "idle" || busy) return;
      swallowClick = true;
      suppress(e);
      if (mode === "region") origin = { x: e.clientX, y: e.clientY };
    },
    opt,
  );
  document.addEventListener(
    "pointerup",
    (e) => {
      if (own(e) || mode === "idle" || busy) return;
      suppress(e);
      if (mode === "region" && origin) {
        origin = null;
        if (region && region.width >= 3 && region.height >= 3)
          choose(null, region);
        else status("Drag a region at least 3 pixels wide and tall.");
      }
    },
    opt,
  );
  // The final click must also be cancelled after pointerup changed mode.
  let swallowClick = false;
  document.addEventListener(
    "click",
    (e) => {
      if (own(e) || busy) return;
      if (swallowClick || mode !== "idle") {
        suppress(e);
        swallowClick = false;
        if (mode === "element") {
          const target = getTarget(e);
          if (target) choose(target, null);
        }
      }
    },
    opt,
  );
  document.addEventListener(
    "scroll",
    (event) => {
      if (own(event)) return;
      if (draft && !busy)
        invalidate(
          "Page scrolled. Capture evidence again to keep coordinates aligned.",
        );
      if (element?.isConnected) draw(element.getBoundingClientRect());
      else outline.hidden = true;
    },
    { passive: true, signal: abort.signal, capture: true },
  );
  window.addEventListener(
    "resize",
    () => invalidate("Viewport changed. Capture evidence again."),
    { signal: abort.signal },
  );
  const routeTimer = window.setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      element = null;
      region = null;
      outline.hidden = true;
      invalidate(
        "Page navigation changed the selection. Select again; your notes are preserved.",
      );
    }
  }, 500);
  function dirty() {
    return (
      !saved &&
      Array.from(
        form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
          "input[name=title],textarea",
        ),
      ).some((x) => !!x.value.trim())
    );
  }
  function requestStop() {
    if (busy) return;
    if (dirty() && !confirm("Discard this unsaved Bugger draft?")) return;
    void rpc({ type: "STOP_CAPTURE" }).catch(() => {});
    cleanup();
  }
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") {
        suppress(e);
        requestStop();
      }
      if (e.altKey && e.shiftKey && e.code === "KeyB") {
        suppress(e);
        focused();
      }
      if (!busy && mode === "region" && !own(e) && e.key === "Enter") {
        suppress(e);
        choose(null, {
          x: Math.round(innerWidth / 4),
          y: Math.round(innerHeight / 4),
          width: Math.round(innerWidth / 2),
          height: Math.round(innerHeight / 2),
          unit: "css_px",
        });
      }
    },
    opt,
  );
  function focused() {
    if (busy) return;
    const el = document.activeElement;
    if (
      el &&
      el !== host &&
      el !== document.body &&
      el !== document.documentElement
    )
      choose(el, null);
    else if (
      priorFocus &&
      priorFocus !== document.body &&
      priorFocus !== document.documentElement &&
      priorFocus.isConnected
    )
      choose(priorFocus, null);
    else {
      drawer.hidden = false;
      status(
        "Focus a page element with Tab, then press Alt+Shift+B. In region mode, Enter selects the center half of the viewport.",
      );
    }
  }
  $("#pins").onclick = () => {
    pinsVisible = !pinsVisible;
    $("#pins").textContent = pinsVisible ? "Hide pin" : "Show pin";
    $("#pins").setAttribute("aria-pressed", String(pinsVisible));
    outline.hidden = !pinsVisible || (!element && !region);
  };
  for (const [button, key] of [
    ["#copy-css", "cssSelector"],
    ["#copy-xpath", "xpath"],
  ] as const) {
    $(button).onclick = async () => {
      const value = draft?.selection.element?.[key];
      if (!value) {
        status("Capture an element first to copy its locator.");
        return;
      }
      try {
        await navigator.clipboard.writeText(value);
        status("Locator copied.");
      } catch {
        status(
          "Clipboard unavailable. Select and copy the locator shown in the context below.",
        );
        $("#context").textContent = value;
      }
    };
  }
  $("#element").onclick = () => {
    if (busy) return;
    mode = "element";
    drawer.hidden = true;
  };
  $("#region").onclick = () => {
    if (busy) return;
    mode = "region";
    region = null;
    drawer.hidden = true;
    status(
      "Drag a rectangle. Keyboard: focus the page and press Enter for a centered region.",
    );
  };
  $("#focused").onclick = focused;
  $("#draft").onclick = () => {
    drawer.hidden = !drawer.hidden;
  };
  $("#stop").onclick = requestStop;
  $("input[name=screenshot]").onchange = () =>
    invalidate("Screenshot preference changed. Capture evidence again.");
  function field(name: string) {
    return (form.elements.namedItem(name) as HTMLInputElement).value.trim();
  }
  function setBusy(value: boolean) {
    busy = value;
    for (const b of shadow.querySelectorAll<HTMLButtonElement>("button"))
      b.disabled = value;
  }
  $("#capture").onclick = async () => {
    if (busy) return;
    if ((!element && !region) || (element && !element.isConnected)) {
      status("Select an element or region first.");
      return;
    }
    setBusy(true);
    invalidate("Capturing…");
    const current = version;
    try {
      const next = collectDraft(element, region);
      const url = location.href;
      host.style.visibility = "hidden";
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      const result = await rpc<{ captureId: string | null }>({
        type: "CAPTURE",
        sessionId,
        draft: next,
        screenshot: $<HTMLInputElement>("input[name=screenshot]").checked,
      });
      if (!alive) return;
      if (
        current !== version ||
        location.href !== url ||
        next.page.scrollX !== scrollX ||
        next.page.scrollY !== scrollY ||
        next.page.viewport.width !== innerWidth ||
        next.page.viewport.height !== innerHeight
      ) {
        invalidate("Page moved during capture. Capture again.");
        return;
      }
      draft = next;
      createdAt = new Date().toISOString();
      captureId = result.captureId;
      $("#context").textContent =
        `${next.environment.browserName.value ?? "Browser unavailable"} · ${next.page.viewport.width} × ${next.page.viewport.height} · DPR ${next.page.dpr} · ${next.page.url ?? "URL omitted"} · ${next.selection.element?.cssSelector ?? "Region selection"} · ${new Date().toISOString()}`;
      status("Evidence captured. Complete the note and save locally.");
    } catch (error) {
      status(
        error instanceof Error ? error.message : "Capture failed. Try again.",
      );
    } finally {
      host.style.visibility = "";
      setBusy(false);
    }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.reportValidity()) return;
    if (!draft) {
      status("Capture evidence before saving.");
      return;
    }
    const steps = field("steps")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (steps.length > 20 || steps.some((s) => s.length > 500)) {
      status("Use at most 20 steps, each no longer than 500 characters.");
      return;
    }
    if (
      draft.page.url !== cleanUrl(location.href) ||
      draft.page.scrollX !== scrollX ||
      draft.page.scrollY !== scrollY ||
      draft.page.viewport.width !== innerWidth ||
      draft.page.viewport.height !== innerHeight
    ) {
      invalidate("Page changed. Capture evidence again.");
      return;
    }
    if (element) {
      const r = element.getBoundingClientRect(),
        b = draft.selection.element?.viewportBox;
      if (
        !element.isConnected ||
        !b ||
        Math.abs(r.x - b.x) > 1 ||
        Math.abs(r.y - b.y) > 1 ||
        Math.abs(r.width - b.width) > 1 ||
        Math.abs(r.height - b.height) > 1
      ) {
        invalidate("Selected element moved. Capture evidence again.");
        return;
      }
    }
    const issue: Issue = {
      schemaVersion: 1,
      id: issueId,
      createdAt,
      updatedAt: createdAt,
      type: field("type") as Issue["type"],
      title: field("title"),
      description: field("description"),
      severity: field("severity") as Issue["severity"],
      status: field("state") as Issue["status"],
      expectedResult: field("expected") || null,
      actualResult: field("actual") || null,
      reproductionSteps: steps,
      ...structuredClone(draft),
      attachments: [],
      diagnostics: { console: "not_collected", network: "not_collected" },
      privacy: {
        urlQueryRemoved: true,
        fieldsOmitted: [
          "page.title",
          "element.text",
          "element.attributes",
          "element.id",
          "element.classes",
          "form.values",
        ],
        reviewedAt: null,
      },
    };
    for (const key of ["country", "geoRegion"] as const) {
      const v = field(key);
      issue.environment[key] = {
        value: v || null,
        source: v ? "user_provided" : "not_collected",
      };
    }
    setBusy(true);
    try {
      await rpc({ type: "SAVE_ISSUE", sessionId, issue, captureId });
      saved = true;
      issueId = uuid();
      createdAt = new Date().toISOString();
      status("Saved locally. Open Bugger → My issues to inspect and export.");
      const geography = {
        country: field("country"),
        geoRegion: field("geoRegion"),
      };
      form.reset();
      for (const key of ["country", "geoRegion"] as const)
        $<HTMLInputElement>(`input[name=${key}]`).value = geography[key];
      element = null;
      region = null;
      draft = null;
      captureId = null;
      outline.hidden = true;
      mode = "element";
      saved = false;
      if ((e as SubmitEvent).submitter?.id === "save-review") {
        try {
          await rpc({ type: "OPEN_ISSUES" });
        } catch {
          status(
            "Saved locally, but could not open My issues. Open it from the Bugger popup.",
          );
        }
      }
    } catch (error) {
      status(
        error instanceof Error
          ? error.message
          : "Save failed. Your draft is retained.",
      );
    } finally {
      setBusy(false);
    }
  };
  function cleanup() {
    if (!alive) return;
    alive = false;
    abort.abort();
    clearInterval(routeTimer);
    host.remove();
    priorFocus?.focus();
  }
  return cleanup;
}
