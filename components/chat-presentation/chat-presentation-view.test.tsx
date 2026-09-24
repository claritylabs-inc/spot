// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type {
  ChatPresentation,
  PresentationReference,
} from "@/lib/chat-presentation";
import { ChatPresentationView } from "./chat-presentation-view";
import { referenceHref } from "./references";

const { query, openPreview, failRender } = vi.hoisted(() => ({
  query: vi.fn(),
  openPreview: vi.fn(),
  failRender: { value: false },
}));
vi.mock("convex/react", () => ({
  useConvex: () => {
    if (failRender.value) throw new Error("Preview unavailable");
    return { query };
  },
}));
vi.mock("@/hooks/use-entity-preview", () => ({
  useEntityPreview: () => ({ openPreview }),
}));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

const roots: Array<ReturnType<typeof createRoot>> = [];
function mount(
  presentation: unknown,
  onFollowUp?: (message: string) => Promise<void>,
) {
  const element = document.createElement("div");
  document.body.append(element);
  const root = createRoot(element);
  roots.push(root);
  act(() =>
    root.render(
      <ChatPresentationView
        presentation={presentation}
        onFollowUp={onFollowUp}
        answer={<p>Saved text answer</p>}
      />,
    ),
  );
  return element;
}
function envelope(
  element: ChatPresentation["spec"]["elements"][string],
  references: PresentationReference[] = [],
): ChatPresentation {
  return {
    version: 1,
    sourceRevision: "revision",
    createdAt: 1,
    references,
    spec: { root: "root", elements: { root: element } },
  };
}

afterEach(() => {
  roots.forEach((root) => act(() => root.unmount()));
  roots.length = 0;
  document.body.innerHTML = "";
  failRender.value = false;
  vi.resetAllMocks();
});

test("invalid persisted UI preserves the text answer and never creates controls", () => {
  const value = envelope({
    type: "Text",
    props: { text: "Hidden" },
    children: [],
  });
  const content = mount({
    ...value,
    spec: {
      ...value.spec,
      elements: {
        root: {
          ...value.spec.elements.root,
          on: { press: { action: "write" } },
        },
      },
    },
  });
  expect(content.textContent).toBe("Saved text answer");
  expect(content.querySelector("button")).toBeNull();
});

test("literal model props cannot introduce HTML or active navigation", () => {
  const content = mount(
    envelope({
      type: "Text",
      props: { text: '<a href="javascript:alert(1)">Click</a>' },
      children: [],
    }),
  );
  expect(content.textContent).toContain('<a href="javascript:alert(1)">');
  expect(content.querySelector("a")).toBeNull();
  const reference: PresentationReference = {
    id: "p",
    kind: "policy",
    recordId: "p1",
    label: "Policy",
  };
  for (const href of [
    "https://attacker.example",
    "//attacker.example",
    "/api/delete",
    "/policies/p2",
    "/policies/p1?redirect=https://attacker.example",
    "/policies/%2fp1",
  ])
    expect(referenceHref({ ...reference, href })).toBeUndefined();
  expect(referenceHref({ ...reference, href: "/policies/p1" })).toBe(
    "/policies/p1",
  );
});

test("source activation passes only validated policy evidence into the existing preview", () => {
  const content = mount(
    envelope(
      { type: "SourceReference", props: { referenceId: "s" }, children: [] },
      [
        {
          id: "s",
          kind: "source",
          recordId: "span",
          policyId: "policy",
          label: "Schedule",
          page: 4,
          sourceSpanIds: ["span"],
        },
      ],
    ),
  );
  act(() => content.querySelector("button")!.click());
  expect(openPreview).toHaveBeenCalledWith({
    type: "policy",
    id: "policy",
    page: 4,
    citedSourceSpanIds: ["span"],
  });
  expect(query).not.toHaveBeenCalled();
});

test("file access uses the authenticated lookup and never a persisted href", async () => {
  query
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce("https://storage.example/authorized");
  const content = mount(
    envelope(
      { type: "FileReference", props: { referenceId: "f" }, children: [] },
      [
        {
          id: "f",
          kind: "file",
          recordId: "client-file",
          label: "Evidence.txt",
          href: "/api/untrusted",
        },
      ],
    ),
  );
  await act(async () => content.querySelector("button")!.click());
  expect(query.mock.calls[0][1]).toEqual({ clientFileId: "client-file" });
  expect(content.querySelector("[role=alert]")?.textContent).toContain(
    "unavailable",
  );
  expect(content.querySelector("a")).toBeNull();
  await act(async () => content.querySelector("button")!.click());
  expect(content.querySelector("a")?.getAttribute("href")).toBe(
    "https://storage.example/authorized",
  );
});

test("sibling follow-up controls share a send lock and recover after rejection", async () => {
  let reject!: (error: Error) => void;
  const send = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const content = mount(
    envelope({
      type: "ActionGroup",
      props: {
        actions: [
          { label: "First", followUp: "First question" },
          { label: "Second", followUp: "Second question" },
        ],
      },
      children: [],
    }),
    send,
  );
  act(() => {
    const buttons = content.querySelectorAll("button");
    buttons[0].click();
    buttons[1].click();
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("offline")));
  expect(content.querySelectorAll("button")[0].disabled).toBe(false);
  expect(content.textContent).toContain("could not be sent");
});

test("request-shared files use their request grant without a global-file fallback", async () => {
  query
    .mockResolvedValueOnce({
      files: [
        {
          clientFileId: "shared-file",
          contentType: "text/plain",
          url: "https://storage.example/request-scoped",
        },
      ],
    })
    .mockResolvedValueOnce({ files: [] });
  const value = envelope(
    { type: "FileReference", props: { referenceId: "f" }, children: [] },
    [
      {
        id: "f",
        kind: "file",
        recordId: "shared-file",
        requestId: "request",
        label: "Shared.txt",
      },
    ],
  );
  const content = mount(value);
  await act(async () => content.querySelector("button")!.click());
  expect(query.mock.calls[0][1]).toEqual({ requestId: "request" });
  expect(content.querySelector("a")?.getAttribute("href")).toBe(
    "https://storage.example/request-scoped",
  );
  const missing = mount(value);
  await act(async () => missing.querySelector("button")!.click());
  expect(query).toHaveBeenCalledTimes(2);
  expect(missing.querySelector("a")?.getAttribute("href")).toBe(
    "/requests/request",
  );
});

test("verified public citations use native external navigation instead of record preview", () => {
  const content = mount(
    envelope(
      { type: "SourceReference", props: { referenceId: "s" }, children: [] },
      [
        {
          id: "s",
          kind: "source",
          recordId: "provider-source",
          label: "Provider appetite",
          sourceUrl: "https://provider.example/appetite",
        },
      ],
    ),
  );
  const link = content.querySelector("a")!;
  expect(link.getAttribute("href")).toBe("https://provider.example/appetite");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  link.addEventListener("click", (event) => event.preventDefault());
  act(() => link.click());
  expect(openPreview).not.toHaveBeenCalled();
  expect(query).not.toHaveBeenCalled();
});

test("unsafe or record-mixed external citations retain the saved text fallback", () => {
  for (const reference of [
    { sourceUrl: "javascript:alert(1)" },
    { sourceUrl: "https://user:secret@provider.example" },
    { sourceUrl: "https://provider.example", policyId: "policy" },
  ]) {
    const content = mount(
      envelope(
        { type: "SourceReference", props: { referenceId: "s" }, children: [] },
        [
          {
            id: "s",
            kind: "source",
            recordId: "source",
            label: "Source",
            ...reference,
          },
        ],
      ),
    );
    expect(content.textContent).toBe("Saved text answer");
    expect(content.querySelector("a")).toBeNull();
  }
});

test("vendor references use the existing vendor policies page rather than an arbitrary href", () => {
  const content = mount(
    envelope(
      {
        type: "ActionGroup",
        props: { actions: [{ label: "Open vendor", referenceId: "v" }] },
        children: [],
      },
      [
        {
          id: "v",
          kind: "vendor",
          recordId: "vendor-org",
          label: "Example vendor",
          href: "/api/untrusted",
        },
      ],
    ),
  );
  expect(content.querySelector("a")?.getAttribute("href")).toBe(
    "/connect/vendors/vendor-org/policies",
  );
});

test("shared fact citations render once while field-specific sources remain distinct", () => {
  const references: PresentationReference[] = [
    {
      id: "s1",
      kind: "source",
      recordId: "one",
      label: "Policy evidence",
      policyId: "policy-one",
    },
    {
      id: "s2",
      kind: "source",
      recordId: "two",
      label: "Endorsement",
      policyId: "policy-two",
    },
  ];
  const content = mount(
    envelope(
      {
        type: "FactList",
        props: {
          facts: [
            { label: "Limit", value: "$1,000,000", sourceIds: ["s1"] },
            { label: "Deductible", value: "$1,000", sourceIds: ["s1"] },
          ],
        },
        children: [],
      },
      references,
    ),
  );
  expect(content.querySelectorAll("button")).toHaveLength(1);
  const distinct = mount(
    envelope(
      {
        type: "FactList",
        props: {
          facts: [
            { label: "Limit", value: "$1,000,000", sourceIds: ["s1"] },
            { label: "Deductible", value: "$1,000", sourceIds: ["s2"] },
          ],
        },
        children: [],
      },
      references,
    ),
  );
  expect(distinct.querySelectorAll("button")).toHaveLength(2);
});

test("render failures suppress only structured UI and preserve the answer once", () => {
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  failRender.value = true;
  try {
    const content = mount(
      envelope(
        { type: "FileReference", props: { referenceId: "file" }, children: [] },
        [{ id: "file", kind: "file", recordId: "file", label: "Evidence.pdf" }],
      ),
    );
    expect(content.textContent).toBe("Saved text answer");
    expect(content.querySelector("button")).toBeNull();
  } finally {
    consoleError.mockRestore();
  }
});

test("vendor policies and canonical requirement and proposal tabs remain navigable", () => {
  const base = { id: "reference", recordId: "record", label: "Record" };
  const routes: Array<[PresentationReference["kind"], string]> = [
    ["policy", "/connect/vendors/vendor/policies/record"],
    ["requirement", "/compliance?tab=requirements"],
    [
      "requirement",
      "/operator/clients/client/compliance?tab=requirements&requirement=record",
    ],
    ["proposal", "/operator/clients/client/procurement/request?view=proposals"],
    [
      "proposal",
      "/operator/clients/client/procurement/request?view=proposals&proposal=record",
    ],
  ];
  for (const [kind, href] of routes)
    expect(referenceHref({ ...base, kind, href })).toBe(
      href === "/compliance?tab=requirements"
        ? "/compliance?tab=requirements&requirement=record"
        : href,
    );
  expect(
    referenceHref({
      ...base,
      kind: "policy",
      href: "/connect/vendors/vendor/policies/another",
    }),
  ).toBeUndefined();
  expect(
    referenceHref({
      ...base,
      kind: "requirement",
      href: "/compliance?tab=requirements&requirement=another",
    }),
  ).toBeUndefined();
  expect(
    referenceHref({
      ...base,
      kind: "proposal",
      href: "/operator/clients/client/procurement/request?view=proposals&proposal=another",
    }),
  ).toBeUndefined();
});

test("requirement citations inspect only the exact source returned by the authorized organization query", async () => {
  query
    .mockResolvedValueOnce([
      {
        _id: "source-record",
        title: "Lease insurance requirements",
        sourceType: "lease_agreement",
        fileName: "Lease.pdf",
        sourceTextExcerpt: "Maintain $2,000,000 general aggregate.",
      },
    ])
    .mockResolvedValueOnce([]);
  const value = envelope(
    { type: "SourceReference", props: { referenceId: "source" }, children: [] },
    [
      {
        id: "source",
        kind: "source",
        recordId: "source-record",
        label: "Lease requirements",
        href: "/operator/clients/client-org/compliance?tab=sources&source=source-record",
      },
    ],
  );
  const content = mount(value);
  await act(async () => content.querySelector("button")!.click());
  expect(query.mock.calls[0][1]).toEqual({ orgId: "client-org" });
  expect(content.textContent).toContain(
    "Maintain $2,000,000 general aggregate.",
  );
  expect(openPreview).not.toHaveBeenCalled();
  const denied = mount(value);
  await act(async () => denied.querySelector("button")!.click());
  expect(denied.querySelector("[role=alert]")?.textContent).toContain(
    "Source unavailable",
  );
  expect(denied.textContent).not.toContain("Maintain $2,000,000");
});

test("requirement navigation normalizes the exact target with or without a requirements tab", () => {
  const reference: PresentationReference = {
    id: "r",
    kind: "requirement",
    recordId: "requirement-record",
    label: "Requirement",
  };
  for (const path of [
    "/compliance",
    "/operator/clients/client-org/compliance",
  ]) {
    for (const queryString of [
      "requirement=requirement-record",
      "tab=requirements&requirement=requirement-record",
      "requirement=requirement-record&tab=requirements",
    ]) {
      expect(
        referenceHref({ ...reference, href: `${path}?${queryString}` }),
      ).toBe(`${path}?tab=requirements&requirement=requirement-record`);
    }
    for (const queryString of [
      "requirement=another",
      "requirement=requirement-record&tab=sources",
      "requirement=requirement-record&redirect=elsewhere",
      "requirement=requirement-record&requirement=another",
    ]) {
      expect(
        referenceHref({ ...reference, href: `${path}?${queryString}` }),
      ).toBeUndefined();
    }
  }
});

test("connected requirement citations navigate to the authorized requirement without reading the foreign source", () => {
  for (const href of [
    "/compliance?requirement=authorized-requirement",
    "/operator/clients/client-org/compliance?tab=requirements&requirement=authorized-requirement",
  ]) {
    const content = mount(
      envelope(
        {
          type: "SourceReference",
          props: { referenceId: "connected-source" },
          children: [],
        },
        [
          {
            id: "connected-source",
            kind: "source",
            recordId: "foreign-source",
            label: "Shared lease requirements",
            href,
          },
        ],
      ),
    );
    const link = content.querySelector("a")!;
    expect(link.textContent).toBe("Shared lease requirements");
    expect(link.getAttribute("href")).toBe(
      `${href.split("?")[0]}?tab=requirements&requirement=authorized-requirement`,
    );
    link.addEventListener("click", (event) => event.preventDefault());
    act(() => link.click());
    expect(content.querySelector("button")).toBeNull();
  }
  expect(query).not.toHaveBeenCalled();
  expect(openPreview).not.toHaveBeenCalled();
});

test("invalid source destinations never fall through to owner source inspection", () => {
  for (const suffix of [
    "requirement=foreign-source",
    "requirement=",
    "requirement=authorized&tab=sources",
    "source=another",
    "tab=unknown",
  ]) {
    const content = mount(
      envelope(
        {
          type: "SourceReference",
          props: { referenceId: "source" },
          children: [],
        },
        [
          {
            id: "source",
            kind: "source",
            recordId: "foreign-source",
            label: "Source metadata",
            href: `/operator/clients/client-org/compliance?${suffix}`,
          },
        ],
      ),
    );
    expect(content.querySelector("button")).toBeNull();
    expect(content.querySelector("a")).toBeNull();
    expect(content.textContent).toContain("Source metadata");
  }
  expect(query).not.toHaveBeenCalled();
});

test("vendor references preserve exact operator destinations and constrain all navigation to their record", () => {
  const reference: PresentationReference = {
    id: "v",
    kind: "vendor",
    recordId: "vendor-org",
    label: "Example vendor",
  };
  expect(
    referenceHref({ ...reference, href: "/operator/clients/vendor-org" }),
  ).toBe("/operator/clients/vendor-org");
  expect(
    referenceHref({
      ...reference,
      href: "/connect/vendors/vendor-org/policies",
    }),
  ).toBe("/connect/vendors/vendor-org/policies");
  for (const href of [
    "/operator/clients/other-org",
    "/connect/vendors/other-org/policies",
    "/operator/clients/vendor-org?redirect=elsewhere",
  ]) {
    expect(referenceHref({ ...reference, href })).toBe(
      "/connect/vendors/vendor-org/policies",
    );
  }
  const content = mount(
    envelope(
      {
        type: "ActionGroup",
        props: { actions: [{ label: "Open vendor", referenceId: "v" }] },
        children: [],
      },
      [{ ...reference, href: "/operator/clients/vendor-org" }],
    ),
  );
  expect(content.querySelector("a")?.getAttribute("href")).toBe(
    "/operator/clients/vendor-org",
  );
  expect(query).not.toHaveBeenCalled();
});

test("direct source and sources-tab citations retain authenticated source inspection", async () => {
  query.mockResolvedValue([]);
  for (const suffix of ["source=source-record", "tab=sources"]) {
    const content = mount(
      envelope(
        {
          type: "SourceReference",
          props: { referenceId: "source" },
          children: [],
        },
        [
          {
            id: "source",
            kind: "source",
            recordId: "source-record",
            label: "Source metadata",
            href: `/operator/clients/client-org/compliance?${suffix}`,
          },
        ],
      ),
    );
    await act(async () => content.querySelector("button")!.click());
    expect(query).toHaveBeenLastCalledWith(expect.anything(), {
      orgId: "client-org",
    });
    expect(content.querySelector('[role="alert"]')?.textContent).toContain(
      "Source unavailable",
    );
  }
  expect(query).toHaveBeenCalledTimes(2);
});
