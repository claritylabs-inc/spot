"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import {
  Check,
  Copy,
  ExternalLink,
  Star,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { Avatar } from "@claritylabs-inc/ui/components/avatar";
import { useFollowedOpen, useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  AddThreadContactDialog,
  type ThreadContactSuggestion,
} from "./add-thread-contact";

export function threadContactMenuKey(
  threadId: Id<"teamEmailThreads">,
  email: string,
) {
  return `procurement:email:${threadId}:contact-menu:${email}`;
}

/** Provider contact actions share the contact records used for outreach recipients. */
export function ThreadContactMenu({
  threadId,
  name,
  email,
  suggestion,
  children,
}: {
  threadId: Id<"teamEmailThreads">;
  name?: string;
  email: string;
  suggestion?: ThreadContactSuggestion;
  children?: ReactNode;
}) {
  const menu = useFollowedOpen(threadContactMenuKey(threadId, email));
  const [dialogMode, setDialogMode] = useFollowedState<
    "add" | "primary" | null
  >(`procurement:email:${threadId}:contact-dialog:${email}`, null);
  const [saving, setSaving] = useState(false);
  const makePrimary = useMutation(api.brokerContacts.setPrimaryFromThread);
  const displayName = name?.trim() || email;

  async function setPrimary() {
    if (!suggestion?.contactId) {
      setDialogMode("primary");
      return;
    }
    setSaving(true);
    try {
      await makePrimary({ threadId, contactId: suggestion.contactId });
      toast.success(
        `${displayName} is the primary outreach contact for ${suggestion.brokerName}`,
      );
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not update the primary outreach contact",
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(email);
      toast.success("Email address copied");
    } catch {
      toast.error("Could not copy email address");
    }
  }

  return (
    <>
      <DropdownMenu {...menu}>
        <DropdownMenuTrigger
          className={`cursor-pointer text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring ${typeStyle("body.medium")}`}
          aria-label={`Contact options for ${displayName}`}
        >
          {children ?? displayName}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center gap-2.5 py-2">
              <Avatar name={displayName} className="size-8 shrink-0" />
              <span className="min-w-0">
                <span className={`block truncate text-foreground ${typeStyle("body.medium")}`}>
                  {displayName}
                </span>
                <span
                  className={`block truncate text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {suggestion?.brokerName
                    ? `${suggestion.brokerName} · ${email}`
                    : email}
                </span>
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={saving || suggestion?.primary}
            onClick={() => void setPrimary()}
          >
            {suggestion?.primary ? <Check /> : <Star />}
            {suggestion?.primary ? "Primary contact" : "Make primary contact"}
          </DropdownMenuItem>
          {!suggestion?.contactId ? (
            <DropdownMenuItem onClick={() => setDialogMode("add")}>
              <UserPlus />
              Save as provider contact
            </DropdownMenuItem>
          ) : null}
          {suggestion ? (
            <DropdownMenuItem
              render={
                <Link href={`/operator/brokers/${suggestion.brokerOrgId}`} />
              }
            >
              <ExternalLink />
              Open provider
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void copyAddress()}>
            <Copy />
            Copy email address
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddThreadContactDialog
        threadId={threadId}
        name={name}
        email={email}
        suggestion={suggestion}
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) setDialogMode(null);
        }}
        primaryDefault={dialogMode === "primary"}
      />
    </>
  );
}
