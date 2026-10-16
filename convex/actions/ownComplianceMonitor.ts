"use node";

import {
  computeComplianceJudgmentsRef,
  findMissingRequirementJudgmentsRef,
} from "../complianceJudgments";
import dayjs from "dayjs";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { internalAction } from "../_generated/server";
import type { OwnComplianceAssessment, OwnComplianceEvent } from "../compliance";

function buildOwnComplianceThreadContent(event: OwnComplianceEvent) {
  if (event.type === "own_compliance_resolved") {
    return [
      `${event.orgName} now meets every active insurance requirement tracked in Spot.`,
      "",
      "Resolved requirements:",
      ...event.issueLines.map((line) => `- ${line}`),
      "",
      "I will keep monitoring your final policy data and let you know if coverage expires or stops meeting a requirement. Reply here if a requirement or policy should be updated.",
    ].join("\n");
  }

  return [
    `Spot found ${event.issueLines.length} insurance ${event.issueLines.length === 1 ? "requirement" : "requirements"} that need attention for ${event.orgName}.`,
    "",
    "What needs attention:",
    ...event.issueLines.map((line) => `- ${line}`),
    "",
    "This check uses only fully extracted policies. Reply with updated policy documents or context, and I can help resolve the gaps.",
  ].join("\n");
}

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<{
    eligibleOrgs: number;
    checkedOrgs: number;
    skippedPendingExtraction: number;
    notifications: number;
  }> => {
    const nowMs = dayjs().valueOf();
    const orgIds: Id<"organizations">[] = await ctx.runQuery(
      internal.compliance.listOrgIdsWithActiveOwnRequirementsInternal,
      {},
    );
    let remainingJudgmentRequirements = 50;
    let checkedOrgs = 0;
    let skippedPendingExtraction = 0;
    let notifications = 0;

    for (const orgId of orgIds) {
      const extractionPending = await ctx.runQuery(
        internal.policies.hasPendingExtractionInternal,
        { orgId },
      );
      if (extractionPending) {
        skippedPendingExtraction += 1;
        continue;
      }

      if (remainingJudgmentRequirements > 0) {
        const missingRequirementIds = await ctx.runQuery(
          findMissingRequirementJudgmentsRef,
          {
            ownerOrgId: orgId,
            subjectOrgId: orgId,
            limit: remainingJudgmentRequirements,
          },
        );
        for (const requirementId of missingRequirementIds)
          await ctx.scheduler.runAfter(0, computeComplianceJudgmentsRef, {
            requirementId,
            subjectOrgId: orgId,
          });
        remainingJudgmentRequirements -= missingRequirementIds.length;
      }
      const assessments: OwnComplianceAssessment[] = await ctx.runQuery(
        internal.compliance.assessOwnRequirementsInternal,
        { orgId, includePreviewPolicies: false },
      );
      if (assessments.length === 0) continue;
      const memberships: Array<{
        userId: Id<"users">;
        role: "admin" | "member";
      }> = await ctx.runQuery(
        internal.organizations.listMembershipsForOrg,
        { orgId },
      );
      const creator =
        memberships.find((membership) => membership.role === "admin") ??
        memberships[0];
      if (!creator) continue;
      checkedOrgs += 1;

      const events: OwnComplianceEvent[] = await ctx.runMutation(
        internal.compliance.recordOwnComplianceRunInternal,
        {
          orgId,
          checks: assessments.map((assessment) => ({
            requirementId: assessment.requirementId,
            requirementTitle: assessment.title,
            status: assessment.status,
            reasons: assessment.reasons,
            matchedPolicyIds: assessment.matchedPolicyIds,
            matchedSummary: assessment.matchedSummary,
            expiresAt: assessment.expiresAt,
            daysUntilExpiration: assessment.daysUntilExpiration,
            notes: assessment.notes,
          })),
          nowMs,
        },
      );

      for (const event of events) {
        const thread = await ctx.runMutation(
          internal.threads.createProactiveInternal,
          {
            orgId,
            userId: creator.userId,
            title: event.title,
            content: buildOwnComplianceThreadContent(event),
          },
        );
        await ctx.runMutation(
          internal.compliance.notifyOwnComplianceEventInternal,
          {
            orgId,
            type: event.type,
            title: event.title,
            body: event.body,
            severity: event.severity,
            threadId: thread.threadId,
            requirementIds: event.requirementIds,
            nowMs,
          },
        );
        notifications += 1;
      }
    }

    return {
      eligibleOrgs: orgIds.length,
      checkedOrgs,
      skippedPendingExtraction,
      notifications,
    };
  },
});
