# Folder tabs workflow — October 26, 2026

Spot adopts the shared folder tabs (`@claritylabs-inc/ui` `TabsList variant="folder"`, clarity-ui branch `work/folder-tabs-30px`, validated at `c510704a29d7956abdce1b2d9a952e8865b32bd4` through a local source overlay; no manifest or lockfile change). Baseline `3cb2c4a4`.

## Composition

- `components/ui/folder-tabs.tsx` owns Spot's thin composition: `PageTabs` (root, `gap-0`, bleeds through the shell content gutter so the rail sits flush under the top bar), `PageTabsList`, `PageTabsPanel` (shell gutters) and `SectionTabs*` (a bordered local sheet for field-group tabs inside a page). Geometry, colors and focus come from the shared primitive.
- A mounted `PageTabs` claims the shell slot `folderRail` (`components/app-shell-slots.tsx`, `useAppShellSlotClaim`). `ShellFrame` then renders the top bar with `bg-tab-rail border-0`, so the top bar and rail read as one surface. Unmounting clears it; nested `SectionTabs` do not claim it.
- `ListToolbar` gains `tabsPlacement="above"`: the caller's page rail renders before the filter row. The default `inline` keeps the previous pill-in-filter-row behavior.
- Optional previous/next lives in the shared top bar `navigation` slot. Only `OperatorClientSwitcher` fills it (operator client record routes), presented with the shared `PageNavigation`; its client callbacks, section preservation, disabled boundaries and `j`/`k` shortcuts are unchanged.
- `app/globals.css`: operator form density rules skip `[data-slot="tabs-trigger"]` so rails inside forms keep 30px / 14px.

## Action scope

Page-wide actions stay in the top bar; actions that only apply to the selected view live with that view's content.

| Surface | Stays above (page-wide) | In the selected view | Reason |
| --- | --- | --- | --- |
| Operator client profile (`/operator/clients/:id`) | Notes, autosave status, Delete client | Tech stack: Rescan beside the scan status; Related entities / Locations: Add entity / Add location in the collection (empty-state action when empty, a right-aligned row once items exist) | Notes, autosave and delete act on the whole record; the rest act on one collection. `InlineCollectionActionsContext` is no longer provided here so the collections own their add controls. |
| Operator provider (`/operator/brokers/:id`) | autosave status, Delete provider | Contacts: existing Add contact | Record-wide; Contacts already owns its action. |
| Operator client settings | Invite member (Team section, not a tab) | none | Sidebar section, not a tab. |
| Policy detail (client, operator, vendor) | Archive, Generate certificate/COI, extraction and archived notices stay in the panel body under every tab | none | Record-wide. Notices moved under the rail so the rail stays flush; they render for every tab. |
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
List rails (`ListToolbar tabsPlacement="above"` or a plain `PageTabs` rail): operator clients, procurement lists, certificates, policies (client and operator client), operator client files.
Local sheets (`SectionTabs`): application detail and review field groups. Both code paths are currently unreferenced: every caller passes `activeSection`, so they keep plain `useState` and no new followed keys were introduced.

## Retained pill exceptions

| Control | Why it stays |
| --- | --- |
| Team inbox mailbox (Inbox / Sent / All mail / Archived) | A filter in the shared `FilterBar` row beside search and chips; also nested inside procurement request view `email`. |
| Information requests (Draft / All) | Shares a row with search inside the procurement request body. |
| Policy upload mode, certificate generate mode, client/provider email audience, proposal PDFs/Terms, Slack Overview/Channels/Automations | Form or panel modes inside drawers and cards. |
| Notification panel Unread/Read, agent dock chat tabs, agent dock history views | Panel and dock chrome. |
| Settings mobile section strip | Navigation that mirrors the sidebar on narrow screens; rendered inside the panel body so the rail stays flush. |
| Sidebar section navigation (operator client sidebar, `SectionMenu`, settings sidebar) | Route navigation, not page tabs. |

## Known limits

- The first tab label aligns with the breadcrumb text only on pages without previous/next. Where the client switcher precedes the breadcrumb (56px plus the 12px gap) the label aligns with the arrows' left edge, and below `lg` the mobile menu button precedes both. A shell-level alignment contract is a shared-primitive/shell decision.
- Files and policies lists render a rail only when Shared/Archived views exist; the seeded fixtures have none, so those two rails were not exercised in the browser.
- Dark theme and the iPad width were not exercised.

## Local QA evidence (`.context/qa/folder-tabs/`, not committed)

Local Conductor stack (`npm run conductor:dev`), synthetic operator `foldertabs-qa-*@spot.insure` via email OTP + TOTP enrollment, fixtures Cove, Maple Logistics, two local procurement requests and one demo policy. Client surfaces through read-only operator impersonation of Cove. Scripts: `auth.mjs`, `capture.mjs`, `batch.sh`, `interact.mjs`.

| Check | Result |
| --- | --- |
| Rail geometry on 11 operator pages at 1440 and 390: top 48 (flush under top bar), 30px tabs, 14px labels, 5px top / 0 bottom radius, white active tab, no `pill` lists left on migrated pages | Passed |
| Top bar and rail one surface (`bg-tab-rail`, bottom border 0) on rail pages; default (transparent, 1px border) on pages without a rail (policies and files with no Archived/Shared views); cleared after navigating from a rail page to a non-rail page | Passed |
| Client surface: policy detail, compliance, Settings → Agent (tabs and wiki), client profile rails | Passed |
| Profile Tech stack / Related entities / Locations actions in the panel and absent from the top bar; Notes and Delete client remain in the top bar | Passed |
| Compliance Requirements and Certificates actions beside the view heading, absent from the top bar | Passed |
| Keyboard: arrow keys move between tabs; focus-visible underline for keyboard focus only | Passed |
| Previous/next client keeps the section, `k` returns, only on client record routes | Passed |
| 390px: 7-tab profile rail scrolls horizontally in a single 34px row | Passed |
| Clients Archived tab selection | Passed |
| `npx tsc --noEmit`, focused `eslint` on changed files | Clean (two unrelated pre-existing warnings repo-wide) |
