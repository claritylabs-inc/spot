import type { IntakeAnswers } from "./insurance-intake";
import {
  intakeMarkdown,
  legacyIntakeMarkdown,
  COMPANY_INTAKE_FIELDS,
} from "./insurance-intake";
import {
  detailsFromAnswers,
  type IntakeDetails,
} from "./insurance-intake-details";
import { hasCommercialAuto } from "./intake-drivers";
import { followupQuestionVisible, type IntakeFollowupAnswer } from "./intake-followups";
import { isFixedVehicleFollowup } from "./intake-vehicle-underwriting";

export type IntakeApplication = {
  answers: IntakeAnswers;
  details: IntakeDetails;
  files: { id: string; name: string }[];
  submittedAt: number;
  revision: number;
};
type ApplicationRecord = {
  deletedAt?: number;
  intakeSubmittedApplication?: IntakeApplication;
  intakeSubmissionBaseline?: Pick<
    IntakeApplication,
    "answers" | "details" | "files"
  >;
  intakeSnapshot?: IntakeAnswers;
  intakeDetailsSnapshot?: IntakeDetails;
  intakeSubmittedAt?: number;
  intakeResubmittedAt?: number;
  intakeRevision?: number;
};
/** Published facts never come from mutable draft answers or parsed Markdown. */
export function submittedIntakeApplication(
  request: ApplicationRecord,
): IntakeApplication | null {
  if (request.deletedAt) return null;
  if (request.intakeSubmittedApplication)
    return request.intakeSubmittedApplication;
  if (!request.intakeSubmittedAt) return null;
  const saved = request.intakeSubmissionBaseline;
  const answers = saved?.answers ?? request.intakeSnapshot;
  if (!answers) return null;
  return {
    answers,
    details:
      saved?.details ??
      request.intakeDetailsSnapshot ??
      detailsFromAnswers(answers),
    files: saved?.files ?? [],
    submittedAt: request.intakeResubmittedAt ?? request.intakeSubmittedAt,
    revision: request.intakeRevision ?? 0,
  };
}
export const APPLICATION_START = "<!-- spot-current-application:start -->";
export const APPLICATION_END = "<!-- spot-current-application:end -->";
export function applicationMarkdownBlock(application: IntakeApplication) {
  return `${APPLICATION_START}\n${intakeMarkdown(application.answers, undefined, application.details)}\n${APPLICATION_END}`;
}
/** The existing marker pair retains ownership; prose outside it is untouched. */
export function projectApplicationMarkdown(
  body: string,
  application: IntakeApplication,
  originalAnswers?: IntakeAnswers,
) {
  const start = body.indexOf(APPLICATION_START);
  const end = start >= 0 ? body.indexOf(APPLICATION_END, start) : -1;
  const block = applicationMarkdownBlock(application);
  if (start >= 0 && end >= start)
    return (
      body.slice(0, start) + block + body.slice(end + APPLICATION_END.length)
    );
  if (originalAnswers) {
    for (const original of [
      legacyIntakeMarkdown(originalAnswers),
      intakeMarkdown(originalAnswers),
    ]) {
      const legacy = `## Request\n\n${original}`;
      if (body.includes(legacy)) return body.replace(legacy, block);
    }
  }
  // Removing a managed block is a deliberate publication choice. Do not re-add it on read.
  return body;
}
export function companyApplicationProfile(application: IntakeApplication) {
  const answers: IntakeAnswers = Object.fromEntries(
    COMPANY_INTAKE_FIELDS.filter((key) => key !== "companyConfirmed").map(
      (key) => [key, application.answers[key] ?? ""],
    ),
  );
  const source = application.details;
  const details: IntakeDetails = {
    ...detailsFromAnswers(answers),
    mailingAddress: source.mailingAddress,
    locations: source.locations,
    relatedEntities: source.relatedEntities,
    relatedEntitiesNote: source.relatedEntitiesNote,
    ...(source.hasRelatedEntities
      ? { hasRelatedEntities: source.hasRelatedEntities }
      : {}),
    ...(source.registrationAddress
      ? { registrationAddress: source.registrationAddress }
      : {}),
    ...(source.registrationCountry
      ? { registrationCountry: source.registrationCountry }
      : {}),
    ...(source.registrationState
      ? { registrationState: source.registrationState }
      : {}),
    ...(source.mailingSameAsRegistered
      ? { mailingSameAsRegistered: source.mailingSameAsRegistered }
      : {}),
    ...(source.revenue ? { revenue: source.revenue } : {}),
  };
  return { answers, details, submittedAt: application.submittedAt };
}

export function companyNotesMarkdown(
  body: string,
  profile:
    | { answers: IntakeAnswers; details: IntakeDetails }
    | null
    | undefined,
) {
  if (!profile) return body;
  const generated = [
    legacyIntakeMarkdown(profile.answers, COMPANY_INTAKE_FIELDS),
    intakeMarkdown(profile.answers, COMPANY_INTAKE_FIELDS),
  ];
  return body
    .replace(
      /^## Customer-confirmed company information[^\n]*\n+([\s\S]*?)(?=^## |$(?![\s\S]))/gm,
      (block, content: string) =>
        generated.some((value) => value.trim() === content.trim()) ? "" : block,
    )
    .trim();
}

/** Visible follow-up answers for one section, excluding typed vehicle facts. */
export function visibleIntakeFollowups(
  details: IntakeDetails,
  section: IntakeFollowupAnswer["section"],
) {
  return (details.followups ?? []).filter(
    (row) =>
      row.section === section &&
      !isFixedVehicleFollowup(row) &&
      followupQuestionVisible(row, details.followups),
  );
}

/** Quote sections after the base application; editors show auto sections before data exists. */
export function intakeQuoteSections(details: IntakeDetails, editable = false) {
  const auto = hasCommercialAuto(details);
  return [
    ...(auto &&
    (editable ||
      details.freightHauled ||
      details.coverages.some((line) =>
        line.vehicles?.some((vehicle) => vehicle.estimatedValue),
      ))
      ? (["Quote details"] as const)
      : []),
    ...(auto && (editable || details.drivers?.length)
      ? (["Driver schedule"] as const)
      : []),
    ...(visibleIntakeFollowups(details, "additional").length
      ? (["Follow-up answers"] as const)
      : []),
  ];
}
