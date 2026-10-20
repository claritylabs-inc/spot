/** Shared section identity for progress, introductions and draft recovery. */
export function intakeSection(step: number): number {
  if (step === 41 || step === 42 || (step >= 31 && step <= 40)) return 1;
  if (step === 43) return 3;
  if (step < 6) return 0;
  if (step < 10) return 1;
  if (step < 20 || step === 27) return 2;
  if (step === 29) return 4;
  if (step === 30) return 5;
  return step < 28 ? 3 : 6;
}

export function atIntakeSectionStart(
  step: number,
  followupPage: number,
  savings: boolean,
): boolean {
  return (
    [0, 1, 6, 10, 20, 28].includes(step) ||
    (savings && step === 21) ||
    ([29, 30].includes(step) && followupPage === 0)
  );
}

export const INTAKE_SECTION_INTRODUCTIONS = [
  {
    title: "Let’s start with your request",
    description: "Tell us what brings you here and when you need insurance.",
  },
  {
    title: "What would you like to cover?",
    description: "Choose your coverages and tell us what you want to insure.",
  },
  {
    title: "Tell us about your business",
    description:
      "We’ll cover what your business does, where it operates, and who works there.",
  },
  {
    title: "Your insurance history",
    description:
      "Tell us about your current insurance and any past claims or cancellations.",
  },
  {
    title: "A few details for insurers",
    description:
      "These questions are tailored to your business and the coverages you chose.",
  },
  {
    title: "Let’s fill in any gaps",
    description:
      "A few final details will help insurers understand your business and prepare quotes.",
  },
  {
    title: "Review your application",
    description:
      "Check your answers and make any changes before sending your request.",
  },
] as const;
