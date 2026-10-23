# Procurement information requests workflow QA

Use the existing native-local backend and visible Chrome. Never send live provider
or client emails. No unit tests or database migrations are part of this change.

## Actors and fixture

- Synthetic operator `qa.operator@example.com`, signed in through email OTP and TOTP.
- Synthetic client `intake-followups@example.com`, signed in through email OTP.
- Submitted request for `Intake Followups QA LLC`; original submitted snapshot stays intact.
- Stored synthetic provider emails are fixtures only; no email transport is invoked.

## Acceptance and iterations

1. Open Information needed; identify questions, outstanding provider needs and next
   actions without scrolling past a creation form. Desktop and narrow layouts use
   Spot primitives, typography and the app-shell right panel.
2. Add a scoped question manually, attach a second provider to the same question,
   and preserve distinct requirements. Different periods/subjects stay separate.
3. Publish one fixed question batch; email action opens the existing composer with
   its link, without sending. Duplicate open batches are rejected.
4. Anonymous links require login. An authorized request owner or company member
   can read the allowlisted form; only authorized owners/admins can submit.
5. Answer through intake primitives, save, reload, review, confirm and submit.
   Both provider requirements become answer available; neither is marked sent.
6. Conditional questions appear only for the matching parent answer. Changing the
   parent hides dependent answers and submission excludes them.
7. Upload and associate a supporting file. Enforce request/user upload intents,
   expiry, byte/type limits, file visibility and active associations.
8. Review an email extraction proposal against its exact source quote before
   adding it. Reject cross-request/provider sources and unsupported quotes.
9. Record delivery against a sent provider message and exact answer/file versions;
   acceptance needs an explicit note. Changing an answer flags prior delivery and
   acceptance as stale.
10. Save generic question wording as observed, approve for future quote intake,
    verify coverage/industry context and retirement. Client answers and email
    bodies do not enter the reusable library.
11. Exercise conflicts, cancelled/submitted forms, read-only impersonation,
    unrelated clients and deleted requests. Preserve unsaved visible edits.
12. Inspect empty/loading/error states, keyboard controls, dark/light and narrow
    layouts, and record type/lint checks and browser artifacts.

## Results

- First browser pass: two providers shared one question and a published one-question
  form. Client sign-in, typed currency input, review and submission passed.
- Found and fixed: a verified existing company member was incorrectly routed through
  the original intake proof gate. Supplementary forms now authorize against the
  target organization's membership; restricted applicants retain owner-only access.
- User review requested a substantial visual refinement: remove the always-visible
  creation form, repeated answers and technical scope values. The final
  iteration below implements that refinement and records its outcomes.

## Final local pass — October 23, 2026

| Workflow | Result |
| --- | --- |
| Two providers, one fact and one client answer | Passed in visible Chrome; independent Embroker/Nadler requirement status. |
| Currency input, review, confirmation and submission | Passed; 50,000 client answer retained in submitted snapshot. |
| Email proposal extraction and exact quote review | Passed on a distinct synthetic checklist email; an earlier failed extraction stayed failed without replay. |
| Conditional order and hidden-answer exclusion | Passed after fixing selection-order dependence; parent Yes reveals child, No hides it, submission contains only No. |
| Supporting file | Upload and one-use intent guard passed via authenticated API; browser selection could not run because the extension disallows file URLs. Browser review/submission of the associated file passed. |
| Draft invitation | Existing client composer opens with the form link; no transport invoked. Synthetic operator has no configured sender name, so Send remains disabled. |
| Delivery and acceptance | Linked synthetic outbound message accepted as exact evidence; explicit acceptance note persisted. Corrected answer renders Answer changed. Stored emails are fixtures, not actual delivery. |
| Conflict handling | Stale form revision, changed answer after publication and submitted-form replay all rejected. `revision-results.json`. |
| Client boundaries | Anonymous form/tracker read and unrelated-client form read/write/tracker access all rejected. `access-results.json`. |
| Library lifecycle | Generic observation saved, activated, retired and reactivated through UI. Retired selector returned []; active selector returned only generic wording/applicability with no client answer. `library-active.json`. |
| Form cancellation | Synthetic stale confirmation form cancelled through UI; operator history retains it. |
| Desktop and narrow | Operator tracker/drawers and client review inspected at 393px; viewport overrides reset. `operator-desktop.png`, `client-narrow.png`. |
| Light theme | Not separately exercised; shared theme tokens/primitives are used. |
| Deleted requests and impersonation | Code review of existing authorization helpers and explicit guards; not separately exercised in this browser run. |

Artifacts are under `.context/qa/information-requests/`. The temporary local data
fixture module was removed before final code generation. No unit tests, database
migrations, production writes, external emails or deployments were performed.

Final static validation: TypeScript noEmit and focused ESLint; the existing
`application.tsx:1350` exhaustive-deps warning predates these changes. See the
platform ledger for completion status. Hosted callback/delivery behavior remains
a release check, rather than something a native-local run establishes.

## Simplified request/email flow — October 23, 2026

The current UI uses one status per question and one logo/name list of requesting
providers. It no longer presents provider delivery/acceptance as client-answer
status, and Request information contains no question-selection controls.

| Workflow | Result |
| --- | --- |
| Automatic provider ingestion | Passed through the existing `ingestEmailInternal` path. Two explicit questions were extracted and confirmed by CL-router/Jev, then appeared in the tracker without manual addition. |
| Semantic overlap | Passed. A later paraphrase selected the existing first-aid count question, passed the atomic semantic check and created no duplicate fact/requirement. |
| Automatic form selection | Passed in visible Chrome. Exactly the two unanswered questions were included; existing answered and inapplicable questions were excluded. |
| Repeated request | Passed. Reopening Request information reused the same form ID. The draft invitation contained one generated block and one current link. |
| Operator answers | Passed. Entering `3` with client-source provenance changed the supervisor question to Answered. The next request included only the unresolved first-aid question. |
| Superseded form | Passed. The affected open form closed; the client saw This form is no longer needed rather than a query failure or a stale form. |
| Client email answer | Passed through the same inbound path. Explicit count `8` passed the existing prefill confidence band and appeared as Answered; its exact source quote and email provenance are visible in the operator detail panel. |
| Client email redelivery | Passed. The same message ID returned duplicate and did not start another inference or overwrite the answer. |
| Unknown correspondent | Passed. A synthetic unrecognized sender remained in the inbox and created no information extraction. |
| Source evidence | Passed in browser. Provider quote, client quote, answer provenance and date render together in the detail panel. |
| Narrow UI | Rechecked with the same viewport capability; temporary overrides reset. |

Evidence: `automatic-email-results.json`, `operator-email-answer.png`,
`operator-desktop-v2.png` and `operator-narrow-v2.png` in
`.context/qa/information-requests/`. These are stored synthetic inbound messages,
not live external deliveries. The existing webhook transport and hosted durable
callback remain release checks.

An initial verification found that a generation-only `phase` trace field had been
passed to the stricter decision contract. Generation completed but automatic
promotion correctly held. The contract mismatch was fixed; the final provider,
semantic overlap and client-answer runs all completed with confirmed decisions.
Earlier held records were retained without replaying their generation.

No unit tests, migration scripts or temporary backend fixture modules were added.
No external email sends or production deployment were performed.

## Additional sample form — October 23, 2026

- Removed the outstanding-questions summary and hid conditionally inapplicable
  cards from the operator list. Add provider now sits in Requested by with logos.
- Seeded 11 unanswered questions on the synthetic Intake Followups QA LLC request:
  yes/no, amounts, numbers, date, dropdown and short/long text. Three questions
  are requested by both Embroker and Nadler Insurance.
- The published sample form includes all 11 definitions automatically. With an
  unknown prerequisite it shows seven questions; Yes expands to ten, No to eight.
  Browser navigation verified Yes opens the subcontractor count and No skips to
  safety training. Only a draft No answer was saved; no answers were submitted.
- Email invitations now retain conditional If Yes/No context; a repeated request
  reused the existing sample form and replaced the generated draft block.
- Sample form ID: `px7sh1peksv1fjzwsk7sw9kd5x8gtfbv`. It remains open for hands-on QA.
- The local-only seed module and temporary helper export were removed after
  seeding; generated API was refreshed. No migrations or test files were added.

## Intake design refinements — October 23, 2026

Actor/fixture: signed-in synthetic operator and applicant on Next :3207 / local
Convex :3220, Intake Followups QA LLC. Preserve the applicant's existing draft;
do not submit answers or publish a replacement form during this pass.

Acceptance workflow: open the introduction, continue to a saved question, inspect
coverage heading/progress/arrow navigation and spacing, open review, verify one
coverage remains expanded, and return through Edit. Operator workflow: add sample
questions in Cyber and Professional liability, answer inline, verify saved status,
and inspect the automatic request preview grouped by coverage. Reload operator
records to verify persistence. Blank/unsure answers must remain unresolved; hidden
prerequisite inputs cannot write. No future-intake reuse controls may remain.

Historical library approval cases above are superseded: the feature is removed,
including its active backend readers/writers and initial-intake hint injection.
Deprecated storage is retained without migration. Browser evidence and final
outcomes for this pass are recorded in the main workflow ledger.

## Independent question batches — October 23, 2026

Actor/fixture: normal synthetic operator and applicant, Intake Followups QA LLC,
Next :3207 / local Convex :3220. Actions: open sidebar Add form, choose two of three
unanswered questions, create its invitation draft, create a second batch from the
remaining question, switch between form pages and email drafts, then open the
client link. Verify the first batch remains open, assigned questions disappear
from new-batch selection, drafts do not mix, and the client sees only that batch.
Do not send mail or submit applicant responses. Existing completed form remains.

Observed: subset selection created a two-question operations batch and a separate
one-question contracts batch. Both remained independently open. Per-form subject,
message and URL stayed separate when switching; an edited operations subject
survived closing/reopening while the contract subject stayed unchanged. The client
operations link showed exactly its two questions. No questions/forms tabs remain.
The Overview still shows every applicable question; form entries use stable IDs.
An early synthetic operations fixture was removed during concurrent local fixture
cleanup, so the persistence check was repeated using the two current batches.

No live delivery was attempted: the synthetic operator's existing sender profile
is incomplete and Send remains disabled. Email association, same-contact batch
separation, duplicate/ownership checks and claim/final-send form revalidation were
source-reviewed; external email delivery and webhook reply correlation are release
checks. No tests or migrations were added. Evidence and validation are in the
main workflow ledger.
