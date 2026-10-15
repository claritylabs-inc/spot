"use client";

import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { OperatorClientRow } from "./client-model";

export function ClientLogoField({
  client,
  disabled = false,
  hideLabel = false,
}: {
  client: OperatorClientRow;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generateUploadUrl = useMutation(
    api.operator.generateClientLogoUploadUrl,
  );
  const update = useMutation(api.operator.updateClientSettings);

  async function upload(file: File) {
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB");
      return;
    }
    setBusy(true);
    const notification = toast.loading("Uploading logo…");
    try {
      const url = await generateUploadUrl({ clientOrgId: client._id });
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("Upload failed");
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await update({ clientOrgId: client._id, iconStorageId: storageId });
      toast.success("Client logo saved", { id: notification });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the client logo"),
        { id: notification },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5">
      {!hideLabel && (
        <span
          className={`block text-muted-foreground ${typeStyle("label.field")}`}
        >
          Logo
        </span>
      )}
      <div className="flex min-h-9 w-full items-center justify-between gap-3 px-3">
        <OrgBrandIcon name={client.name} iconUrl={client.iconUrl} size="md" />
        <PillButton
          variant="secondary"
          size="compact"
          disabled={disabled || busy}
          onClick={() => fileInput.current?.click()}
          title="PNG, JPG, or SVG · Up to 5 MB"
        >
          {busy ? "Uploading…" : client.iconUrl ? "Change logo" : "Upload logo"}
        </PillButton>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml"
          aria-label="Upload client logo"
          className="sr-only"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
    </div>
  );
}
