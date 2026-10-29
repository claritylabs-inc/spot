# Provider submission defaults — October 29, 2026

Actor: authenticated operator. Local Conductor web at localhost:8080 and Convex at 127.0.0.1:8083. Use synthetic provider, contact and email attachments only. Browser verification uses Helium per user instruction.

1. Open a provider conversation, click the sender name, choose Make primary outreach contact for this provider; reopen Contacts and verify one primary contact, including switching from a prior primary.
2. Right-click an attachment (or use its Options button), choose Use as default application form, select provider and coverage, add submission process notes and save. Open provider Submission defaults and reload; the application form and notes persist under that coverage only.
3. Use Message options → Save submission questions or notes. Review the source, add a generic minimum-information question and guidance / information provided. Save to the same coverage without replacing its forms. Verify another coverage remains independent.
4. Edit the process and questions; cancel retains saved state. Concurrent stale saves must reject without discarding the local draft. Remove a form and verify it disappears without deleting its source attachment.
5. Check keyboard menu access, empty/loading states, narrow width, dark/light theme. Anonymous/client/impersonated writes must be rejected; only attachments actually belonging to the source message may be copied.

Cleanup: retain clearly named local synthetic records for review. No live email sends, production writes, tests or migrations.

Coverage retrieval: the operator overview uses cursor-paginated
`providerSubmissionDefaults.listPage`, with a 1 MB read budget per page and a
Load more action. The editor uses the exact provider/coverage `get` query,
including normalized coverage codes, so a coverage omitted from a directory
page is never treated as a new record. The agent's existing bounded
`submissionDefaults` read contract is unchanged. Final review caught and repaired
truncated-list editing before PR creation. A synthetic provider with 20 substantial
standards reproduced the 1 MB boundary (12 rows in the bounded tool read). Signed
API pagination retrieved all 20 and exact lookup/save succeeded for omitted CYBER.
Helium Load more then displayed CYBER, and Edit opened its existing saved standard.
Evidence: `.context/qa/provider-defaults/pagination-outcomes.json`. Root TypeScript,
scoped ESLint and whitespace checks passed after the repair.

| Workflow | Status | Evidence / limits |
| --- | --- | --- |
| Contact dropdown and primary routing | Passed locally | Helium: unlinked synthetic sender → provider chooser → primary selected → saved. API read confirms exactly one primary. Existing outreach priority code reused. |
| Attachment promotion and persistence | Passed locally | Helium right-click opens the form action; provider preselected from newly saved contact; existing AUTOB process/question retained. Real action saved an independent storage copy. |
| Questions, guidance and coverage separation | Passed locally | Helium created AUTOB process, question and example guidance. On resumed QA, Message options → Save submission questions or notes showed the source email; adding a driver-arrangements question and example guidance preserved the form and prior question. A full page reload showed both questions, with CYBER remaining separate. |
| Stale revision, duplicate and remove | Passed locally | Signed API: stale revision and unrelated attachment rejected; duplicate source keeps one form; remove retains original email bytes and process; re-promotion restores the fixture. `.context/qa/provider-defaults/api-outcomes.json`. |
| Anonymous access | Passed locally | Anonymous list/save calls rejected. Client and impersonation guards reviewed in code, separate role browser exercise not run. |
| Cancel and keyboard dialog access | Passed locally | Changed process notes then Cancel; saved card remained unchanged. Enter reopened Edit with the saved text; Escape closed it. |
| Saved-form PDF preview | Passed locally | Standard form opened the shared in-app PDF pane; synthetic title and page 1/1 rendered. Source process/questions remained readable alongside the pane. |
| Responsive and themes | Passed locally | Helium DevTools iPhone 16 viewport (393 × 852): reviewed dark/light cards, wrapping, edit dialog, and scroll-reachable Save/Cancel footer. Color-scheme emulation and device mode reset; desktop provider defaults left open. |
| Validation | Passed locally | Root TypeScript noEmit clean; scoped ESLint clean; native-local Convex compile/codegen ready; git diff --check clean. No unit tests or migrations written. |

Local review fixture: provider `Primary synthetic email provider`, conversation
`Provider submission defaults QA`, sender `sarah.qa@provider.example`, and synthetic
`QA Commercial Auto Application.pdf`. Native-local only. The app runs at
`http://localhost:8080/operator`; the source email is
`/operator/inbox/pd7w8vv98e3jrhfzeyzp3kk53d8h68bk`.

Dependencies: GitHub Packages initially rejected UI download. Downloaded the exact
UI 0.21.0 source tag through authenticated GitHub and packed it locally; its npm
tarball SHA-1 exactly matched package-lock (`f2016392650e2c8af10877e7f35b74f5f9bbcb1d`).
Caching that exact tarball allowed the ordinary locked dependency install to finish;
package.json/package-lock were unchanged. Local backend email delivery is capture mode.

Resumed after the user unlocked the Mac. No additional defects required code changes.
Selection-switch draft caching, multi-operator conflict presentation, and a full
keyboard menu sweep were not separately exercised; revision rejection was verified
through the signed API. The initial memory script reports only free pages on macOS;
`memory_pressure -Q` reported 40% system-wide available memory before resumed QA.

PR preparation: rebased onto remote main `a1987a97`; post-rebase TypeScript
and scoped ESLint passed. No tests or dev database migrations added.

Sender-name styling refinement: restored the original body-medium text and inline
spacing on the shared menu trigger, with no pill or chevron. Helium confirmed the
plain name still opens the same contact menu; scoped ESLint and whitespace checks
passed. Keyboard focus indication is retained.
