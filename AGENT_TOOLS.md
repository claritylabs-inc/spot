# Agent and MCP tool inventory

This reference lists the tools that Spot exposes to its operator agent, tenant-facing conversational agent, internal agent subagents, and OAuth MCP clients. It describes the current executable catalogs; it does not include deterministic controls, ordinary Convex functions, REST routes, or browser actions that are not model-callable or MCP-callable tools.

Spot supplies the tools active on each router step in `request.tools`; an empty array means no tools. `convex/lib/agentToolSelection.ts` selects available families through Jev, retains used or expanded families, assembles guidance, and falls back to all available families on failure or timeout. `expand_tools` requests additional families for the next step without changing business records. Definitions carry name, description, and JSON input schema. Before each operator step, `getRunContextInternal` validates the active operator/thread and filters the registry by role, impersonation, and configured Google Workspace, Slack, Mapbox, and MCP access. Exact target authorization and approval are rechecked at execution; a tool's availability cannot authorize an arbitrary target. Family selection narrows the offered catalog; Spot does not force a business tool with `toolChoice`. Router-owned Jev selects among the offered tools or abstains, the generation model fills arguments, and Spot executes the calls. Operator generation uses this router selection too; Spot no longer forces `toolSelection: caller`.

`clRouterDecide` uses authenticated `/v1/decide` for typed Jev Choice/Noul decisions, with native probabilities and request-bound response validation. Classifications for forwarded-email direction, requirement import intent, certificate-holder matching and endorsement eligibility, carrier identity, compliance manual review, public company identity, policy intake, mailbox automation, Workspace PDF acceptance, intake question relevance/novelty (including exact-use-scoped vehicle/fleet inapplicability in `convex/actions/intakeVehicleRelevance.ts`), description-based industry suggestions, follow-up input primitive selection, Continue-triggered additional-question gates and evidence-based Boolean prefills, and prompt-injection screening use this path. Extraction and prose remain generation tasks; legacy classification/security generation settings remain schema-compatible but are not active UI routes. SDK generation callbacks reject classification instead of silently using generation. The chat policy-evidence classifier, deterministic completed-lookup check, and recovery generation are removed. Normal tool selection handles evidence retrieval; incomplete tool responses may still receive a tool-free final synthesis that cannot replay actions.

## Operator approval policy

Operator Settings (`/operator/settings`) owns one global **Approve all** switch,
shared by every operator and off by default. `operatorAgentSettings` stores the
setting; only active operators outside impersonation may change it, through the
portal API (never an agent tool or MCP tool). With it enabled, all new exact-gated
operator tool calls—including external sends, access/global changes, and
destructive actions—receive automatic fingerprint-bound approval and execute
without pausing the tool loop. The shared `requestOrExecuteToolInternal` path
serves web, email, Slack, iMessage, and operator MCP. Role, OAuth write scope,
impersonation, preflight/source validation, cancellation, idempotency, and audit
checks remain enforced. Automatic approval is recorded on the existing
confirmation ledger and shown as Auto-approved; action execution rechecks the
current global switch. Existing pending confirmations still require a decision;
disabling the switch restores manual approval for new calls. Tenant approvals
are unchanged. References below to exact confirmation describe the default
manual mode; the global switch can satisfy that gate automatically.

## Inference execution

Operator tools run between durable router model steps. Pending inference yields
and resumes the same job; completed tool effects retain their existing idempotency
keys. Exact messages and the selected model route survive operator continuation.
Cancellation blocks subsequent tools and revokes the pending inference job.
Worker-loss outcomes are explicit and never cause automatic tool or model replay.
These lifecycle controls are internal, not new agent or MCP tools.

## Source owners and maintenance

- Operator-agent tools are defined only in `convex/lib/operatorAgentToolRegistry.ts`. `convex/lib/operatorMcpToolCatalog.ts` projects that registry into operator MCP and adds operator-run lifecycle tools.
- Shared tenant conversational tools are defined in `convex/lib/chatTools.ts` and executed by `convex/lib/agentToolExecutors.ts` plus `convex/lib/vendorComplianceTools.ts`. Policy lookup treats nullable optional filters as omitted, including the expiry window, before applying exact policy IDs and tenant scope.
- Channel-specific tenant tools are assembled in `convex/actions/processThreadChat.ts`, `convex/actions/handleInboundEmail.ts`, `convex/actions/handleInboundImessage.ts`, and `convex/actions/mcpChat.ts`.
- `convex/lib/channelAgentRunner.ts` owns shared conversational turn execution, tool-outcome auditing, and tool-free synthesis of incomplete responses. Web, Slack, email, iMessage, and MCP retain channel-local ingress, authorization, persistence, and delivery. Normal router tool selection handles policy lookups; there is no separate policy-evidence classifier, completed-lookup gate, or evidence-recovery generation.
- Discrete email tools and their shared executors live in `convex/lib/emailTools.ts`; no nested email model loop remains. The discrete mailbox family and shared account search/evidence helper live in `convex/lib/mailboxTools.ts`; every operation runs in the parent agent.
- Tenant OAuth MCP tools and their read/write, open-world, destructive, and idempotency metadata are defined together in the shared projection and compatibility metadata in `convex/lib/tenantMcpToolCatalog.ts`.
- MCP `tools/list` rechecks organization membership (`convex/mcpPrincipal.ts`) and filters the business catalog by principal and OAuth scope via `convex/lib/mcpCatalogScope.ts`. Client principals receive the tenant catalog allowed by their read/write scope; providers receive no tools; operators receive the registry filtered by operator role and scope. The server continues to enforce the authenticated principal and scope on every call. There is no MCP UI resource or workspace-launcher tool.
- MCP OAuth revocation accepts form-encoded access or refresh tokens (and legacy Bearer access tokens), invalidates the stored token pair, and rejects a supplied mismatched client ID before any change.
- MCP Events definitions and allowlisted filters/payloads live in `convex/lib/mcpEventCatalog.ts`. `convex/lib/mcpEventHttp.ts` exports the structural authenticated-principal adapter and `{ events: {} }` capability for endpoint composition; `convex/mcpEvents.ts` owns subscription authorization and the durable outbox, and `convex/actions/mcpEvents.ts` owns encrypted secrets, callback verification, and signed delivery. These are subscription protocol methods, not business-write tools.

When any source above adds, removes, renames, or materially changes a tool, update this inventory in the same change. Availability, capability, effect, required role, confirmation policy, execution boundary, and MCP access changes count as material.

## MCP Events

`events/list` discovers authorized webhook events. `events/subscribe` creates or
refreshes a deterministic, principal/client/resource-scoped subscription after
callback verification. `events/unsubscribe` idempotently revokes that matching
subscription. All three require a current read-scoped OAuth connection; they do
not grant write access, execute business tools, or satisfy exact approvals.
CLA-179 owns MCP 2.0 `server/discover` negotiation and endpoint composition.

The catalog exposes `compliance.status_changed`, `vendor.policy_expiring`,
`policy.ready`, `policy.review_required`, `procurement.request_updated`, and
operator-only `proposal.review_ready`. Domain mutations enqueue only matching,
allowlisted identifiers and transition labels. Client-hidden procurement
changes and private proposal content never reach tenant event payloads.
Compliance events reflect existing monitor cadence, not live carrier updates.

Delivery rechecks membership/operator activity, OAuth connection, target access,
expiry, and subscription generation. Callback validation is HTTPS/public-IP
only, with pinned DNS, no redirects, signed constant-time challenge verification,
a bounded verification cache, and safe `-32015` callback errors. A dedicated
32-byte base64 `MCP_EVENTS_ENCRYPTION_KEY` protects signing secrets. Settings
list only the owning actor's origin/scope/expiry and allow revocation. See
`docs/architecture/mcp-events.md` for limits and the unrun ChatGPT smoke workflow.

## Operator agent registry

Operator steps use the shared family selector with the existing 14-family catalog (including `outbound_email`). Starter intents keep their shortcuts; resumed durable steps offer all available families, and tools used or expanded earlier in the run remain loaded. Operator MCP continues to expose its complete authorized catalog. The `expand_tools` control exposes additional families on demand and is not a business write; the registry still rechecks role, integration, exact target, and approval at execution. Command email without available raw-message authentication carries a durable `emailReadOnly` restriction: only read tools are selected, external MCP is excluded, and every execution path rechecks the restriction. The reply may draft wording, but cannot create saved drafts or perform writes and sends. For authenticated command email, the final answer is also delivered automatically. Outbound email tools require a separately requested email action; a reply-only or no-change request must not save a draft. Procurement email tool argument names remain supported, but their IDs refer only to `teamEmailThreads`; legacy storage IDs no longer resolve.

The [operator activity icon inventory](docs/design/operator-tool-icons.md) groups
every operator tool by its browser activity icon. Web research records a bounded
target label at execution start: a hostname for one site, or up to ten public
site URLs for overlapping favicons and a website count. Generic queries keep a
short readable label. Setup traces retain factual outcomes (loaded tool groups,
configured model, planning decision and plan size); identical completed outcomes
are grouped only in the UI. These are observed activity metadata, not model
reasoning. Router callbacks still accept only their existing stage/name contract.

Submitted company facts live in `organizations.intakeBusinessProfile` and request facts in `intakeSubmittedApplication`; research and authored notes remain company Markdown. `update_client_business_profile` is the preferred exact-approved operator tool for company-field edits and document imports. Read `get_organization` or `lookup_client_wiki` first for `businessProfile.submittedAt` (0 if absent); supply `expectedVersion` and only changed typed answers/details. Omitted fields are preserved; supplied addresses, revenue objects and lists replace that whole field. It shares the profile editor’s operator-only, impersonation-protected, revision-checked writer and leaves submitted request snapshots and Markdown untouched. `update_organization_profile` accepts only name and website; `get_organization` returns identity, research status, the client’s typed business profile and its best-effort `websiteTech` scan (detected payment, hosting, email and SaaS signals plus quoted vendor/region disclosures from the company’s own pages, and `websiteTech.browse.skills`: up to 40 browser procedure outcomes such as email verification, each with name, version, `succeeded`/`blocked`/`failed`/`skipped` status, a redacted summary and step count; absent on older scans or when the router reported none). Operator and tenant policy lookups and COI generation use policy evidence and policy overrides, with no company-profile fallback. `update_client_wiki` / `write_company_wiki` edit prose only; they cannot amend submitted application facts. `lookup_client_wiki` includes the typed business profile, and procurement request reads include the accepted structured application. Application amendments use owner intake edits and resubmission.

Spot-owned brands and domains represent Spot. Provider registration, profile updates, outreach, proposal filing, review confirmation, and selection reject those identities at preflight and execution; provider directory/search results exclude existing matching rows. Exact `get_organization` reads label historical matching rows `spot`. Records and history remain stored; this classification never grants operator access.

Operator attachment intake has no file-count cap across web, email, Slack,
iMessage, and MCP. Per-file, aggregate-byte, channel transport, and emitted
router-asset budgets still apply; `run_operator_task` accepts attachment arrays
without a count restriction.

Operator email confirmation replies preserve the current exact approval and
waiting run; approval still requires the portal controls. Quoted email history
is not a new operator instruction, and forwards nested in that history are not
fresh source messages. The read-only `scan_workspace_mailbox` tool excludes Spot Operator's own outgoing summaries from collected evidence.

The operator registry is defined in `convex/lib/operatorAgentToolRegistry.ts`. Writes require an exact, fingerprint-bound confirmation except for the registered private attachment-filing action (`add_client_file`). Exact-confirmed tools run the shared reference preflight in `convex/lib/operatorAgentConfirmationPreflight.ts` before the confirmation is shown, and the write revalidates the same references at execution. Registry schemas expose executable ACORD LOBCd, ISO country and US state/Canadian province enums plus ISO dates, email addresses, HTTP(S) URLs, replacement-list semantics, and explicit omit-versus-null guidance instead of relying on prose guesses. `mutation` and `action` identify the Convex execution boundary, not whether the operation writes data. The versioned browser/agent procurement parity contract lives in `convex/lib/procurementCapabilities.ts`.

Operator web chat, authenticated inbound email, iMessage, and the internal Slack adapter all enqueue into the same operator runner, which registers this complete registry without a channel-specific tool allowlist. iMessage voice notes pass through the shared inbound-turn preparation handler before entering that runner, so their labeled transcripts receive the same tools and confirmation policy as typed operator messages. Each channel still keeps its own transport authentication, identity resolution, thread persistence, and attachment ingestion. For Slack, customer connection and Slack Connect binding resolution takes precedence, and every invocation still requires an active operator profile linked to the exact host-workspace Slack identity; Convex applies no channel allowlist, type, privacy, sharing, or membership gate after that identity is resolved. Operator MCP exposes the same registry and executes the same service-backed tools, so “Slack agent” behavior is Spot-agent behavior rather than a Slack-only catalog. Procurement forwarding email is ingested deterministically into the same canonical request/email/artifact records before the agent reads it, rather than granting the tenant email agent access to operator-private proposals.

Operator command email uses the shared `agent@team.spot.insure` inbox. Its Resend thread ID maps to a private operator conversation after active-operator resolution and aligned full-body DKIM verification of original MIME from Receiving. Explicit authentication failures reject the message. Only unavailable raw MIME permits a durable read-only run; writes, sends, saved drafts and external MCP calls remain blocked after continuation. Responses go only to the resolved operator's canonical login address. Legacy `operator(+t)@agent.spot.insure` addresses retain their authenticated path. Quoted senders, copied recipients and unverified Reply-To addresses never gain access, and email replies cannot approve exact writes. Delivery retries the frozen response rather than the tool loop.

| Tool                                       | Purpose                                                                                                                 | Capability                      | Effect           | Role     | Confirmation | Execution |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---------------- | -------- | ------------ | --------- |
| `web_search` | Research public companies or retrieve public URLs with source links and provider diagnostics; uses global web retrieval settings with Parallel/Exa fallbacks. | `operator.web.read` | read | operator | none | action |
| `search_organizations`                     | Search customer and provider organizations and resolve exact IDs.                                                         | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `get_organization`                         | Read organization identity, research outcome and website tech scan; legacy Spot-owned provider rows return type `spot`.                                | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `list_operators` | List operators with exact user ID, name, email, role and status, to resolve an operator before setting a client assignee. | `operator.platform.read` | read | operator | none | mutation |
| `get_operator_overview`                    | Read compact platform, policy, extraction, and operator-run counts.                                                     | `operator.platform.read`        | read             | operator | none         | mutation  |
| `list_company_mailboxes`                   | Discover configured company Gmail mailboxes with bounded pagination.                                                   | `operator.company_email.read`   | read             | operator | none         | action    |
| `search_company_email`                     | Search company Gmail with mailbox provenance, continuation, and explicit partial failures.                              | `operator.company_email.read`   | read             | operator | none         | action    |
| `read_company_email_thread`                | Read bounded original email bodies and attachment references in an exact mailbox.                                      | `operator.company_email.read`   | read             | operator | none         | action    |
| `get_company_email_attachment`             | Read an original Gmail attachment and return it privately in the operator conversation.                                | `operator.company_email.read`   | read             | operator | none         | action    |
| `scan_workspace_mailbox` | Scan an authorized company Gmail mailbox on demand for up to 30 days and return up to 25 candidates per page with a signed `nextCursor` (Gmail page token) while matches remain; makes no writes. | `operator.company_email.read` | read | operator | none | action |
| `list_policies`                            | List or search policies for one organization.                                                                           | `operator.policies.read`        | read             | operator | none         | mutation  |
| `lookup_policy`                            | Retrieve rich current policy summaries using policy evidence only; no company-profile fallback.                                                                  | `operator.policies.read`        | read             | operator | none         | action    |
| `compare_coverages`                        | Compare two policies' coverages, limits, deductibles, and premium.                                                      | `operator.policies.read`        | read             | operator | none         | action    |
| `lookup_policy_section`                    | Search a final policy's source-native hierarchy and PDF evidence.                                                       | `operator.policies.read`        | read             | operator | none         | action    |
| `attach_policy_document`                   | Attach a final policy's original PDF to the operator response.                                                          | `operator.policies.read`        | read             | operator | none         | action    |
| `confirm_policy_fact`                      | Confirm a source-backed policy fact; always ground the claimed fact plus each field, accepting support from any bounded evidence chunk, and report rejectedFields.                                                | `operator.policies.write`       | reversible write | operator | exact        | action    |
| `lookup_compliance_requirements`           | Retrieve saved insurance requirements and typed saved compliance findings for one client.                                                                   | `operator.compliance.read`      | read             | operator | none         | action    |
| `list_operator_conversations` | Page through your own or every operator conversation (all are visible to operators), with creators, including archived conversations. | `operator.threads.read` | read | operator | none | mutation |
| `read_operator_conversation` | Read complete newest-first message pages from another accessible operator conversation. | `operator.threads.read` | read | operator | none | mutation |
| `search_thread_history`                    | Search older messages in the current operator conversation, optionally within a UTC `dateFrom`/`dateTo`; returns `{matches, nextCursor, bounded}`.      | `operator.threads.read`         | read             | operator | none         | action    |
| `read_thread_attachment`                   | Reopen an attachment returned by operator thread-history search.                                                        | `operator.threads.read`         | read             | operator | none         | action    |
| `list_client_files`                        | List a client's files, provenance, visibility, and policy links.                                                        | `operator.client_files.read`    | read             | operator | none         | mutation  |
| `read_client_file`                         | Read bounded content from a client file, including private files.                                                       | `operator.client_files.read`    | read             | operator | none         | action    |
| `attach_client_file`                       | Attach a client file to the operator response, including private files.                                                 | `operator.client_files.read`    | read             | operator | none         | action    |
| `lookup_client_wiki`                       | Read client or supplier company .md content, front matter, revision, and proposals; private files remain operator-only.                                                     | `operator.wiki.read`            | read             | operator | none         | mutation  |
| `update_client_wiki`               | Replace client or operator-private supplier company .md content with YAML front matter and an expected revision.                                                  | `operator.wiki.write`           | reversible write | operator | exact        | mutation  |
| `lookup_procurement_packet`                | Read the request’s `private.md` and `public.md`, including Markdown, visibility, and revisions.                                              | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `preview_broker_packet`                    | Preview the shared provider-market packet and request-wide released artifacts.                                            | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `list_broker_packet_links`                 | List live packet content/file counts, issuance revision, expiry, delivery, revocation, and view state.                                     | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `update_procurement_packet`        | Replace `private.md` or `public.md` with full Markdown, matching visibility, and an expected revision; saved public.md changes immediately update all active packet links; public.md prose outside the generated application block shows as Submission notes. | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `list_procurement_requests`                | List procurement request workflow records for one client; read prose through the packet files.                                              | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_procurement_request`                  | Read one exact request; unlinked intake returns operator-only draft facts, progress and bounded Slack delivery events, without capabilities or fulfillment access. Company-linked requests include provider, file, policy and email state.                                             | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `list_procurement_proposals`               | List operator-private proposal offers for one exact request.                                                            | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_procurement_proposal`                 | Read a private proposal (full document) or up to 10 via `procurementProposalIds` (`{items, notFound}`, compact view: offer headlines and Markdown, no file URLs; `view` overrides). | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `list_broker_network_profiles`             | Search supplier providers by status, including blacklisted, writing state, or exact ACORD LOBCd.                          | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `get_broker_network_profile`               | Read one provider's profile, portal contacts, operator-only networkContacts with roles, coverage context, notes and sources, market history, and persisted research evidence/outcome.                                                | `operator.organizations.read`   | read             | operator | none         | mutation  |
| `get_procurement_forwarding_address` | Get or provision the caller's team forwarding address and return the request's legacy address as a fallback. | `operator.email.write` | reversible write | operator | none | action |
| `list_procurement_email_threads` | Read bounded shared team conversations linked to one procurement request. | `operator.procurement.read` | read | operator | none | mutation |
| `get_procurement_email_thread` | Read a shared team conversation through its current or migrated legacy ID, with bounded messages, or up to 10 via `procurementEmailThreadIds` (`{items, notFound}`, compact view: newest 5 messages, trimmed bodies, no file URLs; `view` overrides). | `operator.procurement.read` | read | operator | none | mutation |
| `list_team_inbox_threads` | Page shared team mail with combined client, request, mine, unlinked, category and archive filters; return cursors and scan bounds. | `operator.email.read` | read | operator | none | mutation |
| `get_team_inbox_thread` | Read a linked or unlinked conversation, bounded messages, owner, attachments and draft metadata, or up to 10 via `teamEmailThreadIds` (`{items, notFound}`, compact view as above; `view` overrides). | `operator.email.read` | read | operator | none | mutation |
| `link_team_inbox_thread` | Link a conversation and its held attachments to an exact client or request; reject conflicting clients and outreach moves. | `operator.email.write` | reversible write | operator | exact | mutation |
| `preview_procurement_email_reconciliation` | Match an imported email's canonical attachments to exact outreach contacts.                                             | `operator.procurement.read`     | read             | operator | none         | mutation  |
| `get_policy_status`                        | Read one policy's extraction, source-tree, reconciliation, and archive state.                                           | `operator.policies.read`        | read             | operator | none         | mutation  |
| `lookup_address`                           | Validate and standardize a postal address through Mapbox.                                                               | `operator.addresses.read`       | read             | operator | none         | action    |
| `list_extraction_issues`                   | List policy and proposal extraction errors, work, and expired leases by domain.                                         | `operator.extractions.read`     | read             | operator | none         | mutation  |
| `get_routing_status`                       | Read invocation logs, errors, unknown outcomes and operator-pinned routes, or exact `callId` metadata; no prompts, response bodies or credentials.                                             | `operator.routing.read`         | read             | operator | none         | mutation  |
| `get_channel_health`                       | Read Slack and connected-email health without secrets or message content; `problemsOnly` filters rows, and `section` with `cursor`/`limit` pages one list when the scan is bounded. | `operator.channels.read`        | read             | operator | none         | mutation  |
| `send_operator_slack_message`              | Send an exact-confirmed direct Slack message to an active, host-workspace-linked operator.                              | `operator.channels.write`       | external send    | operator | exact        | action    |
| `draft_email` | Draft from the caller's team address and signature, optionally linked to a client, request or team conversation; never sends. | `operator.email.write` | reversible write | operator | none | action |
| `update_email_draft` | Replace and re-sign an unsent draft as the caller; removed copies and attachments clear, Always CC remains, and prior approval expires. | `operator.email.write` | reversible write | operator | none | action |
| `attach_policy_pdf_to_draft` | Attach an explicitly requested original policy PDF to an unsent draft. | `operator.email.write` | reversible write | operator | none | action |
| `attach_client_file_to_draft` | Attach one active stored file of the draft's client organization (for example a certificate filed by `generate_coi`) to an unsent draft. Family `outbound_email`. | `operator.email.write` | reversible write | operator | none | action |
| `list_email_drafts` | List this conversation's email drafts as compact rows (id, subject, to, status, updatedAt, attachmentCount), filtered by status, client, request, team thread or `createdByMe`, with `nextCursor`; `view: "full"` returns whole drafts. | `operator.email.read` | read | operator | none | action |
| `send_email_draft` | Send one draft after the operator approves the complete email (recipients, subject, attachments, body). | `operator.email.send` | external send | operator | exact | action |
| `cancel_email_draft` | Cancel one unsent draft from this conversation. | `operator.email.write` | reversible write | operator | none | action |
| `retry_failed_policy_extraction`           | Queue a fresh full extraction for one failed or idle policy.                                                            | `operator.extractions.write`    | reversible write | operator | exact        | mutation  |
| `generate_coi`                             | Generate certificate PDFs from a policy or requirements source.                                                         | `operator.certificates.write`   | reversible write | operator | exact        | action    |
| `import_policy_files` | Import selected conversation or client-file PDFs into an exact client policy library, combined or separate, with extraction scheduling and content deduplication. | `operator.policies.write` | reversible write | operator | exact | action |
| `add_client_file`                          | File an operator-thread attachment privately in a client's file library.                                                | `operator.client_files.write`   | reversible write | operator | none         | mutation  |
| `update_client_file`                       | Rename a client file or change its visibility or policy association.                                                    | `operator.client_files.write`   | reversible write | operator | exact        | mutation  |
| `create_procurement_request`               | Create a request, seed `public.md` from initial narrative, and prepare forwarding/sharing; optionally record a reported external placement. | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_request`               | Update request workflow fields, policy links, or reported external placement; edit prose through `update_procurement_packet`.             | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `file_procurement_proposal`                | Atomically file canonical artifacts or conversation attachments and queue extraction.                                   | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `file_procurement_email_quote`             | Atomically file an imported email's canonical attachments, all or a chosen subset.                                      | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `archive_procurement_proposal`             | Archive a proposal or delete a truly empty draft.                                                                       | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `retry_procurement_proposal_extraction`    | Retry failed or expired proposal extraction with preserved attempt history.                                             | `operator.extractions.write`    | reversible write | operator | exact        | mutation  |
| `cancel_procurement_proposal_extraction`   | Cancel pending/running proposal extraction and return it to draft.                                                      | `operator.extractions.write`    | reversible write | operator | exact        | mutation  |
| `generate_procurement_proposal_review`     | Generate a source-backed proposal review against the current provider packet.                                             | `operator.procurement.write`    | reversible write | operator | exact        | action    |
| `create_broker_packet_link`                | Replace the one request-wide provider link with a URL serving current shared content and released files.                                      | `operator.procurement.write`    | access change    | operator | exact        | mutation  |
| `rotate_broker_packet_link`                | Revoke a packet link and create a replacement URL serving current shared content and released files.                                                             | `operator.procurement.write`    | access change    | operator | exact        | mutation  |
| `revoke_broker_packet_link`                | Immediately revoke a packet link and its attachment access.                                                             | `operator.procurement.write`    | access change    | operator | exact        | mutation  |
| `confirm_procurement_proposal_review`      | Confirm or override a review bound to the current packet and extraction fingerprint.                                    | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `select_procurement_proposal`              | Select a proposal with a current packet-bound, staff-confirmed passing review.                                          | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `create_broker_network_profile`            | Register a supplier-network provider without users/invites and queue public enrichment.                                        | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `update_broker_network_profile`            | Update a provider profile; explicit edits override research, while identity changes queue fresh enrichment. | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `list_procurement_provider_matches` | Page provider appetite matches and recipients for a request, filtered by verdict, coverage, state or recipient role with `nextCursor` and an honest `bounded` flag; the first page also returns request context, cadence, and sequences. | `operator.procurement.read` | read | operator | none | mutation |
| `launch_procurement_provider_outreach` | Send from the calling operator’s team address with their full-name signature and Always CC; initial emails introduce the accepted applicant by full name, use bounded application-summary bullets and a separate packet section. Exact approval binds the sender identity and selected providers/cadence. Use per-provider packet links. | `operator.procurement.write` | external send | operator | exact | mutation |
| `stop_procurement_provider_outreach` | Stop an exact request's provider outreach or client email sequence and cancel pending follow-ups. | `operator.procurement.write` | reversible write | operator | exact | mutation |
| `list_procurement_client_outreach` | Read current client contacts (portal members and applicant) and bounded client email sequences for a request. | `operator.procurement.read` | read | operator | none | mutation |
| `list_procurement_information` | Read a request's provider outreaches, supplementary questions (scope, answer, requirements, form readiness) and client information forms with fill-in URLs. | `operator.procurement.read` | read | operator | none | mutation |
| `add_procurement_information_questions` | Record up to 20 provider questions for the client on one provider outreach; identical question and scope is reused. Never sends. | `operator.procurement.write` | reversible write | operator | none | mutation |
| `create_procurement_information_form` | Create a client information form (fill-in link) for ready or chosen questions without emailing; prerequisites are added and an identical open form is reused. | `operator.procurement.write` | reversible write | operator | exact | mutation |
| `cancel_procurement_information_form` | Cancel an open client information form; its link stops accepting answers and its email reminders stop. | `operator.procurement.write` | reversible write | operator | exact | mutation |
| `send_procurement_client_email` | Email a listed client contact from the calling operator’s team address, optionally linked to an information form so reminders stop on submission; exact approval covers the signed body, From, Always CC and cadence. Changed sender identity holds unsent mail. | `operator.procurement.write` | external send | operator | exact | mutation |
| `reply_procurement_email_thread`, `reply_email_thread` | Reply as the caller on a shared conversation, with the owner copied when replying from another inbox; stop automated follow-ups. | `operator.email.write` | external send | operator | exact | action |
| `create_procurement_broker_outreach`       | Add a real provider-network organization with contact and status; provider notes belong in `private.md`.                                      | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_broker_outreach`       | Update outreach identity or status; edit provider history in `private.md`, and retain quotes as proposals.                                  | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `create_procurement_file_item`             | Add an existing uploaded client file with a label and independent client/provider visibility; released files appear immediately on existing packet links.                                          | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_file_item`             | Update a file label, replace its underlying uploaded file, or change client/provider visibility; file links cannot be cleared and released files update existing packet links immediately.                                            | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `update_procurement_email_thread`          | Correct an email category or reassign a forwarded thread within its client; provider outreach stays request-bound.       | `operator.procurement.write`    | reversible write | operator | exact        | mutation  |
| `create_client_organization`               | Create a standalone client without provisioning users and return its exact ID.                                          | `operator.organizations.write`  | reversible write | operator | exact        | action    |
| `invite_operator`                           | Invite a company-email Spot operator and send an operator-login link; existing active access is adopted and the invitation resent. | `operator.access.write` | access change | operator | exact | action |
| `update_organization_profile`              | Update only the organization name and website; company details use update_client_wiki.                                                                   | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `research_client` | Queue Jev-orchestrated parallel public research with cited facts, confidence verification, and persisted partial/failure outcomes. | `operator.organizations.write` | reversible write | operator | exact | mutation |
| `research_client_tech_stack` | Queue the best-effort tech-stack research agent (DNS/header signatures, sandbox browser agent with startup-only Browserbase fallback via cl-router `browse`, Jev composite verification) for a client by `orgId` or a prospect `website`; returns the current stored result, including `current.browse.skills` from the previous run. Also available as the Rescan button on the operator Profile Tech stack tab, which shows the same outcomes under Browser research. Skill outcomes describe the browser procedure, not vendor proof; a submitted signup form is not a created account. See `docs/architecture/website-tech-research.md`. | `operator.organizations.write` | reversible write | operator | none | mutation |
| `research_broker` | Queue the same research chain for an external insurance provider (carrier/MGA/wholesaler/agency/producer), selecting each state and ACORD line only above 0.7 confidence; preserve manual profile values and expose evidence through get_broker_network_profile/get_organization. | `operator.organizations.write` | reversible write | operator | exact | mutation |
| `set_client_access_status`                  | Set a client's workspace access to limited or active.                                                      | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `get_client_assignees` | Bulk-read client assignees (responsible operators): exact `orgIds` (up to 100) or all clients (bounded to 500), optionally filtered to one assignee. `get_organization` also returns `assignee`. | `operator.organizations.read` | read | operator | none | mutation |
| `set_client_assignee` | Set a client's assignee to one active operator, or unassign with null; audited as `client_operator_assigned`. | `operator.organizations.write` | reversible write | operator | exact | mutation |
| `set_client_feature_flag`                  | Enable or disable Connect features or iMessage app cards for a client.                                                                      | `operator.organizations.write`  | reversible write | operator | exact        | mutation  |
| `clear_all_agent_memory`                   | Schedule a global purge of company wiki documents only; retain actual conversation history and other document kinds.                                              | `operator.platform.destructive` | destructive      | owner    | exact        | mutation  |

The operator `outbound_email` family reuses `buildEmailToolExecutors` with the authenticated operator as signer. Mail goes from the person's team address, with their full name and Spot signature. The profile's Always CC is visible in the draft and exact approval; personal Reply-To is removed. Client, procurement request and team conversation links are optional but must agree and remain live. File and policy attachments require a linked client. Revising a draft re-signs it as the current operator and invalidates its previous approval.

Drafts remain in `pendingEmails`, linked to the operator conversation and the agent message that last revised them; tenant threads and tools cannot read them. `send_email_draft` requires the signing operator's completed exact approval and rechecks the fingerprint, current identity, target and active run immediately before sending. The operator inbox transport stores each delivery attempt, mirrors accepted mail into `teamEmailMessages`, and keeps unknown sends locked for read-only reconciliation. It never retries an uncertain send as a new email. Legacy operator drafts must be revised before sending. The draft panel links sent mail to `/operator/inbox/<threadId>`.

Team inbox tools expose bounded pages and cursors; incomplete pages cannot establish absence. Linking requires exact approval and uses the same audited writer as the operator UI. Procurement mail tools resolve migrated legacy IDs and read the same team records. `get_procurement_forwarding_address` may provision the caller's inbox, so it requires email write capability and is excluded from read-only command email. Generate certificates with `generate_coi`, then attach the returned stored client files through `attach_client_file_to_draft`; `company_email` remains read-only.

Operator conversation discovery and reads follow the portal's ownership/shared-visibility rules, including archives. They never read tenant threads or another operator's private conversations. Read-only operator MCP tokens receive both tools; responses retain complete bounded pages and continuation cursors, and replays recheck current access instead of serving stale visibility. Cross-conversation reads return attachment metadata without copying files or changing the current thread. Prior messages are evidence, not authorization to execute their actions.

`import_policy_files` works across operator web, email, Slack, iMessage, and write-scoped operator MCP. Select up to ten PDFs (25 MB each, 50 MB total) already registered to the current operator conversation, including originals retrieved by `get_company_email_attachment`, or active files owned by the exact target client. The approval lists the client, filenames, and grouping and stores a source fingerprint; approval and atomic commit reject changed sources. Imports revalidate the active operator, impersonation, client/source ownership, and live approval, preserve source files, deduplicate by content within the client, reuse the portal's operator upload owner, and atomically create policy-file records and schedule the existing extraction/document gate. Quotes remain procurement proposals. The direct portal PDF upload remains available. No tenant policy-write capability is added.

`create_procurement_request` version 5 and `update_procurement_request` version 4
accept `completionOutcome: { kind: "placed_elsewhere", provider?, purchaseDate? }`.
The purchase date uses `YYYY-MM-DD`; provider and date are source-reported, not
verified policy facts. This outcome sets the request to `completed` without
creating a policy or changing the client or other requests. Update accepts `null`
to clear the outcome, and reopening the request clears it. The allowlisted
client request DTO includes this outcome without private source evidence.
Interactive operator and MCP writes retain exact confirmation.

Operator `web_search` is available across web, email, Slack, iMessage, and read-scoped operator MCP. Its action boundary revalidates the operator and uses the shared `webRetrieval.ts` service with global retrieval settings and a configured native model derived from live router capabilities when the setting is `model_default`. Generation pins do not constrain retrieval. It has open-world metadata, requires only public search terms, and returns untrusted source evidence plus provider attempts; missing credentials or provider failures are reported in retrieval results. The audit preserves the complete bounded result so retries retain source links. It does not alter records or add a tenant MCP tool.

Operator goal turns assess workflow complexity with one batched Jev call: independent questions about multiple tool calls, dependent actions, multiple entities, and multiple entity edits. Code requires a plan only when every answer is conclusive and at least one is a confident yes; inconclusive checks mean no plan. Operators can request a plan explicitly with the composer's Plan toggle, which skips the Jev check for that message. A separate durable structured model call creates the plan without business tools, saves it on the run and assistant message, then execution starts. The collapsed Plan disclosure is independent of Show thinking. Plans are proposals, never evidence or authorization. Existing executing runs resume without replanning completed work.

Search contracts are explicit: organization and provider queries target one name/domain; policy and procurement queries use one literal substring, not concatenated targets. `search_organizations` returns `{organizations, matchedInScan, scanned, bounded, scanBounded, limit}`; `list_policies` returns the equivalent `policies` envelope. Neither is an exhaustive listing when bounded. Organization scans cover 500 provider records, up to 500 client plus 500 legacy-client records, or 1,000 unfiltered records, returning at most 25 matches. Policy scans cover 2,000 records and return at most 25 matches. Files, procurement requests and procurement email lists return at most 100 records without cursors. Extraction issue scans are bounded before organization/stuck filtering. Agents must disclose incomplete coverage and never infer absence from a failed or capped search. Google Workspace continuation references must be reused unchanged in their original thread and query; invalid references require restarting the read without a cursor.

Tool validation runs at the execution boundary while preserving provider-visible schemas, so rejected inputs produce structured failure codes and compact field issues before dispatch. Correctable no-write failures receive up to three subsequent model iterations to revise input, refresh authoritative IDs, or use supported alternatives. Recovery state survives durable continuation; unrelated helper reads and repeated errors do not replenish its budget. Exhausted tools stop dispatching for that run. Provisional recovery replies are withheld from streaming and rejected no-tool replies are omitted from continuation history. If those replies exhaust recovery without resolving the failure, the final response uses the structured error codes and guidance instead of the rejected model prose. Authorization/approval restrictions and unknown write outcomes never grant automatic retries. This budget is separate from router transport retries. Saved audit summaries retain failure codes and guidance rather than truncating them behind a long error string.

Update confirmations describe supplied field changes in plain language, including explicit clears and replacement lists. Omitted update fields remain unchanged; null is accepted only on fields whose schema explicitly describes a deliberate clear. Provider profile approvals show saved and proposed values with readable coverage names. Optional `evidence` (source URLs or mailbox/sender/date) remains bound to the exact input but is omitted from the approval summary and is not a provider-profile field. The operator runner stops at its first pending confirmation, blocks later calls in that batch, checkpoints research for resumption, and ignores stale segment completion/failure callbacks after approval resumes the task. Invalid schema and confirmation-preflight results return a structured `failure` with phase, code, recovery guidance, and authoritative `writeState: not_started`, so the model may correct the call in the same task.

Company email uses the global connection configured in Channels → Google Workspace. Every active operator can read every configured mailbox; there are no per-mailbox operator permissions. The action boundary revalidates the operator and connection before delegated Gmail reads. These tools require no confirmation, are available to read-scoped operator MCP clients, and are marked open-world because they query Google. They are absent from tenant/client agents and tenant MCP. Search is live and mailbox-scoped with resumable coverage, not a semantic index or guaranteed global recency order. Registered callers receive short continuation references resolved from the existing action audit only for the same operator, thread, and tool. Reuse the reference unchanged with the same query, filters, and page size; raw signed cursors remain backend-side and retain revision/request validation. Results preserve mailbox/message/thread provenance and report failures or truncation. Attachment metadata uses short message-local `part:` references; retrieval refetches the stated parent and rejects absent or ambiguous parts before using the raw provider ID internally. Attachment retrieval reads Google, extracts bounded content, and uses the existing protected operator-thread attachment owner; it does not create client files, change Gmail, or send mail. The service-account key and access tokens remain backend-only. See [Google Workspace setup](docs/deployment/google-workspace.md).

`scan_workspace_mailbox` is an explicit read-only operator tool. It reads authorized Google Workspace mailboxes and does not create requests, policies, or outbound messages. When Gmail has more matches it returns a `nextCursor` (resolved like the other mailbox continuations; reuse it with the same query, mailbox, dates and limit, and the date window stays pinned). The former scheduled scan and reconciliation APIs are retired; agent-scheduled workflows are tracked in Linear CLA-171.

### Operator MCP projection

Operator MCP exposes registered read tools to read-scoped operator tokens, registered write tools only to write-scoped tokens, and owner-only tools only to owners. `docs/deployment/operator-mcp.md` covers connecting Claude Code, Codex, and Conductor sessions to it. It adds these lifecycle tools outside the operator-agent registry:

An operator conversation permits one live exact confirmation at a time. A competing registered write returns `blocked_by_confirmation` with the existing confirmation and run IDs instead of an MCP error, and the blocked invocation terminates without executing. Pending operator confirmations have no time limit; they remain live until approved, cancelled, or superseded. Approval reruns schema, fingerprint, source, and shared reference preflight before execution. A failed approval-time check, or a domain `NoWriteInputError` raised before any mutation, completes the exact confirmation, preserves its failed audit linkage, and resumes a goal with structured no-write feedback. Any corrected write input receives a new fingerprint and fresh approval. Unexpected write/action outcomes remain unknown and are never automatically replayed; failed pure reads can be corrected within the bounded recovery budget. Already-expired confirmations remain terminal and require a fresh proposal. Slack confirmation handling resolves that exact linked action audit before the resumed task state, preserving its outcome and error on first and repeated clicks; a later task failure does not relabel an earlier confirmed action. Unknown outcomes direct the operator to check task status before retrying, without inventing a cause or claiming execution succeeded or was safe to repeat. Block Kit cards and plain-text fallback share this explanation.

| Tool                      | Purpose                                                                            | Availability        |
| ------------------------- | ---------------------------------------------------------------------------------- | ------------------- |
| `run_operator_task`       | Start or continue a durable multi-step operator task, optionally with attachments. | write scope         |
| `get_operator_run`        | Read an operator run, checkpoint, response, and pending confirmation.              | read or write scope |
| `cancel_operator_run`     | Request cancellation of a queued or active operator run.                           | write scope         |
| `confirm_operator_action` | Approve or reject one exact pending operator action.                               | write scope         |

Operator Slack/iMessage runs that outlast the synchronous request continue through scheduled channel delivery with current-operator validation and the same delivery key. The task itself has no response-wait deadline. New `create_broker_packet_link` and `rotate_broker_packet_link` links remain available until revoked or replaced unless an expiry is explicitly supplied; there is no arbitrary maximum lifetime. Existing stored link expirations are honored.

## Client conversational agent

There is no single client registry equivalent to `OPERATOR_AGENT_TOOL_REGISTRY`. The client agent receives a shared executable tool set and channel-specific additions. In the tables below, **MCP chat** means the model loop behind the tenant `ask_spot` MCP tool, not the full tenant MCP catalog documented later.

Client prompt families are `policy_qa`, `coi`, `compliance`, `policy_change_email`, `email`, `procurement`, `mailbox`, `web_research`, `collaboration`, `history`, and `presentation`. One Jev call selects families, answer depth, and the optional Slack reaction. All authorized tools are registered with AI SDK; `prepareStep` selects `activeTools` and current family guidance. Every surface includes `expand_tools`, which adds the requested available families on the next step of the same turn. Used families remain active. Surface, OAuth, and requirement-import authorization determine availability before selection; expansion cannot grant those permissions. `tool_selection` artifacts record the selection and decision metadata.

### Shared tools

“All channels” means web, Slack, inbound email, iMessage, and MCP chat. Runtime authorization and readable/writable organization scope still apply.

The client Slack adapter accepts direct mentions from any connected-workspace channel where Slack delivers the installed app's events. Channel inventory, privacy, sharing, membership, and support-binding health do not authorize an invocation or its reply; they remain metadata for setup, web-mirror privacy, support routing, and proactive destination selection. The sender must still resolve to the connected client workspace or an active Spot operator.

| Tool                             | Purpose                                                                            | Availability or condition                                                       |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `search_thread_history`          | Search older messages in the current conversation.                                 | All channels; requires a thread.                                                |
| `read_thread_attachment`         | Reopen an older attachment identified by thread-history search.                    | All channels; requires a thread.                                                |
| `lookup_client_requests`         | Read client-visible request stages, dates, shared Markdown, and file metadata through the client DTO. | All client-agent channels; readable client scope only; no proposals, market activity, private Markdown, or signed URLs. |
| `lookup_client_files`            | List or search readable client dropbox files.                                      | All channels; returns only explicitly client-visible files in readable scope.   |
| `read_client_file`               | Read bounded content from one readable client dropbox file.                        | All channels; the file must be explicitly client-visible.                       |
| `attach_client_file`             | Attach one readable client dropbox file to the response.                           | All channels; the file must be explicitly client-visible.                       |
| `lookup_address`                 | Validate and standardize a user-supplied postal address.                           | All channels; Mapbox must be configured.                                        |
| `lookup_policy`                  | Retrieve fresh policy summaries by IDs, text, LOB, carrier, or expiry window.      | All channels.                                                                   |
| `list_policy_versions`           | Read renewal, upload, and re-extraction history for a policy or organization.      | All channels; history family.                                            |
| `list_certificates`              | Read issued COIs, holder details, and issue or reissue history.                    | All channels; COI family.                                                |
| `present_policy_card`            | Select a current-turn resolved policy for rich-card presentation.                  | Web, Slack, and iMessage only.                                                  |
| `lookup_company_context`         | Retrieve durable company-profile facts and preferences, never policy facts.        | All channels.                                                                   |
| `compare_coverages`              | Compare two readable policies side by side.                                        | All channels.                                                                   |
| `lookup_compliance_requirements` | Retrieve saved insurance requirements by topic and scope, including typed saved compliance findings.                          | All channels.                                                                   |
| `create_compliance_requirement`  | Save a typed coverage requirement.                                                 | All channels; write capability, direct admin role, and text-channel confirmation required. |
| `import_requirement_attachments` | Persist and extract server-authorized requirement files from the current message.  | Web, Slack, email, and iMessage only, and only when eligible files are present. |
| `lookup_connected_vendors`       | List connected vendors and compliance status.                                      | All channels.                                                                   |
| `lookup_vendor_policies`         | List policies for a connected vendor.                                              | All channels.                                                                   |
| `lookup_vendor_compliance`       | Retrieve requirement-by-requirement vendor compliance.                             | All channels.                                                                   |
| `lookup_policy_section`          | Search source-native policy hierarchy and exact PDF evidence, with the resolved policy ID.                      | All channels; final policies only.                                              |
| `save_note`                      | Add an explicit stable company fact to the shared company Markdown file.                     | All channels; write permission required.                                        |
| `update_company_wiki`            | Replace the company Markdown or one section with a revision check.                | All channels; exact org, direct admin role, write capability, and text-channel confirmation required. |
| `attach_policy_document`         | Attach the original full policy PDF to the response.                               | All channels; final readable policy and stored PDF required.                    |
| `confirm_policy_fact`            | Confirm a source-backed policy fact; always ground the claimed fact plus each field, accepting support from any bounded evidence chunk, and report rejectedFields. | All channels; final writable policy and exact source spans required.            |
| `generate_coi`                   | Generate or reuse certificates from a policy or requirements source.               | All channels; write permission and final supporting policies required.          |

Shared customer confirmation records for email send/cancel, draft snapshots, multiple-certificate delivery, and requirement imports have no time limit. Exact actor, content, adjacency where required, single-use, and task-reset checks remain enforced. Email review links follow that same lifecycle, and completed email authorizations revalidate the current task epoch before delivery. iMessage inactivity does not reset the task. Signed Slack controls are revoked explicitly instead of aging out.

### Channel-specific root tools

| Tool                                             | Purpose                                                                             | Root-agent availability or condition                                                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `request_human_service`                          | Pause a Slack AI thread and request operator help.                                  | Slack only, when a Slack actor was resolved.                                                                                                             |
| `create_imessage_group_chat`                     | Create a confirmed outbound iMessage group.                                         | Web; iMessage for a linked sender; direct internal email; MCP chat.                                                                                      |
| `web_research`                                   | Retrieve public web facts through the configured provider.                          | Web and Slack; direct internal email; linked-user iMessage; MCP chat.                                                                                    |
| `render_email_preview`                           | Render a durable email draft as PNG or PDF.                                         | Web and Slack only.                                                                                                                                      |
| `search_connected_email`                         | Search connected IMAP accounts.                                                     | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `read_connected_email`                           | Read one connected-mailbox message.                                                 | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `read_connected_email_attachment`                | Read a supported connected-email attachment.                                        | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `import_connected_email_policy_attachments`      | Import policy PDFs from a connected email.                                          | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `import_connected_email_requirement_attachments` | Import requirement content from a connected email.                                  | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `send_connected_vendor_invite`                   | Send a user-authorized connected-vendor invitation.                                 | Web/Slack, direct internal email, linked-user iMessage, MCP chat, and tenant MCP.                                                                          |
| `extract_policy_attachment`                      | Start extraction for one policy represented by one or more inbound PDF attachments. | Inbound email only.                                                                                                                                      |

For tenant MCP chat, the OAuth token's write scope filters the actual nested executable catalog. Read-only `ask_spot` calls exclude email writes, `save_note`, `confirm_policy_fact`, `generate_coi`, `update_company_wiki`, `create_compliance_requirement`, iMessage creation, connected-email imports, and vendor invitations. Read-only mailbox access includes search, message reads, and attachment reads. Imports, both thread-save tools, and vendor invitations require write scope.

### Email family

| Tool | Purpose |
| --- | --- |
| `draft_email` | Persist recipient direction, To/CC/BCC, subject, and body as a draft. |
| `update_email_draft` | Replace the exact draft, clearing removed copies and attachments and invalidating its approval. |
| `attach_policy_pdf_to_draft` | Add an available original policy PDF from authorized policy scope. |
| `attach_file_to_draft` | Add a file available in the current conversation. |
| `attach_coi_to_draft` | Generate or reuse a COI through the existing endorsement and evidence gates. |
| `list_email_drafts` | List drafts in authorized organization/thread scope. |
| `send_email_draft` | Send or queue an authorized draft; otherwise retain it and return its confirmation prompt. |
| `cancel_email_draft` | Cancel an authorized draft. |

The operator agent also exposes these tools (minus the conversation-file and COI attachment tools, plus `attach_client_file_to_draft`) through its `outbound_email` family; see the operator registry. Email tools are available on web/Slack with a send-capable identity, direct internal email, linked-user iMessage, and write-scoped MCP chat. Copies, recipient direction, known contacts, attachment kinds, original-policy evidence, duplicates, and COI batch approvals are validated in shared executors. `send_email_draft` reads the stored `emailSendAuthorization` on the current actor-bound user message and applies `jevProceeds`; absent, failed, negated, or low-confidence decisions cannot send. Existing fingerprint-bound confirmation and review-link delivery paths remain authoritative. Direct MCP send actions retain their explicit-action authorization; conversational `ask_spot` never receives it. Email style uses the shared `channelStyle.ts` constants in family guidance. Failed requested attachments remain a send blocker across turns; a successful retry clears its failure within the turn, while a later turn must explicitly replace the draft to revise those attachment requirements. Read-only MCP chat can list drafts.

### Mailbox family

All eight tools run directly in the parent agent on web/Slack, direct internal email, linked-user iMessage, and MCP chat. Tenant MCP exposes the same tools. Searches fan out across accessible accounts, respect selected account scope, and return account failures alongside bounded results. Search logs are deterministic; evidence includes only email references subsequently used by read, attachment, import, or save tools.

| Tool                                             | Purpose                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| `search_connected_email`                         | Search selected or accessible mailboxes.                            |
| `read_connected_email`                           | Read a matching message.                                            |
| `read_connected_email_attachment`                | Read a supported attachment.                                        |
| `import_connected_email_policy_attachments`      | Import policy PDFs.                                                 |
| `import_connected_email_requirement_attachments` | Import requirements from attachments or email body.                 |
| `save_connected_email_attachments_to_thread`     | Save reusable message attachments into the parent thread.           |
| `save_connected_email_message_to_thread`         | Export the message itself into the parent thread as an `.eml` file. |
| `send_connected_vendor_invite`                   | Send an explicitly requested vendor invitation.                     |

Read-only tenant MCP chat registers only the first three tools. Both save tools use the current conversation thread; direct tenant MCP calls must supply an accessible `threadId`. Private threads remain restricted to their creator. Saved files can be reused by the shared email tools.

`coordinate_mailbox_task` has been removed from tenant MCP. External clients should use the discrete mailbox tools; no compatibility alias or nested model loop remains.

## Tenant OAuth MCP catalog

`convex/lib/tenantMcpToolCatalog.ts` projects shared client tool definitions into MCP names, JSON schemas, OAuth scopes, and annotations. `convex/actions/tenantMcpTools.ts` executes direct shared tools with the same tenant scope as agent chat. Existing policy, vendor, and `ask_spot` names retain their compatibility handlers. Email draft names project the shared email tools through adapters that preserve external schemas and response shapes, including batch sending and the text draft list. Deprecated aliases advertise their replacement in `tools/list`; legacy response adapters preserve the old shapes where the shared result differs. The catalog effect is checked before dispatch; resource authorization is checked by the executor. `ask_spot` passes the token's write capability to the shared client catalog.

| MCP tools | Access |
| --- | --- |
| `ask_spot`, `list_policies`, `get_policy`, `get_policy_pdf`, `search_policies` | read; `ask_spot` can invoke nested writes only with write scope |
| `list_email_drafts` | read |
| `draft_email`, `update_email_draft`, `send_email_draft`, `send_email_drafts`, `cancel_email_draft` | write; sends are open-world |
| `list_connected_vendors`, `get_connected_vendor`, `list_connected_vendor_policies`, `list_vendor_compliance` | read |
| `lookup_policy`, `lookup_company_context`, `lookup_client_requests`, `lookup_client_files`, `read_client_file`, `compare_coverages`, `lookup_compliance_requirements`, `lookup_connected_vendors`, `lookup_vendor_policies`, `lookup_vendor_compliance`, `lookup_policy_section`, `lookup_address`, `web_research` | read; `web_research` is open-world |
| `list_certificates`, `list_policy_versions` | read; issued COIs with holder/version history, and policy version history |
| `save_note`, `confirm_policy_fact`, `generate_coi`, `update_company_wiki`, `create_compliance_requirement` | write |
| `search_connected_email`, `read_connected_email`, `read_connected_email_attachment` | read |
| `import_connected_email_policy_attachments`, `import_connected_email_requirement_attachments`, `save_connected_email_attachments_to_thread`, `save_connected_email_message_to_thread` | write |
| `send_connected_vendor_invite` | write; open-world |
| `list_my_policies`, `get_org_info`, `read_company_wiki`, `list_client_files`, `get_client_file`, `list_insurance_requirements`, `get_policy_stats`, `list_policy_certificates`, `list_certificate_holders`, `list_certificate_versions` | deprecated read aliases |
| `generate_policy_certificate`, `write_company_wiki`, `create_insurance_requirement` | deprecated write aliases; write scope required |

`list_threads` and `get_thread_messages` remain retired. `search_thread_history` searches excerpts in the active conversation; it cannot reproduce `get_thread_messages`' complete message list for an arbitrary thread ID. The other former direct names above remain available as deprecated aliases. `list_policy_versions` is now the shared policy history tool under its original name.

## Browser WebMCP tools

`lib/webmcp/catalog.ts` and `lib/webmcp/definitions/*` define the WebMCP tools
Chrome agents can call in the Spot web app when Vercel flag `webmcp-enabled` is on (`WEBMCP_ENABLED`, `FLAGS_SECRET`). `docs/architecture/webmcp.md` describes the runtime; `/llms.txt` is generated from the
catalog. Declarative signup, login, and onboarding forms include: `request_signup_code`, `verify_signup_code`,
`request_login_code`, `verify_login_code`, `submit_user_profile`,
`submit_company_profile`, and `finish_onboarding`. OTP verification stays
mandatory. Imperative client tools cover
policies, certificates, compliance, requests, shared files, agent threads and
drafted email, mailbox review items, notifications, connections, organization
settings, team, agent channels, company wiki, workflow and notification
settings, integrations, mailboxes, beta features, and the personal profile.
Public token tools cover shared packets, shared email reviews, and vendor invitations.

Effect and access:

- Every tool executes its action directly with no confirmation step. That
  includes `send_email_draft`, `send_email_drafts`, `send_shared_email_draft`,
  invitations, removals, and deletions, the same as clicking in the UI.
- Each tool calls the public Convex function the UI calls, under the same
  session or page-token authorization, so it can do nothing the user cannot do.
  `readOnlyHint` marks exactly the `list_*`, `get_*`, and `search_*` tools.
  `consequentialHint` marks external sends, AI-cost, and irreversible actions,
  and does not block.
- Client tools register only for onboarded customer accounts in live client
  orgs, never for operators or during impersonation, and only on their pages.
  Admin-only UI actions register only for org admins.
- Client members upload policies (`upload_policy`) and archive, restore, or
  cancel extraction for their own uploads (`archive_policy`, `restore_policy`,
  `cancel_policy_extraction`).
- Actions clients cannot perform are not exposed: editing policy fields,
  answering extraction review, and archiving staff-added policies; file
  management; request editing and proposals; agent email handle edits; Slack
  channel creation; and organization reset.

## Markdown frontends and MCP boundaries

- Company knowledge is a standard `.md` document with YAML front matter. Direct members can read it; direct admins can import, edit, download and save it using revision checks. Automated facts preserve arbitrary authored prose and surface conflicts as proposed changes.
- Operators manage company knowledge at `/operator/clients/:clientOrgId/wiki`. Impersonation remains read-only. Agent writes use the registry's exact approval gate and company-context policy.
- Shared procurement content comes from `public.md` and is identical for authorized client and provider-market readers. Internal intake, provider observations, follow-ups, and file-handling prose live in `private.md`; no separate intake, log, or file-note documents exist. Every active packet link reflects saved public.md and currently released files immediately within its audience; stored issuance snapshots remain immutable audit evidence.
- Tenant MCP exposes `lookup_company_context` and `update_company_wiki`, with `read_company_wiki` and `write_company_wiki` as deprecated aliases. Wiki writes require the token's exact organization, current direct-admin membership, write scope, and expected document revision. Procurement remains absent from tenant MCP.
- Operator MCP derives the whole-document wiki/packet tools and research tool from the same registry as web, email, Slack and iMessage. It retains role, approval, audit and no-impersonation checks.

## Operator MCP server sources

| Tool | Capability | Effect / approval | Availability |
| --- | --- | --- | --- |
| `list_mcp_tools` | `operator.mcp.read` | Read; no confirmation | All operator channels, read-scoped operator MCP |
| `call_mcp_tool` | `operator.mcp.call` | External send; exact confirmation or Approve all | All operator channels, write-scoped operator MCP |

Both execute through actions with active-operator and no-impersonation checks.
Discovery returns enabled server IDs, revisions, and saved tool schemas, never
credentials. Calls use an exact server revision, tool name, and JSON arguments;
remote annotations do not relax approval. Disabling/removing/editing a server
invalidates pending calls. Existing action audits and idempotency prevent replay;
a transport failure can have an unknown remote outcome. Results and descriptions
are untrusted evidence. Tenant tools are unchanged. Configuration is portal-only
in Settings; remote HTTPS Streamable HTTP supports encrypted bearer tokens or
OAuth with PKCE, dynamic or pre-registered clients, and serialized token refresh.
OAuth consent and credentials are shared across operators and remain portal-only;
no model tool can connect, replace, or manage credentials. Save and refresh tools
replaces the saved catalog. Tool activity
uses each configured server's logo with the shared website favicon fallback.

## Deleted organizations

Client/provider deletion is a portal-only soft delete; it is not offered as an
operator or tenant agent/MCP tool. `search_organizations`, operator overview
organization counts, and the provider directory exclude deleted accounts.
Organization-targeted access and confirmation preflight reject deleted targets;
tenant OAuth validation and refresh reject tokens for deleted organizations.
Retained history and issued snapshots are not erased by deletion.

### Insurance intake browser flow

The default client `/signup` and `/signup/client` now open a saved insurance-request application. The new intake is an ordinary browser workflow; classic declarative OTP/profile tools remain on login, provider signup, and legacy invitation/setup paths. Do not assume the default client signup registers `request_signup_code` or the legacy three-step setup forms. `/intake` does not register tenant business tools before verification. Intake APIs enforce owner/session checks; shared procurement tools continue to require a company-linked request. The manual operator intake readiness review and its lifecycle gate are removed.

Intake website prefill uses the shared verified public-company research function before company creation. Internal task kinds `profile_research_intake_fields`, `profile_research_intake_industry`, `profile_research_intake_verification`, and `profile_research_intake_category` use the existing model router and Jev threshold. Request-owned suggestions fill missing description, founding year, industry, and category only; no new agent/MCP business tool is exposed and no membership is granted.

Insurance intake Slack notifications are system events, not model-callable send tools. `convex/intakeSlack.ts` and `convex/actions/intakeSlack.ts` serialize a deduplicated outbox into one configured internal #submissions thread per request. Step progress never mentions the channel; successful submit/resubmit events use @here. Delivery reuses the operator Slack transport and durable send-receipt idempotency, with bounded retries and request leases.

Insurance application and intake lookup uses the existing operator procurement family. `list_procurement_requests` exposes submission timestamps and intake answers for an exact authorized client; compare `intakeSubmittedAt` for recency and read `get_procurement_request` for coverage details. Drafts are not submissions, and bounded client searches must not be described as exhaustive.

Procurement file attachment defaults to provider `attached` when omitted; callers can explicitly choose `hidden` or `listed`. Client visibility is independent. Deleted requests are unavailable to normal procurement tools and shared packet links. Browser-only operator Delete/Undo actions require a direct operator and retain audit/evidence records; these are not additional agent tools.

`preview_broker_packet` and active shared packet links include current confirmed supplementary answers, grouped by coverage and restricted to the linked provider's active requirements (request-wide links include active requirements across providers). Draft edits, unsure/blank answers, archived or inapplicable questions, provider source emails and internal provenance are excluded. Supporting files keep their independent release and outreach scope. Viewing a packet does not record email delivery of an answer; issued snapshots remain unchanged.

Company Markdown writes do not use a word blacklist to classify content. Insurance terminology, contact email addresses, and references to documents are valid prose. Authorization, exact approvals, revision checks, Markdown/front-matter validation and size limits remain enforced; tool guidance directs policy terms and workflow state to their proper records. Automatic extracted facts retain length and organization-association checks.

Company Markdown update preflight checks the current document revision before creating or approving an exact confirmation. Stale input is a recoverable no-write result: reread `lookup_client_wiki`, merge into the current document, then propose the corrected update. Storage revision conflicts also identify `document_revision_changed` as a no-write failure.

Operator procurement application corrections use `update_procurement_application` in both the operator agent and operator MCP registry projection. Read `get_procurement_request` first, then send `expectedRevision`/`expectedUpdatedAt` plus changed `answers` and/or typed `details`. Omitted values are preserved; supplied nested objects and arrays replace that whole field. Coverage/limits, addresses, locations and revenue are edited in `details`, not derived answer strings. The tool shares the direct operator application editor’s authorization, impersonation guard, revision checks, validation, canonical application projection and audit path. Exact approval remains required; applicant consent is never manufactured. Use `update_procurement_request` for title, lifecycle and policy links, and `update_procurement_packet` for prose.

`create_procurement_file_item` accepts optional `documentCategory` (`requirements`, `policy`, `loss_runs`, `supporting`) to place attachments in their application section. Operator-created uploads from Insurance history are classified as policy documents; Request details uploads are supporting documents. Legacy intake files retain their upload category.

Prompt-injection screening checks every supplied instruction; regex matches are audit signals. First-party web/MCP requests block confident injection verdicts and fail open on unavailable or invalid screening, recording `failOpen: true`. External email, iMessage and Slack require screening before actions: email outages throw for delivery retry, iMessage outages return “temporarily unavailable, please try again shortly” without completing the event, and Slack outages retry through ingress failure handling. Actual unsafe Slack verdicts are terminal failures, not retries or a review queue. Historical Slack context that cannot pass screening is omitted.


Typed procurement application `details.drivers` holds request-scoped driver
schedules (identity, optional licensing/experience/history fields). Existing
`update_procurement_application` revision/authorization/exact-approval rules and
whole-array replacement semantics apply. Driver schedules do not promote into
the company business profile. Follow-up generation receives redacted birth dates
and license identifiers; authorized application views retain the entered values.

Commercial-auto quote intake collects freight hauled and approximate current value per vehicle (optional currency) in fixed steps 41–42 before the driver schedule. The retired uninsured-reason step 43 redirects to the existing claims-history step 23. Typed details (`freightHauled`, per-vehicle `estimatedValue`, `noCurrentInsuranceReason`) persist in accepted applications, review/export, Slack summaries, and both model stages’ answered/skipped question history. UI cursor `autoVehicleIndex` is excluded from submission-change comparison. Legacy scope notes remain saved but their redundant intake textarea is hidden.

Catalog adapter v5 binds vehicle, driver, location and property questions to known typed subjects before deterministic coverage-pack selection. Subjects without typed records are omitted rather than merged into one yes/no answer. Typed money uses currency; scoped prompts do not request identifiers through Boolean/dropdown controls. Catalog-authored Boolean child questions carry server-approved `conditions` (questionId/answer), appear on a separate page only when the same subject’s parent matches, and clear obsolete child answers when parents change. Saved skipped child history is retained; server saves enforce exact condition definitions and reject entered inactive answers. Review/export hides inactive children. The uninsured-reason question is retired (legacy step 43 redirects to claims step 23); its old typed field remains readable and reserved against AI re-asking. Intake presentation substitutes the saved legal business name (DBA fallback) into generic business/company wording without mutating approved definitions.

Intake review uses shared row primitives for follow-up answers and driver summaries. `lib/intake-submission.ts` shares final validation between review completion links and server submission. `activeIntakeDetails` omits dormant driver/freight data when commercial auto is removed and omits quote details for savings, while retaining the editable draft for recovery. Coverage limit facts already owned by fixed questions are excluded from catalog selection even when blank or unsure. Baked coverage packs are bounded to 120 questions, generated batches to 40, with 160 saved/reserved questions overall; conditional groups fit together or are omitted. Finalization rechecks current capacity, token and context. Failed/unknown outcomes never replay automatically. Only the current approved batch appears on ordinary forward navigation; historical questions remain editable from review.

Additional questions prepare provisionally during insurance history. A prepared batch exposes no answer controls and cannot authorize saves. Section entry screens current original base and catalog facts; generated answers never recursively trigger more questions. Only changed base/catalog facts or uploads invalidate the terminal list. Failed/unknown outcomes do not replay automatically. Empty or unavailable batches skip their introduction and question page directly to review, preserving saved answers.

Intake question generation supports `routes` alongside existing answer primitives: an ordered sequence of up to eight city stops with a map preview and optional maximum travel distance. Route questions must not request unrelated vehicle/driver facts. The catalog transport-routes adapter and generated follow-ups share this control; question history supplies readable city sequences and distance so novelty screening does not re-ask the same route facts.


Standard Coverage questions come from reviewed IDs in `docs/procurement/acord-intake/coverage-question-packs.json`, projected by `lib/intake-coverage-questions.ts` and the shared `lib/intake-acord-questions.ts` adapter. No runtime ACORD Jev selection or question fetch is required. Typed coverage, industry, subject and parent-answer gates determine applicability; specialized tail/extended-reporting elections are excluded from initial quote packs. Conditional child definitions are approved up front, and saves compare condition fields independent of object key order. Final generated questions remain a separate bounded terminal pass. Applicant choice questions with fewer than eight options use the shared large radio controls; larger sets use shared Select primitives.

Coverage review has no Other coverage details subsection. Property identity, address, activities, occupancy, staff and scoped catalog answers share one named location row card, using the common review primitives. General catalog answers appear directly under Coverage. Saved inactive child answers remain hidden.

The retired `eo.terms.extended_reporting` question is hidden by shared follow-up visibility, including historical answers in draft/review/export; saved history remains intact and does not prevent saves. Coverage review sorts catalog answers in pack order under their owning coverage before named location cards. Location subheadings use `heading.micro`, and question navigation keeps general coverage terms before each grouped location subsection.

Intake input helpers add the owner-authorized `actions/intakeFollowupInputs:vehicleBodyType`
action (make/model/year only; no VIN), with a confidence-gated Jev Choice and blank-only
client merge. `actions/intakeCyberResearch:run` is an internal scheduled pipeline,
not a new agent/MCP tool: routed public retrieval, bounded LLM fact extraction and
atomic Jev evidence verification. Research stores private request-owned proposals;
`requestIntake.save` verifies exact proposal provenance and existing owner/revision
checks. No background process directly writes applicant answers. Local text-only
`intake_cyber_fact_extraction` is allowlisted only with its intake-cyber trace and
the existing 3,000-token/no-tools limit; hosted generation remains durable.

Submitted quote intake runs one bounded `intake_monthly_premium_estimate` structured generation through the shared router (`convex/actions/intakePremiumEstimate.ts`), with accepted snapshot context and driver identifiers redacted. The response contains only minimum/maximum monthly totals; no tools, eligibility decision, quote issuance or business writes are available to the model. Local text-only execution is explicitly allowlisted under the existing 100,000-character/3,000-output-token ceiling (this task requests 1,500 tokens); hosted execution remains durable. Results are application-owned estimates, not company facts or insurer quotes.

The premium-estimate task preloads from the current review draft using the canonical submitted-content hash. It remains hidden until that exact content is accepted, promotes a matching prepared result without another inference, and shows pending/running progress on the submitted applicant page while hiding failed estimates. Failed/unknown attempts are not automatically replayed.

`actions/intakeVehicleSpecifications:lookup` remains owner-scoped through `requestIntake.get`; local `intake-vehicle:` retrieval and structured specification generation use explicitly bounded synchronous router execution, while hosted execution stays durable. Enrichment failures return an empty specification list; owner/vehicle validation errors remain enforced before enrichment. Grounding and Jev verification are unchanged, and no automatic inference replay is added.

`requestIntake.retryFailedPremiumEstimateInternal` permits a single explicit operator-requested retry of an expected failed submitted estimate, checking its start timestamp and accepted content hash. Never invoke it automatically or for a running/completed/unknown attempt. `inspectPremiumEstimate` exposes bounded input counts, operations, and up to 160 answered non-driver underwriting questions for diagnosis; model failures distinguish null bounds from invalid numeric ordering.

The monthly-estimate schema permits independently null lower/upper bounds; at least one positive bounded amount is required for completion. When both exist, maximum must exceed minimum. Missing optional details broaden uncertainty rather than inventing applicant facts.

Final intake additional questions use one `intake_additional_questions` generation call per saved base/catalog context, prepared after coalesced draft saves once company and coverage are known or immediately at section entry when needed. Coverage-mapped historical concepts are shortlisted locally by `lib/intake-question-reference.ts` (at most 50 / 12,000 characters). Gap detection, semantic novelty and primitive selection share that response; no extra gap, novelty, Boolean-prefill or date-hint model call runs for new `single-pass-v1` definitions. Revision-checked warmups reuse unchanged contexts and never overlap pending batches; legacy gap endpoints perform no inference. The prompt helper deduplicates history under a 96,000-byte budget without truncating application facts. No new agent/MCP business tool or access grant is introduced.


Intake System One audit: owner-scoped `actions/intakeIndustry:suggestProfile` returns a typed optional industry/category object (the legacy `suggest` string response remains compatible with already-open tabs) from one batched known-taxonomy Jev request. Website enrichment extracts atomic operations and batches verification, founding-year and taxonomy decisions; failed prose generation does not suppress classification. `intake_vehicle_question_relevance` batches at most 100 independent questions once. The shared requirement classifier batches 16 rows / 112 questions with its existing payload splitting. Cyber extraction restricts IDs to its supplied question enum. Cyber/workforce/specification checks use nested candidate state; specifications not claiming universal applicability omit that extra judgment. The terminal `intake_additional_questions` remains one generative call with no additional decision or repair calls. These helpers introduce no agent/MCP business capabilities or authorization changes.

Provider appetite writes accept `writingCountries` (ISO two-letter codes) and `writingStates` (US states/DC or Canadian provinces/territories). Country removal clears dependent regions; region-only writes include their country. Explicit geography edits override automated regional enrichment. Existing state-only profiles infer their countries on read without a data migration.

Provider `lineOfBusinessCodes` writes use the verified ACORD PCS 2.11.0 LineOfBusiness catalog. The shared provider enum excludes interchange-only `UN`/`BLANK`; unknown appetite is an empty list. Existing commercial/personal variants and distinct valid codes are preserved, with exact `Motorcycle` case. The portal, operator/MCP schemas, server validation and research share the catalog in `convex/lib/linesOfBusiness.ts`; source provenance is in `docs/architecture/acord-provider-appetite.md`.

Provider network create/update tools also accept optional `nationwideCountries`
and `excludedStates`. Nationwide scope requires explicit service evidence, not
just a license or an empty region list. Country removal clears its nationwide
selection and exclusions; exclusions apply only within nationwide countries and
override included regions. Geography edits retain manual precedence. These fields
share the existing operator role, exact approval and impersonation boundaries;
there is no new send or scheduling capability.
