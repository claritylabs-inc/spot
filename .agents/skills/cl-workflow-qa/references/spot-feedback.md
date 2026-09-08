# Spot feedback to carry into every workflow

Derived from the user's procurement cloud-Chrome session and current Spot
contracts. Apply these as Spot conventions, not universal rules for other apps.

- Table rows show readable data and open a keyboard-accessible sidebar. No row
  actions, menus, editing controls, or dropzones. Record actions use its footer.
  A sidebar settings table may contain audience switches.
- Edit in context. Autosave existing records through the shared owner; flush
  pending edits on close, scope drafts to the record, reject stale writes, and
  retain unsaved text after errors. Creation and consequential transitions stay
  explicit. Do not add duplicate footer Close/Cancel controls.
- Broker/client selectors show `OrgBrandIcon` in options and the selected value.
- Upload/extraction progress belongs in toasts, not dropzone notes.
- Remove repeated route/tab titles, obvious sidebar headings, and file subtitles
  that do not help a decision. Let filenames and controls identify themselves.
- Procurement uses Proposals, with PDFs and Terms sidebar tabs. Keep shared
  broker profile data distinct from request-specific contacts and logs; make
  the scope understandable rather than duplicating ambiguous fields.
- File sharing uses Client visibility and Broker visibility switches in a table.
  Preserve operator-private proposal/market boundaries and snapshot semantics.
- Compare the complete action path before/after: reduce screen changes and
  cursor travel while preserving confirmations that protect real consequences.
- Verify actual download files without navigating away from the app, immediate
  close after edits, row switching, concurrent edits, live status updates,
  revision handling, and role-filtered public/client/broker views.
