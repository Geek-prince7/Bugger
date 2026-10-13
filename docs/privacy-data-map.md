# Bugger privacy data map

Implementation baseline: 0.1.0 local trial. This describes code behavior, not a legal certification.

## Collection and storage

Before explicit activation there is no manifest content script, page observer or screenshot capture. Activation injects the bundled content controller into the selected top-level HTTP(S) tab. Selection inspects the chosen DOM target; explicit capture collects bounded context and optionally calls Chrome's visible-tab screenshot API.

Saved reports and original PNG blobs live in the extension-owned `bugger-v1` IndexedDB. Stored context includes sanitized page URL/hostname, time, viewport/screen/document dimensions, scroll, DPR, structural selection/bounds, whitelisted styles, browser-reported environment and manually entered country/region. Observation text is supplied by the reporter and can itself contain confidential information. Browser/OS/device inference carries provenance and may be approximate.

The `bugger-captures` IndexedDB stages one pending capture, including its screenshot. New capture replaces the staged record. Stop/navigation/tab-close cleanup clears staging; a capture expires for save after 30 minutes. Expiration is a validity check, not a guaranteed timed deletion job: an abandoned staged record can persist until a later cleanup action. The worker also clears abandoned staging when it starts without a browser-session capture identity. Session identity and tab URL are held in `chrome.storage.session`; optional country/region preferences use `chrome.storage.local`. Unsaved form state is transient. Do not promise automatic recovery after navigation or browser shutdown.

## Exclusions and deliberate deviations

The sanitizer excludes inputs, textareas, selects/options, scripts/styles, hidden/contenteditable elements, frames and embedded objects from HTML evidence. Structural HTML is depth/size bounded; text becomes `[redacted]`. No element IDs/classes/arbitrary attributes, accessible labels or asset URLs are copied. Locators use structural positions. Page title and text excerpts are currently null. This is more restrictive than the PRD's proposed safe-attribute/text capture; privacy toggles do not reconstruct these omitted values.

URLs lose credentials, query and fragment during collection; likely sensitive path segments (emails, long tokens and values following sensitive routes) are redacted. Paths and hostnames can still reveal sensitive information. Export performs additional email/token redaction, but it cannot guarantee detection of every secret in notes or URLs. Screenshots are not text-sanitized or pixel-redacted.

No cookies, auth headers, request/response bodies, console logs, network diagnostics, GPS, inferred country, account data or payment data are collected by the current build. No product analytics, remote content scripts, cloud sync or page-content uploads are implemented.

## Export boundary

JSON, Markdown, HTML and attachment inclusion are derived from one privacy projection. Default export includes available screenshot and page URL; text, HTML, attributes, geography and assets are off. Review is user-facing, not an assertion that the output is safe. Disabling URL also removes page hostname/title. Attribute/text omissions suppress unsafe derivative locators. Only safe structural HTML can be emitted. Country omission clears both country and region.

ZIP contains `report.md`, `metadata.json`, and only included available evidence at `screenshots/original.png`, `screenshots/annotated.png`, `snapshots/element.html`. Standalone JSON/Markdown do not claim external files are attached. Image export is an annotated PNG. Clipboard copy is explicit. Downloads and clipboard become user-controlled copies outside the extension; deleting a report does not delete these copies. Privacy settings affect exports, not stored originals.

## Permissions and recipients

`activeTab`: temporary access after a user gesture, including screenshot authorization. `scripting`: inject the local capture controller when activated. `storage`: local preferences and session state. There are no persistent host permissions, cookies/debugger permissions or required remote endpoints.

Bugger sends no report data to a Bugger server. Browser/OS services, installed software, user backups and downstream recipients operate under their own policies. Local storage is not an encrypted vault. A future payment or cloud feature requires a revised data map and policy before activation.
