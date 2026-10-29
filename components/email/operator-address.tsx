"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { TagRemoveButton } from "@claritylabs-inc/ui/components/tag-remove-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
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

type ProviderContact = FunctionReturnType<
  typeof api.brokerContacts.lookupByEmails
>[number];

/** Saved provider contacts among `addresses`, by lowercased address. */
function useProviderContacts(addresses: string[]) {
  const emails = [
    ...new Set(addresses.map((address) => bareAddress(address)).filter(Boolean)),
  ].sort();
  const contacts = useQuery(
    api.brokerContacts.lookupByEmails,
    emails.length ? { emails } : "skip",
  );
  return new Map((contacts ?? []).map((contact) => [contact.email, contact]));
}

const bareAddress = (address: string) =>
  (address.match(/<([^>]+)>/)?.[1] ?? address).trim().toLowerCase();

/** A provider contact as a pill: provider icon and their name, address on hover. */
function ProviderContactPill({
  contact,
  address,
  children,
}: {
  contact: ProviderContact;
  address: string;
  children?: ReactNode;
}) {
  return (
    <span
      title={`${contact.name} <${address}> · ${contact.brokerName}`}
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-muted p-0.5 pr-2.5",
        typeStyle("body.default"),
      )}
    >
      <OrgBrandIcon
        name={contact.brokerName}
        website={contact.brokerWebsite ?? undefined}
        iconUrl={contact.brokerIconUrl ?? undefined}
        size="xs"
        shape="circle"
      />
      <span className="min-w-0 truncate">{contact.name}</span>
      {children}
    </span>
  );
}

/** One address as a pill: an operator or provider contact by name, anyone else by address. */
function AddressPill({
  address,
  operator,
  contact,
  onRemove,
}: {
  address: string;
  operator: DirectoryOperator | null;
  contact: ProviderContact | undefined;
  onRemove?: () => void;
}) {
  const remove = onRemove ? (
    <TagRemoveButton label={`Remove ${address}`} onClick={onRemove} />
  ) : null;
  if (operator)
    return (
      <span className="inline-flex max-w-full min-w-0 items-center">
        <OperatorPill operator={operator} address={address} className={remove ? "pr-1" : undefined} />
        {remove}
      </span>
    );
  if (contact)
    return (
      <ProviderContactPill contact={contact} address={address}>
        {remove}
      </ProviderContactPill>
    );
  return (
    <span
      className={cn(
        "inline-flex max-w-full min-w-0 items-center gap-0.5 rounded-full bg-muted py-0.5 pl-2.5",
        remove ? "pr-1" : "pr-2.5",
      )}
    >
      <span className="min-w-0 truncate">{address}</span>
      {remove}
    </span>
  );
}

/** Addresses as pills: operators and provider contacts by name, anyone else by address. */
export function AddressPills({ addresses }: { addresses: string[] }) {
  const { find } = useOperatorDirectory();
  const contacts = useProviderContacts(addresses);
  return addresses.map((address) => (
    <AddressPill
      key={address}
      address={address}
      operator={find(address)}
      contact={contacts.get(bareAddress(address))}
    />
  ));
}

const EMAIL_PATTERN = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

/**
 * Editable To/Cc: recognized pills with remove buttons, then a box that adds
 * an address on Enter, comma, semicolon, Tab or blur. `fixed` addresses show
 * without a remove button; `max` caps how many can be entered.
 */
export function AddressField({
  label,
  value,
  onChange,
  fixed = [],
  max,
  disabled,
  autoFocus,
  placeholder = "Add recipient",
}: {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  fixed?: string[];
  max?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const { find } = useOperatorDirectory();
  const contacts = useProviderContacts(value);
  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const full = max !== undefined && value.length >= max;
  function commit(text = draft) {
    const entries = text
      .split(/[,;\s]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    if (!entries.length) return true;
    const bad = entries.filter((entry) => !EMAIL_PATTERN.test(entry));
    const next = [...new Set([...value, ...entries.filter((entry) => !bad.includes(entry))])];
    onChange(max !== undefined ? next.slice(-max) : next);
    setDraft(bad.join(", "));
    setInvalid(bad.length > 0);
    return bad.length === 0;
  }
  return (
    <>
      {value.map((address) => (
        <AddressPill
          key={address}
          address={address}
          operator={find(address)}
          contact={contacts.get(address)}
          onRemove={
            disabled || fixed.includes(address)
              ? undefined
              : () => onChange(value.filter((entry) => entry !== address))
          }
        />
      ))}
      {disabled || (full && !draft) ? null : (
        <input
          aria-label={`Add ${label} recipient`}
          aria-invalid={invalid || undefined}
          type="email"
          autoFocus={autoFocus}
          placeholder={value.length ? "" : placeholder}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            setInvalid(false);
            // A pasted list commits at its separators.
            if (/[,;]/.test(text)) commit(text);
            else setDraft(text);
          }}
          onKeyDown={(event) => {
            if (["Enter", ",", ";"].includes(event.key)) {
              event.preventDefault();
              commit();
            } else if (event.key === "Tab" && draft.trim()) {
              // A valid address moves on with Tab; an invalid one keeps focus.
              if (!commit()) event.preventDefault();
            } else if (event.key === "Backspace" && !draft && value.length) {
              const removable = value.filter((address) => !fixed.includes(address));
              const last = removable.at(-1);
              if (last) onChange(value.filter((address) => address !== last));
            }
          }}
          onBlur={() => void commit()}
          className={cn(
            "h-7 min-w-32 flex-1 bg-transparent pl-0.5 outline-none placeholder:text-muted-foreground/60 aria-invalid:text-destructive",
            typeStyle("body.default"),
          )}
        />
      )}
    </>
  );
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
