# Bugger Chrome Web Store listing — draft

Publication is pending owner review, verified test evidence, public policy/support URLs and store submission. This copy describes the current local trial, not the PRD's unimplemented paid release.

## Name and summary

**Bugger**  
Capture webpage observations with screenshots and developer context. Review and export reports locally.

## Description

Click an element or select a rectangular region, describe what you observed, and save a report in your browser. Bugger helps you hand developers concrete visual evidence and technical context without setting up a cloud workspace.

- Capture an optional screenshot of the visible viewport.
- Record structural CSS/XPath locators, element bounds, selected styles and browser/viewport context.
- Add title, severity, expected and actual results, and reproduction steps.
- Search, edit and delete your locally saved reports.
- Review export privacy and download Markdown, JSON, annotated PNG or a ZIP bundle.

This early-access build permits five saved reports at a time. Delete an old report to make room; existing reports remain editable and exportable. Payments and paid activation are not available. No account is required and Bugger does not upload your reports to a Bugger server.

Capture is deliberate, not always on. Screenshots can contain confidential information: inspect them or exclude them before sharing. Pixel redaction is not available. The structural snapshot omits page text, form values, IDs, classes and arbitrary attributes; it cannot recreate the full page. Bugger records observations and does not automatically detect or verify bugs.

Works on supported desktop HTTP(S) pages. Browser settings, extension stores and some frame/shadow content are restricted. Export important reports before uninstalling or clearing browser data.

## Publication fields to complete

- Support URL/email: **[OWNER TO SUPPLY]**
- Public privacy policy URL: **[OWNER TO SUPPLY]**
- Publisher identity and applicable terms: **[OWNER TO SUPPLY]**
- Store screenshots/demo: **[CAPTURE FROM VERIFIED BUILD]**

## Permission rationale

`activeTab` grants temporary access following your activation and authorizes visible-tab screenshots. `scripting` injects Bugger's bundled selection controls only when started. `storage` saves preferences and capture-session state. Reports/images use extension-owned IndexedDB. No permanent access to every website, cookies, debugger or remote-code permission is requested.
