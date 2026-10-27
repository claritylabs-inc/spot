# Tab action layout audit — October 27, 2026

Baseline: `a4c38923` (shared UI 0.18.0). This is a Spot consumer change; it reuses `ListToolbar`, the combined `FilterBar`, shared navbar tabs and `PillButton`.

## Layout contract

- Tabs distinguish content, such as Profile sections and Private/Shared files. Status and mailbox choices use combined filters instead.
- With real tabs, creation and view actions belong at the top right of the selected panel, even when empty. Only persistent cross-view controls such as Notes remain beside tabs.
- Without real tabs, page actions stay in the navbar. Primary actions retain text; secondary actions use icons with accessible labels/tooltips.
- The panel toolbar's left side holds at most one search, first, then filters. There is no duplicate page title or divider beside the actions.
- Empty-state cards explain absence; they do not duplicate an action already available above.

## Audit decisions

| Surface | Result |
| --- | --- |
| Client Profile | Account/Business/etc remain tabs. Related entities and Locations have the same top-right add button when empty or populated. Rescan moves above the tech-stack fields; scan status stays below the fields. Notes stays in the navbar. |
| Compliance | Requirements, Sources and Certificates remain views. Their actions use an actions-only toolbar; duplicate headings beside buttons are removed. Customer requirement filters retain their existing combined row. |
| Files | Private/Shared remain views. Active/Archived is a Status filter, scoped to the selected visibility view. Upload moves between navbar and panel according to whether real tabs exist; Shared upload defaults to client-visible. Archived has no upload action. Shared-tab availability considers both sources so changing status does not remove a selected view. |
| Client and provider lists | Client status tabs become a combined Status filter. Provider list already uses filters. Create remains in the navbar. |
| Policy lists | Active/Archived becomes Status. Navbar upload stays labeled; empty states no longer duplicate upload/drop-zone controls. |
| Policy details | Distinct Details/Coverages/Sections/etc remain tabs. Generate COI belongs to Certificates, or Details before any certificates exist; it is not shown in unrelated views. With only one view it stays in the navbar. Record-wide PDF/extraction/archive controls remain in the navbar. |
| Procurement lists | Open/Closed becomes a State filter alongside the existing detailed Status filter. Existing state, search, selection and permissions are retained. |
| Certificates list | Active/Archived becomes a Status filter beside Policy; no status rail can replace a parent page's tabs. |
| Inbox and information requests | Mailbox and Draft/All become combined filters. Search precedes filters. New email/Add question stay in their existing navbar when there are no real content tabs; duplicate empty-state Add question is removed. |
| Provider Contacts | Top-right Add contact uses ListToolbar; the redundant Contacts heading is removed. |
| Team and connected vendors | Existing navbar actions are retained, with duplicate empty-state actions removed. |
| Channels, settings field groups, preview modes | Genuine content tabs and local modes remain unchanged. Connect/reconnect, field uploads and per-record editor controls stay with their content. |

## Local browser acceptance

Synthetic operator via locally captured OTP/TOTP; native local backend started through the Conductor script. No Vercel preview testing, live email, scan, certificate generation or file upload was performed. Four synthetic file rows were imported into the local backend, reusing an existing local fixture PDF, so no naming/extraction job was triggered. Entity add/remove exercised only the synthetic Maple fixture.

Artifacts: `.context/action-audit/acceptance.mjs`, `acceptance.log`, `acceptance.json`, screenshots in the same directory. The script covers:

- Clients: no status tabs, single search before Status, Archived/clear/search behavior, full primary navbar label.
- Profile: entity action above both empty/populated content, add/remove round trip, icon-only Notes, Locations at 390px without overflow, Tech stack action above fields when available.
- Compliance: no duplicated toolbar heading, selected-view Requirements/Certificates actions.
- Files: no-tabs navbar upload versus tabbed panel upload, Shared visibility prefill, Archived filtering within Private/Shared, no archived upload, narrow layout without overflow.
- Policies: one upload action in the empty list; Generate COI in Details before the first certificate and absent from Sections/navbar.
- Inbox: combined Mailbox selection and clear back to Inbox.

Supplemental procurement/information coverage: `.context/action-audit/information.mjs` and its log. Validation results and remaining limits are recorded in the PR.

## Limits

The browser checks do not exercise actual mail, uploads, website scans or certificate generation. Existing write callbacks and server authorization are retained. Two-person followed-state behavior, client impersonation, and every provider/settings view were reviewed in code rather than all being replayed in this audit. Shared package behavior and backend changes are outside this patch.

## Validation results

- Main local browser workflow passed on October 27, including desktop and 390px screenshots.
- Supplemental procurement State and Information Draft/All filtering, single labeled Add question action and drawer opening passed.
- Regression check passed: open Private upload, select Shared, reopen Upload; client visibility is now prefilled on. No upload was submitted.
- TypeScript and focused ESLint passed. Local production build passed before the final small review fixes; final build status is included in the PR.
- Independent Sonnet review found the upload-prefill remount case and the secondary Add question style; both were fixed and replayed. Policy action fallback now checks actual Certificates-view availability rather than raw certificate count. The Draft default remains unchanged intentionally.
