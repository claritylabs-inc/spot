"use client";

import { normalizeWebsiteUrl } from "@claritylabs-inc/ui/lib/website";
import { WebsiteInput } from "@claritylabs-inc/ui/components/website-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { useRef, useState } from "react";
import { useMutation } from "convex/react";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { ChatAvatar } from "@/components/chat/chat-message";
import { cn } from "@/lib/utils";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
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
  const cancelled = useRef(false);

  async function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const website = normalizeWebsiteUrl(draft) ?? draft.trim();
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
    <WebsiteInput
      aria-label={`Website for ${client.name}`}
      disabled={disabled}
      value={draft ?? saved}
      onChange={setDraft}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          cancelled.current = true;
          event.currentTarget.blur();
        }
      }}
      // The https:// prefix shows only while editing.
      groupClassName="-ml-[13px] w-[calc(100%+13px)] [&>[data-slot=input-group-addon]]:pl-3! [&:not(:focus-within)>[data-slot=input-group-addon]]:hidden"
      className="truncate bg-transparent! not-focus:pl-3!"
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

  const { label, ...presentation } =
    OPERATOR_CLIENT_STATUSES[client.clientAccessStatus];

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
      <SelectTrigger
        className="-ml-[13px] w-[calc(100%+13px)]"
        aria-label={`Status for ${client.name}`}>
        <SelectValue>
          <StatusLabel {...presentation}>{label}</StatusLabel>
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

const UNASSIGNED = "unassigned";

type AssignableOperator = {
  userId: Id<"users">;
  name: string;
  avatarUrl: string | null;
};

function AssigneeOption({
  operator,
  compact,
}: {
  operator: AssignableOperator | undefined;
  /** Avatar only until the column is wide enough to fit the name. */
  compact?: boolean;
}) {
  const name = operator?.name ?? "Unassigned";
  return (
    <span className="flex min-w-0 items-center gap-2" title={name}>
      <ChatAvatar
        name={name}
        imageUrl={operator?.avatarUrl}
        className={cn(
          "size-5",
          !operator &&
            "border border-dashed border-muted-foreground/50 bg-transparent text-muted-foreground",
        )}
      >
        {operator ? undefined : <UserRound className="size-3" />}
      </ChatAvatar>
      <span
        className={cn(
          "truncate",
          !operator && "text-muted-foreground",
          compact && "hidden @[6.5rem]:inline",
        )}
      >
        {name}
      </span>
    </span>
  );
}

export function ClientAssigneeField({
  client,
  operators,
  disabled,
}: {
  client: OperatorClientRow;
  operators: AssignableOperator[];
  disabled?: boolean;
}) {
  const assign = useMutation(api.operator.setClientAssignee);
  const { patchClientSettings } = useOperatorClientCacheActions();
  const byId = new Map(operators.map((operator) => [operator.userId, operator]));
  const items: Record<string, string> = {
    [UNASSIGNED]: "Unassigned",
    ...Object.fromEntries(operators.map(({ userId, name }) => [userId, name])),
  };
  const assigned = client.assignedOperatorUserId
    ? byId.get(client.assignedOperatorUserId)
    : undefined;

  async function change(value: string) {
    const previous = client.assignedOperatorUserId;
    const next = value === UNASSIGNED ? undefined : (value as Id<"users">);
    if (next === previous) return;
    await patchClientSettings(client._id, { assignedOperatorUserId: next });
    try {
      await assign({ clientOrgId: client._id, assigneeUserId: next ?? null });
    } catch (error) {
      await patchClientSettings(client._id, {
        assignedOperatorUserId: previous,
      });
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the assignee"),
      );
    }
  }

  return (
    <div className="@container">
      <Select
        value={client.assignedOperatorUserId ?? UNASSIGNED}
        items={items}
        disabled={disabled}
        onValueChange={(value) => {
          if (value && value in items) void change(value);
        }}
      >
        <SelectTrigger
          // Avatar-only columns drop the chevron so the avatar fits.
          className="-ml-[13px] w-[calc(100%+13px)] @max-[6.5rem]:[&_.lucide-chevron-down]:hidden"
          aria-label={`Assignee for ${client.name}`}
        >
          <SelectValue>
            <AssigneeOption operator={assigned} compact />
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={UNASSIGNED}>
            <AssigneeOption operator={undefined} />
          </SelectItem>
          {operators.map((operator) => (
            <SelectItem key={operator.userId} value={operator.userId}>
              <AssigneeOption operator={operator} />
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ApplicationWebsiteField({ name }: { name: string }) {
  return (
    <Input
      aria-label={`Website for ${name}`}
      placeholder="Not set"
      disabled
      value=""
      readOnly
      className="-ml-[13px] w-[calc(100%+13px)]"
    />
  );
}

export function ApplicationStatusField() {
  return (
    <span className="text-muted-foreground">Not submitted</span>
  );
}
