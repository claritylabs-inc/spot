"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { Loader2, Mail, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { ThreadMessageBubble } from "@/components/agent-thread/message-bubble";
import { ProseMarkdown } from "@/components/prose-markdown";
import { OperatorSidebar } from "../operator-sidebar";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
} from "@/components/ui/operational-panel";
import { ActionSurface } from "@/components/ui/action-surface";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FadeIn } from "@/components/ui/fade-in";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedOperatorDemoSalesTranscriptDetail,
  useCachedOperatorDemoSalesTranscripts,
} from "@/lib/sync/operator-cached-queries";
import { formatDisplayDateTime } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

type TranscriptRow = FunctionReturnType<
  typeof api.operator.listPublicDemoSalesTranscripts
>[number];

type TimelineLog = {
  _id: string;
  direction: "inbound" | "outbound" | "system";
  content: string;
  subject?: string;
  createdAt: number;
};

function channelIcon(channel?: string) {
  const Icon = channel === "imessage" ? MessageCircle : Mail;
  return <Icon className="h-4 w-4" />;
}

function formatShortTime(value?: number) {
  return formatDisplayDateTime(value, "Unknown time");
}

function formatContact(value?: string) {
  const contact = value?.trim();
  if (!contact) return "Unknown";
  if (contact.includes("@")) return contact;
  const phone = parsePhoneNumberFromString(contact, "US");
  return phone?.isValid() ? phone.formatNational() : contact;
}

function drawerTitle(row?: TranscriptRow) {
  if (!row) return "Demo chat";
  const contact = formatContact(row.senderContact);
  const primary =
    contact !== "Unknown"
      ? contact
      : (row.leadName ?? row.leadCompany ?? row.leadEmail ?? "Unknown");
  const secondary = [row.leadName, row.leadCompany, row.leadEmail]
    .filter((item) => item && item !== primary)
    .join(" · ");

  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-muted-foreground/40">
        {channelIcon(row.channel)}
      </span>
      <span className="min-w-0">
        <span className="block truncate">{primary}</span>
        {secondary ? (
          <span
            className={`block truncate text-muted-foreground/40 ${typeStyle("caption.default")}`}
          >
            {secondary}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function Timeline({
  logs,
  channel,
}: {
  logs?: TimelineLog[];
  channel: "email" | "imessage";
}) {
  const messages = logs?.filter((log) => log.direction !== "system") ?? [];
  if (!messages.length) {
    return (
      <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
        No turns recorded.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {messages.map((log) => {
        const isInbound = log.direction === "inbound";
        const content = log.content;

        return (
          <div
            key={log._id}
            className={`max-w-lg w-fit ${isInbound ? "ml-auto" : ""}`}
          >
            {isInbound ? (
              <div className="mb-1 flex items-center justify-end gap-2">
                <span
                  className={`text-muted-foreground/50 ${typeStyle("caption.medium")}`}
                >
                  Prospect
                </span>
                <span className="text-muted-foreground/20">·</span>
                <span
                  className={`text-muted-foreground/25 ${typeStyle("caption.default")}`}
                >
                  {formatDisplayDateTime(log.createdAt)}
                </span>
              </div>
            ) : null}
            <ThreadMessageBubble
              role={isInbound ? "user" : "agent"}
              channel={channel}
              isOwnMessage={isInbound}
            >
              {log.subject ? (
                <p className={`mb-1 ${typeStyle("body.medium")}`}>
                  {log.subject}
                </p>
              ) : null}
              <ProseMarkdown gfm breaks compact={isInbound}>
                {content}
              </ProseMarkdown>
            </ThreadMessageBubble>
          </div>
        );
      })}
    </div>
  );
}

export default function OperatorDemoLeadsPage() {
  const transcripts = useCachedOperatorDemoSalesTranscripts();
  const deleteTranscript = useMutation(
    api.operator.deletePublicDemoSalesTranscript,
  );
  const [selectedTranscriptId, setSelectedTranscriptId] =
    useState<Id<"publicDemoSalesTranscripts"> | null>(null);
  const [pendingDelete, setPendingDelete] = useState<TranscriptRow | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const transcriptDetail =
    useCachedOperatorDemoSalesTranscriptDetail(selectedTranscriptId);
  const selectedTranscript = transcriptDetail?.transcript;

  async function deleteLead() {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteTranscript({ id: pendingDelete._id });
      if (selectedTranscriptId === pendingDelete._id) {
        setSelectedTranscriptId(null);
      }
      setPendingDelete(null);
      toast.success("Demo lead deleted");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not delete this demo lead."),
      );
    } finally {
      setDeleting(false);
    }
  }

  const rightPanel = (
    <SettingsDrawer
      open={Boolean(selectedTranscriptId)}
      onOpenChange={(open) => {
        if (!open) setSelectedTranscriptId(null);
      }}
      title={drawerTitle(selectedTranscript)}
      footer={
        selectedTranscript ? (
          <PillButton
            variant="destructive"
            disabled={deleting}
            onClick={() => setPendingDelete(selectedTranscript)}
          >
            <Trash2 className="size-3.5" />
            Delete lead
          </PillButton>
        ) : undefined
      }
    >
      {transcriptDetail ? (
        <div className="space-y-5 pb-4">
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Use case"
              value={transcriptDetail.transcript.leadUseCase}
            />
            <OperationalLabelValueRow
              label="Summary"
              value={transcriptDetail.transcript.summary}
            />
            <OperationalLabelValueRow
              label="Next step"
              value={transcriptDetail.transcript.nextStep}
            />
          </OperationalLabelValueList>
          <Timeline
            logs={transcriptDetail.logs}
            channel={transcriptDetail.transcript.channel}
          />
        </div>
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          Loading chat.
        </p>
      )}
    </SettingsDrawer>
  );

  return (
    <AppShell
      customSidebar={({ collapsed, onToggleCollapse }) => (
        <OperatorSidebar
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          active="demo-leads"
        />
      )}
      customSidebarStorageKey="operator-sidebar"
      disablePersistentChat
      disableCommandPalette
      rightPanel={rightPanel}
    >
      <FadeIn when={true} duration={0.12}>
        {(transcripts ?? []).length === 0 ? (
          <div className="py-16 text-center">
            <p
              className={`text-muted-foreground/40 ${typeStyle("body.default")}`}
            >
              No public demo chats
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {(transcripts ?? []).map((row) => {
              const contact = formatContact(row.senderContact);
              return (
                <ActionSurface
                  key={row._id}
                  className="flex items-center gap-1 p-1"
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized"
                    onClick={() => setSelectedTranscriptId(row._id)}
                  >
                    <span className="shrink-0 text-muted-foreground/30">
                      {channelIcon(row.channel)}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                      <span
                        className={`truncate text-foreground ${typeStyle("body.medium")}`}
                      >
                        {contact}
                      </span>
                      <span
                        className={`shrink-0 text-muted-foreground/40 ${typeStyle("caption.default")}`}
                      >
                        {formatShortTime(row.lastUpdatedAt)}
                      </span>
                    </span>
                  </button>
                </ActionSurface>
              );
            })}
          </div>
        )}
      </FadeIn>

      <Dialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deleting) setPendingDelete(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete demo lead</DialogTitle>
            <DialogDescription>
              Permanently delete{" "}
              <strong>{formatContact(pendingDelete?.senderContact)}</strong>,
              including the transcript and full chat history? This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <PillButton
              variant="secondary"
              disabled={deleting}
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </PillButton>
            <PillButton
              variant="destructive"
              disabled={deleting}
              onClick={() => void deleteLead()}
            >
              {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {deleting ? "Deleting…" : "Delete lead"}
            </PillButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
