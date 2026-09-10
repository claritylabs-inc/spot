import { v, type Infer } from "convex/values";

export const threadActionActorValidator = v.union(
  v.object({ kind: v.literal("user"), userId: v.id("users") }),
  v.object({ kind: v.literal("email"), address: v.string() }),
);

type ThreadActionActor = Infer<typeof threadActionActorValidator>;

export function threadActionActorsMatch(
  left: ThreadActionActor,
  right: ThreadActionActor,
) {
  if (left.kind !== right.kind) return false;
  if (left.kind === "user" && right.kind === "user") {
    return left.userId === right.userId;
  }
  return (
    left.kind === "email" &&
    right.kind === "email" &&
    left.address === right.address
  );
}

const requirementClassificationValidator = v.object({
  fileId: v.id("_storage"),
  filename: v.string(),
  contentType: v.string(),
  documentClass: v.literal("insurance_requirements"),
  confidence: v.number(),
});

export const operatorToolActionConfirmationPayloadValidator = v.object({
  kind: v.literal("operator_tool_action"),
  runId: v.id("operatorAgentRuns"),
  toolName: v.string(),
  toolVersion: v.number(),
  input: v.string(),
  inputHash: v.string(),
  sourceFingerprint: v.optional(v.string()),
  idempotencyKey: v.string(),
  capability: v.string(),
  effect: v.union(
    v.literal("reversible_write"),
    v.literal("external_send"),
    v.literal("access_change"),
    v.literal("global_change"),
    v.literal("destructive"),
  ),
  requiredRole: v.union(v.literal("operator"), v.literal("owner")),
  targetKind: v.optional(v.string()),
  targetId: v.optional(v.string()),
  summary: v.string(),
});

export const threadActionConfirmationPayloadValidator = v.union(
  v.object({
    kind: v.literal("draft_snapshot"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("email_send"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("email_cancel"),
    pendingEmailIds: v.array(v.id("pendingEmails")),
    draftFingerprints: v.array(v.string()),
  }),
  v.object({
    kind: v.literal("coi_batch_delivery"),
    pendingEmailId: v.id("pendingEmails"),
    recipientEmail: v.string(),
    fileIds: v.array(v.id("_storage")),
    draftFingerprint: v.string(),
  }),
  v.object({
    kind: v.literal("requirement_import"),
    fileIds: v.array(v.id("_storage")),
    classifications: v.array(requirementClassificationValidator),
    scope: v.union(v.literal("vendors"), v.literal("own_org")),
    confidence: v.number(),
    intentEvidence: v.string(),
  }),
);

export const threadActionConfirmationStatusValidator = v.union(
  v.literal("pending"),
  v.literal("completed"),
  v.literal("stale"),
  v.literal("expired"),
);
