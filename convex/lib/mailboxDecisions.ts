import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { decideWithFallback, type DecisionQuestion } from "./decisions";
import {
  acceptedChoice,
  choiceQuestion,
  decisionState,
} from "./domainDecisionQuestions";
import type {
  ConnectedEmailAutomation,
  MailboxAutomationDecision,
  MailboxAttachmentSummary,
} from "./mailboxAutomation";

const categories = {
  ignore:
    "Unrelated marketing, scheduling, receipt or no durable insurance action.",
  policy_document:
    "Explicit bound policy, declarations, binder or endorsement PDF; never quote, application, invoice, claim or standalone certificate.",
  insurance_requirements:
    "A lease, contract, lender/investor request or vendor standard imposing insurance obligations.",
  company_context:
    "Explicit durable facts about the mailbox owner's company, excluding policy facts and one-off transactions.",
  multiple:
    "Several enabled categories are present; needs package interpretation.",
  review_needed:
    "Insurance relevant but ambiguous or unsafe for unattended import.",
};

type Message = {
  subject?: string;
  from?: string;
  snippet?: string;
  attachments: MailboxAttachmentSummary[];
};

export async function decideMailboxBatch(
  ctx: ActionCtx,
  orgId: Id<"organizations">,
  policy: { automation: ConnectedEmailAutomation; alertOnly: boolean },
  messages: Message[],
  fallback: () => Promise<{ decisions: MailboxAutomationDecision[] }>,
) {
  const questions: Record<string, DecisionQuestion> = {};
  for (const [index, message] of messages.entries()) {
    const context = { messageIndex: index };
    questions[`category_${index}`] = choiceQuestion(
      "Classify this mailbox message for commercial-insurance intake, using only explicit evidence and enabled actions.",
      categories,
      context,
    );
    questions[`scope_${index}`] = choiceQuestion(
      "Who must comply with the insurance requirements in this message?",
      {
        own_org:
          "This company owes insurance to a client, landlord, lender or investor.",
        vendors: "Vendors owe insurance to this company.",
      },
      context,
    );
    questions[`source_${index}`] = choiceQuestion(
      "What source imposes the requirements in this message?",
      {
        lease_agreement: "Lease agreement",
        client_contract: "Client contract",
        vendor_requirements: "Vendor insurance standards",
        other: "Another explicitly identified requirement source",
      },
      context,
    );
    questions[`body_${index}`] = choiceQuestion(
      "Does the message body itself state insurance requirements that need importing?",
      {
        yes: "Explicit requirements in the body.",
        no: "No requirements in the body; attachment is the only source.",
      },
      context,
    );
    message.attachments.forEach((attachment, fileIndex) => {
      questions[`file_${index}_${fileIndex}`] = choiceQuestion(
        "What intake role does this exact attachment have? A filename alone cannot establish bound coverage or document identity. Abstain when the message does not identify the document unambiguously.",
        {
          policy:
            "An explicitly identified bound-policy document; not a quote, certificate, invoice or application.",
          requirements:
            "An explicitly identified insurance requirement source.",
          other: "Not a policy or requirement source.",
        },
        { ...context, attachment: decisionState(attachment) },
      );
    });
  }
  return decideWithFallback({
    ctx,
    orgId,
    family: "mailbox.classification",
    state: decisionState({ policy, messages }),
    questions,
    fallback,
    requiredQuestionIds: (answers) =>
      messages.flatMap((message, index) => {
        const category = answers[`category_${index}`];
        const required = [`category_${index}`];
        if (category?.type !== "choice") return required;
        if (
          category.choice === "policy_document" ||
          category.choice === "insurance_requirements"
        ) {
          required.push(
            ...message.attachments.map(
              (_, fileIndex) => `file_${index}_${fileIndex}`,
            ),
          );
        }
        if (category.choice === "insurance_requirements")
          required.push(`scope_${index}`, `source_${index}`, `body_${index}`);
        return required;
      }),
    accept: (answers) => {
      const decisions: MailboxAutomationDecision[] = [];
      for (const [index, message] of messages.entries()) {
        const selected = acceptedChoice(
          answers[`category_${index}`],
          Object.keys(categories),
        );
        if (!selected || selected.value === "multiple") return undefined;
        const classification =
          selected.value as MailboxAutomationDecision["classification"];
        const decision: MailboxAutomationDecision = {
          emailRef: String(index + 1),
          classification,
          confidence: selected.confidence,
          reason: categories[classification],
          policyGroups: [],
          requirementFilenames: [],
          includeEmailBodyAsRequirements: false,
          requirementSourceType: null,
          requirementScope: null,
          extractCompanyMemory: classification === "company_context",
          attentionTitle:
            classification === "review_needed"
              ? "Review insurance email"
              : null,
          attentionBody:
            classification === "review_needed"
              ? "The message needs review before importing documents or updating company information."
              : null,
        };
        if (
          classification === "policy_document" ||
          classification === "insurance_requirements"
        ) {
          const policyFiles: string[] = [];
          for (const [fileIndex, attachment] of message.attachments.entries()) {
            const role = acceptedChoice(answers[`file_${index}_${fileIndex}`], [
              "policy",
              "requirements",
              "other",
            ]);
            if (!role) return undefined;
            decision.confidence = Math.min(
              decision.confidence,
              role.confidence,
            );
            if (role.value === "other") continue;
            if (!attachment.filename) return undefined;
            if (role.value === "policy") policyFiles.push(attachment.filename);
            else decision.requirementFilenames.push(attachment.filename);
          }
          // Grouping several PDFs requires reasoning about package boundaries.
          if (classification === "policy_document") {
            if (
              policyFiles.length !== 1 ||
              decision.requirementFilenames.length
            )
              return undefined;
            decision.policyGroups = [{ filenames: policyFiles }];
          } else {
            if (policyFiles.length) return undefined;
            const scope = acceptedChoice(answers[`scope_${index}`], [
              "own_org",
              "vendors",
            ]);
            const source = acceptedChoice(answers[`source_${index}`], [
              "lease_agreement",
              "client_contract",
              "vendor_requirements",
              "other",
            ]);
            const body = acceptedChoice(answers[`body_${index}`], [
              "yes",
              "no",
            ]);
            if (!scope || !source || !body) return undefined;
            decision.requirementScope = scope.value as "own_org" | "vendors";
            decision.requirementSourceType =
              source.value as MailboxAutomationDecision["requirementSourceType"];
            decision.includeEmailBodyAsRequirements = body.value === "yes";
            if (
              !decision.requirementFilenames.length &&
              !decision.includeEmailBodyAsRequirements
            )
              return undefined;
            decision.confidence = Math.min(
              decision.confidence,
              scope.confidence,
              source.confidence,
              body.confidence,
            );
          }
        }
        decisions.push(decision);
      }
      return { decisions };
    },
  });
}
