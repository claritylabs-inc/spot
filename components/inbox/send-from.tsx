"use client";

import { useState } from "react";
import { useQuery } from "convex/react";

import { TextLink } from "@/components/ui/text-link";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { api } from "@/convex/_generated/api";
import type { SendFrom, SendFromOptions } from "@/convex/lib/outreachIdentity";
import { typeStyle } from "@/lib/typography";

/** The server words a refused Gmail send in terms of reconnecting it; there is no fallback to Spot. */
export const isGmailReconnectMessage = (message: string) => /gmail/i.test(message) && /reconnect/i.test(message);

/** A refusal from the server, with the way out when the cause is a Gmail that needs reconnecting. */
export function ComposeProblem({ message }: { message: string }) {
  return (
    <p role="alert" className="flex flex-wrap items-baseline gap-x-2">
      <span>{message}</span>
      {isGmailReconnectMessage(message) ? <TextLink href="/operator/profile">Open Profile</TextLink> : null}
    </p>
  );
}

/**
 * The accounts this operator can send from. A preview carries them; until one
 * exists the connected Gmail (when active) is known from the connection itself.
 */
export function useSendFromOptions(fromPreview?: SendFromOptions): SendFromOptions | undefined {
  const connection = useQuery(api.operatorGmail.myConnection);
  const [last, setLast] = useState<SendFromOptions | undefined>(fromPreview);
  if (fromPreview && fromPreview !== last) setLast(fromPreview);
  const options = fromPreview ?? last;
  if (options?.gmail) return options;
  return connection?.status === "active"
    ? { spot: options?.spot ?? "Your Spot address", gmail: connection.address }
    : undefined;
}

/** The From value: a picker when a Gmail can send, otherwise the single static address. */
export function SendFromField({
  options,
  value,
  fallback,
  disabled,
  onChange,
}: {
  options: SendFromOptions | undefined;
  value: SendFrom;
  fallback: string;
  disabled: boolean;
  onChange: (value: SendFrom) => void;
}) {
  if (!options?.gmail) return <span className="min-w-0 truncate">{fallback}</span>;
  const labels: Record<SendFrom, string> = { spot: options.spot, gmail: options.gmail };
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        if (next === "spot" || next === "gmail") onChange(next);
      }}
    >
      <SelectTrigger
        aria-label="Send from"
        className="-ml-2 h-8 w-auto max-w-full min-w-0 border-transparent bg-transparent px-2 shadow-none"
      >
        <SelectValue>{labels[value]}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="spot">{labels.spot}</SelectItem>
        <SelectItem value="gmail">{labels.gmail}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Why the Cc row carries the sender's own Spot address when sending from Gmail. */
export function SpotCopyHint() {
  return (
    <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
      Copies your Spot address so replies reach Spot
    </span>
  );
}
