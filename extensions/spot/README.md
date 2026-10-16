# Spot browser extension

A thin Manifest V3 side panel for Chrome and Edge. The panel hosts Spot's own
`/extension` route in an iframe, so the agent, sign-in and history are the
existing web app. The extension adds an explicit **Use this page** action in one compact row with new chat, history, and a menu.

## Build

```bash
npm run extension:build                 # production: https://app.spot.insure
npm run extension:build -- --store      # store upload: omits the development key
npm run extension:build -- --local      # http://localhost:<workspace web port>
npm run extension:build -- --origin http://localhost:8080
```

Output goes to `extensions/spot/dist` (overwritten on every build, not committed).
The build fixes the extension ID from the public `key` in
`config/browser-extension.json` and fails if the key does not produce the
configured ID. The public key comes from the Chrome Web Store package page for
`ioghpiffchcecdfkekjdgkgakemgfdhi`. Store builds omit `key`, which the store
rejects on upload. Zip the contents of `dist`, with `manifest.json` at the root.
Never load the keyless store build unpacked: use the default build for that.
Local builds grant access to all ports on localhost and must not be distributed.

Version 0.1.3 requires the matching compact `/extension` app deployment. Deploy the app before distributing this package.

## Load it

1. Open `chrome://extensions` (or `edge://extensions`) and turn on Developer mode.
2. Choose **Load unpacked** and select `extensions/spot/dist`.
3. Pin the Spot icon.

Sign in to Spot in a normal browser tab first, then click the Spot icon (or press
Reload in the panel). The panel shares that session; there is no separate login.

## Use

- Click the **Spot icon** to open the sidebar. This never reads a page.
- Press **Use this page** to add the current page, or the selected text if
  there is a selection, to your next message. The page text goes to Spot only
  when you press the button.
- Reading a tab requires a click on the Spot icon **on that tab**. After you
  switch to another tab, click the Spot icon there, then press **Use this page**.
- The **More options** menu contains **Reload** and **Open Spot**.
- **New chat** starts a conversation; **History** opens the existing conversation list.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the current tab only after a click on the Spot icon. |
| `scripting` | Run the packaged page-reader in that tab. |
| `sidePanel` | Show Spot beside the page. |
| Host access to the Spot origin | Lets the framed app use your Spot sign-in. |

There is no `cookies`, `tabs` or all-sites access. Page text excludes form
fields, password fields, editable areas, HTML-hidden/ARIA-hidden content,
CSS-hidden or transparent elements, closed detail bodies, scripts and styles;
URLs are sent without credentials, query or fragment. Text is capped by
`config/browser-extension.json` and marked when shortened.
Capture is text extraction, not a screenshot: visually clipped or off-screen
text may still be included. Review the attachment before sending it.

## Not readable

Browser pages (`chrome://`, `edge://`), the Chrome Web Store, extension pages,
local files and other non-web pages cannot be read. Text inside embedded frames,
shadow DOM, canvases and PDFs is not captured.

## Requirements and status

- The app must serve `/extension` and allow this extension's origin in
  `frame-ancestors`; local builds need the same on the local app. Without that
  the panel stays blank.
- The app sends `spot:ready` with protocol version 1 and a per-mount `sessionId`;
  **Use this page** stays disabled until then.
- Captures carry that session ID and a `captureId`. The app acknowledges receipt;
  stale-session messages are rejected. Logout/unmount disables capture.
- Chrome Web Store item: `ioghpiffchcecdfkekjdgkgakemgfdhi`. Its current review
  and publication status is shown in the developer dashboard. Edge Add-ons
  submission remains separate. Edge Add-ons draft product ID:
  `2ea28992-245b-434c-a872-0a372379d202`; CRX ID:
  `bjdellngobanihjicilhpiodbocglhhh`. Both store IDs are explicitly allowed by
  the app's frame policy and message bridge. Deploy this app configuration and
  verify the Edge sidebar before publishing. The draft is not yet published;
  the company's Certificate of Incorporation was submitted for Microsoft
  business verification on October 16, 2026. Microsoft confirmed receipt and
  says review should complete within five days; approval remains pending.

## Local workflow QA

With `npm run conductor:dev` running and the synthetic Cove fixture present:

```bash
node scripts/browser-extension-e2e.mjs
```

This uses installed Chrome, the local backend and fresh captured email OTPs.
It temporarily changes the synthetic client's access status and restores it.
Results and screenshots are written to `.context/qa/extension/`. See the coverage
ledger for the live-model and Edge checks that remain unverified.
