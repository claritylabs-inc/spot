import { v } from "convex/values";

const sourceIds = v.array(v.string());
const fact = v.object({ label: v.string(), value: v.string(), sourceIds });
const choice = v.object({ value: v.string(), label: v.string() });
const findingStatus = v.union(
  v.literal("satisfied"),
  v.literal("missing"),
  v.literal("uncertain"),
);
export const presentationReferenceValidator = v.object({
  id: v.string(),
  kind: v.union(
    v.literal("policy"),
    v.literal("requirement"),
    v.literal("request"),
    v.literal("proposal"),
    v.literal("provider"),
    v.literal("vendor"),
    v.literal("file"),
    v.literal("source"),
  ),
  recordId: v.string(),
  label: v.string(),
  href: v.optional(v.string()),
  policyId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  sourceSpanIds: v.optional(v.array(v.string())),
  page: v.optional(v.number()),
});
const children = v.array(v.string());
const element = v.union(
  v.object({ type: v.literal("Stack"), props: v.object({}), children }),
  v.object({
    type: v.literal("Section"),
    props: v.object({ title: v.optional(v.string()) }),
    children,
  }),
  v.object({
    type: v.literal("Text"),
    props: v.object({ text: v.string() }),
    children,
  }),
  v.object({
    type: v.literal("FactList"),
    props: v.object({ facts: v.array(fact) }),
    children,
  }),
  v.object({
    type: v.literal("ComparisonTable"),
    props: v.object({
      columns: v.array(v.object({ id: v.string(), label: v.string() })),
      rows: v.array(
        v.object({ label: v.string(), values: v.array(v.string()), sourceIds }),
      ),
    }),
    children,
  }),
  v.object({
    type: v.literal("RecordList"),
    props: v.object({
      records: v.array(
        v.object({ referenceId: v.string(), detail: v.optional(v.string()) }),
      ),
    }),
    children,
  }),
  v.object({
    type: v.literal("FindingsList"),
    props: v.object({
      findings: v.array(
        v.object({
          label: v.string(),
          detail: v.string(),
          status: v.union(findingStatus, v.literal("information")),
          sourceIds,
        }),
      ),
    }),
    children,
  }),
  v.object({
    type: v.literal("RequirementMatrix"),
    props: v.object({
      requirements: v.array(
        v.object({
          label: v.string(),
          evidence: v.string(),
          status: findingStatus,
          sourceIds,
        }),
      ),
    }),
    children,
  }),
  v.object({
    type: v.literal("DateList"),
    props: v.object({ dates: v.array(fact) }),
    children,
  }),
  v.object({
    type: v.literal("SourceReference"),
    props: v.object({ referenceId: v.string() }),
    children,
  }),
  v.object({
    type: v.literal("FileReference"),
    props: v.object({ referenceId: v.string() }),
    children,
  }),
  v.object({
    type: v.literal("ChoiceGroup"),
    props: v.object({
      label: v.string(),
      options: v.array(choice),
      submitLabel: v.string(),
    }),
    children,
  }),
  v.object({
    type: v.literal("RecordSelector"),
    props: v.object({
      label: v.string(),
      referenceIds: v.array(v.string()),
      submitLabel: v.string(),
    }),
    children,
  }),
  v.object({
    type: v.literal("ClarificationForm"),
    props: v.object({
      fields: v.array(
        v.object({
          id: v.string(),
          label: v.string(),
          type: v.union(
            v.literal("text"),
            v.literal("number"),
            v.literal("date"),
            v.literal("choice"),
            v.literal("record"),
          ),
          required: v.boolean(),
          options: v.optional(v.array(choice)),
        }),
      ),
      submitLabel: v.string(),
    }),
    children,
  }),
  v.object({
    type: v.literal("ActionGroup"),
    props: v.object({
      actions: v.array(
        v.object({
          label: v.string(),
          referenceId: v.optional(v.string()),
          followUp: v.optional(v.string()),
        }),
      ),
    }),
    children,
  }),
);

export const chatPresentationValidator = v.object({
  version: v.literal(1),
  spec: v.object({ root: v.string(), elements: v.record(v.string(), element) }),
  references: v.array(presentationReferenceValidator),
  sourceRevision: v.string(),
  createdAt: v.number(),
  decisionRequestId: v.optional(v.string()),
});
