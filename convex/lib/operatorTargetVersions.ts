import type { Doc, Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { actionConfirmationFingerprint } from "./actionConfirmationFingerprint";
import { NoWriteInputError } from "./noWriteInputError";
import { isClientBatchToolName } from "./operatorClientBatch";
import {
  OPERATOR_AGENT_TOOL_REGISTRY,
  type OperatorAgentToolName,
  type OperatorToolTarget,
} from "./operatorAgentToolRegistry";
import {
  isRemainingBatchToolName,
  remainingBatchItems,
  REMAINING_BATCH_TOOLS,
} from "./operatorRemainingBatch";

/**
 * Pending approvals have no time limit, so another operator, another agent run
 * or the client can change a record between the approval card and the
 * decision. A manual approval records the version of every existing record the
 * action changes, and approving rechecks them: a changed record makes the
 * approval stale instead of overwriting the newer edit with a proposal built
 * from the old one.
 */

export type OperatorTargetVersion = { kind: string; id: string; version: string };

const TARGET_TABLES = {
  organization: "organizations",
  procurement_request: "procurementRequests",
  procurement_proposal: "procurementProposals",
  procurement_proposal_review: "procurementProposalReviews",
  procurement_broker_outreach: "procurementBrokerOutreaches",
  procurement_file_item: "procurementFileItems",
  procurement_email_thread: "teamEmailThreads",
  team_email_thread: "teamEmailThreads",
  procurement_information_form: "procurementInformationForms",
  client_file: "clientFiles",
  policy: "policies",
} as const satisfies Record<string, TableNames>;

type TargetKind = keyof typeof TARGET_TABLES;

const TARGET_LABELS: Record<TargetKind, string> = {
  organization: "organization",
  procurement_request: "procurement request",
  procurement_proposal: "proposal",
  procurement_proposal_review: "proposal review",
  procurement_broker_outreach: "provider outreach",
  procurement_file_item: "request file",
  procurement_email_thread: "email thread",
  team_email_thread: "email thread",
  procurement_information_form: "information form",
  client_file: "client file",
  policy: "policy",
};

/** Writes that change the existing records they target, singly or per batch item. */
const VERSIONED_WRITE_TOOLS: ReadonlySet<OperatorAgentToolName> = new Set([
  "update_client_file",
  "update_client_files",
  "update_procurement_request",
  "update_procurement_requests",
  "update_procurement_application",
  "update_procurement_broker_outreach",
  "update_procurement_broker_outreaches",
  "update_procurement_file_item",
  "update_procurement_file_items",
  "update_procurement_email_thread",
  "update_procurement_email_threads",
  "link_team_inbox_thread",
  "link_team_inbox_threads",
  "update_organization_profile",
  "update_organization_profiles",
  "update_broker_network_profile",
  "set_client_access_status",
  "set_client_access_statuses",
  "set_client_assignee",
  "set_client_assignees",
  "set_client_feature_flag",
  "set_client_feature_flags",
  "archive_procurement_proposal",
  "archive_procurement_proposals",
  "select_procurement_proposal",
  "confirm_procurement_proposal_review",
  "cancel_procurement_information_form",
  "confirm_policy_fact",
]);

/** Sends whose drafts may reply in a shared team inbox conversation. */
const REPLY_SEND_TOOLS: ReadonlySet<OperatorAgentToolName> = new Set([
  "send_email_drafts",
  "send_email_draft",
]);

const CONVERSATION_KIND = "team_email_conversation";
const MAX_VERSIONED_TARGETS = 50;

/** Activity bookkeeping that changes without anyone editing the record. */
function versionedFields(doc: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(doc).filter(
      ([key]) =>
        key !== "updatedAt" &&
        key !== "preview" &&
        key !== "messageCount" &&
        !/^(?:last|latest)[A-Z]/.test(key),
    ),
  );
}

function isTargetKind(kind: string | undefined): kind is TargetKind {
  return Boolean(kind && Object.hasOwn(TARGET_TABLES, kind));
}

type TargetOf = (input: unknown) => OperatorToolTarget;

function writeTargets(
  toolName: OperatorAgentToolName,
  input: Record<string, unknown>,
): OperatorToolTarget[] {
  if (isRemainingBatchToolName(toolName)) {
    const single = OPERATOR_AGENT_TOOL_REGISTRY[REMAINING_BATCH_TOOLS[toolName].single];
    return remainingBatchItems(toolName, input).map((item) =>
      (single.target as TargetOf)(item),
    );
  }
  if (isClientBatchToolName(toolName)) {
    const items = (
      OPERATOR_AGENT_TOOL_REGISTRY[toolName].inputSchema.parse(input) as {
        items: Array<{ orgId: string }>;
      }
    ).items;
    return items.map((item) => ({ kind: "organization", id: item.orgId }));
  }
  return [(OPERATOR_AGENT_TOOL_REGISTRY[toolName].target as TargetOf)(input)];
}

async function recordVersion(
  ctx: QueryCtx | MutationCtx,
  kind: TargetKind,
  id: string,
) {
  const docId = ctx.db.normalizeId(TARGET_TABLES[kind], id);
  const doc = docId ? await ctx.db.get(docId) : null;
  if (!doc) return { doc: null, version: "missing" };
  return {
    doc,
    version: await actionConfirmationFingerprint(
      versionedFields(doc as Record<string, unknown>),
    ),
  };
}

async function latestConversationMessage(
  ctx: QueryCtx | MutationCtx,
  threadId: Id<"teamEmailThreads">,
) {
  const latest = await ctx.db
    .query("teamEmailMessages")
    .withIndex("by_threadId_and_receivedAt", (q) => q.eq("threadId", threadId))
    .order("desc")
    .first();
  return latest ? String(latest._id) : "none";
}

/** The conversations the drafts reply in, from their stored reply thread. */
async function replyConversations(
  ctx: QueryCtx | MutationCtx,
  input: Record<string, unknown>,
) {
  const ids = Array.isArray(input.draftIds)
    ? input.draftIds
    : [input.draftId];
  const threads = new Set<Id<"teamEmailThreads">>();
  for (const value of ids) {
    const draftId =
      typeof value === "string" ? ctx.db.normalizeId("pendingEmails", value) : null;
    const draft = draftId ? await ctx.db.get(draftId) : null;
    if (draft?.teamEmailThreadId) threads.add(draft.teamEmailThreadId);
  }
  return [...threads];
}

/** Versions to store on a manual approval; empty when the tool needs none. */
export async function captureOperatorTargetVersions(
  ctx: QueryCtx | MutationCtx,
  toolName: OperatorAgentToolName,
  input: Record<string, unknown>,
): Promise<OperatorTargetVersion[]> {
  if (REPLY_SEND_TOOLS.has(toolName)) {
    const threads = await replyConversations(ctx, input);
    return Promise.all(
      threads.slice(0, MAX_VERSIONED_TARGETS).map(async (threadId) => ({
        kind: CONVERSATION_KIND,
        id: String(threadId),
        version: await latestConversationMessage(ctx, threadId),
      })),
    );
  }
  if (!VERSIONED_WRITE_TOOLS.has(toolName)) return [];
  const seen = new Set<string>();
  const versions: OperatorTargetVersion[] = [];
  for (const target of writeTargets(toolName, input)) {
    if (!isTargetKind(target.kind) || !target.id) continue;
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key) || versions.length >= MAX_VERSIONED_TARGETS) continue;
    seen.add(key);
    const { version } = await recordVersion(ctx, target.kind, target.id);
    versions.push({ kind: target.kind, id: target.id, version });
  }
  return versions;
}

function recordName(doc: Doc<TableNames>) {
  const record = doc as Record<string, unknown>;
  for (const key of ["name", "title", "subject", "filename", "policyNumber"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/**
 * Throws a no-write `target_changed` failure naming each record that changed
 * since the approval was proposed. The run resumes with that feedback, so the
 * agent re-reads the record and proposes the change again from current state.
 */
export async function assertOperatorTargetVersionsCurrent(
  ctx: QueryCtx | MutationCtx,
  versions: readonly OperatorTargetVersion[] | undefined,
) {
  if (!versions?.length) return;
  const changed: string[] = [];
  for (const target of versions) {
    if (target.kind === CONVERSATION_KIND) {
      const threadId = ctx.db.normalizeId("teamEmailThreads", target.id);
      if (!threadId) continue;
      if ((await latestConversationMessage(ctx, threadId)) === target.version)
        continue;
      const thread = await ctx.db.get(threadId);
      changed.push(
        `New mail arrived in or was sent from the conversation${
          thread?.subject ? ` “${thread.subject}”` : ""
        } after this send was proposed`,
      );
      continue;
    }
    if (!isTargetKind(target.kind)) continue;
    const current = await recordVersion(ctx, target.kind, target.id);
    if (current.version === target.version) continue;
    const name = current.doc ? recordName(current.doc) : undefined;
    changed.push(
      `The ${TARGET_LABELS[target.kind]}${name ? ` “${name}”` : ""} ${
        current.doc ? "changed" : "was removed"
      } after this action was proposed`,
    );
  }
  if (!changed.length) return;
  throw new NoWriteInputError(
    "target_changed",
    `${changed.slice(0, 5).join("; ")}${
      changed.length > 5 ? `; and ${changed.length - 5} more` : ""
    }. Another operator, agent run or client update changed it, so nothing was written. Read the current record${
      changed.length === 1 ? "" : "s"
    } and propose the change again from that state.`,
  );
}
