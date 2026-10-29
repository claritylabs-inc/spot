"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import {
  Check,
  ChevronDown,
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
import { PillButton } from "@/components/ui/pill-button";
import { useFollowedOpen, useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  AddThreadContactDialog,
  type ThreadContactSuggestion,
} from "./add-thread-contact";

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
  const menu = useFollowedOpen(
    `procurement:email:${threadId}:contact-menu:${email}`,
  );
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
          render={
            <PillButton
              type="button"
              variant="ghost"
              size="compact"
              className="min-w-0 max-w-full text-left"
              aria-label={`Contact options for ${displayName}`}
            />
          }
        >
          <span className="truncate">{children ?? displayName}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-w-[calc(100vw-2rem)]">
          <DropdownMenuGroup>
            <DropdownMenuLabel>
              <span className="block">
                {suggestion?.brokerName ?? "Provider contact"}
              </span>
              <span
                className={`block break-all text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {email}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={saving || suggestion?.primary}
            onClick={() => void setPrimary()}
          >
            {suggestion?.primary ? <Check /> : <Star />}
            {suggestion?.primary
              ? "Primary outreach contact for this provider"
              : "Make primary outreach contact for this provider"}
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
