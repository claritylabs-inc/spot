// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { expect, test, vi } from "vitest";
import { RequirementEditForm } from "@/components/compliance-page";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("editing a labeled imported limit preserves its numeric value and failed close keeps the draft retryable", async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  const editor = createRef<{ save: () => Promise<boolean> }>();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({ scope: { appId: "requirement-test" }, persistence: "memory" });
  try {
    await act(async () => root.render(
      <SyncProvider store={store}>
        <RequirementEditForm
          ref={editor}
          requirement={{
            _id: "requirement" as Id<"insuranceRequirements">,
            orgId: "org" as Id<"organizations">,
            scope: "own_org",
            title: "Cyber requirement",
            lineOfBusiness: "CYBER",
            limits: [{ kind: "aggregate", amount: 5_000_000.25, label: "CAD 5,000,000.25 aggregate" }],
            requirementText: "Carry cyber insurance.",
            updatedAt: 1,
          }}
          onSave={save}
        />
      </SyncProvider>,
    ));
    expect(container.textContent).not.toContain("Enter a valid limit amount");
    const title = container.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      title.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(title, "Updated cyber requirement");
      title.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let closed = true;
    await act(async () => { closed = await editor.current!.save(); });
    expect(closed).toBe(false);
    expect(title.value).toBe("Updated cyber requirement");
    await act(async () => { closed = await editor.current!.save(); });
    expect(closed).toBe(true);
    expect(save.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
      title: "Updated cyber requirement",
      limits: [expect.objectContaining({ kind: "aggregate", amount: 5_000_000.25 })],
    }));
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
