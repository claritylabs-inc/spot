# Operator tool consolidation workflow

W11 consolidates operator tools while keeping existing MCP calls executable.
No tenant contracts, schema indexes, runner iterations, production deployments,
or outbound sends change.

Use Node 24 and start the native local backend with `npm run conductor:dev`.
Every other Convex CLI call must start with
`env -u CONVEX_DEPLOY_KEY -u CONVEX_DEPLOYMENT_TOKEN`. Use synthetic local fixtures
and `operatorAgent:invokeRegisteredToolInternal`, an isolated conversation key,
the seeded operator ID, and a fresh idempotency key for each invocation. Approve
or reject pending actions with `operatorAgent:confirmActionInternal` using the
same operator, thread and confirmation IDs. Do not approve a send or an extraction
retry for this workflow.

## Repeatable checks

1. Compare the baseline and current serialized `operatorAgentToolJsonCatalog()`.
   Check every hidden entry against the baseline schema, version, capability,
   effect, role, execution type and confirmation requirement. It must remain
   registered, while model availability, both offered catalogs, family listings
   and MCP tools/list omit it.
2. Call `get_platform_status` without sections, then with all three sections.
   Page channels using `section: slack_connections`, limit and cursor. Call the
   hidden `get_operator_overview` directly as a compatibility check.
3. Attach a fixture client file and policy with `attach_to_conversation`.
   Repeat the client attachment using the hidden name. Reopen a staged file with
   source threadAttachment, its exact assistant message ID and filename.
4. Create `save_email_draft` with a fixture client, real example.com recipient,
   CC/BCC and duplicate clientFileIds. It must save one copy of the attachment.
   Edit body only; recipient, subject, CC/BCC and attachments must remain.
   Repeat the attachment; it must remain deduplicated. Try an invalid client
   file alongside a changed body; reread the draft and verify no edit occurred.
5. Revise with hidden `update_email_draft`, omitting copies and attachments:
   legacy copies and attachments clear, except mandatory standing copies.
   Add the original policy with explicitArtifactRequest and intentEvidence,
   then explicitly clear attachments with attachmentFileIds: []. Cancel the
   synthetic draft after inspection. Never send it.
6. Read both `get_procurement_packet` views. Read default
   `get_procurement_information` provider summaries and question/form counts;
   request both include sections for full information and client outreach.
   Compare request-filtered team inbox and hidden procurement thread reads.
7. Request, approve and execute local packet-link create, rotate and revoke.
   Each confirmation names its action. Rotation replaces the link, and listing
   links does not redisclose the new URL. Keep generated URLs in private artifacts.
8. Request proposal retry and reject it after checking its exact confirmation.
   Exercise cancel preflight and reject any resulting confirmation. An invalid
   email-thread quote source must fail before creating an approval.

## Recorded local result — October 26, 2026

Catalog checks passed for all 23 hidden entries, including identical legacy input
schemas and approval metadata. Offered tools decreased from 131 to 115; total
registered tools are 138. Serialized JSON decreased from 148,891 to 138,089 UTF-8
bytes (10,802 bytes, 7.25%). These are full-catalog measurements; actual model
steps continue using selected families and live integration availability.

The local workflow script passed 22 direct tool calls. A separate approval script
passed 13 calls covering packet-link create/rotate/revoke execution, extraction
preflight and rejected retry, and invalid email-source filing before approval.
Default platform, compact information and reopening a staged conversation attachment smoke calls also passed. Original
policy attachment, draft preservation, legacy replacement, attachment
idempotency, explicit clearing and no partial edit on invalid input were verified.

Validation commands (all passed; npm test: 20 files, 145 tests):

```bash
npx tsc --noEmit -p .
npx eslint convex/lib/operatorToolConsolidation.ts convex/lib/emailTools.ts convex/lib/operatorAgentConfirmationPreflight.ts convex/lib/operatorAgentToolRegistry.ts convex/lib/operatorEmailTools.ts convex/lib/operatorMcpToolCatalog.ts convex/operatorAgent.ts convex/lib/chatPresentationCandidates.ts convex/lib/operatorAgentToolFailure.ts lib/tool-activity-icons.ts
npm test
node .context/check-catalog.mjs
node .context/runtime-qa.mjs
node .context/approval-qa.mjs
```

No test files were added.

Private repeatable artifacts are in `.context/`: `catalog-before.json`,
`catalog-after.json`, `check-catalog.mjs`, `runtime-qa.mjs`, `approval-qa.mjs`,
their result JSON/logs, and individual smoke-call results.

Live Gmail retrieval, successful imported-email quote filing, hosted MCP HTTP,
rendered browser approval cards, and actual extraction execution were not
verified. Link approvals used the common persisted summary consumed by web,
Slack and MCP; no email or extraction retry was sent/executed.
