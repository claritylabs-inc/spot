export type PacketAudience = "operator" | "client" | "broker";

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
    key?: string;
    heading: string;
    body: string;
    audience: PacketAudience;
    order?: number;
  },
>(sections: T[], options: { audience: PacketAudience }) {
  const visible = [...sections]
    .filter((section) => audienceIncludes(section.audience, options.audience))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .filter((section) => section.body.trim());
  if (visible.length === 1 && visible[0].key === "public.md")
    return visible[0].body.trim();
  return visible
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
