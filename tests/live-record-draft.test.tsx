// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { expect, test, vi } from "vitest";
import { useLiveRecordDraft } from "@/lib/sync/use-live-record-draft";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test("live agent updates stay visible while failed and in-flight edits retain only local intent", async () => {
  let source = { name: "Harbor", industry: "", industryVertical: "" };
  let recordKey = "harbor";
  const flush = vi.fn(async (patch: Partial<typeof source>) => {
    source = { ...source, ...patch };
  });
  let editor!: ReturnType<typeof useLiveRecordDraft<typeof source>>;
  let autoSave!: ReturnType<typeof useLocalFirstAutoSave>;
  function Harness() {
    editor = useLiveRecordDraft(recordKey, source);
    const draft = editor;
    autoSave = useLocalFirstAutoSave({
      mutationName: "test.live-profile",
      resetKey: recordKey,
      args: { patch: draft.patch, revision: draft.revision },
      valueKey: String(draft.revision),
      autoSave: false,
      flush: async ({ patch, revision }) => {
        await flush(patch);
        draft.acknowledge(revision);
      },
    });
    return <output>{JSON.stringify(draft.value)}</output>;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "live-profile-test" },
    persistence: "memory",
  });
  const render = () =>
    act(async () =>
      root.render(
        <SyncProvider store={store}>
          <Harness />
        </SyncProvider>,
      ),
    );
  try {
    await render();
    source = {
      ...source,
      industry: "manufacturing",
      industryVertical: "food_beverage_mfg",
    };
    await render();
    expect(JSON.parse(container.textContent!)).toEqual(source);
    expect(autoSave.status).toBe("saved");
    await act(async () => {
      await autoSave.saveNow();
    });
    expect(flush).not.toHaveBeenCalled();

    await act(async () => editor.field("name")("Harbor Foods"));
    source = { ...source, industry: "retail", industryVertical: "grocery" };
    await render();
    expect(editor.value).toEqual({ ...source, name: "Harbor Foods" });
    flush.mockRejectedValueOnce(new Error("Offline"));
    await act(async () => {
      await autoSave.saveNow();
    });
    expect(autoSave.status).toBe("error");
    expect(editor.value.name).toBe("Harbor Foods");
    expect(flush).toHaveBeenLastCalledWith({ name: "Harbor Foods" });

    let finish!: () => void;
    flush.mockImplementationOnce(
      (patch) =>
        new Promise<void>((resolve) => {
          finish = () => {
            source = { ...source, ...patch };
            resolve();
          };
        }),
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = autoSave.saveNow();
    });
    // Reverting while an earlier write is pending is still an edit to persist.
    await act(async () => editor.field("name")("Harbor"));
    await act(async () => {
      finish();
      await pending;
    });
    expect(editor.value.name).toBe("Harbor");
    await act(async () => {
      await autoSave.saveNow();
    });
    expect(source).toEqual({
      name: "Harbor",
      industry: "retail",
      industryVertical: "grocery",
    });
    expect(editor.patch).toEqual({});
    expect(autoSave.status).toBe("saved");

    source = { ...source, name: "Agent's updated name" };
    await render();
    expect(editor.value.name).toBe("Agent's updated name");
    await act(async () => editor.field("name")("Unsaved local name"));
    const oldAcknowledgement = editor.acknowledge;
    recordKey = "another-client";
    source = { name: "Another client", industry: "", industryVertical: "" };
    await render();
    expect(editor.value).toEqual(source);
    expect(editor.patch).toEqual({});
    recordKey = "harbor";
    await render();
    await act(async () => editor.field("name")("New draft after returning"));
    await act(async () => oldAcknowledgement(100));
    expect(editor.value.name).toBe("New draft after returning");
    await act(async () => {
      await autoSave.saveNow();
    });
  } finally {
    await act(async () => root.unmount());
  }
});
