---
name: spot-primitives
description: "Use before adding or changing Spot shared UI, feature flags, model routes, extraction helpers, workflows, agent tools, auth helpers, notification channels, or cross-cutting backend libraries."
---

# Spot primitives

Search the current owners before creating another abstraction:

```bash
rg "<concept|route|component|table|helper>" AGENTS.md components convex lib hooks app
```

Reuse the module whose contract already owns the behavior. Read [AGENTS.md](../../../AGENTS.md) for boundaries and [AGENT_TOOLS.md](../../../AGENT_TOOLS.md) before changing a model-callable or MCP tool. Update those inventories in the same change.

## UI and documents

- `components/ui/markdown-editor.tsx` owns inline Markdown editing; `convex/markdownDocuments.ts` and `convex/lib/markdownDocument.ts` own safe persistence, ownership, size limits, and revision checks. Company wiki and procurement `private.md`/`public.md` are ordinary Markdown with optional YAML front matter. Typed workflow and authorization fields stay typed. Front matter never grants access. Issued snapshots remain immutable; active packet links show current saved shared content.
- `components/ui/inline-fields.tsx` owns editable label/value row cards, including optional card headers and nested coverage item cards. `components/ui/remove-button.tsx` owns quiet gray X removal actions for on-page collection items; keep accessible labels and existing removal/confirmation owners.
- `components/ui/table.tsx` wraps the shared table. Record tables sort by clicking headers: `SortableTableHead` plus `useTableSort` (`hooks/use-table-sort.ts`, the shared clarity-ui hook with followed state); sort after filtering and render `tableSort.rows`.
- `components/ui/list-toolbar.tsx` `ListToolbar` owns list toolbars: pill view tabs, clarity-ui `FilterBar` filters (`FilterDefinition[]`: simple ones `inline` as chips, the rest in the two-pane Filters menu), search and actions, with followed popover state. Do not build ad-hoc filter Selects or show/hide filter panels.
- `components/ui/pill-button.tsx` owns pill actions and client navigation. Use `variant="destructive"` on destructive actions. Operator page views use app-shell breadcrumbs, shared `TabsList variant="navbar"` (42px, neutral borders, slightly rounded top corners) in the navbar, and compact label/value rows. Keep breadcrumbs left, tabs right, and page-wide actions in the navbar. Selected-view controls stay in their panel; local field groups use 36px `TabsList variant="folder"`; keep local modes and chart controls on existing variants. `AppTopBar.navigation` is optional. `OperatorClientSwitcher` owns previous/next-client routing, disabled boundaries and j/k shortcuts, using shared `PageNavigation` for presentation.
- `components/chat/` owns shared chat rendering and composition. `lib/chat-presentation.ts`, `lib/chat-presentation-catalog.ts`, `convex/lib/chatPresentationCandidates.ts`, `convex/lib/chatPresentationComposer.ts`, and `convex/chatPresentations.ts` own generated presentations; composition cannot execute business tools. Avoid another chat component system.
- `lib/extraction-state.ts` owns extraction status presentation. The operator policy Sections tab lives at `app/policies/[id]/policy-sections-tab.tsx`. Keep a single re-extraction action in each applicable UI.
- Browser WebMCP uses `lib/flags.ts` flag `webmcp-enabled`, default off, with `WEBMCP_ENABLED` and Vercel `FLAGS_SECRET`; definitions live in `lib/webmcp/definitions/` and the catalog in `lib/webmcp/catalog.ts`.

## Extraction and search

- Policy and proposal extraction run in Convex. `convex/lib/pdfText.ts` and `convex/lib/pdfSourceSpans.ts` own pdf.js positioned text; `convex/lib/policySectioning.ts` plans sections; `convex/lib/sectionExtraction/` owns durable per-section jobs; `convex/lib/citationResolver.ts` resolves citations. Scanned pages use model-transcription evidence spans. Declarations provide an early preview; final promotion requires `convex-sections-v1` through `convex/lib/extractionPromotion.ts`.
- The cl-sdk extraction engine is unused. Do not add chunking, `documentChunks` retrieval, an extraction worker, LiteParse, Poppler, OCR, or a preview queue. Agent search uses Convex full-text search plus Jev ranking in `convex/lib/policySearch.ts` and `convex/lib/policyLookup.ts`. See [section extraction](../../../docs/architecture/convex-section-extraction.md).

- Browser analytics is owned by `lib/analytics.ts` and `components/analytics.tsx`, initialized by `instrumentation-client.ts`. Reuse its typed structural events and preserve masking; never export answers, document contents, or access tokens. See `docs/architecture/product-analytics.md`.

## Models and tools

- Operator Slack alerts have separate categories, routes, authorization and outbox in `operatorNotifications.ts`, `actions/operatorNotifications.ts` and `lib/operatorNotify.ts`; client notification routing stays in `notificationSlack.ts` and `lib/notify.ts`. Reuse `lib/slackWebApi.ts` for transport/channel probes, `slackErrors.ts` for provider errors, `slackDelivery.ts` for send-result assertions, and `slackMessage.ts` for formatting primitives. Operator approval cards belong in `operatorSlackBlocks.ts`; client cards remain in `slackBlocks.ts`. Do not combine tenant and operator audience rules.
- All generation, decisions, embedding, transcription, and credentialed retrieval use cl-router through `CL_ROUTER_URL` and `CL_ROUTER_SECRET`. Spot stores no provider keys or fallback transport. `convex/lib/clRouterClient.ts` owns transport, and `convex/routerJobs.ts`, `convex/lib/routerJobClient.ts`, and `convex/actions/routerJobs.ts` own durable jobs. Unknown outcomes cannot replay an inference step.
- `clRouterDecide` provides Jev Choice/Noul decisions; `convex/lib/jevThreshold.ts` centralizes the 0.7 threshold. Use known candidates and fail closed below the threshold. Prompt-injection screening checks all supplied instructions, with regexes as audit signals. External email/iMessage/Slack require safe confidence at the configured threshold; outages remain retryable (email throws, iMessage responds temporarily unavailable without completing its event, Slack uses ingress retries). Unsafe Slack verdicts fail terminally. First-party web/MCP block confident unsafe verdicts but fail open on unavailable/invalid screening with `failOpen: true` in the audit. There is no security review queue. `convex/lib/clientAgentPrompt.ts` chooses client prompt modules, answer depth, and Slack reaction. `convex/lib/channelControls.ts` owns email, Slack, and certificate endorsement intent. Email send authorization is persisted on the message.
- `convex/lib/operatorAgentToolRegistry.ts` owns operator tools and tool families; `expand_tools` expands families selected by Jev. `convex/lib/operatorMcpToolCatalog.ts` projects operator MCP. `convex/lib/tenantMcpToolCatalog.ts` projects the shared tenant catalog. Keep effect, role, OAuth scope, exact approval, and target authorization aligned with execution. The operator global Approve all setting applies to new exact approvals only.
- `scan_workspace_mailbox` is a read-only operator tool. Scheduled Google Workspace scans and reconciliation are retired; agent-scheduled workflows are tracked in Linear CLA-171. Presence cleanup is unscheduled (CLA-170).
- Generation uses `text` or `reasoning` with router-inferred capabilities and no explicit `requirements`. Every step routes by default; only explicit optional pins use `/v1/manual`. Live capabilities detect stale pins; confirmed unknown-route rejections before execution can fall back once using a stable durable `:routed` invocation. Never replay unknown outcomes or streams with output. Native retrieval derives model IDs from capabilities. `modelSettings:clearOperatorModelOverridesInternal` clears all global/broker pins, including `operator_agent`; the optional setter is `modelSettings:setOperatorAgentRouteInternal`.
