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

const { query, openPreview } = vi.hoisted(() => ({
  query: vi.fn(),
  openPreview: vi.fn(),
}));
vi.mock("convex/react", () => ({ useConvex: () => ({ query }) }));
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
        fallback={<p>Saved text answer</p>}
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

test("empty layout envelopes retain the saved text answer", () => {
  const content = mount(envelope({ type: "Stack", props: {}, children: [] }));
  expect(content.textContent).toBe("Saved text answer");
});
