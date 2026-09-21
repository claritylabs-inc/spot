import { z } from "zod";

export const CHAT_PRESENTATION_VERSION = 1 as const;
export const CHAT_PRESENTATION_MAX_BYTES = 96 * 1024;
const text = z.string().max(4000);
const label = z.string().min(1).max(200);
const id = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) => !["__proto__", "prototype", "constructor"].includes(value),
  );
const sourceIds = z.array(id).max(12);
export const presentationReferenceSchema = z
  .object({
    id,
    kind: z.enum([
      "policy",
      "requirement",
      "request",
      "proposal",
      "provider",
      "vendor",
      "file",
      "source",
    ]),
    recordId: id,
    label,
    href: z.string().max(2000).optional(),
    policyId: id.optional(),
    requestId: id.optional(),
    sourceUrl: z.string().url().max(2000).optional(),
    sourceSpanIds: z.array(id).max(20).optional(),
    page: z.number().int().positive().optional(),
  })
  .strict();
const fact = z.object({ label, value: text, sourceIds }).strict();
const finding = z
  .object({
    label,
    detail: text,
    status: z.enum(["satisfied", "missing", "uncertain", "information"]),
    sourceIds,
  })
  .strict();
const choice = z.object({ value: id, label }).strict();
const choices = z
  .array(choice)
  .max(40)
  .refine(
    (options) =>
      new Set(options.map((option) => option.value)).size === options.length,
  );
const field = z
  .object({
    id,
    label,
    type: z.enum(["text", "number", "date", "choice", "record"]),
    required: z.boolean(),
    options: choices.optional(),
  })
  .strict();
export const presentationPropsSchemas = {
  Stack: z.object({}).strict(),
  Section: z.object({ title: label.optional() }).strict(),
  Text: z.object({ text }).strict(),
  FactList: z.object({ facts: z.array(fact).min(1).max(40) }).strict(),
  ComparisonTable: z
    .object({
      columns: z.array(z.object({ id, label }).strict()).min(1).max(8),
      rows: z
        .array(
          z.object({ label, values: z.array(text).max(8), sourceIds }).strict(),
        )
        .min(1)
        .max(40),
    })
    .strict(),
  RecordList: z
    .object({
      records: z
        .array(z.object({ referenceId: id, detail: text.optional() }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  FindingsList: z
    .object({ findings: z.array(finding).min(1).max(40) })
    .strict(),
  RequirementMatrix: z
    .object({
      requirements: z
        .array(
          z
            .object({
              label,
              evidence: text,
              status: z.enum(["satisfied", "missing", "uncertain"]),
              sourceIds,
            })
            .strict(),
        )
        .min(1)
        .max(40),
    })
    .strict(),
  DateList: z
    .object({
      dates: z
        .array(z.object({ label, value: text, sourceIds }).strict())
        .min(1)
        .max(40),
    })
    .strict(),
  SourceReference: z.object({ referenceId: id }).strict(),
  FileReference: z.object({ referenceId: id }).strict(),
  ChoiceGroup: z
    .object({
      label,
      options: choices.min(1).max(20),
      submitLabel: label,
    })
    .strict(),
  RecordSelector: z
    .object({
      label,
      referenceIds: z.array(id).min(1).max(40),
      submitLabel: label,
    })
    .strict(),
  ClarificationForm: z
    .object({
      fields: z
        .array(field)
        .min(1)
        .max(8)
        .refine(
          (fields) =>
            new Set(fields.map((field) => field.id)).size === fields.length,
        ),
      submitLabel: label,
    })
    .strict(),
  ActionGroup: z
    .object({
      actions: z
        .array(
          z
            .object({
              label,
              referenceId: id.optional(),
              followUp: z.string().min(1).max(1000).optional(),
            })
            .strict()
            .refine(
              (action) =>
                Boolean(action.referenceId) !== Boolean(action.followUp),
            ),
        )
        .min(1)
        .max(6),
    })
    .strict(),
} as const;
export type PresentationComponent = keyof typeof presentationPropsSchemas;
export type PresentationReference = z.infer<typeof presentationReferenceSchema>;
export type PresentationProps<K extends PresentationComponent> = z.infer<
  (typeof presentationPropsSchemas)[K]
>;
export type PresentationElement = {
  [K in PresentationComponent]: {
    type: K;
    props: PresentationProps<K>;
    children: string[];
  };
}[PresentationComponent];
export type PresentationSpec = {
  root: string;
  elements: Record<string, PresentationElement>;
};
export type ChatPresentation = {
  version: typeof CHAT_PRESENTATION_VERSION;
  spec: PresentationSpec;
  references: PresentationReference[];
  sourceRevision: string;
  createdAt: number;
  decisionRequestId?: string;
};
export type PresentationCandidate = {
  id: string;
  description: string;
  element: PresentationElement;
  resource?: string;
};
export type PresentationToolResult = {
  name: string;
  input?: unknown;
  output: unknown;
};
export type PresentationEvidence = {
  audience: "operator" | "client";
  prompt: string;
  response: string;
  tools: PresentationToolResult[];
};

const envelopeSchema = z
  .object({
    version: z.literal(CHAT_PRESENTATION_VERSION),
    spec: z
      .object({
        root: id,
        elements: z.record(
          id,
          z
            .object({
              type: z.string(),
              props: z.unknown(),
              children: z.array(id).max(24),
            })
            .strict(),
        ),
      })
      .strict(),
    references: z.array(presentationReferenceSchema).max(80),
    sourceRevision: z.string().min(1).max(200),
    createdAt: z.number().finite(),
    decisionRequestId: z.string().max(200).optional(),
  })
  .strict();

export function parseChatPresentation(value: unknown): ChatPresentation | null {
  try {
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      CHAT_PRESENTATION_MAX_BYTES
    )
      return null;
    const result = envelopeSchema.safeParse(value);
    if (!result.success) return null;
    const envelope = result.data;
    const entries = Object.entries(envelope.spec.elements);
    if (!entries.length || entries.length > 24) return null;
    const references = new Map(
      envelope.references.map((reference) => [reference.id, reference]),
    );
    if (references.size !== envelope.references.length) return null;
    for (const reference of references.values()) {
      if (reference.sourceUrl) {
        const url = new URL(reference.sourceUrl);
        if (
          reference.kind !== "source" ||
          reference.policyId ||
          reference.requestId ||
          reference.href ||
          !["https:", "http:"].includes(url.protocol) ||
          url.username ||
          url.password
        )
          return null;
      }
      if (
        reference.href &&
        (!reference.href.startsWith("/") ||
          reference.href.startsWith("//") ||
          /[\\\s]/.test(reference.href))
      )
        return null;
    }
    const elements: Record<string, PresentationElement> = {};
    for (const [key, element] of entries) {
      if (!Object.hasOwn(presentationPropsSchemas, element.type)) return null;
      const type = element.type as PresentationComponent;
      const parsed = presentationPropsSchemas[type].safeParse(element.props);
      if (!parsed.success) return null;
      if (element.children.length && type !== "Stack" && type !== "Section")
        return null;
      if (type === "ComparisonTable") {
        const props = parsed.data as PresentationProps<"ComparisonTable">;
        if (
          new Set(props.columns.map((column) => column.id)).size !==
            props.columns.length ||
          props.rows.some((row) => row.values.length !== props.columns.length)
        )
          return null;
      }
      if (type === "ClarificationForm") {
        const props = parsed.data as PresentationProps<"ClarificationForm">;
        if (
          props.fields.some((field) => {
            if (field.type === "choice" || field.type === "record") {
              if (!field.options?.length) return true;
              return (
                field.type === "record" &&
                field.options.some((option) => !references.has(option.value))
              );
            }
            return field.options !== undefined;
          })
        )
          return null;
      }
      const checkReferences = (data: unknown): boolean => {
        if (Array.isArray(data)) return data.every(checkReferences);
        if (!data || typeof data !== "object") return true;
        return Object.entries(data).every(([name, item]) => {
          if (name === "referenceId")
            return typeof item === "string" && references.has(item);
          if (name === "referenceIds" || name === "sourceIds")
            return (
              Array.isArray(item) &&
              item.every(
                (key) => typeof key === "string" && references.has(key),
              )
            );
          return checkReferences(item);
        });
      };
      if (!checkReferences(parsed.data)) return null;
      // Each component's schema above establishes the discriminated props contract.
      elements[key] = {
        type,
        props: parsed.data,
        children: element.children,
      } as PresentationElement;
    }
    const visited = new Set<string>();
    const visit = (key: string, depth: number): boolean => {
      if (depth > 4 || visited.has(key) || !Object.hasOwn(elements, key))
        return false;
      visited.add(key);
      return elements[key].children.every((child) => visit(child, depth + 1));
    };
    if (!visit(envelope.spec.root, 0) || visited.size !== entries.length)
      return null;
    return { ...envelope, spec: { root: envelope.spec.root, elements } };
  } catch {
    return null;
  }
}
