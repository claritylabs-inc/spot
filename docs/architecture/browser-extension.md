# Spot browser sidebar

The Chrome/Edge extension hosts `/extension`, a full-height client agent view.
The chat, history, attachments, policy citations and approval views reuse the
existing client agent components. Conversation storage, authorization, tools
and durable execution remain in Spot. There is no extension-specific agent or
provider credential.
Sidebar tabs and layout preferences use their own user/organization-scoped
storage key, so opening the sidebar does not change the main app's dock layout.

## Owners

- `extensions/spot/`: packaged Manifest V3 sidebar and explicit page capture.
- `scripts/build-browser-extension.mjs`: unpacked extension build.
- `config/browser-extension.json`: public manifest key, stable extension ID,
  app origin and capture limits. The key is public identity material, not a
  credential. It matches Chrome Web Store item
  `ioghpiffchcecdfkekjdgkgakemgfdhi`; `--store` builds omit the development key
  from the upload manifest.
- `lib/browser-extension.ts`: versioned message validation.
- `app/extension/` and `components/browser-extension/`: app view, access gate
  and capture staging, using the shared chat/dock and composer owners.
- `next.config.ts`: `/extension` framing restriction to the configured extension
  origin and the app itself.

## Sessions and permissions

The extension has host access to the configured Spot app origin. Chrome exempts
that embedded origin from storage partitioning when the embedding extension
has host permission. Sign-in occurs in a normal Spot tab; reload the sidebar
when sign-in is complete. The extension never reads, copies or stores tokens.
See [Chrome storage and cookies](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

The app checks the live viewer and organization before mounting the agent.
The initial release is for active client workspaces. Existing Convex resource
and tool authorization remains authoritative.

## Page capture

Opening the sidebar does not capture a page. Capture requires an explicit user
interaction. `activeTab` only grants temporary access after a qualifying browser
interaction; switching to another site's tab can require invoking the extension
again. Browser internal pages and some document viewers cannot be captured.
Use ordinary file attachments when page access is unavailable.

The extension sends plain text with a title, sanitized source URL and selection
indicator. Query strings, fragments and URL credentials are excluded. The app
checks the exact parent window, extension origin, protocol version, field types
and size limits. A per-mount session ID rejects transfers that outlive a signed-in
workspace; a receipt confirms delivery. The bridge cannot send chat messages or
execute tools.

Captured text stages as a removable file in the current composer. Existing draft
text is preserved. The user reviews and submits it through the normal attachment
flow. Captures are ephemeral; they are not browser history, automatically synced
page context or a background scraper. Page text is untrusted reference material.

## Scope and validation

This version does not fill forms, click page controls, capture screenshots or
publish to browser stores. Building an extension does not deploy `/extension`.

Use the local app/backend for acceptance; never use Vercel previews. The workflow
and evidence ledger is in `docs/testing/workflow-qa.md`. Browser-store approval,
Edge-specific behavior and organizational browser policies require separate
verification before distribution.
