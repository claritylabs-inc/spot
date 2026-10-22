import type { IntakeAnswers } from "./insurance-intake";
import dayjs from "dayjs";
import {
  intakeMarkdown,
  legacyIntakeMarkdown,
  COMPANY_INTAKE_FIELDS,
  INTAKE_FIELDS,
} from "./insurance-intake";
import {
  detailsFromAnswers,
  type IntakeDetails,
} from "./insurance-intake-details";
import { hasCommercialAuto } from "./intake-drivers";
import {
  expandIntakeFollowupQuestion,
  followupQuestionVisible,
  type IntakeFollowupAnswer,
} from "./intake-followups";
import { bakedCoverageQuestions } from "./intake-coverage-questions";
import { intakeCatalogCoverage } from "./intake-acord-questions";
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
  const markdown = intakeMarkdown(
    application.answers,
    undefined,
    application.details,
    intakeCatalogCoverage,
  );
  return `${APPLICATION_START}\n${markdown}\n${APPLICATION_END}`;
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
    // Earlier projections omitted these fields; their saved text must still match.
    const earlier: IntakeAnswers = Object.fromEntries(
      Object.entries(originalAnswers).filter(
        ([key]) =>
          !["deadline", "currentInsuranceDetails", "changes"].includes(key),
      ),
    );
    // Earlier projections also used "Coverage Requested" and an unformatted deadline.
    const previousPresentation = (markdown: string) => {
      const deadline = originalAnswers.deadline?.trim() ?? "";
      const label = `| ${INTAKE_FIELDS.deadline} |`;
      const renamed = markdown.replace(
        "## Coverage requested",
        "## Coverage Requested",
      );
      return /^\d{4}-\d{2}-\d{2}$/.test(deadline)
        ? renamed.replace(
            `${label} ${dayjs(deadline).format("MMMM D, YYYY")} |`,
            `${label} ${deadline} |`,
          )
        : renamed;
    };
    for (const original of [
      legacyIntakeMarkdown(originalAnswers),
      intakeMarkdown(originalAnswers),
      intakeMarkdown(earlier),
    ].flatMap((markdown) => [markdown, previousPresentation(markdown)])) {
      const legacy = `## Request\n\n${original}`;
      if (body.includes(legacy)) return body.replace(legacy, block);
    }
  }
  // Removing a managed block is a deliberate publication choice. Do not re-add it on read.
  return body;
}
/** public.md prose outside the managed application block is the request's
 * submission notes. Prose after the block reads as notes and moves before it
 * on the next edit; split(join(notes, block)) returns the same notes. */
export function splitSubmissionNotes(body: string) {
  const start = body.indexOf(APPLICATION_START);
  const end = start >= 0 ? body.indexOf(APPLICATION_END, start) : -1;
  if (start < 0 || end < 0) return { notes: body, application: null };
  const before = body.slice(0, start).replace(/\n\n$/, "");
  const after = body.slice(end + APPLICATION_END.length).trim();
  return {
    notes: after ? [before.trim(), after].filter(Boolean).join("\n\n") : before,
    application: body.slice(start, end + APPLICATION_END.length),
  };
}
export function joinSubmissionNotes(notes: string, application: string | null) {
  if (!application) return notes;
  return notes ? `${notes}\n\n${application}` : application;
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

/** Location identity facts are edited with the property row, not as catalog answers. */
const TYPED_LOCATION_SOURCES = [
  "shared.location.activities",
  "shared.location.ownership",
  "shared.location.staff_count",
];

/** Every applicable reviewed coverage question, answered or not, for editors. */
export function intakeCoverageAnswerRows(
  answers: IntakeAnswers,
  details: IntakeDetails,
): IntakeFollowupAnswer[] {
  const saved = new Map(
    (details.followups ?? [])
      .filter((row) => row.section === "acord")
      .map((row) => [row.id, row]),
  );
  const rows = new Map<string, IntakeFollowupAnswer>(
    bakedCoverageQuestions({ answers, details })
      .flatMap(expandIntakeFollowupQuestion)
      .map((question) => [
        question.id,
        saved.get(question.id) ?? { ...question, answer: "" },
      ]),
  );
  for (const row of saved.values()) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()].filter(
    (row) =>
      !isFixedVehicleFollowup(row) &&
      !TYPED_LOCATION_SOURCES.some((id) => row.source?.endsWith(` · ${id}`)) &&
      followupQuestionVisible(row, details.followups),
  );
}

/** Review sections after the base application. Editors keep auto quote facts
 * and drivers under the commercial auto coverage instead of separate tabs.
 */
export function intakeQuoteSections(details: IntakeDetails, editable = false) {
  const auto = hasCommercialAuto(details) && !editable;
  return [
    ...(auto &&
    (details.freightHauled ||
      details.coverages.some((line) =>
        line.vehicles?.some((vehicle) => vehicle.estimatedValue),
      ))
      ? (["Quote details"] as const)
      : []),
    ...(auto && details.drivers?.length
      ? (["Driver schedule"] as const)
      : []),
    ...(visibleIntakeFollowups(details, "additional").length
      ? (["Follow-up answers"] as const)
      : []),
  ];
}
