# Router generation streaming inventory

Audited `origin/main` at `23cf9916` on October 23, 2026. Branch:
`perf/stream-router-generations`.

Every currently eligible user-facing generation already streams. This packet
records the call-site inventory and validation; it makes no runtime changes.
Prompts, models, pins, routing, retries, and authorization remain unchanged.

## Transport owners

Paths below are relative to the repository root. A generation helper's name
does not determine its wire transport: `postJson` delegates to `executeJob`
when supplied. Existing web agents use that delegation to stream through durable
jobs even though their AI SDK entry point is `generateText` / `doGenerate`.

| Call site | Consumer / who waits | Current transport | Incremental output / decision |
| --- | --- | --- | --- |
| `convex/lib/clRouterClient.ts`: `clRouterGenerate`, `clRouterGenerateManual`, `clRouterGenerateMaybeManual` | Shared generation callers | `/v1/generate` or `/v1/manual` JSON; `executeJob` instead submits `/v1/jobs` | Keep both; callers determine whether progress has a recipient. |
| `convex/lib/clRouterClient.ts`: `clRouterGenerateStream`, `clRouterGenerateManualStream`, `clRouterGenerateMaybeManualStream` | AI SDK streaming adapter | `/v1/generate/stream` or `/v1/manual/stream` SSE; with `executeJob`, reconstructs events from the completed result | Direct SSE already implemented. Production web progress uses job callbacks independently of these reconstructed SDK events. |
| `convex/lib/clRouterLanguageModel.ts`: `doGenerate` | Agent model calls | Shared JSON helper with injected durable executor | Web consumers already receive progress while the SDK awaits completion. Keep. |
| `convex/lib/clRouterLanguageModel.ts`: `doStream` | Streaming SDK consumers | Shared SSE helper | Supports text, tool calls, done metadata, and errors. No application caller currently invokes `streamText`; adding it would not improve existing durable web progress. |
| `convex/lib/models.ts`: `agentLanguageModel` | Client/operator agents, attachment readers, history compaction | `/v1/jobs`, generate/manual operation | Passes `streamTarget` to the job executor; enables progress only for a supplied target. Keep. |
| `convex/lib/models.ts`: `generateAgentTextForOrg`, `generateAgentTextForPublicTask`, `generateAgentTextForOperatorTask` and their `getAgentLanguageModel*` resolvers | Agent entry points | Resolve routes and call the shared language-model adapter | Org/operator consumers are inventoried below; public agent helper has no application callers. Keep. |
| `convex/lib/models.ts`: `generateTextForOrg`, `generateTextForPublicTask` | Plain-text helper consumers | Durable generate/manual jobs | Complete result contract; org helper used by operational smoke, public helper has no application callers. Keep. |
| `convex/lib/models.ts`: `generateObjectForOrg`, `generateObjectForPublicTask` | Structured consumers below | Durable generate/manual jobs; allowlisted bounded local intake calls can use synchronous JSON | Schema validation and downstream decisions require completion. Keep. |
| `convex/lib/sdkCallbacks.ts`: `makeGenerateText`, `makeGenerateObject` | cl-sdk callbacks | Durable jobs with a context; synchronous generate/manual JSON without one | Text factory has no application callers; object factory serves extraction. Keep. |
| `convex/lib/sectionExtraction/sectionJobs.ts`: `runSectionJob`, `runProposalQuoteTermsJob` | Extraction orchestrators | Durable generate/manual jobs with yielding | Schema validation, citation grounding, and promotion consume completed objects. Keep. |

`CL_ROUTER_URL` / `CL_ROUTER_SECRET` references outside these generation owners
configure workspace credentials, health/capabilities, asset signing, or durable
control requests. They introduce no additional generate/manual call sites.
Contract-check endpoint strings are fixtures, not inference calls. Decide,
extract, browse, retrieve, embed, and transcribe operations are outside this
generation inventory.

## User-facing agent paths

| Call site | Who waits | Current transport | Incremental output / decision |
| --- | --- | --- | --- |
| `convex/actions/processThreadChat.ts`: `runAgentTurn` (web) | Client web chat, shared dock/extension chat | Durable job with `streamTarget: agentMsgId` | Already streams cumulative text to the processing message. Keep. |
| Same call (Slack) | Slack user | Durable job without stream target; completed channel delivery | Existing delivery path sends the completed reply. Keep terminal delivery. |
| `convex/operatorAgentRunner.ts`: `generateAgentTextForOperatorTask` (web) | Operator web chat | Durable manual job with message stream target | Already streams. Unresolved tool recovery deliberately withholds text until it is suitable for an answer. Keep this guard. |
| Same call (email, Slack, iMessage, MCP) | Operator on the respective channel | Durable manual job; channel delivery or queued JSON/status result | No partial answer forwarding in these transports. Keep. |
| `convex/lib/channelAgentRunner.ts`: completed-tool synthesis | Client web/channel user waiting for a final answer after tools | Inherits the parent run's durable executor and stream target | Web synthesis already streams; other channels remain terminal. Keep. |
| `convex/actions/handleInboundEmail.ts`: `runAgentTurn` | Email sender | Durable job, then complete email | Email delivery requires a complete message. Keep. |
| `convex/actions/handleInboundImessage.ts`: `runAgentTurn` | iMessage sender | Durable job, then complete message | Existing sender consumes the final answer. Keep. |
| `convex/actions/mcpChat.ts`: `runAgentTurn` | Tenant MCP / HTTP assistant caller | Durable job, then JSON result | MCP `ask_spot` in `convex/http.ts` awaits the complete tool result; `/api/ask` also returns JSON. Neither forwards text deltas. Keep. |
| `convex/operatorAgentRunner.ts`: planning model call | Operator waiting for a plan and execution | Durable manual job, structured output | Complete plan validation precedes persistence and business tools. Keep. |
| `convex/lib/emailTools.ts`, `convex/lib/operatorEmailTools.ts` | User waiting for a draft card | No separate generation call: body/subject arrive as completed tool arguments from the parent agent | Preserve validated tool execution and saved-draft card rendering. Tool-argument generation is excluded from conversion. |

The web path is already end to end:

1. The caller supplies its processing message as `streamTarget`.
2. `agentLanguageModel` passes the target to `executeDurableRouterRequest`.
3. `routerJobClient` submits `/v1/jobs` with `stream: true`, preserving the
   generate/manual operation, exact request, and selected pin.
4. The router sends cumulative progress to the existing capability `resultUrl`.
5. `convex/routerJobs.ts` validates the callback and updates message content.
6. Convex subscriptions feed the shared `components/chat/chat-message.tsx`
   renderer. Stream responses defaults on; explicit opt-out hides partial text.

See [the durable protocol](../architecture/router-jobs.md#web-response-streaming).
Switching these agents to direct SSE would replace their durable ownership and
reconnection semantics without adding incremental display.

## Completed-output consumers

All entries remain unchanged. “Jobs” means durable generate/manual operations;
“local JSON” means the bounded `local-inline` branch selected before submission.

| Call site | Who waits / consumes output | Current transport | Why completion is required |
| --- | --- | --- | --- |
| `convex/actions/intakeVehicleSpecifications.ts` | Intake specification suggestions | Jobs; local JSON | Validate and ground structured manufacturer facts. |
| `convex/actions/intakeFollowups.ts` | Applicant at additional questions; background preparation | Jobs; local JSON | Validate question definitions, novelty, and input types together. |
| `convex/actions/intakeCyberResearch.ts` | Intake suggestions | Jobs; local JSON | Ground and score structured proposed answers before applying. |
| `convex/actions/intakeRequirementPrefill.ts` | Upload prefill suggestions | Jobs; local JSON | Validate extracted requirement fields before suggestions. |
| `convex/actions/intakePremiumEstimate.ts` | Applicant's premium estimate | Jobs; local JSON | Validate complete estimate fields. |
| `convex/actions/intakeCompanyResearch.ts` | Applicant's company prefill | Jobs; local JSON | Ground complete claims before prefill. |
| `convex/lib/intakeWorkforcePrefill.ts` | Workforce document prefill | Jobs; requests local-inline for local text-only inputs | Parse and merge structured extraction batches. |
| `convex/actions/proposalReview.ts` | Proposal review / background results | Jobs | Associate validated gap summaries with judged sections. |
| `convex/actions/connectedEmailScan.ts` (two generation calls) | Mailbox scan reasons and attention notifications | Jobs | Validate referenced-email arrays before saving reasons or notifications. |
| `convex/actions/companyResearch.ts`: `generateCompanyResearchObject` | Background company research | Jobs | Complete structured research/prose claims are validated before storage. |
| `convex/actions/complianceRequirements.ts` | Requirement import | Jobs | Parse complete structured requirement rows. |
| `convex/actions/companyInformationExtraction.ts` (two generation calls) | Typed document intake and policy-derived company facts | Jobs | Validate candidates before decisions and company-field promotion. |
| `convex/lib/providerOutreachEmail.ts`: `generateOutreachDraftText` | Automated outreach worker | Jobs | Validate complete subject/body, then compose links/signature and persist; deterministic fallback on invalid output. No partial draft UI. |
| `convex/actions/policyExtraction.ts`: `makeGenerateObject` | Policy extraction eligibility | Jobs | Complete structured extraction/eligibility data. |
| `convex/actions/extractSupplementary.ts`: `makeGenerateObject` | Supplementary extraction | Jobs | Complete structured extraction data. |
| `convex/actions/threadTitle.ts` (client and operator calls) | Background thread naming | Jobs | Validate and persist a complete short title. |
| `convex/actions/clientFileNaming.ts` | Background upload naming | Jobs | Validate complete filename object. |
| `convex/lib/procurementInformationProviderExtraction.ts` | Provider email question extraction | Jobs; requests local-inline in local environments | Validate complete question/evidence objects. |
| `convex/lib/procurementInformationClientExtraction.ts` | Client email answer extraction | Jobs; local JSON | Validate complete answer/evidence objects. |
| `convex/lib/orgWikiExtraction.ts` | Background exchange-to-company-memory extraction | Jobs | Validate complete durable-fact objects before writing. |
| `convex/actions/compactThreadHistory.ts` | Background conversation compaction | Jobs | Commit the complete continuity summary with revision guards. |
| `convex/lib/agentThreadAttachment.ts`: `describeStoredImage` | Parent agent reading an older image | Jobs | Description is tool/context data consumed after completion, not a user-facing answer. |
| `convex/actions/operationalRouterSmoke.ts` | Diagnostic runner | Jobs | Checks completed text, objects, tools, and routing metadata; no user reply target. |

## Failure handling and latency

Existing direct SSE handling validates event framing and metadata. The language
model adapter maps SSE `error` events to `ClRouterRequestError`, rejects premature
EOF without `done`, and wraps failures after visible output in
`ClRouterVisibleOutputError`. The stream transport itself does not retry.

For the active web path, durable progress is display-only. Tools execute only
after the final result. Callback identity, sequence, active-message, cancellation,
and operator-checkpoint guards reject foreign or stale updates. Failed and unknown
jobs fail through the existing job error path; reconnecting uses the same
invocation and never starts a fresh inference for an unknown result.

This packet adds no latency improvement because the qualifying paths already
stream. Their time to first visible text depends on the first router progress
callback and Convex subscription delivery, rather than full-answer completion.
Streaming does not reduce model time to full answer. No live latency benchmark
or browser workflow was run; this is a source audit plus existing automated checks.

## Validation

- Node `v24.22.1`.
- `npm run check:cl-router-contract`: passed, 22 fixtures / 11 operations.
- `npm test -- convex/routerJobs.test.ts`: passed, 8 tests, including progress
  ordering, foreign/stale callbacks, terminal messages, and checkpoint fencing.
- `npm test`: passed, 20 files / 133 tests. Happy DOM printed Google Ads script
  loading diagnostics; the suite exited successfully.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed, zero errors and nine existing warnings in intake UI
  and stored website-tech QA artifacts.
- `git diff --cached --check`: passed.
- No new tests, production commands, PR, or deployment.
