# Quote authorization declaration - October 27, 2026

## Client ownership follow-up

The authorization now belongs to `organizations.intakeAuthorizationId` and has
one `clientFileId`. The original request remains acceptance provenance. The
request-owned behavior described below is historical and superseded by this flow.

Failure boundaries reviewed: concurrent submissions must claim one client grant;
requests must never borrow another client's form; resubmission must preserve the
signed bytes; source-request deletion must leave the client file available;
legacy adoption must preserve release/removal choices and original evidence;
hidden, removed, archived or deleted files must not be revived by resubmission.

Verified with synthetic applicants on the existing local Conductor backend via
the real intake, procurement, client Files and packet APIs:

- Two quote requests and an accepted amendment produced one grant and one active
  client file. Both requests referenced the same `clientFileId` and storage blob.
- An operator-created request reused that file. Deleting the original intake
  request left the client Files entry and the remaining packets accessible.
- Detaching the authorization from one request, then saving and accepting another
  amendment, kept it detached. Other requests retained their own references.
- A client with five legacy declarations adopted the latest existing grant on
  authorized resubmission. All three requests reused its file, four historical
  generated files were archived, and all original declaration storage IDs stayed
  intact. No additional PDF or consent was created by adoption.
- The packet download returned 200, `application/pdf`, 23,939 bytes and
  `Cache-Control: private, no-store`. An invalid packet token returned 404.

Evidence: `.context/qa/authorization/client-scope-{evidence,results,http}.json`
and `client-scope-download.pdf`. Existing tests passed (145 cases); root and
Convex TypeScript checks passed. Lint passed with the nine existing warnings.
No tests, dev migrations or production cleanup were written. Simultaneous
submissions, source deletion during rendering, retry exhaustion and batches over
50 rows were reviewed in code rather than exercised. No emails were sent.

## Original request-owned release

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
