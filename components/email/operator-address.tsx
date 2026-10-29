"use client";

import type { CSSProperties } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { operatorTint, useOperatorColor } from "@/lib/collab/operator-color";
import { useCachedOperatorCurrent } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";

export type DirectoryOperator = FunctionReturnType<
  typeof api.operatorDirectory.list
>[number];

/** Active operators and a lookup from any of their addresses to them. */
export function useOperatorDirectory() {
  const operators = useQuery(api.operatorDirectory.list);
  const byAddress = new Map<string, DirectoryOperator>();
  for (const operator of operators ?? []) {
    for (const address of operator.addresses) byAddress.set(address, operator);
  }
  return {
    operators,
    /** The operator an address belongs to; accepts `Name <address>` too. */
    find: (address: string) => {
      const bare = (address.match(/<([^>]+)>/)?.[1] ?? address)
        .trim()
        .toLowerCase();
      return byAddress.get(bare) ?? null;
    },
  };
}

/** An operator as a pill in their color: avatar and name, address on hover. */
export function OperatorPill({
  operator,
  address,
  className,
}: {
  operator: Pick<DirectoryOperator, "userId" | "name" | "avatarUrl">;
  address?: string;
  className?: string;
}) {
  const color = useOperatorColor()(operator.userId);
  return (
    <span
      title={address ? `${operator.name} <${address}>` : operator.name}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full p-0.5 pr-2.5",
        typeStyle("body.default"),
        className,
      )}
      style={
        {
          backgroundColor: operatorTint(color),
          "--operator-color": color,
        } as CSSProperties
      }
    >
      <OperatorAvatar operator={operator} />
      <span className="min-w-0 truncate">{operator.name}</span>
    </span>
  );
}

/** Addresses as pills: operators by name and avatar, anyone else by address. */
export function AddressPills({ addresses }: { addresses: string[] }) {
  const { find } = useOperatorDirectory();
  return addresses.map((address) => {
    const operator = find(address);
    return operator ? (
      <OperatorPill key={address} operator={operator} address={address} />
    ) : (
      <span
        key={address}
        className="inline-flex max-w-full min-w-0 items-center truncate rounded-full bg-muted px-2.5 py-0.5"
      >
        {address}
      </span>
    );
  });
}

/** An operator's avatar in their color: without a photo, colored initials on a tint. */
function OperatorAvatar({
  operator,
  className,
}: {
  operator: Pick<DirectoryOperator, "name" | "avatarUrl">;
  className?: string;
}) {
  return (
    <Avatar
      name={operator.name}
      imageUrl={operator.avatarUrl}
      className={cn(
        "size-5 bg-[color-mix(in_srgb,var(--operator-color)_22%,transparent)] [&>span]:text-(--operator-color)",
        className,
      )}
    />
  );
}

/**
 * Who an email is sent from: any operator with a team address. The trigger is
 * the sender's own pill; the server signs and sends as them.
 */
export function FromPicker({
  value,
  onChange,
  disabled,
}: {
  value: Id<"users">;
  onChange: (userId: Id<"users">) => void;
  disabled?: boolean;
}) {
  const { operators } = useOperatorDirectory();
  const me = useCachedOperatorCurrent()?.user._id;
  const colorOf = useOperatorColor();
  const senders = (operators ?? []).filter((operator) => operator.teamAddress);
  const selected = senders.find((operator) => operator.userId === value);
  const color = colorOf(value);
  return (
    <Select
      value={value}
      disabled={disabled || !senders.length}
      onValueChange={(next) => next && onChange(next as Id<"users">)}
    >
      <SelectTrigger
        aria-label="Send from"
        title={selected?.teamAddress ?? undefined}
        // The pill is the button: no field border, chevron inside.
        className={cn(
          "w-auto max-w-full min-w-0 gap-1 rounded-full border-0 p-0.5 pr-2 hover:border-0 focus-visible:ring-2 focus-visible:ring-ring data-[size=default]:h-6 [&>svg]:size-3 [&>svg]:text-(--operator-color)",
          typeStyle("body.default"),
        )}
        style={
          {
            backgroundColor: operatorTint(color),
            "--operator-color": color,
          } as CSSProperties
        }
      >
        <SelectValue>
          {selected ? (
            <span className="flex min-w-0 items-center gap-1">
              <OperatorAvatar operator={selected} />
              <span
                className={cn("min-w-0 truncate", typeStyle("body.default"))}
              >
                {selected.name}
              </span>
            </span>
          ) : (
            "You"
          )}
        </SelectValue>
      </SelectTrigger>
      <SelectContent align="start">
        {senders.map((operator) => (
          <SelectItem
            key={operator.userId}
            value={operator.userId}
            label={operator.name}
          >
            <span
              className="flex min-w-0 items-center gap-2"
              style={
                {
                  "--operator-color": colorOf(operator.userId),
                } as CSSProperties
              }
            >
              <OperatorAvatar operator={operator} />
              <span className="min-w-0 truncate">{operator.name}</span>
              {operator.userId === me ? (
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  You
                </span>
              ) : null}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
