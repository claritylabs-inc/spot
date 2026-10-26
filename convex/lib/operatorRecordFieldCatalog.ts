import { z } from "zod";
import {
  COVERAGE_OPTIONS,
  UNKNOWN_ANSWER,
} from "../../lib/insurance-intake-details";
import { INTAKE_FIELDS } from "../../lib/insurance-intake";
import { COMPANY_PROFILE_SHAPES, companyAddressSchema } from "./companyProfileInput";
import { APPLICATION_SHAPES } from "./procurementApplicationInput";
import { compactShape, fieldNames, shapeCatalog } from "./operatorToolFieldCatalog";

export const OPERATOR_DESCRIBABLE_RECORDS = [
  "procurement_application",
  "client_business_profile",
] as const;
export type OperatorDescribableRecord =
  (typeof OPERATOR_DESCRIBABLE_RECORDS)[number];

function answerLabels(schema: z.ZodType) {
  return Object.fromEntries(
    fieldNames(schema).map((key) => [
      key,
      INTAKE_FIELDS[key as keyof typeof INTAKE_FIELDS] ?? key,
    ]),
  );
}

/**
 * Field documentation for the two structured-update tools, generated from the
 * strict schemas that validate them so it cannot drift from what is accepted.
 */
export function describeOperatorRecordFields(record: OperatorDescribableRecord) {
  const shared = {
    shapes: {
      Address: compactShape(companyAddressSchema),
      Location: compactShape(
        (
          COMPANY_PROFILE_SHAPES.details.shape.locations.unwrap() as z.ZodArray<z.ZodType>
        ).element,
        COMPANY_PROFILE_SHAPES.named,
      ),
    },
  };
  if (record === "client_business_profile") {
    return {
      record,
      read: "get_organization or lookup_client_wiki: businessProfile (answers, details, submittedAt = expectedVersion; 0 if absent)",
      update: "update_client_business_profile",
      answers: answerLabels(COMPANY_PROFILE_SHAPES.answers),
      details: shapeCatalog(
        COMPANY_PROFILE_SHAPES.details,
        COMPANY_PROFILE_SHAPES.named,
      ),
      ...shared,
      rules: [
        "Send only changed keys. A supplied details key replaces its whole value (address, list, revenue), so copy the existing entries you keep.",
        "website is an http(s) URL or an empty string. Does not alter submitted request snapshots.",
      ],
    };
  }
  return {
    record,
    read: "get_procurement_request: application, intakeRevision (expectedRevision; 0 if absent), updatedAt (expectedUpdatedAt)",
    update: "update_procurement_application",
    answers: answerLabels(APPLICATION_SHAPES.answers),
    details: shapeCatalog(APPLICATION_SHAPES.details, APPLICATION_SHAPES.named),
    ...shared,
    coverageLimitKeys: Object.fromEntries(
      COVERAGE_OPTIONS.filter((option) => option.limits.length).map(
        (option) => [option.id, option.limits.map((limit) => limit.key)],
      ),
    ),
    rules: [
      "Send only changed keys. A supplied details key replaces its whole value (coverages, locations, revenue), so copy the existing entries you keep.",
      "Typed details own coverage, limits, scope, addresses, locations and revenue; change them in details, never through derived answer strings.",
      `coverages[].limits keys must belong to that coverage (coverageLimitKeys). Values: a positive dollar amount such as "1000000" or "$1,000,000", or "${UNKNOWN_ANSWER}"; statutory and coverage_description take free text. Each coverage appears at most once; "unknown" cannot be combined with others.`,
      "Corrections are operator-authored and do not manufacture applicant consent. Title, status and policy links use update_procurement_request; prose uses update_procurement_packet.",
    ],
  };
}
