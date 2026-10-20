/** Shared section identity for progress, introductions and draft recovery. */
export function intakeSection(step: number): number {
  if (step === 41 || step === 42 || (step >= 31 && step <= 40)) return 1;
  if (step === 43) return 3;
  if (step < 6) return 0;
  if (step < 10) return 1;
  if (step < 20 || step === 27) return 2;
  if (step === 29) return 1;
  if (step === 30) return 5;
  return step < 28 ? 3 : 6;
}

export function atIntakeSectionStart(
  step: number,
  followupPage: number,
  savings: boolean,
): boolean {
  return (
    [0, 1, 6, 10, 20].includes(step) ||
    (savings && step === 21) ||
    (step === 30 && followupPage === 0)
  );
}

export const INTAKE_SECTION_INTRODUCTIONS = [
  {
    title: "Let’s start with your request",
    label: "Your request",
    topics: [
      "Why you’re looking for insurance",
      "When you need coverage",
      "Requirements and supporting documents",
    ],
    description: "Tell us what brings you here and when you need insurance.",
  },
  {
    title: "Your Coverage",
    label: "Coverage",
    topics: [
      "The types of insurance you need",
      "Coverage limits and special requests",
      "Locations or vehicles to include",
    ],
    description: "Choose your coverages and tell us what you want to insure.",
  },
  {
    title: "Your business",
    label: "Your business",
    topics: [
      "Business identity and contact information",
      "What you do and where you operate",
      "Your team and revenue",
    ],
    description:
      "We’ll cover what your business does, where it operates, and who works there.",
  },
  {
    title: "Your insurance history",
    label: "Insurance history",
    topics: [
      "Your current insurance",
      "Past claims and losses",
      "Cancellations and nonrenewals",
    ],
    description:
      "Tell us about your current insurance and any past claims or cancellations.",
  },
  {
    title: "A few details for insurers",
    label: "Coverage details",
    topics: [
      "Questions matched to your coverage",
      "Details about what you need to insure",
      "Information insurers use to prepare quotes",
    ],
    description:
      "These questions are tailored to your business and the coverages you chose.",
  },
  {
    title: "Let’s fill in any gaps",
    label: "Additional details",
    topics: [
      "Follow-ups based on your earlier answers",
      "A closer look at your business operations",
      "Any remaining details for insurers",
    ],
    description:
      "A few final details will help insurers understand your business and prepare quotes.",
  },
  {
    title: "Review your application",
    label: "Review",
    topics: [
      "Your answers and uploaded documents",
      "Any changes you’d like to make",
      "Your confirmation before submitting",
    ],
    description:
      "Check your answers and make any changes before sending your request.",
  },
] as const;

/** Preserve persisted section IDs while presenting one final details section. */
export const INTAKE_VISIBLE_SECTIONS = [
  { id: 0, label: "Your request", step: 1 },
  { id: 2, label: "Company", step: 10 },
  { id: 1, label: "Coverage", step: 6 },
  { id: 3, label: "Insurance history", step: 20 },
  { id: 5, label: "Additional details", step: 30 },
  { id: 6, label: "Review", step: 28 },
] as const;
