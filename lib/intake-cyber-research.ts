import type { IntakeAnswers } from "./insurance-intake";
import type { IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";

export function intakeCyberResearchKey(answers: IntakeAnswers, details: IntakeDetails) {
  return JSON.stringify(["cyber-research-v2", answers.website?.trim() ?? "", answers.legalName?.trim() || answers.dba?.trim() || "",
    answers.description?.trim() ?? "", answers.industry ?? "", details.cyberDocuments?.privacyPolicyUrl ?? "", details.cyberDocuments?.termsUrl ?? ""]);
}

/** Policy links are optional base facts, never LLM-generated questions. */
export function cyberDocumentQuestions(details: IntakeDetails, discovered?: { privacyPolicyUrl?: string; termsUrl?: string }) {
  if (!details.coverages.some(line => line.coverage === "cyber")) return [];
  const coverageIndex = details.coverages.findIndex(line => line.coverage === "cyber");
  return ([
    { field: "privacyPolicyUrl" as const, label: "Where can we find your privacy policy?" },
    { field: "termsUrl" as const, label: "Where can we find your terms of service?" },
  ]).filter(row => !discovered?.[row.field] || !!details.cyberDocuments?.[row.field])
    .map(row => ({ coverageIndex, field: row.field, answer: details.cyberDocuments?.[row.field] ?? "", question: {
      id: `cyber_document_${row.field}`, label: row.label, section: "acord" as const,
      source: "Base cyber documents", kind: "short_text" as const, options: [],
    } satisfies IntakeFollowupQuestion }));
}

export function withCyberDocumentQuestions(details: IntakeDetails, questions: IntakeFollowupQuestion[], discovered?: { privacyPolicyUrl?: string; termsUrl?: string }) {
  const documents = cyberDocumentQuestions(details, discovered).map(row => row.question);
  const position = questions.findIndex(question => question.source?.includes(" · cyber."));
  return position < 0 ? [...questions, ...documents] : [...questions.slice(0, position), ...documents, ...questions.slice(position)];
}

/** Keep draft typing recoverable; navigation/submission check entered links. */
export function cyberDocumentUrlValid(value?: string) {
  if (!value?.trim() || value === "I'm not sure") return true;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !!url.hostname && !url.username && !url.password; } catch { return false; }
}
