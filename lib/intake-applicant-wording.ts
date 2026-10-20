import { INDUSTRIES } from "./insurance-intake-industries";
import { INTAKE_CATALOG_WORDING } from "./intake-catalog-wording";
import { addressText, type IntakeDetails } from "./insurance-intake-details";
import type { IntakeFollowupQuestion } from "./intake-followups";

/** Presentation only: saved definitions/IDs remain the server's approval contract. */
export function intakeApplicantQuestion(question: IntakeFollowupQuestion, industry?: string) {
  const scoped = question.section === "acord"
    ? question.label.match(/^((?:Location|Property|Vehicle) \d+ \(.+\)):\s*([\s\S]*)$/)
    : null;
  const context = scoped?.[1];
  let title = scoped?.[2] ?? question.label;
  let description: string | undefined;
  let placeholder: string | undefined;
  if (question.section === "acord") {
    const concise: Record<string, string> = {
      "Which industries do clients operate in?": "What industries do your clients operate in?",
      "What percentage of revenue comes from the largest client?": "What percentage of revenue comes from your largest client?",
      "What property deductible is requested?": "What deductible would you like for your property coverage?",
      "What equipment, furnishings, stock, and other contents need coverage here?": "What items do you have at this location that need to be insured?",
      "What would it cost to replace the business-owned contents at this location?": "How much would it cost to replace the items your business owns here?",
      "How should insured property be valued?": "How would you like your property valued if you make a claim?",
      "Does another business occupy part of the premises?": "Do you share this location with another business?",
      "Is an extended reporting period needed for a prior policy or discontinued activity?": "Do you need extra time to report claims under a previous policy or for work you no longer do?",
      "At what underlying limit should the requested layer begin?": "Above what existing liability limit would you like your extra coverage to start?",
      "Which underlying coverage lines should the layer sit above?": "Which insurance policies would you like your extra liability coverage to sit above?",
      "What retained amount is acceptable for covered exposures without underlying insurance?": "How much would you be comfortable paying yourself when your other insurance does not cover a claim?",
      "Does the requested layer need to address operations outside the home country?": "Do you need extra liability coverage for work outside your home country?",
    };
    const original = title;
    title = INTAKE_CATALOG_WORDING[question.source?.split(" · ").at(-1) ?? ""] ?? concise[title] ?? title
      .replace(/^What (.+?) (?:is|are) (?:being )?requested(?: for (.+))?\?$/, (_, value: string, purpose?: string) => `What ${value} would you like${purpose ? ` for ${purpose}` : ""}?`)
      .replace(/^Which (.+?) (?:is|are) being requested\?$/, "Which $1 would you like?")
      .replace(/^Is (.+?) requested for (.+)\?$/, "Would you like $1 for $2?")
      .replace(/^Should (.+?) be considered\?$/, "Would you like us to consider $1?")
      .replace(/\b(?:the|this) business(?:'s)?\b/g, match => match.endsWith("'s") ? "your business’s" : "your business")
      .replace(/\bthe applicant(?:'s)?\b/g, match => match.endsWith("'s") ? "your" : "you")
      .replace(/\bthe requested policy (?:period|term)\b/g, "your policy period")
      .replace(/\bthe requested coverage\b/g, "your coverage");
    if (question.source?.endsWith(" · wc.terms.owner_election_details"))
      placeholder = "List each person’s name, role in your business, and whether to include or exclude them.";
    if (original === "What equipment, furnishings, stock, and other contents need coverage here?")
      { description = "For example, computers, office furniture, equipment or inventory.";
        placeholder = intakeContentsPlaceholder(industry); }
  }
  return { title, context, description, placeholder };
}

/** Match the saved subject by address, so reordered locations never borrow a name. */
export function intakeLocationHeading(question: IntakeFollowupQuestion, details: IntakeDetails) {
  const context = intakeApplicantQuestion(question).context;
  const match = context?.match(/^((?:Location|Property) \d+) \((.+)\)$/);
  if (!match) return;
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  const locations = [...details.locations, ...details.coverages.flatMap(line => line.properties ?? [])];
  const matching = locations.filter(location => normalize(addressText(location.address)) === normalize(match[2]));
  const location = matching.find(location => location.name?.trim()) ?? matching[0];
  return { name: location?.name?.trim() || match[1], address: match[2] };
}

/** Examples illustrate the selected industry; they never become saved answers. */
function intakeContentsPlaceholder(industry?: string) {
  const selected = INDUSTRIES.find(option => option.value === industry || option.label === industry)?.value;
  const examples: Record<string, string> = {
    agriculture: "e.g. farm equipment, tools and stored supplies",
    construction: "e.g. tools, equipment and building materials",
    manufacturing: "e.g. machinery, tools, raw materials and finished stock",
    wholesale_distribution: "e.g. stock, shelving, forklifts and packing equipment",
    retail: "e.g. inventory, display shelves and checkout equipment",
    transportation_logistics: "e.g. warehouse equipment, tools and stored goods",
    technology: "e.g. computers, servers, monitors and office furniture",
    financial_services: "e.g. computers, desks, chairs and filing cabinets",
    real_estate: "e.g. office computers, desks, furniture and maintenance equipment",
    professional_services: "e.g. computers, desks, chairs and office equipment",
    business_services: "e.g. work equipment, tools, supplies and office furniture",
    education: "e.g. computers, desks, classroom furniture and teaching equipment",
    healthcare: "e.g. medical equipment, computers and office furniture",
    hospitality_entertainment: "e.g. furniture, kitchen equipment and supplies",
    personal_consumer_services: "e.g. service equipment, tools, furniture and stock",
  };
  return (selected && examples[selected]) || "e.g. computers, furniture, equipment and inventory";
}
