// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Id } from "@/convex/_generated/dataModel";
import { ClientFileUploadPanel } from "./client-files-workspace";

const mutations = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  registerUpload: vi.fn(),
  discardUpload: vi.fn(),
}));
vi.mock("convex/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("convex/react")>()),
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) =>
    mutations[
      getFunctionName(reference).split(":")[1] as keyof typeof mutations
    ],
}));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => <>{children}{footer}</>,
}));

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  mutations.generateUploadUrl.mockResolvedValue({
    uploadUrl: "https://upload.example.com",
    uploadIntentId: "intent",
  });
  mutations.registerUpload.mockResolvedValue({
    clientFileId: "file",
    status: "created",
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ storageId: "storage" }),
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

test.each([
  { clientVisible: false, brokerVisible: false },
  { clientVisible: true, brokerVisible: false },
  { clientVisible: false, brokerVisible: true },
  { clientVisible: true, brokerVisible: true },
])("uploads preserve independent sharing choices: %j", async (visibility) => {
  const onUploaded = vi.fn();
  const onClose = vi.fn();
  await act(async () => {
    root.render(
      <ClientFileUploadPanel
        clientOrgId={"client" as Id<"organizations">}
        showBrokerVisibility
        onUploaded={onUploaded}
        onClose={onClose}
      />,
    );
  });
  for (const [label, enabled] of [
    ["Client visibility", visibility.clientVisible],
    ["Broker visibility", visibility.brokerVisible],
  ] as const) {
    const toggle = container.querySelector<HTMLButtonElement>(
      `[role="switch"][aria-label="${label}"]`,
    )!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    if (enabled) await act(async () => toggle.click());
  }
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    )!;
    Object.defineProperty(input, "files", {
      value: [new File(["report"], "report.pdf", { type: "application/pdf" })],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Upload files")!.click();
  });
  expect(mutations.registerUpload).toHaveBeenCalledWith({
    uploadIntentId: "intent",
    fileId: "storage",
    originalName: "report.pdf",
    contentType: "application/pdf",
    clientVisible: visibility.clientVisible,
    hint: undefined,
  });
  expect(onUploaded).toHaveBeenCalledWith(
    [{ clientFileId: "file", originalName: "report.pdf" }],
    visibility,
  );
  expect(onClose).toHaveBeenCalledOnce();
});
