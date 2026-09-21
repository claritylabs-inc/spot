# Generated chat presentations

Operator and client web chats share generated presentations without a feature flag. Completed assistant text remains visible. Presentations add evidence-backed comparisons, facts, requirements, dates, records, citations, files, and explicit follow-up controls. Other channels keep their existing text responses; historical messages are not recomposed.

## Evidence and composition

`convex/chatPresentations.ts` captures bounded, allowlisted results from successful read tools. Temporary `chatPresentationEvidence` rows retain the originating actor/run and expire after 24 hours. They are presentation inputs, not canonical business records. Business tools execute through their existing authorization and approval paths.

`convex/lib/chatPresentationCandidates.ts` converts these concrete results into typed candidates. Policy facts and dates come from policy records, compliance states and reasons come from saved findings, client procurement comes from the shared request DTO, and proposal/provider detail remains operator-only. Missing or stale evidence stays uncertain. Truncated candidate sets carry a visible partial-result notice.

`convex/lib/chatPresentationComposer.ts` uses the native experimental composer in pinned `@json-render/core` 0.21.0. Its evaluator calls `clRouterDecide` through authenticated `/v1/decide`; there are no provider keys or alternate transports. At most two bounded decisions select from supplied candidates. Only a finished, validated composition is accepted. The model does not generate executable code, invent record references, or receive a write-action catalog.

The shared catalog in `lib/chat-presentation-catalog.ts` contains 15 components: Stack, Section, Text, FactList, ComparisonTable, RecordList, FindingsList, RequirementMatrix, DateList, SourceReference, FileReference, ChoiceGroup, RecordSelector, ClarificationForm, and ActionGroup. Text supports Markdown. `lib/chat-presentation.ts` owns the versioned envelope, reference registry, strict component props, and limits: 96 KiB, 24 elements, depth four, and 80 references. Dynamic bindings, arbitrary actions, unknown props, disconnected trees, cycles, and invalid references are rejected. `convex/lib/chatPresentationValidators.ts` supplies storage validators.

## Completion and access

Composition is scheduled after a successful web-chat answer. Failure or abstention leaves that answer intact and never replays a business tool. Both message tables store an optional presentation and revision. Save checks the originating actor, completed run, current access, references, and revision; cancelled or superseded work cannot replace the current result.

Message queries reauthorize saved references with a bounded per-query budget. Access removal hides the presentation. Policy sources resolve against their policy, request files retain request-specific grants, connected requirements retain their existing relationship boundary, and provider citations must match saved public research sources. Server-normalized destinations and existing authorized preview/download APIs own navigation. A provider URL cannot become an arbitrary external action.

`components/chat-presentation/` renders the shared catalog in both chat surfaces. Comparison and record rows support keyboard inspection, with source actions in the drawer. Filtering and sorting are local. Forms retain failed drafts, prevent overlapping sends, and submit ordinary chat messages through existing conversation APIs. They do not mutate business records or bypass operator exact approval, Approve all, or tenant approval rules. Client policy/requirement selections reuse existing typed message references.

## Tool contracts

`lookup_client_requests` uses the existing client-visible request DTO, bounded and scoped to the agent's readable organizations. It excludes proposals, private notes, market activity, and signed file URLs. `lookup_compliance_requirements` includes typed saved status/reasons while preserving its readable text. Policy source lookup returns the resolved policy ID alongside its evidence results. These tools remain useful on text-only channels.

## Validation

Focused tests cover schema rejection, evidence grounding, composer failures, persistence and stale revisions, access revocation, request-file grants, client/private boundaries, follow-up validation and failed-send recovery. Browser fixtures exercise all components in light/dark themes, narrow rails and mobile widths, including a 30-row comparison and keyboard source inspection. Live local acceptance and final check results are recorded in the implementation handoff; local validation does not deploy production.
