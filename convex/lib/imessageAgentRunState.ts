import type { Id } from "../_generated/dataModel";
import type { WorkflowOutcome } from "./workflows/types";
import type { EmailToolResult } from "./emailTools";

type ToolAttachment = {
  filename: string;
  fileId?: Id<"_storage">;
};

type ToolArtifact = {
  type: string;
  data: unknown;
};

export type ImessageResponseFileAttachment = {
  storageId: Id<"_storage">;
  filename: string;
};

export function createImessageAgentRunState() {
  const responseFileAttachments: ImessageResponseFileAttachment[] = [];
  const toolArtifacts: ToolArtifact[] = [];
  const presentedPolicyIds: Id<"policies">[] = [];
  let emailResult: EmailToolResult | null = null;

  return {
    responseFileAttachments,
    toolArtifacts,
    presentedPolicyIds,
    onPolicyPresented(policyId: Id<"policies">) {
      if (!presentedPolicyIds.some((id) => String(id) === String(policyId))) {
        presentedPolicyIds.push(policyId);
      }
    },
    onResponseAttachment(attachment: ToolAttachment) {
      if (!attachment.fileId) return;
      responseFileAttachments.push({
        storageId: attachment.fileId,
        filename: attachment.filename,
      });
    },
    onToolArtifact(artifact: ToolArtifact) {
      toolArtifacts.push(artifact);
    },
    appendWorkflowOutcomes(workflowOutcomes: WorkflowOutcome[]) {
      for (const workflowOutcome of workflowOutcomes) {
        toolArtifacts.push({
          type: "workflow_outcome",
          data: workflowOutcome,
        });
      }
    },
    setEmailResult(result: EmailToolResult) {
      emailResult = result;
    },
    getEmailResult() {
      return emailResult;
    },
  };
}
