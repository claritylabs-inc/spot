export type DocumentOutlineNode = Record<string, unknown> & {
  children?: DocumentOutlineNode[];
  subsections?: DocumentOutlineNode[];
  sections?: DocumentOutlineNode[];
  sourceSpanIds?: string[];
};

export type FlattenedDocumentOutlineNode = {
  node: DocumentOutlineNode;
  depth: number;
  path: string;
};

type FormatOptions = {
  maxNodes?: number;
  maxChars?: number;
  includeSourceSpanIds?: boolean;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function asRecordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> =>
      Boolean(item) && typeof item === "object" && !Array.isArray(item),
    )
    : [];
}

function asOutlineArray(value: unknown): DocumentOutlineNode[] {
  return asRecordArray(value) as DocumentOutlineNode[];
}

function cleanString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text || undefined;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function compactJson(value: unknown, maxChars: number): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === "string" ? value : stringValue(value);
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean === "{}" || clean === "[]") return undefined;
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}...` : clean;
}

function truncate(value: unknown, maxChars: number): string | undefined {
  const text = cleanString(typeof value === "string" ? value : stringValue(value));
  if (!text) return undefined;
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = cleanString(record[key]);
    if (value) return value;
  }
  return undefined;
}

export function sourceSpanIdsFromValue(value: unknown): string[] {
  const record = asRecord(value);
  const raw = record?.sourceSpanIds;
  return Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === "string" && id.length > 0)
    : [];
}

export function getPolicyDocumentOutline(policy: Record<string, unknown>): DocumentOutlineNode[] {
  return asOutlineArray(policy.documentOutline);
}

export function getPolicyDocumentMetadata(policy: Record<string, unknown>): Record<string, unknown> | undefined {
  return asRecord(policy.documentMetadata);
}

export function getPolicyFormInventory(policy: Record<string, unknown>): Record<string, unknown>[] {
  return asRecordArray(policy.formInventory);
}

export function flattenDocumentOutline(
  nodes: DocumentOutlineNode[],
  depth = 0,
  prefix = "",
): FlattenedDocumentOutlineNode[] {
  const flattened: FlattenedDocumentOutlineNode[] = [];
  nodes.forEach((node, index) => {
    const path = prefix ? `${prefix}.${index + 1}` : String(index + 1);
    flattened.push({ node, depth, path });
    const children = [
      ...asOutlineArray(node.children),
      ...asOutlineArray(node.subsections),
      ...asOutlineArray(node.sections),
    ];
    if (children.length > 0) {
      flattened.push(...flattenDocumentOutline(children, depth + 1, path));
    }
  });
  return flattened;
}

export function documentOutlineNodeTitle(node: Record<string, unknown>): string {
  return firstString(node, ["title", "name", "heading", "label", "sectionTitle"])
    ?? "Untitled document node";
}

export function documentOutlineNodeKind(node: Record<string, unknown>): string | undefined {
  const labels = Array.isArray(node.interpretationLabels)
    ? node.interpretationLabels.filter((label): label is string => typeof label === "string")
    : [];
  return labels.length > 0
    ? labels.join(", ")
    : firstString(node, ["type", "kind", "sectionType", "semanticType", "category"]);
}

export function documentOutlineNodePages(node: Record<string, unknown>): string | undefined {
  const start = typeof node.pageStart === "number"
    ? node.pageStart
    : typeof node.pageNumber === "number"
      ? node.pageNumber
      : typeof node.page === "number"
        ? node.page
        : undefined;
  const end = typeof node.pageEnd === "number" ? node.pageEnd : undefined;
  if (start === undefined) return undefined;
  return end && end !== start ? `${start}-${end}` : String(start);
}

export function documentOutlineNodeText(node: Record<string, unknown>, maxChars = 900): string {
  const direct = [
    node.summary,
    node.excerpt,
    node.content,
    node.text,
    node.originalContent,
  ]
    .map((value) => truncate(value, maxChars))
    .find(Boolean);
  if (direct) return direct;

  const sparse = Object.fromEntries(
    Object.entries(node).filter(([key]) =>
      !["children", "subsections", "sections", "bbox", "sourceSpanIds"].includes(key),
    ),
  );
  return truncate(sparse, maxChars) ?? "";
}

export function formatSourceSpanLabel(span: {
  sourceUnit?: string;
  sectionId?: string;
  formNumber?: string;
  pageStart?: number;
  pageEnd?: number;
  metadata?: Record<string, unknown>;
}): string {
  const metadata = span.metadata ?? {};
  const unit = cleanString(span.sourceUnit) ?? cleanString(metadata.sourceUnit) ?? cleanString(metadata.elementType);
  const name = [
    unit,
    cleanString(span.sectionId),
    cleanString(span.formNumber),
  ].filter(Boolean).join(" / ");
  const pages = span.pageStart
    ? `p.${span.pageStart}${span.pageEnd && span.pageEnd !== span.pageStart ? `-${span.pageEnd}` : ""}`
    : undefined;
  return [name || "Policy source", pages].filter(Boolean).join(" ");
}

export function formatDocumentOutlineForPrompt(
  policy: Record<string, unknown>,
  options: FormatOptions = {},
): string {
  const maxNodes = options.maxNodes ?? 24;
  const maxChars = options.maxChars ?? 8000;
  const includeSourceSpanIds = options.includeSourceSpanIds ?? true;
  const flattened = flattenDocumentOutline(getPolicyDocumentOutline(policy));
  const outline = flattened.slice(0, maxNodes);
  if (outline.length === 0) return "";

  const lines = outline.map(({ node, depth, path }) => {
    const title = documentOutlineNodeTitle(node);
    const kind = documentOutlineNodeKind(node);
    const pages = documentOutlineNodePages(node);
    const form = firstString(node, ["formNumber", "formTitle", "formName"]);
    const sourceSpanIds = sourceSpanIdsFromValue(node).slice(0, 4);
    const text = documentOutlineNodeText(node, 320);
    const prefix = `${"  ".repeat(depth)}${path}. ${title}`;
    const meta = [
      kind ? `[${kind}]` : undefined,
      pages ? `pages ${pages}` : undefined,
      form ? `form ${form}` : undefined,
      includeSourceSpanIds && sourceSpanIds.length > 0
        ? `sourceSpanIds ${sourceSpanIds.join(",")}`
        : undefined,
    ].filter(Boolean).join(" | ");
    return `${prefix}${meta ? ` (${meta})` : ""}${text ? `\n${"  ".repeat(depth)}   ${text}` : ""}`;
  });

  const suffix = flattened.length > maxNodes
    ? `\n... ${flattened.length - maxNodes} additional outline node(s) omitted`
    : "";
  const text = `DOCUMENT OUTLINE (source-native order; use labels as interpretation, not as a replacement for the original structure):\n${lines.join("\n")}${suffix}`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export function formatDocumentMetadataForPrompt(
  policy: Record<string, unknown>,
  options: FormatOptions = {},
): string {
  const maxChars = options.maxChars ?? 6000;
  const metadata = getPolicyDocumentMetadata(policy);
  const formInventory = getPolicyFormInventory(policy);
  const parts: string[] = [];

  if (formInventory.length > 0) {
    const lines = formInventory.slice(0, 18).map((form, index) => {
      const formNumber = firstString(form, ["formNumber", "number", "id"]);
      const title = firstString(form, ["title", "name", "formTitle"]) ?? "Untitled form";
      const pages = documentOutlineNodePages(form);
      const formType = firstString(form, ["formType", "type", "category"]);
      const sourceSpanIds = sourceSpanIdsFromValue(form).slice(0, 3);
      return [
        `${index + 1}. ${[formNumber, title].filter(Boolean).join(" - ")}`,
        formType ? `[${formType}]` : undefined,
        pages ? `pages ${pages}` : undefined,
        sourceSpanIds.length > 0 ? `sourceSpanIds ${sourceSpanIds.join(",")}` : undefined,
      ].filter(Boolean).join(" | ");
    });
    if (formInventory.length > 18) lines.push(`... ${formInventory.length - 18} additional form(s) omitted`);
    parts.push(`FORM INVENTORY:\n${lines.join("\n")}`);
  }

  if (metadata) {
    for (const [label, keys] of [
      ["TABLE OF CONTENTS", ["tableOfContents", "toc"]],
      ["PAGE MAP", ["pageMap", "pageIndex", "navigation"]],
      ["DOCUMENT LOGIC", ["agentGuidance", "internalLogic", "documentLogic", "overrideLogic"]],
    ] as const) {
      for (const key of keys) {
        const formatted = compactJson(metadata[key], 1800);
        if (formatted) {
          parts.push(`${label}:\n${formatted}`);
          break;
        }
      }
    }
  }

  if (parts.length === 0) return "";
  const text = `DOCUMENT METADATA (navigation and extraction guidance, not policy wording):\n${parts.join("\n\n")}`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}...` : text;
}

export function formatDocumentStructureForPrompt(
  policy: Record<string, unknown>,
  options: FormatOptions = {},
): string {
  return [
    formatDocumentMetadataForPrompt(policy, options),
    formatDocumentOutlineForPrompt(policy, options),
  ].filter(Boolean).join("\n\n");
}
