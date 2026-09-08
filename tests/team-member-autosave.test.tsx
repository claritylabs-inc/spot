// @vitest-environment happy-dom
import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { createSyncStore, SyncProvider } from "@claritylabs/cl-sync";
import { expect, test, vi } from "vitest";
import { TeamMemberEditDrawer } from "@/components/settings/team-member-edit-drawer";
import type { TeamMember } from "@/components/settings/team-types";
import type { Id } from "@/convex/_generated/dataModel";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/settings/settings-drawer", () => ({
  SettingsDrawer: ({
    children,
    footer,
    onOpenChange,
  }: {
    children: ReactNode;
    footer: ReactNode;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <button onClick={() => onOpenChange(false)}>Close</button>
      {children}
      {footer}
    </div>
  ),
}));
(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const member: TeamMember = {
  membershipId: "membership" as Id<"orgMemberships">,
  userId: "user" as Id<"users">,
  role: "admin",
  name: "Example User",
  title: "Original title",
  isActivated: true,
};

test("failed member autosave retains the draft and close retries only the edited profile fields", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(undefined);
  const closed = vi.fn();
  function Editor() {
    const [title, setTitle] = useState(member.title!);
    return (
      <TeamMemberEditDrawer
        member={member}
        viewerUserId={member.userId}
        adminCount={1}
        primaryContactId={member.userId}
        name={member.name!}
        title={title}
        phone=""
        role="admin"
        email=""
        emailChangeError=""
        savingProfile={false}
        removingMember={false}
        requestingEmailChange={false}
        cancellingEmailChange={false}
        settingPrimaryContactUserId={null}
        onOpenChange={closed}
        onNameChange={() => {}}
        onTitleChange={setTitle}
        onPhoneChange={() => {}}
        onRoleChange={() => {}}
        onEmailChange={() => {}}
        onSave={save}
        onSaveRole={() => {}}
        onRemove={() => {}}
        onSetPrimary={() => {}}
        onRequestEmailChange={() => {}}
        onCancelEmailChange={() => {}}
      />
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const store = createSyncStore({
    scope: { appId: "team-test" },
    persistence: "memory",
  });
  try {
    await act(async () =>
      root.render(
        <SyncProvider store={store}>
          <Editor />
        </SyncProvider>,
      ),
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Title"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Changed title");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const close = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Close",
    )!;
    await act(async () => close.click());
    expect(closed).not.toHaveBeenCalled();
    expect(input.value).toBe("Changed title");
    expect(save).toHaveBeenLastCalledWith(member, {
      name: undefined,
      title: "Changed title",
      phone: undefined,
    });
    await act(async () => close.click());
    expect(closed).toHaveBeenCalledWith(false);
    expect(save).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
