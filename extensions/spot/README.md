# Spot browser extension

A thin Manifest V3 side panel for Chrome and Edge. The panel hosts Spot's own
`/extension` route in an iframe, so the agent, sign-in and history are the
existing web app. The extension only adds an explicit **Use this page** button.

## Build

```bash
npm run extension:build                 # production: https://app.spot.insure
npm run extension:build -- --local      # http://localhost:<workspace web port>
npm run extension:build -- --origin http://localhost:8080
```

Output goes to `extensions/spot/dist` (overwritten on every build, not committed).
The build fixes the extension ID from the public `key` in
`config/browser-extension.json` and fails if the key does not produce the
configured ID.

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
- **Reload** reloads Spot in the panel. **Open Spot** opens Spot in a tab.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab` | Read the current tab only after a click on the Spot icon. |
| `scripting` | Run the packaged page-reader in that tab. |
| `sidePanel` | Show Spot beside the page. |
| Host access to the Spot origin | Lets the framed app use your Spot sign-in. |

There is no `cookies`, `tabs` or all-sites access. Page text excludes form
fields, password fields, editable areas, hidden content, scripts and styles;
URLs are sent without credentials, query or fragment. Text is capped by
`config/browser-extension.json` and marked when shortened.

## Not readable

Browser pages (`chrome://`, `edge://`), the Chrome Web Store, extension pages,
local files and other non-web pages cannot be read. Text inside embedded frames,
shadow DOM, canvases and PDFs is not captured.

## Requirements and status

- The app must serve `/extension` and allow this extension's origin in
  `frame-ancestors`; local builds need the same on the local app. Without that
  the panel stays blank.
- The app must send `{type:"spot:ready",version:1}` when it can stage a page;
  **Use this page** stays disabled until then.
- Not done: Chrome Web Store or Edge Add-ons submission or review. An Edge
  listing may be assigned a different extension ID, which the app's allowed
  origin would need to include.
