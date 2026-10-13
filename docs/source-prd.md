# BugSnap Lite — Product Requirements Document

**Version:** 1.0  
**Date:** October 12, 2026  
**Status:** Implementation-ready product specification (proposed)  
**Audience:** Product owner, Codex coding agent, frontend/extension developers, QA  
**Product category:** Chrome extension; local-first visual feedback and developer-context capture

> **Product promise:** Stop sending screenshots developers cannot debug. Pin a problem on a webpage, record an observation, and export the screenshot plus the technical context required to investigate it.

## 1. Executive summary

BugSnap Lite is a lightweight, paid Chrome extension for freelancers, frontend developers, QA engineers, and small web agencies. A user deliberately activates capture mode on a supported webpage, selects an element or region, attaches a note, and creates a structured issue containing visual evidence, a sanitized element snapshot, location on the page, browser/device/environment metadata, and optional reproduction steps. Issues live locally by default and can be exported without accounts or cloud infrastructure.

**Initial market:** US-first, globally available. **Price hypothesis:** $19 one-time for a local-first personal license; 5 saved reports on free trial. **90-day commercial goal:** 100 paying purchasers, an ambition rather than a forecast; if all purchase at $19, gross revenue is $1,900 before fees/refunds/tax. Acquisition and willingness-to-pay must be validated.

**Non-goal:** Not an automatic bug detector, session replay suite, full offline website clone, VWO Observation clone, or Jira replacement.

## 2. Target buyers and jobs to be done

| Persona | Trigger | Job to be done | Why pay |
|---|---|---|---|
| Freelance web developer | Reviewing a client website | Capture actionable feedback fast | Less back-and-forth; reusable reports |
| Small agency QA/reviewer | Pre-launch review | Record multiple design and functional issues | Faster handoff without a project-management platform |
| Frontend developer | Reproducing responsive visual defect | Capture selector, layout, styles, viewport | More context than screenshot alone |
| Technical founder | Reviewing own SaaS | Organize issues while browsing | Low friction, inexpensive one-time tool |

**Early adopter focus:** freelancers and small agency developers who personally install an extension. P0 does **not** support a client leaving feedback without the extension.

## 3. Positioning and differentiation

- **Category:** visual website feedback and developer context capture.
- **Primary differentiator to test:** an actionable, privacy-reviewed **Developer Context Snapshot** bundled with each pinned issue; not merely a screenshot or whole-page archiver.
- **Supporting differentiator:** local-first, no account for core usage, portable Markdown + JSON + screenshot export, straightforward $19 license.
- **Competition:** BugHerd and Marker.io offer broader hosted feedback/collaboration; SingleFile saves webpages. Snapshotting and pinning are established features, so product-market differentiation is a *hypothesis* requiring user testing.
- **Message:** “Click the broken element. Explain the problem. Export a developer-ready report.”
- **Compliance boundary:** build original source/assets/UX; do not reuse proprietary employer/VWO code or confidential product information.

## 4. Goals, constraints and success metrics

### Goals

1. Capture and export a useful issue in **under 30 seconds** for a returning user, measured in user testing.
2. Make a report useful without asking the reporter to manually enter URL, CSS selector, viewport, time, or browser information.
3. Default to local storage and no outbound transfer of page content.
4. Support one-time purchase and local feature gating without exposing payment secrets in the extension.
5. Publish to Chrome Web Store with privacy policy, minimum necessary permissions and clear paid-feature disclosures.

### Outcome metrics (hypotheses)

- Day 15: demo in front of 10–15 target buyers; at least 3 concrete payment commitments or actual purchases.
- Day 30: target 10 cumulative purchasers; day 60: target 40–60; day 90: target 100. These are stretch goals.
- Activation: percentage of installers exporting at least one report.
- Median time from activation to first saved issue; percentage of exports completed; refund rate; support tickets; repeat use.
- Privacy: zero unrequested page-content uploads; no secrets included in default snapshot fixtures.

### Constraints

- P0 build target: approximately **3–7 focused development days**, excluding Chrome Web Store review, beta recruitment, marketing and fixes. Not a delivery guarantee.
- Chrome Manifest V3, current stable Chrome; desktop-first.
- No unrestricted site monitoring, cookies extraction, request/response bodies, invasive permissions, or automatic GPS collection.
- Websites using inaccessible frames, closed shadow roots, canvas, browser pages or restrictive policies may have limited support; show precise error messages.

## 5. Release roadmap and priority definitions

**P0 = required to charge for a useful local-first MVP. P1 = near-term follow-up after P0 launch. P2 = richer product after validation. P3 = longer-term experiments.** No later phase is a promise to customers.

| Feature | P0 | P1 | P2 | P3 |
|---|---|---|---|---|
| Manual activation / stop, toolbar + drawer | Yes | Polish | | |
| Element hover, select, and pin | Yes | Multiple pins/issue | | |
| Freehand rectangular region selection | Basic | Resize/crop/blur | | |
| Issue type, title, description, expected/actual, steps, priority | Yes | Templates | | |
| Visible-tab screenshot and pin marker | Yes | Annotation arrows/text/blur | | |
| CSS selector, XPath, bbox, DOM path | Yes | selector reliability scoring | | |
| Sanitized element HTML and computed-style whitelist | Yes | parent context + diff | | |
| URL, page title, scroll, browser/OS, viewport, DPR, language, timezone, UTC time | Yes | Better device reporting | | |
| Country/region | Manual optional | Consent-based coarse lookup | | |
| Local issue list, search, edit, delete | Basic | Filter, tags, batch actions | | |
| Export Markdown, JSON, image, ZIP | Yes | Branded PDF, CSV | | |
| Export privacy review/redaction | Yes | Configurable rules | | |
| 5-report trial, $19 payment, license validation | Yes | Device management | | |
| Local backups and import | | Yes | | |
| Console diagnostic capture | | Explicit opt-in | | |
| Failed network request metadata | | Limited opt-in exploration | | |
| Cloud workspace, synced issue dashboard, secure share links | | | Yes | |
| GitHub/Linear/Jira issue creation | | | Yes | |
| Guest/client feedback without installing extension | | | Yes | |
| Full-page asset archival/offline reproduction | | Feasibility spike | Limited beta | |
| AI writing assistance and verified workflow recording | | | | Yes |
| Collaborative threads, roles, billing plans | | | | Yes |

## 6. P0 product behavior and user journeys

### 6.1 Onboarding and activation

**Entry points:** browser action popup: **Start BugSnap**, **My Issues**, **Settings**, **Upgrade**. No always-on website injection. Activating via extension toolbar invokes `activeTab` and `scripting`; badge indicates ACTIVE. Show “This page is not supported” for restricted pages instead of silently failing. One tab/capture session at a time for P0. Stop mode by toolbar, Esc, or page reload; unsaved draft prompts for confirmation where possible.

**Acceptance:** before activation, no page observer, screenshot, or DOM capture; after activation, a selectable overlay appears and original page remains interactive when capture mode is off. Activation must not mutate page business data or intercept submissions.

### 6.2 Element pinning and selected-region flow

- On hover, show outline and element tag; click selects highest meaningful target under pointer (`composedPath` where available), ignoring BugSnap-owned UI.
- Highlight selection, obtain stable-ish unique CSS selector and XPath, DOM ancestor breadcrumb, selected element `outerHTML` after sanitization, bounding rectangle, relevant computed styles, text summary if safe.
- Record **viewport bounds** (`getBoundingClientRect`) and **document bounds** (viewport + scroll offsets); include device pixel ratio and scroll offsets to correlate screenshots.
- Region mode: drag rectangle; record CSS pixel coordinates relative to viewport; allow cancelling/retrying. Capture visible screenshot after hiding BugSnap overlay/drawer, then render pin overlay in the exported annotated copy; optionally keep unannotated original.
- Element selector is a *best effort locator*, never a guaranteed durable identifier. Never auto-click or trigger the selected element while in pin mode.

**Acceptance:** a selected element is visually identified and the exported record contains selector and bounds; scroll test keeps screenshot marker aligned; clicking BugSnap UI does not select underlying host element.

### 6.3 Observation / issue drawer

Fields: **type** (`functional_bug`, `visual_bug`, `content`, `suggestion`, `observation`, `accessibility`), title (required, 3–140 chars), description (optional, 0–5,000 chars), severity (`low`, `medium`, `high`, `critical`; default medium; *reporter selected*), expected/actual (optional), reproduction steps (manual, ordered; 0–20 steps), labels (P1), status (`open` by default). Show context chips for browser, viewport, page URL, selector, UTC time; allow copy of CSS selector/XPath/bounds. “Save locally” and “Save + Export” primary actions.

**Acceptance:** empty required title blocks save; draft survives closing/reopening UI within the same session where feasible; editing an issue never silently overwrites a different issue.

### 6.4 Developer Context Snapshot (P0 core)

Collect when user explicitly chooses to save/capture:

- **Page:** sanitized URL, hostname, document title, timestamp UTC ISO 8601, scrollX/Y, viewport size, screen size, DPR, document dimensions if available.
- **Element:** CSS selector, XPath, tag, non-sensitive ID/classes, DOM path, viewport+document bounding boxes, limited attributes (`role`, accessible name/aria-label after filtering, `type` for non-sensitive elements), whitelist computed styles (`display`, `position`, `flexDirection`, `gridTemplateColumns`, `overflow`, `width`, `height`, `margin`, `padding`, `fontSize`, `lineHeight`, `color`, `backgroundColor`, `zIndex`, `transform`, `boxSizing`, `visibility`, `opacity`).
- **Snapshot:** bounded sanitized subtree, max **20 KB serialized** and **depth 3**, with value/text redaction; exclude hidden/sensitive form elements and event-handler attributes. Avoid resource requests; record asset reference URLs only after review, with query/hash removed by default.
- **Environment:** user agent as exposed by browser, derived browser/OS when reliable, language/locale, timezone (IANA if available), platform hints if available, and coarse device type marked `heuristic`.
- **Geo:** user-supplied country and optional state/region (P0), explicitly marked `user_provided`. Timezone/locale MUST NOT silently stand in for country. No IP geolocation in P0.
- **Diagnostics:** `not_collected` for console/network by default. Do not imply that a selected element is actually broken.

**Snapshot is evidence, not reproduction:** dynamic application state, styles outside captured context, shadow DOM internals, external files and iframe content may be unavailable. No claim of complete webpage reconstruction.

### 6.5 Screenshot, annotation, and privacy review

Use `chrome.tabs.captureVisibleTab` on user action with `activeTab`. Only current visible viewport. Hide extension overlays immediately before capture and restore afterward; retain separate coordinates to draw marker in export. Explicit capture button; no continuous screenshots. Provide a privacy review screen with toggles for screenshot, page URL, element text, HTML fragment, element attributes, country, asset URLs. Default: **strip URL query and fragment**, redact likely tokens/email and input values, remove password/hidden field data. Manual preview before ZIP export. For screenshots show a warning that visual content may contain personal data; P1 blur/redact tools.

**Acceptance:** no password or input value in exported JSON/Markdown HTML context fixtures; screenshot omission works; privacy changes affect *all* output files; report does not include extension controls except intentional pin overlay.

### 6.6 Issue management and export

- Local list with title, type, hostname, created time, status; detail, edit, delete (confirm), copy selector, copy report; text search by title/hostname.
- Use **IndexedDB from an extension-owned context** for screenshots and issue blobs; `chrome.storage.local` for preferences/licensing/cache only. Content scripts should message extension contexts for storage, not use webpage IndexedDB.
- Cap saved screenshot per issue with compression and user-friendly storage-full failure; P0 max 50 MB total target (configurable; not a guaranteed quota). Prompt backup/export before uninstall; uninstall can erase local issues.
- Markdown copy, `metadata.json`, original/annotated PNG (or WebP if selectable), portable ZIP. Export names `BUG-<date>-<shortId>`, but canonical identifiers use UUIDs.
- PDF NOT P0: P1 branded PDF; avoid scope creep.

**ZIP contract:**

```text
BUG-20261012-a1b2c3.zip
├── report.md
├── metadata.json
├── screenshots/
│   ├── original.png
│   └── annotated.png
└── snapshots/
    └── element.html
```

If screenshot or HTML was omitted in privacy review, omit those files and corresponding attachment references. All internal ZIP paths are relative and safe; never include actual browser filesystem paths.

## 7. UI / interaction contract

**Popup:** START CAPTURE / VIEW ISSUES / SETTINGS / LICENSE. 360 px default width, keyboard operable.  
**In-page floating toolbar:** Select Element, Select Region, Hide/Show Pins, Stop.  
**Drawer:** Issue form left/right configurable later; P0 fixed right side, 360–420 px responsive; never overlay the source element irreversibly.  
**Issue detail:** screenshot above fold, clickable selector+metadata copy icons, reproduction, privacy preview, export.  
**Empty states:** No issues yet; click Start to record your first observation.  
**Failure states:** page restricted; screenshot unavailable; unable to read selected frame; capture failed; storage full; license offline; website navigation invalidated selection.  
**Accessibility:** tab/keyboard navigation, focus trap in dialogs, visible focus, Esc close, ARIA labels, sufficient contrast, reduced motion support.  
**UX measurement:** user should complete activation → pin → title → save → export without account creation.

## 8. Data contracts (TypeScript, normative)

All persistent objects must include `schemaVersion`; version and migrate schemas. Optional/null values mean **not collected** or **not available**, not guessed values. Date strings UTC ISO 8601. Coordinates in **CSS pixels**, unless otherwise specified.

```typescript
type IssueType = 'functional_bug'|'visual_bug'|'content'|'suggestion'|'observation'|'accessibility';
type Severity = 'low'|'medium'|'high'|'critical';
type IssueStatus = 'open'|'in_progress'|'resolved'|'wont_fix';
type Source = 'browser_api'|'dom'|'derived_heuristic'|'user_provided'|'not_collected';
interface Box { x:number; y:number; width:number; height:number; unit:'css_px' }
interface MetadataValue<T> { value:T|null; source:Source }
interface ElementSnapshot {
  cssSelector:string|null; xpath:string|null; domPath:string[];
  tagName:string|null; id:string|null; classes:string[];
  viewportBox:Box|null; documentBox:Box|null;
  attributes:Record<string,string>; computedStyles:Record<string,string>;
  sanitizedHtml:string|null; textExcerpt:string|null;
  locatorConfidence:'high'|'medium'|'low'; limitations:string[];
}
interface PageContext {
  url:string|null; hostname:string|null; title:string|null;
  scrollX:number; scrollY:number;
  viewport:{width:number;height:number};
  screen:{width:number;height:number}|null;
  dpr:number; document:{width:number;height:number}|null;
}
interface EnvironmentContext {
  userAgent:MetadataValue<string>; browserName:MetadataValue<string>;
  browserVersion:MetadataValue<string>; os:MetadataValue<string>;
  deviceType:MetadataValue<'desktop'|'tablet'|'mobile'|'unknown'>;
  language:MetadataValue<string>; timezone:MetadataValue<string>;
  country:MetadataValue<string>; geoRegion:MetadataValue<string>;
}
interface CaptureSelection {
  kind:'element'|'region'; element:ElementSnapshot|null;
  selectedRegion:Box|null; // viewport-relative when region mode used
}
interface Attachment { id:string; kind:'original_screenshot'|'annotated_screenshot'|'element_html';
  fileName:string; mimeType:string; byteLength:number; sha256:string|null }
interface BugSnapIssue {
  schemaVersion:1; id:string; createdAt:string; updatedAt:string;
  type:IssueType; title:string; description:string; severity:Severity;
  status:IssueStatus; expectedResult:string|null; actualResult:string|null;
  reproductionSteps:string[]; page:PageContext; environment:EnvironmentContext;
  selection:CaptureSelection; attachments:Attachment[];
  diagnostics:{ console:'not_collected'; network:'not_collected' };
  privacy:{urlQueryRemoved:boolean; fieldsOmitted:string[]; reviewedAt:string|null};
}
```

### 8.1 Canonical example `metadata.json`

```json
{
  "schemaVersion": 1,
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2026-10-12T17:45:00.000Z",
  "updatedAt": "2026-10-12T17:45:00.000Z",
  "type": "functional_bug",
  "title": "Subscribe button does not respond",
  "description": "Reporter observed no visible response after clicking.",
  "severity": "high",
  "status": "open",
  "expectedResult": "Navigate to checkout",
  "actualResult": "No visible response",
  "reproductionSteps": ["Open pricing page", "Click Pro plan Subscribe"],
  "page": {
    "url": "https://example.com/pricing", "hostname": "example.com", "title": "Pricing",
    "scrollX": 0, "scrollY": 640, "viewport": {"width":1440,"height":900},
    "screen": {"width":2560,"height":1440}, "dpr":2,
    "document":{"width":1440,"height":3000}
  },
  "environment": {
    "userAgent":{"value":null,"source":"not_collected"},
    "browserName":{"value":"Chrome","source":"derived_heuristic"},
    "browserVersion":{"value":null,"source":"not_collected"},
    "os":{"value":"macOS","source":"derived_heuristic"},
    "deviceType":{"value":"desktop","source":"derived_heuristic"},
    "language":{"value":"en-US","source":"browser_api"},
    "timezone":{"value":"America/New_York","source":"browser_api"},
    "country":{"value":"US","source":"user_provided"},
    "geoRegion":{"value":null,"source":"not_collected"}
  },
  "selection": {
    "kind":"element",
    "selectedRegion":null,
    "element": {
      "cssSelector":"#pricing .pro-plan button",
      "xpath":"//*[@id='pricing']/div[2]/button",
      "domPath":["html","body","main#pricing","div.pro-plan","button"],
      "tagName":"BUTTON", "id":null, "classes":[],
      "viewportBox":{"x":420,"y":310,"width":180,"height":48,"unit":"css_px"},
      "documentBox":{"x":420,"y":950,"width":180,"height":48,"unit":"css_px"},
      "attributes":{"type":"button"}, "computedStyles":{"display":"flex","position":"relative"},
      "sanitizedHtml":"<button type=\"button\">[text redacted]</button>",
      "textExcerpt":null, "locatorConfidence":"medium", "limitations":[]
    }
  },
  "attachments":[
    {"id":"att-1","kind":"annotated_screenshot","fileName":"screenshots/annotated.png","mimeType":"image/png","byteLength":70000,"sha256":null}
  ],
  "diagnostics":{"console":"not_collected","network":"not_collected"},
  "privacy":{"urlQueryRemoved":true,"fieldsOmitted":["userAgent","textExcerpt"],"reviewedAt":"2026-10-12T17:46:00.000Z"}
}
```

### 8.2 Markdown report template

```markdown
# BUG-<shortId> — <title>

- Type: <type> | Severity: <reporter selected severity> | Status: <status>
- Page: <sanitized URL> | Captured (UTC): <time>
- Browser: <value or unavailable> | OS: <value or unavailable>
- Viewport: <width> × <height> CSS px | DPR: <dpr>
- Country: <user provided / not collected>

## Observation
<description>

## Reproduction steps (reporter provided)
1. ...

## Expected / actual
**Expected:** ...
**Actual:** ...

## Selected location
- CSS selector: `<selector>`
- XPath: `<xpath>`
- Viewport bounds: x=... y=... width=... height=... CSS px
- Document bounds: x=... y=... width=... height=... CSS px

## Evidence
- `screenshots/annotated.png` (if included)
- `snapshots/element.html` (if included)

## Limitations
Selector may change with DOM updates. No console/network data captured.
```

## 9. Internal extension message contract

Define a discriminated typed envelope, validate runtime messages (TypeScript alone does not validate untrusted messages), and ensure sender tab ID/session are consistent.

```typescript
type ExtensionRequest =
 | { requestId:string; type:'CAPTURE_START'; payload:{tabId:number} }
 | { requestId:string; type:'CAPTURE_STOP'; payload:{tabId:number} }
 | { requestId:string; type:'ELEMENT_SELECT'; payload:{tabId:number; sessionId:string} }
 | { requestId:string; type:'SCREENSHOT_CAPTURE'; payload:{tabId:number; sessionId:string} }
 | { requestId:string; type:'ISSUE_SAVE'; payload:{issue:BugSnapIssue} }
 | { requestId:string; type:'ISSUE_LIST'; payload:{query?:string} }
 | { requestId:string; type:'ISSUE_DELETE'; payload:{issueId:string} }
 | { requestId:string; type:'ISSUE_EXPORT'; payload:{issueId:string;format:'markdown'|'zip'|'json'} };
type ExtensionResponse<T> =
 | { requestId:string; ok:true; data:T }
 | { requestId:string; ok:false; error:{code:string;message:string;retryable:boolean} };
```

Required error codes: `UNSUPPORTED_PAGE`, `PERMISSION_DENIED`, `STALE_SESSION`, `SELECTION_NOT_FOUND`, `SCREENSHOT_FAILED`, `STORAGE_FULL`, `SCHEMA_INVALID`, `EXPORT_FAILED`, `LICENSE_REQUIRED`, `LICENSE_UNAVAILABLE`. The service worker is **not** assumed to remain alive; persist required state and make operations idempotent where possible.

## 10. Architecture and implementation choices

```text
Extension popup (React + TS)
   ↔ MV3 service worker (activation, screenshot, message coordinator)
   ↔ injected content script (isolated world; overlay, DOM inspect, drawer)
   ↔ extension-owned IssueRepository (IndexedDB)
   ↔ ExportService (Markdown, JSON, PNG, ZIP)
   ↔ Preferences / license (chrome.storage.local)
Optional hosted license API + payment provider; NO issue-data service in P0.
```

Suggested stack: TypeScript, React, Vite + CRXJS or equivalent MV3 build, lightweight state management, `idb` for IndexedDB, `JSZip` for export, Zod for runtime contract validation, Vitest + Playwright for unit/E2E. Confirm dependency quality/version before installing. Render overlay with isolated Shadow DOM where feasible; be aware CSP/shadow/frame limitations. Store screenshots as Blobs, not base64 in `chrome.storage`. No remotely hosted executable code in extension. Limit content script scope and guard all `postMessage`/runtime pathways.

### Permissions strategy

P0 candidate manifest `permissions`: `activeTab`, `scripting`, `storage`, `downloads` if using Downloads API (not mandatory if browser Blob download works). No `<all_urls>` persistent host permission, `webRequest`, `debugger`, `history`, `cookies`, `geolocation`, or `tabs` unless documented technical need requires change. Chrome `captureVisibleTab` works on user-authorized active tab, but page injection restrictions remain. Validate final permission set through local build and current policy review.

### Security boundaries

Content script operates in isolated world but processes untrusted page DOM. Do not evaluate page code, inject unsanitized HTML, or log raw sensitive snapshots to console. Use `textContent`, DOM APIs and vetted HTML sanitization if previewing fragments. Validate origin/sender/context; validate all data crossing contexts. Apply exports-only redaction to **copies**, and offer permanent field deletion from stored issue. Respect user removal and clear-all operations. Licensing never unlocks collection on websites without user activation.

## 11. P0 commercial / license contract

**Free:** up to 5 locally saved reports; view/edit/export saved reports without paywall; no arbitrary hard limit on transient capture testing.  
**Paid:** $19 one-time, unlimited locally saved issues subject to local disk/storage constraints; personal use; core P0 updates. Be precise: *not* unlimited cloud storage or perpetual hosted services.  
**License architecture:** external checkout provider (e.g. Stripe Payment Links/Checkout) → webhook-backed licensing service → issue opaque license key or signed entitlement token → extension validates online initially and caches signed expiry/grace fields. Never embed Stripe secret keys. Payment success UI is not proof of entitlement. Offline grace policy proposed: 14 days after previous valid verification; first activation requires connectivity. Rate-limit validation and support revoke/refund.  
**Commercial API proposal** (P0 optional if using established licensing merchant; replace with provider contract if outsourcing):

```http
POST /v1/licenses/activate
Content-Type: application/json
{ "licenseKey":"<secret>", "installationId":"<random installation UUID>", "extensionVersion":"1.0.0" }
→ 200 { "active":true, "plan":"lifetime_local", "entitlementToken":"<signed token>", "validatedAt":"2026-10-12T00:00:00Z", "nextCheckAt":"2026-10-19T00:00:00Z" }
→ 401 { "code":"INVALID_LICENSE", "message":"License could not be verified" }

POST /v1/licenses/status
{ "installationId":"<UUID>", "entitlementToken":"<signed token>" }
→ 200 { "active":true, "plan":"lifetime_local", "nextCheckAt":"..." }
```

No webpage URL, screenshot, issue content, raw browser history or DOM is ever sent to licensing API. Store only purchase identifier, entitlement, installation pseudonymous ID and license logs for abuse/security; publish actual retention practices. Key rotation and device-limit policy decided before launch (proposal: 3 concurrent installs, self-service reset via email support).

## 12. P1 (post-launch release: annotation + robustness)

**Scope / deliverables:**

1. Rich screenshot annotation: arrows, rectangles, redaction blur/solid cover, crop, undo/redo; original screenshot unchanged unless user deliberately discards it.
2. Branded client-friendly PDF and multi-issue consolidated PDF/ZIP; searchable export and stable filenames.
3. Report templates for visual bug, broken interaction, content copy, and accessibility issue.
4. Issue labels, severity filters, bulk delete/export, duplicate issue, keyboard shortcuts.
5. Local backup and import with integrity validation and schema migrations; import never executes script or trusts file paths.
6. Better locator confidence: CSS selector plus XPath, ARIA role/name and fallback parent path; user can edit locator.
7. Consent-based **coarse country lookup**: default OFF; disclose third-party IP processing, lookup never stores raw IP in bug report; return country code and source `ip_geolocation_opt_in`, expand source enum/schema in v2.
8. Optional diagnostic session: only while user explicitly records; capture accessible `window.onerror`/`unhandledrejection` events with conservative redaction, not a guarantee of all console logs. Investigate network error metadata separately; do not request powerful `debugger` permission by default.
9. Feasibility spike on sanitized offline component archival using resources already accessible in page; document coverage and privacy risks before implementation.

**P1 acceptance:** screenshot redaction is applied to exported image bytes (not merely CSS overlay); PDF report excludes omitted sensitive fields; backups round-trip schema and images; diagnostics state exactly what was and was not captured.

## 13. P2 (cloud collaboration and integrations; validate demand first)

**New user value:** client shares feedback without extension installation; agency receives a shared issue dashboard; synced backups; issue handoff directly to ticketing tools. This moves product from $19 local utility to a distinct subscription product, with informed consent and clear upgrade messaging.

**Potential scope:** opt-in accounts, organizations/projects, owner/editor/guest roles, invite links, secure guest screenshot upload and annotation, organization issue boards, comments/status, expiring share URLs, cloud object storage, encrypted transport/at-rest protection, retention controls, Github Issues / Linear / Jira OAuth integrations, webhooks.

**Proposed API resources** (not part of P0 implementation):

```http
POST   /v2/projects
GET    /v2/projects/{projectId}/issues
POST   /v2/projects/{projectId}/issues
GET    /v2/issues/{issueId}
PATCH  /v2/issues/{issueId}
POST   /v2/issues/{issueId}/attachments/presign
POST   /v2/issues/{issueId}/comments
POST   /v2/issues/{issueId}/share-links
DELETE /v2/issues/{issueId}
```

**P2 security contract:** use auth/OIDC, tenant-scoped authorization checks on every resource, signed short-lived upload URLs, object storage scanning, audit trail, rate limits, anti-CSRF as relevant, secure guest-link expirations, deletion propagation and data processing terms. Never silently upload old local issues upon user login. Cloud pricing, limits and SLA TBD from demand.

**P2 acceptance:** no cross-tenant leakage in authorization tests; cloud sync only after opt-in; revoked link cannot access evidence; third-party ticket creation requires explicit user action.

## 14. P3 (differentiating experiments—not launch commitments)

- **AI report polishing** from user-provided facts, with opt-in model transmission and field-level preview. AI must never invent observations or claim it performed steps it did not observe.
- **Verified action recording:** opt-in click/navigation recorder, timestamps and a user-reviewable trace. Never capture keystrokes in password/payment fields or raw input values. Mark generated steps as observed vs inferred.
- **Enhanced snapshots:** isolated replay/asset snapshots for supported public pages; do not promise exact reconstruction of authenticated dynamic websites. Research SingleFile-like resource archiving, CSP, cross-origin assets, and licensing/IP issues.
- **CI/QA workflows:** attach reports to test runs, deduplication by URL/selector, compare selected DOM/style state across captures.
- **Business features:** agency branding, seats, roles, notification routing, annual subscription and API access only when justified.

## 15. Non-functional requirements

- **Performance:** activation in <1 second in typical desktop test fixture; pointer highlighting must not noticeably degrade page interactions; bounded mutation observation or none until necessary; no polling whole document.
- **Payload:** P0 sanitized HTML max 20 KB, max subtree depth 3; reasonable local screenshot compression; warn when issue size exceeds configured threshold (suggested 10 MB/issue).
- **Resilience:** capture failures handled without losing typed notes; service worker restart tolerant; exports reliable offline.
- **Reliability:** report schema versioned; migrations reversible via user backup; ensure createdAt immutable and updatedAt monotonic.
- **Privacy:** local issue data stays on device until explicit export; payment/entitlement data can go to licensing service. Published privacy policy reflects reality.
- **Accessibility:** core flows keyboard reachable; UI overlays dismissible; focus management; text contrast and screen reader labels.
- **Compatibility:** latest Chrome stable desktop, test on Windows/macOS; unsupported pages explained; do not make blanket “works on every website” claim.
- **Observability:** no page content in crash/telemetry; P0 analytics opt-in or aggregate product events without URLs/snapshots; allow fully offline core operation post-license grace rules.

## 16. Definition of done and acceptance test matrix

| ID | Scenario | Required outcome |
|---|---|---|
| AC-01 | Install + browse without activating | No site content read, no overlay, no screenshots |
| AC-02 | Start on normal HTTPS site | Overlay launches; STOP removes listeners and UI |
| AC-03 | Hover + choose nested button | Correct target, CSS selector, XPath, bbox; no button action fired |
| AC-04 | Scroll and select | Document and viewport rectangles differ by scroll offsets accurately |
| AC-05 | Region select | Rectangle coordinates agree with screenshot dimensions/DPR |
| AC-06 | Save observation | Issue appears after browser popup closes/reopens |
| AC-07 | Save invalid title | Inline validation; no malformed record created |
| AC-08 | Capture image | Page screenshot saved and overlay absent from raw image |
| AC-09 | Copy locator | Accurate selector/XPath copied and announced |
| AC-10 | Export ZIP | Well-formed archive and valid `metadata.json`; relative paths correct |
| AC-11 | Redact fields | Removed fields absent from JSON/MD/HTML/ZIP; screenshot omitted if unchecked |
| AC-12 | Password/form fixtures | No input `value`, password, hidden tokens, cookies, auth headers stored by default |
| AC-13 | Unsupported pages/cross-origin frame | Graceful unsupported notice; no extension crash |
| AC-14 | Service worker terminates | Saved issues remain; transient session can safely reset |
| AC-15 | IndexedDB quota/storage exception | Human-readable recovery instructions; typed draft retained where possible |
| AC-16 | No network connection | Core issue creation/export still works; entitlement grace enforced |
| AC-17 | Sixth free issue | Clear upgrade prompt; existing reports remain accessible/exportable |
| AC-18 | Invalid/refunded license | Accurate status and support path; no deletion of reports |
| AC-19 | Keyboard-only use | Start, select alternative, dialog, edit, export, stop supported |
| AC-20 | Responsive fixture | Capture at narrow viewport without obstructing site irreversibly |
| AC-21 | Static/dynamic websites | SPA route changes handled or capture resets with clear warning |
| AC-22 | Export no screenshot | Metadata and markdown do not claim screenshot attached |

### Test fixtures and tools

Create local demo pages with a broken checkout button, overlapping responsive cards, nested elements, shadow root, cross-origin iframe placeholder, SPA route, long scrolling page, pseudo-elements, sensitive input forms, SVG, canvas and contenteditable fields. Unit-test sanitizers, CSS selector generation, bbox calculations, schema validation, report templates and licensing state machine. Browser-E2E test capture overlay, persistence, download, and offline mode. Manual checks: 5 representative public sites with permission-compatible contexts, Chrome Web Store package audit, accessibility keyboard pass.

## 17. Suggested repository structure

```text
bugsnap-lite/
├── apps/extension/
│   ├── public/manifest.json
│   ├── src/popup/
│   ├── src/content/{overlay,selection,drawer,sanitizer}/
│   ├── src/background/
│   ├── src/storage/
│   ├── src/export/
│   ├── src/licensing/
│   ├── src/shared/{contracts,validation,errors}/
│   └── tests/{unit,e2e,fixtures}/
├── apps/licensing-api/       # optional separate backend for P0 payments
├── website/                  # landing page, legal docs, support
├── docs/{PRD.md,architecture.md,privacy-data-map.md,store-listing.md}
└── README.md
```

## 18. Codex implementation instructions (execution contract)

1. Start by reading this PRD; create `docs/architecture.md`, `docs/implementation-plan.md` and a traceability checklist keyed to AC-01...AC-22.
2. Build **P0 only** on the first implementation pass. Do not implement P1/P2/P3 opportunistically.
3. Scaffold MV3 + TypeScript + React, typed message bus, Zod schemas, IndexedDB repository, overlay/selection engine, and export engine. Keep business/domain logic independently testable.
4. Wire explicit user activation and content-script injection. Implement click-to-select and region mode, with overlay isolation and no accidental click-through.
5. Build conservative privacy sanitizer before storing/exporting HTML or page data. Test sensitive fixtures first.
6. Implement screenshot capture with overlay hiding and a deterministic annotated output. Attach source/provenance to environment fields.
7. Implement issue drawer, local list, edit/delete, Markdown/JSON/ZIP export, with deterministic ZIP file naming and error paths.
8. Implement free-limit + entitlement interface. If live payment credentials are unavailable, supply a mock provider behind `LicenseProvider`, provide documented env configuration and no hardcoded paid bypass in production builds.
9. Add unit + E2E tests and run build, lint and tests; fix failures. Create privacy policy, website draft, Chrome Web Store permission explanations and release checklist.
10. Include README: `npm install`, `npm run build`, load unpacked extension, test fixture commands, provider configuration, no-secret-in-extension policy, packaging/upload guidance, known restrictions.
11. Do not claim Chrome Web Store submission, checkout success, or verified external integrations unless actually completed with proper credentials and direct verification.
12. After P0 passes all acceptance tests, propose P1 as a separate implementation milestone; keep P2/P3 documented but not enabled.

**Preferred deliverables from Codex:** working extension code; build artifact in `dist/`; passing tests; privacy/data flow map; manifest permissions rationale; README; store listing copy; demo fixture; prioritized P1 backlog; known risks.

## 19. Go-to-market and launch checklist

- Create recognizable icon and name; conduct Chrome Web Store trademark/name search; check domain availability before purchase.
- Single-page marketing site with 30-second video: select → pin → context snapshot → ZIP handoff.
- Trial-to-paid funnel with honest value/limitations and clear refund/support terms; do not promise universal bug detection.
- Interview 10–15 freelance developers/agency reviewers. Ask for real feedback samples and whether generated output would save time. Run live price test at $15 and $19.
- Publish privacy policy, support contact, permission disclosures, license/refund terms, screenshot samples and FAQ.
- Chrome Web Store listing + demo assets + external payment setup + test purchaser flow.
- Post practical demo in targeted developer/freelancer communities where permitted; engage without spam; offer first-user onboarding.
- Weekly cohort tracking: installs, capture starts, issues saved, exports, trial limit reached, purchase completion, refunds, time-to-first-value. Avoid collecting URLs/DOM for analytics.
- At 30/60/90 days decide: scale this extension, change niche, or ship the next utility based on purchases and retention.

## 20. Risks, trade-offs and open product decisions

| Risk/decision | Position for P0 |
|---|---|
| Is $19 one-time profitable? | Test; support and payment costs may exceed expectation |
| 100 buyers in 90 days? | Target only; reach/acquisition not guaranteed |
| Screenshot may expose private information | User-triggered, preview and omission; P1 pixel redaction |
| Snapshot has tokens, PII, legal concerns | Strict whitelist, sanitized HTML, truncation, user review; test fixtures |
| “Country” accuracy | P0 manually entered and labeled; no silent inference |
| Region ambiguity | Separate `selectedRegion` (rectangle) and `geoRegion` (geography) |
| Selector stability | Best effort, confidence flag and alternate XPath/bounds |
| Shadow DOM/iframes/canvas | Partial support or explicit unsupported status |
| Dynamic page replay | Not promised; HTML fragment is diagnostic only |
| Lifetime license maintenance | Only promised P0 local features and fixes; clarify future product tiers |
| Backend scope | License/payment only, no issue-content backend in P0 |
| Privacy policy and regulatory compliance | Review actual data flows, Chrome store requirements and laws before launch |
| Document ownership | Original implementation, never extract employer materials |

## 21. Reference documentation to consult during implementation

These are technical references, not claims of implementation or legal approval:

- Chrome `activeTab` and scripting: https://developer.chrome.com/docs/extensions/get-started/tutorial/scripts-activetab
- Chrome `tabs.captureVisibleTab`: https://developer.chrome.com/docs/extensions/reference/api/tabs
- Extension storage and IndexedDB: https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies
- Chrome Web Store user data / privacy: https://developer.chrome.com/docs/webstore/user_data
- Chrome extension developer policies: https://developer.chrome.com/docs/webstore/program-policies

**End of specification.** Treat the P0 acceptance matrix and TypeScript schemas as the primary implementation contract. P1, P2 and P3 are documented roadmap phases, not P0 requirements.
