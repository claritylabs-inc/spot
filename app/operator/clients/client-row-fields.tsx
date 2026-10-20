"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { StatusLabel } from "@claritylabs-inc/ui/components/status-tag";
import { useOperatorClientCacheActions } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  OPERATOR_CLIENT_STATUSES,
  operatorClientStatusLabel,
  operatorClientStatusPresentation,
  operatorClientStatuses,
  type OperatorClientRow,
} from "./client-model";

export function ClientWebsiteField({
  client,
  disabled,
}: {
  client: OperatorClientRow;
  disabled?: boolean;
}) {
  const update = useMutation(api.operator.updateClientSettings);
  const { patchClientSettings } = useOperatorClientCacheActions();
  const saved = client.website ?? "";
  const [draft, setDraft] = useState<string | null>(null);

  async function commit() {
    if (draft === null) return;
    const website = draft.trim();
    setDraft(null);
    if (website === saved) return;
    await patchClientSettings(client._id, { website });
    try {
      await update({ clientOrgId: client._id, website });
    } catch (error) {
      await patchClientSettings(client._id, { website: saved });
      toast.error(getUserFacingErrorMessage(error, "Could not save the website"));
    }
  }

  return (
    <Input
      aria-label={`Website for ${client.name}`}
      placeholder="Not set"
      disabled={disabled}
      value={draft ?? saved}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className="truncate"
    />
  );
}

export function ClientStatusField({
  client,
  disabled,
}: {
  client: OperatorClientRow;
  disabled?: boolean;
}) {
  const setStatus = useMutation(api.operator.setSoloClientStatus);
  const { patchClientStatus } = useOperatorClientCacheActions();

  async function change(status: OperatorClientRow["clientAccessStatus"]) {
    const previous = client.clientAccessStatus;
    if (status === previous) return;
    await patchClientStatus(client._id, status);
    try {
      await setStatus({ clientOrgId: client._id, status });
    } catch (error) {
      await patchClientStatus(client._id, previous);
      toast.error(getUserFacingErrorMessage(error, "Could not save the status"));
    }
  }

  return (
    <Select
      value={client.clientAccessStatus}
      items={operatorClientStatuses}
      disabled={disabled}
      onValueChange={(value) => {
        if (value && value in OPERATOR_CLIENT_STATUSES)
          void change(value as OperatorClientRow["clientAccessStatus"]);
      }}
    >
      <SelectTrigger className="w-full" aria-label={`Status for ${client.name}`}>
        <SelectValue>
          <StatusLabel {...operatorClientStatusPresentation(client)}>
            {operatorClientStatusLabel(client)}
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
  );
}
