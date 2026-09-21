import { describe, expect, it } from "vitest";
import {
  parseChatPresentation,
  type ChatPresentation,
} from "./chat-presentation";

function presentation(): ChatPresentation {
  return {
    version: 1,
    sourceRevision: "message:attempt:1",
    createdAt: 1,
    references: [
      {
        id: "policy-a",
        kind: "policy",
        recordId: "policy-a",
        label: "General liability",
        href: "/policies/policy-a",
      },
    ],
    spec: {
      root: "root",
      elements: {
        root: { type: "Stack", props: {}, children: ["facts"] },
        facts: {
          type: "FactList",
          props: {
            facts: [
              { label: "Limit", value: "$1,000,000", sourceIds: ["policy-a"] },
            ],
          },
          children: [],
        },
      },
    },
  };
}

describe("chat presentation trust boundary", () => {
  it("rejects ambiguous form fields and unbound record choices", () => {
    const input = presentation();
    const field = {
      id: "policy",
      label: "Policy",
      type: "record" as const,
      required: true,
      options: [{ label: "Unknown", value: "missing" }],
    };
    input.spec.elements.facts = {
      type: "ClarificationForm",
      props: { fields: [field], submitLabel: "Continue" },
      children: [],
    };
    expect(parseChatPresentation(input)).toBeNull();
    field.options = [{ label: "General liability", value: "policy-a" }];
    expect(parseChatPresentation(input)).not.toBeNull();
    input.spec.elements.facts.props.fields.push(field);
    expect(parseChatPresentation(input)).toBeNull();
  });

  it("retains grounded facts and source references without changing the saved input", () => {
    const input = presentation();
    const before = structuredClone(input);
    expect(parseChatPresentation(input)).toEqual(before);
    expect(input).toEqual(before);
  });

  it("rejects executable props, expressions, and action hooks", () => {
    const input = presentation();
    expect(
      parseChatPresentation({
        ...input,
        spec: {
          ...input.spec,
          elements: {
            ...input.spec.elements,
            facts: {
              ...input.spec.elements.facts,
              on: { press: { action: "send_email" } },
            },
          },
        },
      }),
    ).toBeNull();
    expect(
      parseChatPresentation({
        ...input,
        spec: {
          ...input.spec,
          elements: {
            root: {
              type: "Text",
              props: { text: { $state: "/secret" } },
              children: [],
            },
          },
        },
      }),
    ).toBeNull();
  });

  it("falls back for unknown versions, components, and excessive payloads", () => {
    expect(parseChatPresentation({ ...presentation(), version: 2 })).toBeNull();
    const input = presentation();
    expect(
      parseChatPresentation({
        ...input,
        spec: {
          root: "x",
          elements: { x: { type: "iframe", props: {}, children: [] } },
        },
      }),
    ).toBeNull();
    expect(
      parseChatPresentation({ ...input, sourceRevision: "x".repeat(100_000) }),
    ).toBeNull();
  });

  it("rejects missing, shared, disconnected, and cyclic tree nodes", () => {
    for (const children of [["missing"], ["facts", "facts"], ["root"], []]) {
      const input = presentation();
      input.spec.elements.root.children = children;
      expect(parseChatPresentation(input)).toBeNull();
    }
  });

  it("rejects dangling evidence and unsafe navigation destinations", () => {
    const input = presentation();
    input.references = [];
    expect(parseChatPresentation(input)).toBeNull();
    for (const href of [
      "javascript:alert(1)",
      "https://outside.example",
      "//outside.example",
      "/\\outside.example",
      "/ bad",
    ]) {
      const invalid = presentation();
      invalid.references[0].href = href;
      expect(parseChatPresentation(invalid)).toBeNull();
    }
  });

  it("rejects misaligned comparison values instead of attributing them to the wrong policy", () => {
    const input = presentation();
    input.spec.elements.facts = {
      type: "ComparisonTable",
      props: {
        columns: [
          { id: "a", label: "Policy A" },
          { id: "b", label: "Policy B" },
        ],
        rows: [
          { label: "Limit", values: ["$1,000,000"], sourceIds: ["policy-a"] },
        ],
      },
      children: [],
    };
    expect(parseChatPresentation(input)).toBeNull();
  });
});
