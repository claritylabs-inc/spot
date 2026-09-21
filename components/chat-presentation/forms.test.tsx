// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  PresentationProps,
  PresentationReference,
} from "@/lib/chat-presentation";
import { PresentationContext } from "./context";
import {
  buildClarificationFollowUp,
  ClarificationForm,
  FollowUpButton,
  RecordSelector,
} from "./forms";

const references = new Map<string, PresentationReference>([
  [
    "policy-a",
    {
      id: "policy-a",
      kind: "policy",
      recordId: "record-a",
      label: "General liability",
    },
  ],
]);
const fields: PresentationProps<"ClarificationForm">["fields"] = [
  { id: "amount", label: "Limit", type: "number", required: true },
  { id: "date", label: "Effective date", type: "date", required: true },
  {
    id: "policy",
    label: "Policy",
    type: "record",
    required: true,
    options: [{ value: "policy-a", label: "General liability" }],
  },
];

test("answers reject malformed numbers, invalid dates and unoffered records before creating a chat follow-up", () => {
  const invalid = buildClarificationFollowUp(
    fields,
    { amount: "Infinity", date: "2025-02-29", policy: "policy-b" },
    references,
  );
  expect(Object.keys(invalid.errors)).toEqual(["amount", "date", "policy"]);
  expect(
    buildClarificationFollowUp(
      fields,
      { amount: "0x10", date: "2026-04-31", policy: "policy-a" },
      references,
    ).errors,
  ).toEqual({
    amount: expect.any(String),
    date: expect.any(String),
  });
  expect(
    buildClarificationFollowUp(
      fields,
      { amount: "2500000.50", date: "2028-02-29", policy: "policy-a" },
      references,
    ),
  ).toEqual({
    errors: {},
    message:
      "Limit: 2500000.50\nEffective date: 2028-02-29\nPolicy: General liability (policy: record-a)",
  });
});

test("answers enforce required values, literal text bounds, and the offered choice set", () => {
  const textFields: PresentationProps<"ClarificationForm">["fields"] = [
    { id: "required", label: "Operations", type: "text", required: true },
    { id: "optional", label: "Note", type: "text", required: false },
    {
      id: "choice",
      label: "Term",
      type: "choice",
      required: true,
      options: [{ value: "annual", label: "Annual" }],
    },
  ];
  expect(
    Object.keys(
      buildClarificationFollowUp(
        textFields,
        { required: " ", optional: "a".repeat(2001), choice: "monthly" },
        references,
      ).errors,
    ),
  ).toEqual(["required", "optional", "choice"]);
  expect(
    buildClarificationFollowUp(
      textFields,
      { required: "Retail", optional: "", choice: "annual" },
      references,
    ),
  ).toEqual({ errors: {}, message: "Operations: Retail\nTerm: Annual" });
  expect(
    buildClarificationFollowUp([fields[2]], { policy: "policy-a" }, new Map())
      .errors.policy,
  ).toBeTruthy();
});

test("field identifiers cannot inherit draft values or suppress required validation", () => {
  const reservedFields: PresentationProps<"ClarificationForm">["fields"] = [
    { id: "__proto__", label: "Operations", type: "text", required: true },
    { id: "constructor", label: "Details", type: "text", required: true },
  ];
  expect(
    Object.keys(
      buildClarificationFollowUp(reservedFields, {}, references).errors,
    ),
  ).toEqual(["__proto__", "constructor"]);
  expect(
    buildClarificationFollowUp(
      reservedFields,
      Object.fromEntries([
        ["__proto__", "Retail"],
        ["constructor", "Stores"],
      ]),
      references,
    ),
  ).toEqual({ errors: {}, message: "Operations: Retail\nDetails: Stores" });
});

let root: Root;
let container: HTMLDivElement;
const onFollowUp =
  vi.fn<
    (
      message: string,
      selectedReferences?: PresentationReference[],
    ) => Promise<void>
  >();
async function render(
  children: ReactNode,
  disabled = false,
  structuredReferences = false,
  availableReferences = references,
) {
  await act(async () =>
    root.render(
      <PresentationContext.Provider
        value={{
          references: availableReferences,
          disabled,
          structuredReferences,
          onFollowUp,
          openRecord: vi.fn(),
        }}
      >
        {children}
      </PresentationContext.Provider>,
    ),
  );
}
async function enter(value: string) {
  await act(async () => {
    const input = container.querySelector("input")!;
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const form = (
  <ClarificationForm
    fields={[
      { id: "operations", label: "Operations", type: "text", required: true },
    ]}
    submitLabel="Send reply"
  />
);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onFollowUp.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test("a failed follow-up retains the entered draft for retry and a successful reply cannot be sent twice", async () => {
  onFollowUp
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  await render(form);
  await enter("Retail operations");
  await submit();
  expect(onFollowUp).toHaveBeenCalledWith(
    "Operations: Retail operations",
    undefined,
  );
  expect(container.querySelector("input")?.value).toBe("Retail operations");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await submit();
  await submit();
  expect(onFollowUp).toHaveBeenCalledTimes(2);
  expect(container.querySelector("button")?.disabled).toBe(true);
});

test("active runs, IME composition, and in-flight delivery block follow-up submission", async () => {
  let finish!: () => void;
  onFollowUp.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await render(form);
  await enter("Retail operations");
  await render(form, true);
  await submit();
  expect(onFollowUp).not.toHaveBeenCalled();
  await render(form);
  await act(async () =>
    container
      .querySelector("input")!
      .dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      ),
  );
  await submit();
  expect(onFollowUp).not.toHaveBeenCalled();
  await act(async () =>
    container
      .querySelector("input")!
      .dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
  );
  await submit();
  await submit();
  expect(onFollowUp).toHaveBeenCalledTimes(1);
  expect(container.querySelector("input")?.disabled).toBe(true);
  await act(async () => finish());
});

test("action follow-ups require an explicit click and allow retry after failure", async () => {
  onFollowUp
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  await render(
    <FollowUpButton message="Compare these policies" label="Compare" />,
  );
  expect(onFollowUp).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => container.querySelector("button")!.click());
  await act(async () => container.querySelector("button")!.click());
  expect(onFollowUp).toHaveBeenCalledTimes(2);
  expect(onFollowUp).toHaveBeenLastCalledWith(
    "Compare these policies",
    undefined,
  );
});

test("structured selections keep exact policy and requirement metadata without exposing IDs in the reply", () => {
  const policy = references.get("policy-a")!;
  const requirement: PresentationReference = {
    id: "requirement-a",
    kind: "requirement",
    recordId: "requirement-record",
    label: "Liability minimum",
  };
  const vendor: PresentationReference = {
    id: "vendor-a",
    kind: "vendor",
    recordId: "vendor-record",
    label: "Example vendor",
  };
  const selectedFields = [policy, requirement, vendor].map(
    (reference): PresentationProps<"ClarificationForm">["fields"][number] => ({
      id: reference.id,
      label: reference.kind,
      type: "record",
      required: true,
      options: [{ value: reference.id, label: reference.label }],
    }),
  );
  const choices = new Map(
    [policy, requirement, vendor].map((reference) => [reference.id, reference]),
  );
  const values = Object.fromEntries([...choices.keys()].map((id) => [id, id]));
  expect(
    buildClarificationFollowUp(selectedFields, values, choices, true),
  ).toEqual({
    errors: {},
    message:
      "policy: @General liability\nrequirement: @Liability minimum\nvendor: Example vendor (vendor: vendor-record)",
    selectedReferences: [policy, requirement],
  });
  expect(
    buildClarificationFollowUp(selectedFields, values, choices)
      .selectedReferences,
  ).toBeUndefined();
});

test("distinct record selections with identical labels submit their exact identities without silent deduplication", async () => {
  onFollowUp.mockResolvedValue(undefined);
  const first = references.get("policy-a")!;
  const second: PresentationReference = {
    ...first,
    id: "policy-b",
    recordId: "record-b",
  };
  await render(
    <RecordSelector
      label="Policy"
      referenceIds={[first.id, second.id]}
      submitLabel="Send reply"
    />,
    false,
    true,
    new Map([
      [first.id, first],
      [second.id, second],
    ]),
  );
  async function choose(index: number) {
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[role="combobox"]')!.click(),
    );
    await act(async () => {
      const option =
        document.querySelectorAll<HTMLElement>('[role="option"]')[index];
      option.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          pointerType: "touch",
        }),
      );
      option.click();
    });
  }
  await choose(0);
  await submit();
  expect(onFollowUp).toHaveBeenNthCalledWith(1, "Policy: @General liability", [
    first,
  ]);
  await choose(1);
  await submit();
  expect(onFollowUp).toHaveBeenNthCalledWith(2, "Policy: @General liability", [
    second,
  ]);
  await submit();
  expect(onFollowUp).toHaveBeenCalledTimes(2);
});
