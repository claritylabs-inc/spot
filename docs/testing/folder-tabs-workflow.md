# Folder tabs workflow — October 26, 2026

Spot adopts published `@claritylabs-inc/ui@0.18.0` from the registry: `TabsList variant="navbar"` for page tabs and `variant="folder"` for local field groups. The manifest, lockfile and existing UI postinstall patch are pinned to 0.18.0. Final acceptance below uses the installed package, without source overlays. Baseline `3cb2c4a4`.

## Composition

- Page-level tabs live in the shell top bar: optional previous/next, breadcrumb on the left, tabs right-aligned, then page-wide actions. The shared `AppTopBar` `tabs` prop owns geometry, alignment, the 42px navbar tabs (6px top gap inside the 48px bar) and the container-query stacking at main-pane widths of 48rem or less. The bar stays on the page background (continuous with the sidebar); there is no gray rail.
- `components/ui/folder-tabs.tsx`: `PageTabs` (Tabs root, `gap-0`), `PageTabsList` (portals a shared `TabsList variant="navbar"` into the top bar through the existing `AppShellPortal` slot `folderRail`; Base UI context follows the portal), `PageTabsRail` (a `display: contents` root for pages whose body is ordinary content, so it adds no spacing inside `space-y`/`gap` containers) and `SectionTabs*` (local `variant="folder"`, 36px, inline in a page or drawer; never claims the top bar).
- `ShellFrame` renders the portal target (`<div ref>` passed through Spot's `AppTopBar` `tabs` prop) only while a page owns `folderRail`, so leaving a tab page clears `data-tabs` and the target.
- Panels are plain `TabsContent` inside the shell's own content gutters: no negative margins and no compensating padding.
- `ListToolbar` order is fixed: search first (left), then inline filter chips and the Filters menu, then Clear; the selected view's action buttons sit right-aligned with whitespace only, no divider. Search uses the shared `FilterBar` `leading`, actions its `trailing`. Page-level tabs (`tabsPlacement="navbar"`) render in the top bar; inline tabs (`tabsPlacement="inline"`, team inbox mailbox) get their own row above the toolbar and are never placed between search and filters. Below `sm` the search takes a full row and the chips wrap beneath it.
- Optional previous/next lives in the shared top bar `navigation` slot. Only `OperatorClientSwitcher` fills it (operator client record routes), through the shared `PageNavigation`; its client callbacks, section preservation, disabled boundaries and `j`/`k` shortcuts are unchanged.
- `app/globals.css`: operator form density rules skip `[data-slot="tabs-trigger"]` so tabs inside forms keep the shared geometry.
- Loading skeletons show only the page body: tabs arrive with the page, so there is no placeholder rail.

## Action scope

Page-wide actions stay in the top bar; actions that only apply to the selected view live with that view's content.

| Surface | Stays above (page-wide) | In the selected view | Reason |
| --- | --- | --- | --- |
| Operator client profile (`/operator/clients/:id`) | Notes, autosave status, Delete client | Tech stack: Rescan beside the scan status; Related entities / Locations: Add entity / Add location in the collection (empty-state action when empty, a right-aligned row once items exist) | Notes, autosave and delete act on the whole record; the rest act on one collection. `InlineCollectionActionsContext` is no longer provided here so the collections own their add controls. |
| Operator provider (`/operator/brokers/:id`) | autosave status, Delete provider | Contacts: existing Add contact | Record-wide; Contacts already owns its action. |
| Operator client settings | Invite member (Team section, not a tab) | none | Sidebar section, not a tab. |
| Policy detail (client, operator, vendor) | Archive, Generate certificate/COI, extraction and archived notices stay in the panel body under every tab | none | Record-wide. Notices render in the panel body, so they show under every tab. |
| Settings → Agent (Channels / Behavior / Company wiki) | autosave status | Company wiki editor controls render inside the editor card (no longer portaled to the top bar) | Editor controls act on the notes document only. |
| Compliance (operator and client) | none when there is one view (actions stay in the top bar) | Requirements: Add requirement / Import requirements next to the "Coverage requirements" heading (client surface: trailing `ListToolbar` actions); Sources: Import requirements next to "Requirement sources"; Certificates: Generate certificate next to "Certificates" | They act on that view's rows. Overview has none. |
| Operator channels | none | none | View-only tabs. |
| Operator clients list | Create client, Stop impersonating | search, delete-selected bar | Create is page-wide; search/bulk apply to the visible table. |
| Operator / client procurement list | New request | search, filters, delete-selected | Same. |
| Certificates (client) | Generate certificate | policy filter | Create is page-wide. |
| Policies (client and operator client) | Upload policy (hidden on Archived) | none | Upload is page-wide; kept in the top bar so it does not vanish when there are no Archived tabs. |
| Client files (operator) | Upload files | none | Same. |
| Profile (client) | autosave, Change email | none | Page-wide. |

## Migrated tab families

Page rails (`PageTabs`): operator client profile, operator client settings sub-tabs, operator provider, policy detail, Settings (multi-tab sections), compliance (operator and client), operator channels, client profile (Profile / Privacy, formerly a hand-rolled `role="tablist"`).
List rails (`ListToolbar tabsPlacement="navbar"` or a plain `PageTabs` rail): operator clients, procurement lists, certificates, policies (client and operator client), operator client files.
Local sheets (`SectionTabs`): application detail and review field groups. Both code paths are currently unreferenced: every caller passes `activeSection`, so they keep plain `useState` and no new followed keys were introduced.

## Retained pill exceptions

| Control | Why it stays |
| --- | --- |
| Team inbox mailbox (Inbox / Sent / All mail / Archived) | Inline navigation in its own row above search and filters; also nested inside procurement request view `email`. |
| Information requests (Draft / All) | Shares a row with search inside the procurement request body. |
| Policy upload mode, certificate generate mode, client/provider email audience, proposal PDFs/Terms, Slack Overview/Channels/Automations | Form or panel modes inside drawers and cards. |
| Notification panel Unread/Read, agent dock chat tabs, agent dock history views | Panel and dock chrome. |
| Settings mobile section strip | Navigation that mirrors the sidebar on narrow screens; rendered inside the panel body so the rail stays flush. |
| Sidebar section navigation (operator client sidebar, `SectionMenu`, settings sidebar) | Route navigation, not page tabs. |

## Known limits

- The local `variant="folder"` field tabs (`SectionTabs`, application detail and review) have no live caller, so their 36px geometry was not exercised in the browser.
- Files and policies lists render tabs only when Shared/Archived views exist; the seeded fixtures have none, so those two tab lists were not exercised.
- Dark rendering was captured in final acceptance; changing the theme through settings was not separately exercised.

## Local QA evidence (`.context/qa/folder-tabs/`, not committed)

Local Conductor stack (`npm run conductor:dev`, Convex deploy credentials unset), synthetic operator `foldertabs-qa-*@spot.insure` via email OTP + TOTP enrollment, fixtures Cove, Maple Logistics, two local procurement requests and one demo policy. Client surfaces through read-only operator impersonation of Cove. Scripts: `auth.mjs`, `capture.mjs`, `batch.sh`, `interact.mjs`.

| Check | Result |
| --- | --- |
| Geometry on 11 operator pages at 1440: 48px bar, 42px tabs, 6px top gap, 14px labels, `data-tabs` on the bar, tabs right-aligned (tab list right edge 12px before the actions), bar transparent over the page background | Passed |
| Client surfaces (compliance, Settings → Agent, profile, policy): same geometry, no previous/next | Passed |
| Previous/next only on operator client records; keeps the section; `k` returns | Passed |
| No-nav list pages (clients, all-clients procurement, channels, provider) | Passed |
| 390px: context row 47px, tab row 42px below it (bar 95px), tab list scrolls horizontally, no document overflow | Passed |
| 960px (no sidebar) and 1024px (sidebar, dense profile) | Geometry passed; breadcrumb squeeze noted above |
| Leaving a tab page clears `data-tabs` and the tab list; page body has no phantom row above it (content starts at 72px) | Passed |
| Selecting a tab swaps the panel; panel state kept while the page lives | Passed |
| Keyboard: arrow keys move between tabs; underline only for keyboard focus | Passed |
| Profile Tech stack / Related entities / Locations actions in their panels; Notes, Delete client stay in the bar | Passed |
| Compliance Requirements and Certificates actions beside the view heading | Passed |
| `ListToolbar` order at 1440 (clients with a selected row, procurement, inbox) and 390: search left of filters, selection actions right, inline inbox tabs in their own row above, chips wrap under a full-width search, no horizontal overflow | Passed |
| Search narrows clients and requests; the Filters menu opens; no divider beside the actions | Passed |
| `npx tsc --noEmit`, `eslint` on changed files | Clean |

## Final installed-package acceptance

October 26, 2026: registry 0.18.0, Spot code head `8fba8bd0`. Manager script `.context/folder-tabs-rollout/acceptance.mjs` and `final018-browser.log` passed on the native local backend with synthetic clients. Screenshots and `acceptance.json` are in the same directory.

- Verified 42px navbar tabs, 6px top clearance, 14px text, breadcrumb left and tabs right.
- Dense context retains 12rem; the active Tech stack tab remains visible after resizing through 1024, 960 and 390px. Mobile actions wrap while preserving context.
- Previous/next and j/k retain client section; list pages omit them. Related entities and Locations keep their add actions in the selected panel.
- Clients has one search; selecting a row places bulk actions right with no divider, and search narrows results. Search precedes combined FilterBar criteria wherever filters exist. Named text predicates belong in the shared Filters popover, not extra page search bars.
- Local production build passed. Exact code-head CI lint, tests and typecheck passed (run 40417754369). A concurrent local typecheck was killed by memory pressure; no local final typecheck pass is claimed.
- Earlier worker evidence above covers additional operator/client routes. Shared 0.18.0 browser acceptance also covers text-filter Apply/Enter/clear, keyboard focus and responsive active-tab visibility. No new unit tests or Vercel preview testing.
