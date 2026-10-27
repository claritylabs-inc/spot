# Quote authorization declaration - October 27, 2026

Verified against the native local Conductor backend and local Next.js app.
Only synthetic `example.com` applicant data was used. No emails were sent,
no production deployment was changed, and no tests or migrations were written.

## Failure boundaries reviewed

- Draft or savings-review data must not be published as signed authorization.
- Old-version consent or a changed signer must not authorize a new declaration.
- Duplicate submit/action completion must not publish duplicate PDFs.
- Draft edits must not change stored signed facts or published PDF bytes.
- Delayed older rendering must not replace the current declaration.
- Packet capabilities must not expose a replaced/hidden PDF or accept an invalid token.
- A cursive placeholder must not be represented as captured handwriting.

## Repeatable workflow and results

1. Create a synthetic local intake through the existing handoff/session flow.
   Save a complete quote application with the current terms checkbox. The saved
   consent records the authenticated owner, entered name/email, exact statement,
   server timestamp and versioned terms URL.
2. Submit through `requestIntake.submit` with exact revision and final shopping
   confirmation. A single immutable authorization snapshot and ready PDF were
   created. The shared packet showed one downloadable authorization document in
   visible Chrome. Its HTTP download returned 200, `application/pdf` and
   `Cache-Control: private, no-store`.
3. Replay submission, then save a draft amendment. The published PDF remained
   unchanged. Accept the amendment through resubmit: one new declaration became
   current, the packet contained exactly one PDF, and the previous packet-file
   URL returned 404. An invalid packet token also returned 404.
4. Change the applicant's name while sending previously accepted details.
   Consent was cleared by the server and resubmission was rejected.
5. Render the final production renderer with synthetic inputs including a DBA.
   Inspect the PNG: one page, clickable terms links, complete audit references,
   correct footer and a bottom signature box containing a cursive name placeholder.
   The unmodified font and its OFL license are bundled with the renderer.

Evidence: `.context/qa/authorization/packet.json`, `submitted.pdf`, and
`boundary-results.json`; final layout preview: `output/pdf/spot-authorization-preview.pdf`.
The initial submitted artifact predates the cursive-box adjustment. A fresh
consented resubmission with the final renderer is saved as `final-submitted.pdf`
and `final-packet.json` in the same evidence directory: one page, two clickable
terms links, a bottom signature box and a labeled cursive placeholder, verified
in the rendered PNG and via the actual packet-file HTTP download (200).

Root and Convex TypeScript checks passed. The five existing
`convex/requestIntake.auth.test.ts` cases passed. Focused lint passed with zero
errors; the existing intake application effect dependency warning remains.
Initial automated outreach was reviewed in code: its stored outbound message
continues to use `attachments: []`. Live broker delivery, a complete applicant UI
walkthrough, exhausted render retries, and token revocation were not exercised.

The final spacing follow-up enlarges the white signature/date fields to 30pt,
lowers the cursive baseline by 5pt and retains one-page output. Consent revision
`2026-10-27-v2` explicitly authorizes PDF generation, inclusion in the packet and
sharing with providers to demonstrate representation and obtain quotes. Visible
local Chrome confirmed the expanded current terms and unchanged `2026-10-27`
archive. The revised PDF preserves the full new statement in metadata and links
to `?version=2026-10-27-v2`; no prior acceptance was rewritten.
