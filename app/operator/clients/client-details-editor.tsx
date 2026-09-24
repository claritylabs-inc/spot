"use client";

import { useImperativeHandle, type Ref } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { StatusLabel } from "@claritylabs-inc/ui/components/status-tag";
import { Input } from "@claritylabs-inc/ui/components/input";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { useLiveRecordDraft } from "@/lib/sync/use-live-record-draft";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { useOperatorClientCacheActions } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ClientLogoField } from "./client-logo-field";
import {
  OPERATOR_CLIENT_STATUSES,
  operatorClientStatuses,
  type OperatorClientRow,
} from "./client-model";

export type ClientEditorHandle = { saveNow: () => Promise<boolean> };

export function ClientDetailsEditor({
  client,
  ref,
  disabled = false,
}: {
  client: OperatorClientRow;
  ref: Ref<ClientEditorHandle>;
  disabled?: boolean;
}) {
  const update = useMutation(api.operator.updateClientSettings);
  const setStatus = useMutation(api.operator.setSoloClientStatus);
  const { patchClientSettings, patchClientStatus } =
    useOperatorClientCacheActions();
  const draft = useLiveRecordDraft(client._id, {
    name: client.name,
    website: client.website ?? "",
    status: client.operatorStatus,
  });
  const { label: statusLabel, ...statusPresentation } =
    OPERATOR_CLIENT_STATUSES[draft.value.status];
  const autoSave = useLocalFirstAutoSave({
    mutationName: "operator.updateClientSettings",
    resetKey: client._id,
    valueKey: String(draft.revision),
    args: { patch: draft.patch, revision: draft.revision },
    enabled: !disabled,
    canSave: Boolean(draft.value.name.trim()),
    flush: async ({ patch, revision }) => {
      const { status, ...settings } = patch;
      if (Object.keys(settings).length) {
        const normalized = {
          ...(settings.name !== undefined
            ? { name: settings.name.trim() }
            : {}),
          ...(settings.website !== undefined
            ? { website: settings.website.trim() }
            : {}),
        };
        await update({ clientOrgId: client._id, ...normalized });
        await patchClientSettings(client._id, normalized);
      }
      if (status !== undefined) {
        await setStatus({ clientOrgId: client._id, status });
        await patchClientStatus(client._id, status);
      }
      draft.acknowledge(revision);
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not save the client"),
  });
  useImperativeHandle(ref, () => ({
    saveNow: disabled ? async () => true : autoSave.saveNow,
  }));
  return (
    <div className="space-y-4">
      <AutoSaveStatus status={autoSave.status} />
      <label className="block space-y-1.5">
        <span className={`text-muted-foreground ${typeStyle("label.field")}`}>
          Client name
        </span>
        <Input
          value={draft.value.name}
          disabled={disabled}
          aria-invalid={!draft.value.name.trim()}
          onChange={(event) => draft.field("name")(event.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
        {!draft.value.name.trim() ? (
          <span className={`text-destructive ${typeStyle("caption.default")}`}>
            Client name is required
          </span>
        ) : null}
      </label>
      <label className="block space-y-1.5">
        <span className={`text-muted-foreground ${typeStyle("label.field")}`}>
          Website
        </span>
        <Input
          value={draft.value.website}
          disabled={disabled}
          placeholder="https://example.com"
          onChange={(event) => draft.field("website")(event.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </label>
      <ClientLogoField client={client} disabled={disabled} />
      <label className="block space-y-1.5">
        <span className={`text-muted-foreground ${typeStyle("label.field")}`}>
          Status
        </span>
        <Select
          value={draft.value.status}
          items={operatorClientStatuses}
          disabled={disabled}
          onValueChange={(value) => {
            if (
              value === "live" ||
              value === "onboarding" ||
              value === "lost" ||
              value === "churned"
            )
              draft.field("status")(value);
          }}
        >
          <SelectTrigger className="w-full">
            <SelectValue>
              <StatusLabel {...statusPresentation}>
                {statusLabel}
              </StatusLabel>
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {Object.entries(OPERATOR_CLIENT_STATUSES).map(
              ([value, { label, ...presentation }]) => (
                <SelectItem key={value} value={value}>
                  <StatusLabel {...presentation}>{label}</StatusLabel>
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </label>
      {autoSave.status === "error" ? (
        <PillButton variant="secondary" onClick={() => void autoSave.saveNow()}>
          Retry save
        </PillButton>
      ) : null}
    </div>
  );
}
