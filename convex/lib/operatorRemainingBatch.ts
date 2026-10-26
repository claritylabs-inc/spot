import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeDeclarationValue } from "./declarationFacts";
import { prepareOperatorBatch } from "./operatorBatch";
import {
  OPERATOR_AGENT_TOOL_REGISTRY,
  operatorUpdateFieldLabel,
  type OperatorAgentToolName,
} from "./operatorAgentToolRegistry";

export const REMAINING_BATCH_TOOLS = {
  create_client_organizations: {
    single: "create_client_organization",
    key: "name",
  },
  update_organization_profiles: {
    single: "update_organization_profile",
    key: "orgId",
  },
  research_brokers: { single: "research_broker", key: "orgId" },
  add_client_files: { single: "add_client_file", key: "attachmentFileId" },
  update_client_files: { single: "update_client_file", key: "clientFileId" },
  update_procurement_requests: {
    single: "update_procurement_request",
    key: "procurementRequestId",
  },
  update_procurement_broker_outreaches: {
    single: "update_procurement_broker_outreach",
    key: "procurementOutreachId",
  },
  create_procurement_file_items: {
    single: "create_procurement_file_item",
    key: "clientFileId",
  },
  update_procurement_file_items: {
    single: "update_procurement_file_item",
    key: "procurementFileItemId",
  },
  archive_procurement_proposals: {
    single: "archive_procurement_proposal",
    key: "procurementProposalId",
  },
  update_procurement_email_threads: {
    single: "update_procurement_email_thread",
    key: "procurementEmailThreadId",
  },
  link_team_inbox_threads: {
    single: "link_team_inbox_thread",
    key: "teamEmailThreadId",
  },
  cancel_email_drafts: { single: "cancel_email_draft", key: "draftId" },
} as const satisfies Record<
  string,
  { single: OperatorAgentToolName; key: string }
>;

export type RemainingBatchToolName = keyof typeof REMAINING_BATCH_TOOLS;
export type RemainingBatchResult = { results: unknown[] };

export function isRemainingBatchToolName(
  name: string,
): name is RemainingBatchToolName {
  return Object.hasOwn(REMAINING_BATCH_TOOLS, name);
}

export function remainingBatchItems(
  toolName: RemainingBatchToolName,
  input: Record<string, unknown>,
) {
  const parsed =
    OPERATOR_AGENT_TOOL_REGISTRY[toolName].inputSchema.parse(input);
  return parsed.items as Record<string, unknown>[];
}

export async function resolveBatchAttachment(
  ctx: MutationCtx,
  threadId: Id<"operatorAgentThreads">,
  value: unknown,
) {
  const reference = String(value ?? "").trim();
  const exactId = ctx.db.system.normalizeId("_storage", reference);
  const attachments = await ctx.db
    .query("operatorAgentAttachments")
    .withIndex("thread_file", (q) => q.eq("threadId", threadId))
    .take(50);
  const matches = attachments.filter((attachment) =>
    exactId
      ? attachment.fileId === exactId
      : attachment.filename.trim().toLowerCase() === reference.toLowerCase(),
  );
  if (matches.length !== 1)
    throw new Error(
      "Use an exact attachment ID or unique filename from this operator thread",
    );
  return matches[0];
}

export async function prepareRemainingBatch(
  ctx: MutationCtx,
  args: {
    toolName: RemainingBatchToolName;
    input: Record<string, unknown>;
    threadId: Id<"operatorAgentThreads">;
  },
  validate: (
    toolName: OperatorAgentToolName,
    input: Record<string, unknown>,
  ) => Promise<void>,
) {
  const { single, key } = REMAINING_BATCH_TOOLS[args.toolName];
  const items = remainingBatchItems(args.toolName, args.input);
  // Canonicalize attachment aliases before duplicate detection. The original
  // full input remains the approval fingerprint; only prepared execution uses IDs.
  if (args.toolName === "add_client_files") {
    for (const item of items)
      item.attachmentFileId = (
        await resolveBatchAttachment(ctx, args.threadId, item.attachmentFileId)
      ).fileId;
  }
  return prepareOperatorBatch(
    items,
    (item) => {
      if (args.toolName === "create_client_organizations")
        return normalizeDeclarationValue(item.name);
      if (args.toolName === "create_procurement_file_items")
        return `${item.procurementRequestId}:${item.clientFileId}`;
      return String(item[key]);
    },
    async (item) => {
      await validate(single, item);
      return item;
    },
  );
}

type ReferenceTable =
  | "organizations"
  | "clientFiles"
  | "policies"
  | "procurementRequests"
  | "procurementBrokerOutreaches"
  | "procurementFileItems"
  | "procurementProposals"
  | "teamEmailThreads"
  | "pendingEmails";

const referenceTables: Record<string, ReferenceTable> = {
  orgId: "organizations",
  clientOrgId: "organizations",
  brokerOrgId: "organizations",
  clientFileId: "clientFiles",
  policyId: "policies",
  replacingPolicyId: "policies",
  resultingPolicyId: "policies",
  procurementRequestId: "procurementRequests",
  procurementOutreachId: "procurementBrokerOutreaches",
  procurementFileItemId: "procurementFileItems",
  procurementProposalId: "procurementProposals",
  procurementEmailThreadId: "teamEmailThreads",
  teamEmailThreadId: "teamEmailThreads",
  draftId: "pendingEmails",
};

export async function remainingBatchConfirmationSummary(
  ctx: MutationCtx,
  toolName: RemainingBatchToolName,
  input: Record<string, unknown>,
) {
  const items = remainingBatchItems(toolName, input);
  const lines = [`${toolName.replaceAll("_", " ")} (${items.length} items)`];
  for (const item of items) {
    const fields: string[] = [];
    for (const [key, value] of Object.entries(item)) {
      if (value === undefined) continue;
      const table = referenceTables[key];
      const id =
        table && typeof value === "string"
          ? ctx.db.normalizeId(table, value)
          : null;
      const row = id ? await ctx.db.get(id) : null;
      const label =
        row &&
        ("name" in row
          ? row.name
          : "title" in row
            ? row.title
            : "subject" in row
              ? row.subject
              : "brokerName" in row
                ? row.brokerName
                : "label" in row
                  ? row.label
                  : undefined);
      fields.push(
        `${operatorUpdateFieldLabel(key)}: ${label ? `${JSON.stringify(label)} (${value})` : JSON.stringify(value)}`,
      );
    }
    lines.push(`- ${fields.join("; ")}`);
  }
  const summary = lines.join("\n");
  if (summary.length > 20_000)
    throw new Error(
      "The full batch approval exceeds 20,000 characters; split it into smaller batches",
    );
  return summary;
}
