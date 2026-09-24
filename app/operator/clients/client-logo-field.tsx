"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import type { OperatorClientRow } from "./client-model";

export function ClientLogoField({
  client,
  disabled = false,
}: {
  client: OperatorClientRow;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
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
      <span
        className={`block text-muted-foreground ${typeStyle("label.field")}`}
      >
        Logo
      </span>
      <div className="space-y-2.5">
        <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-muted/20 p-3">
          <OrgBrandIcon
            name={client.name}
            iconUrl={client.iconUrl}
            size="xl"
            className="rounded-lg"
          />
          <div className="min-w-0">
            <p className={typeStyle("body.medium")}>{client.name}</p>
            <p
              className={`text-muted-foreground ${typeStyle("caption.default")}`}
            >
              {client.iconUrl ? "Current logo" : "No logo uploaded yet"}
            </p>
          </div>
        </div>
        <FileDropZone
          padding="px-4 py-3"
          accept="image/*"
          disabled={disabled || busy}
          idleLabel="Upload a logo"
          activeLabel="Drop logo to upload"
          hint="PNG, JPG, or SVG · Max 5 MB"
          className="min-h-24"
          onFile={(file) => void upload(file)}
        />
      </div>
    </div>
  );
}
