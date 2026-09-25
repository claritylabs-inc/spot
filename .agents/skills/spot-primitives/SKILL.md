---
name: spot-primitives
description: "Use before adding or changing Spot shared UI, feature flags, model routes, extraction helpers, workflows, agent tools, auth helpers, notification channels, or cross-cutting backend libraries."
---

# Spot primitives

Search the current owners before creating another abstraction:

```bash
rg "<concept|route|component|table|helper>" AGENTS.md components convex lib hooks app imessage-worker
```

Reuse the module whose contract already owns the behavior. Read [AGENTS.md](../../../AGENTS.md) for boundaries and [AGENT_TOOLS.md](../../../AGENT_TOOLS.md) before changing a model-callable or MCP tool. Update those inventories in the same change.

## UI and documents

- `components/ui/markdown-editor.tsx` owns inline Markdown editing; `convex/markdownDocuments.ts` and `convex/lib/markdownDocument.ts` own safe persistence, ownership, size limits, and revision checks. Company wiki and procurement `private.md`/`public.md` are ordinary Markdown with optional YAML front matter. Typed workflow and authorization fields stay typed. Front matter never grants access. Issued snapshots remain immutable; active packet links show current saved shared content.
- `components/ui/pill-button.tsx` owns pill actions and client navigation. Use `variant="destructive"` on destructive actions. Operator pages use app-shell breadcrumbs, `TabsList variant="pill"`, and compact label/value rows.
- `components/chat/` owns shared chat rendering and composition. `lib/chat-presentation.ts`, `lib/chat-presentation-catalog.ts`, `convex/lib/chatPresentationCandidates.ts`, `convex/lib/chatPresentationComposer.ts`, and `convex/chatPresentations.ts` own generated presentations; composition cannot execute business tools. Avoid another chat component system.
- `lib/extraction-state.ts` owns extraction status presentation. The operator policy Sections tab lives at `app/policies/[id]/policy-sections-tab.tsx`. Keep a single re-extraction action in each applicable UI.
- Browser WebMCP uses `lib/flags.ts` flag `webmcp-enabled`, default off, with `WEBMCP_ENABLED` and Vercel `FLAGS_SECRET`; definitions live in `lib/webmcp/definitions/` and the catalog in `lib/webmcp/catalog.ts`.

## Extraction and search

- Policy and proposal extraction run in Convex. `convex/lib/pdfText.ts` and `convex/lib/pdfSourceSpans.ts` own pdf.js positioned text; `convex/lib/policySectioning.ts` plans sections; `convex/lib/sectionExtraction/` owns durable per-section jobs; `convex/lib/citationResolver.ts` resolves citations. Scanned pages use model-transcription evidence spans. Declarations provide an early preview; final promotion requires `convex-sections-v1` through `convex/lib/extractionPromotion.ts`.
- The cl-sdk extraction engine is unused. Do not add chunking, `documentChunks` retrieval, an extraction worker, LiteParse, Poppler, OCR, or a preview queue. Agent search uses Convex full-text search plus Jev ranking in `convex/lib/policySearch.ts` and `convex/lib/policyLookup.ts`. See [section extraction](../../../docs/architecture/convex-section-extraction.md).

## Models and tools

- All generation, decisions, embedding, transcription, and credentialed retrieval use cl-router through `CL_ROUTER_URL` and `CL_ROUTER_SECRET`. Spot stores no provider keys or fallback transport. `convex/lib/clRouterClient.ts` owns transport, and `convex/routerJobs.ts`, `convex/lib/routerJobClient.ts`, and `convex/actions/routerJobs.ts` own durable jobs. Unknown outcomes cannot replay an inference step.
- `clRouterDecide` provides Jev Choice/Noul decisions; `convex/lib/jevThreshold.ts` centralizes the 0.7 threshold. Use known candidates and fail closed below the threshold. Prompt-injection screening is safe only at 0.7 safe confidence. `convex/lib/clientAgentPrompt.ts` chooses client prompt modules, answer depth, and Slack reaction. `convex/lib/channelControls.ts` owns email, Slack, and certificate endorsement intent. Email send authorization is persisted on the message.
- `convex/lib/operatorAgentToolRegistry.ts` owns operator tools and tool families; `expand_tools` expands families selected by Jev. `convex/lib/operatorMcpToolCatalog.ts` projects operator MCP. `convex/lib/tenantMcpToolCatalog.ts` projects the shared tenant catalog. Keep effect, role, OAuth scope, exact approval, and target authorization aligned with execution. The operator global Approve all setting applies to new exact approvals only.
- `scan_workspace_mailbox` is a read-only operator tool. Scheduled Google Workspace scans and reconciliation are retired; agent-scheduled workflows are tracked in Linear CLA-171. Presence cleanup is unscheduled (CLA-170).
- The operator-agent model and web retrieval route have no UI or supported `npx convex run` setter. Their stored overrides are cleared after deployment by `modelSettings:clearOperatorModelOverridesInternal`; `resolveOperatorAgentRoute` still throws without a stored explicit `operator_agent` route, so resolve this conflict before live cleanup. Follow the [post-deploy checklist](../../../AGENTS.md#post-deploy-operator-checklist-for-this-extraction-release).
