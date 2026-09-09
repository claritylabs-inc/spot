// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PolicyEmptyState } from "@/components/policy-empty-state";
import { PolicyUploadDrawer } from "@/components/policy-upload-drawer";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
  }: {
    children: ReactNode;
    footer: ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

test.each(["drawer", "empty state"])(
  "%s keeps staged PDFs after a failed upload so the operator can retry",
  async (surface) => {
    const upload = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    const close = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const file = new File(["synthetic policy"], "local-qa-policy.pdf", {
      type: "application/pdf",
    });
    try {
      await act(async () =>
        root.render(
          surface === "drawer" ? (
            <PolicyUploadDrawer
              open
              onClose={close}
              onUpload={upload}
              uploading={false}
            />
          ) : (
            <PolicyEmptyState onUpload={upload} uploading={false} />
          ),
        ),
      );
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      await act(async () => {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [file],
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      function uploadButton() {
        return Array.from(container.querySelectorAll("button")).find(
          (button) => button.textContent === "Upload policy",
        )!;
      }
      await act(async () => uploadButton().click());
      expect(container.textContent).toContain(file.name);
      expect(close).not.toHaveBeenCalled();
      expect(upload).toHaveBeenLastCalledWith([file], "combined");
      await act(async () => uploadButton().click());
      expect(upload).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain(file.name);
      expect(close).toHaveBeenCalledTimes(surface === "drawer" ? 1 : 0);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
