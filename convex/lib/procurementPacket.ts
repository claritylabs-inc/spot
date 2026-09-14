export type PacketAudience = "operator" | "client" | "broker";

export const PACKET_SECTIONS = [
  ["intake_narrative", "Client narrative", "client", false],
  ["summary", "Summary", "broker", false],
  ["named_insured", "Named insured", "operator", true],
  ["applicant_profile", "Applicant profile", "broker", false],
  ["premises", "Premises", "broker", false],
  ["construction", "Construction", "broker", false],
  ["protection", "Protection", "broker", false],
  ["valuation", "Valuation", "broker", false],
  ["coverage_requested", "Coverage requested", "broker", false],
  ["liability_exposure", "Liability exposure", "broker", false],
  ["loss_history", "Loss history", "broker", false],
  ["prior_insurance", "Prior insurance", "operator", true],
  ["underwriting_flags", "Underwriting flags", "broker", false],
  ["ask", "The ask", "broker", false],
  ["market_strategy", "Market strategy", "operator", true],
  ["client_contacts", "Client contacts", "operator", true],
] as const;

export const PACKET_SECTION_MAP = new Map<
  string,
  {
    key: string;
    heading: string;
    defaultAudience: PacketAudience;
    sensitive: boolean;
  }
>(
  PACKET_SECTIONS.map(([key, heading, defaultAudience, sensitive]) => [
    key,
    {
      key,
      heading,
      defaultAudience: defaultAudience as PacketAudience,
      sensitive,
    },
  ]),
);

export function defaultPacketSection(key: string) {
  return (
    PACKET_SECTION_MAP.get(key) ?? {
      key,
      heading: key.startsWith("custom:")
        ? key.slice("custom:".length).replace(/[-_]+/g, " ")
        : key,
      defaultAudience: "operator" as const,
      sensitive: false,
    }
  );
}

const RANK: Record<PacketAudience, number> = {
  operator: 0,
  client: 1,
  broker: 2,
};
export function audienceIncludes(
  sectionAudience: PacketAudience,
  audience: PacketAudience,
) {
  return RANK[sectionAudience] >= RANK[audience];
}

export function assemblePacketMarkdown<
  T extends {
    heading: string;
    body: string;
    audience: PacketAudience;
    order?: number;
  },
>(sections: T[], options: { audience: PacketAudience }) {
  return [...sections]
    .filter((section) => audienceIncludes(section.audience, options.audience))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((section) => section.body.trim())
    .map((section) => `## ${section.heading}\n\n${section.body.trim()}`)
    .join("\n\n");
}

/** A request is read as one document: the client's durable background first,
 * then this request's packet. The banners keep the two apart for a model
 * reading them as a single file. */
export function composeRequestMarkdown(args: {
  wikiMarkdown: string;
  packetMarkdown: string;
}) {
  const wiki = args.wikiMarkdown.trim();
  const packet = args.packetMarkdown.trim();
  if (!wiki) return packet;
  if (!packet) return `# Client background\n\n${wiki}`;
  return `# Client background\n\n${wiki}\n\n# Submission packet\n\n${packet}`;
}
