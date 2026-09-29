# Browser background tasks

Spot uses `BackgroundTaskProvider` and `useBackgroundTasks` from
`@claritylabs-inc/ui/components/background-tasks`. `components/background-tasks.tsx`
scopes the provider to the current sync user/organization; `components/providers.tsx`
mounts it above routes. Upload task IDs are scoped to the organization or request.
Route return reads the shared running state and disables duplicate submission.

`hooks/use-policy-upload.ts` owns PDF hashing, duplicate confirmation, storage
uploads, policy registration and extraction handoff for client and operator
policy uploads. Its browser task ends after the backend accepts the handoff,
with an Open policy action that works after the initiating page unmounts.
The previous page-local pending-row tracker could discard readiness tracking as
soon as a placeholder row appeared. Upload completion now explicitly means
“queued for extraction”; it does not claim the policy is ready.

`components/procurement/client-requests-workspace.tsx` uses the same lifecycle for
client request file uploads and attachment registration. Its completion action
opens the request only when clicked. Network calls, authentication, file hashes
and response validation remain in Spot. Progress reports count completed file
uploads and use messages during registration/merge/handoff rather than guessing
an extraction percentage.

Policy/proposal extraction remains durable in Convex. `routerJobs`, the section
extraction pipeline and `components/shared/extraction-banner.tsx` keep their
existing storage/status/cancellation roles. Proposal filing's existing upload
intent/discard cleanup was inspected and remains unchanged. There is no shared
durable runner to extract for these browser operations, and this change does not
modify backend persistence or replay behavior.

Browser tasks survive navigation only while their provider remains mounted.
Reload/tab close may interrupt uploads; the provider requests a native warning
while work is active. Browsers decide whether to display it. Once extraction is
accepted by Convex, it no longer depends on the browser task. There is no refresh
recovery, cross-tab deduplication, automatic retry or generic cancellation.
Settled records/actions expire after 60 seconds. Provider teardown clears toasts
and suppresses late completion callbacks, but cannot abort in-flight network
writes. Consumers must inspect existing results before retrying an ambiguous
outcome. Existing server authorization continues to apply to every write.

PDF rendering is imported from `@claritylabs-inc/ui/components/pdf-viewer` through
Spot's existing viewer path. `components/pdf-context.tsx` uses its shared
`PdfHighlightBox` type. Spot still owns PDF URLs, route resets and its context-based
`components/ui/pdf-panel.tsx` adapter. The shared package pins `react-pdf 10.4.1`
and `pdfjs-dist 5.4.296` together for worker compatibility.

See [the workflow ledger](../testing/workflow-qa.md) for repeatable browser
artifacts and coverage limitations. The shared API and its admin PDF/AEO usage
are documented in clarity-ui's `docs/background-tasks.md`.
