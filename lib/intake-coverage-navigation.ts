import { intakeCatalogCoverage } from "./intake-acord-questions";
import { autoVehicles } from "./intake-auto-quote";
import { intakeFollowupPages, type IntakeFollowupQuestion } from "./intake-followups";
import { needsCoverageScope, type IntakeDetails } from "./insurance-intake-details";

type CoveragePage = {
  step: number;
  coverageIndex: number;
  followupIndex?: number;
  autoVehicleIndex?: number;
  driverIndex?: number;
};

/** Keep existing persisted step IDs and global question indices, ordered by line. */
export function intakeCoveragePages(
  details: IntakeDetails,
  questions: IntakeFollowupQuestion[],
  typedOwners: ReadonlyMap<string, number>,
  excludedQuestionIds: readonly string[] = [],
): CoveragePage[] {
  const selected = details.coverages.map(line => line.coverage);
  const owners = questions.map(question => {
    const typed = typedOwners.get(question.id);
    if (typed !== undefined) return typed;
    const coverage = intakeCatalogCoverage(question, selected);
    return Math.max(0, selected.findIndex(id => id === coverage));
  });
  return details.coverages.flatMap((line, coverageIndex) => {
    const pages: CoveragePage[] = [];
    const add = (step: number, cursor: Partial<CoveragePage> = {}) =>
      pages.push({ step, coverageIndex, ...cursor });
    if (line.coverage !== "unknown") add(7);
    if (needsCoverageScope(line.coverage)) add(9);
    for (const page of intakeFollowupPages(questions.filter((_, index) => owners[index] === coverageIndex)))
      add(29, { followupIndex: questions.findIndex(question => question.id === page[0].id) });
    if (line.coverage === "commercial_auto") {
      if(!excludedQuestionIds.includes("auto_freight"))add(41);
      autoVehicles(details).forEach((_, autoVehicleIndex) => add(42, { autoVehicleIndex }));
      add(31, { driverIndex: 0 });
      (details.drivers ?? []).forEach((driver, driverIndex) => {
        for (const step of [34, 35, 36, 37]) add(step, { driverIndex });
        if (driver.accidents === "yes") add(38, { driverIndex });
        add(39, { driverIndex });
        if (driver.violations === "yes") add(40, { driverIndex });
      });
    }
    return pages;
  });
}

/** Undefined leaves company, history, final follow-ups and direct review links alone. */
export function intakeCoverageDestination(
  pages: CoveragePage[],
  details: IntakeDetails,
  step: number,
  requestedStep: number,
  followupIndex: number,
): CoveragePage | undefined {
  if (step === 6 && requestedStep > step)
    return pages[0] ?? { step: 20, coverageIndex: 0 };
  if (step === 20 && (requestedStep < step || requestedStep === 27))
    return pages.at(-1) ?? { step: 6, coverageIndex: 0 };
  if (![7, 8, 9, 29, 41, 42, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40].includes(step))
    return;
  const forward = step === 29 ? requestedStep === 10 : requestedStep > step;
  const index = pages.findIndex(page => page.step === step &&
    (step === 29 ? page.followupIndex === followupIndex
      : step === 42 ? page.autoVehicleIndex === (details.autoVehicleIndex ?? 0)
      : step >= 31 && step <= 40 ? page.driverIndex === (details.driverIndex ?? 0)
      : page.coverageIndex === details.coverageIndex));
  if (index >= 0) return pages[index + (forward ? 1 : -1)] ?? {
    step: forward ? 20 : 6,
    coverageIndex: forward ? Math.max(0, details.coverages.length - 1) : 0,
  };
  // Retired or now-hidden pages resume at the current line's boundary.
  const linePages = pages.filter(page => page.coverageIndex === details.coverageIndex);
  return (forward ? linePages[0] : linePages.at(-1)) ?? { step: forward ? 20 : 6, coverageIndex: 0 };
}
