"use client";

import { Fragment, useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { ConvexError } from "convex/values";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import {
  Ban,
  ChevronDown,
  ClipboardList,
  Copy,
  FileText,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { isFeatureEnabled } from "@/convex/lib/featureFlags";
import { usePdf } from "@/components/pdf-context";
import { ChatAttachmentChip } from "@/components/chat/attachment-chip";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { formatDisplayDateTime } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import {
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { typeStyle } from "@/lib/typography";
import { ActionPill, ArtifactSidebar, useBusyKey } from "./shell";
import { asNumber, asRecord, asRecords } from "./normalize";

type MailboxAttachment = {
  attachmentIndex?: number;
  filename: string;
  contentType?: string;
  size?: number;
};

type MailboxAddress = {
  name?: string;
  address: string;
};

type MailboxReviewEmail = {
  automationItemId?: Id<"connectedEmailAutomationItems">;
  emailRef?: string;
  mailbox?: string;
  accountEmail?: string;
  subject: string;
  from?: string;
  date?: string;
  attachments: MailboxAttachment[];
};

export type LiveMailboxEmail = {
  emailRef: string;
  mailbox: string;
  subject: string;
  from?: string;
  fromAddresses?: MailboxAddress[];
  to?: string;
  toAddresses?: MailboxAddress[];
  cc?: string;
  ccAddresses?: MailboxAddress[];
  date?: string;
  text?: string;
  attachments: MailboxAttachment[];
};

/** Live read results carry loosely typed attachments; trim and default names. */
export function normalizeLiveEmail(result: unknown): LiveMailboxEmail {
  const row = result as Omit<LiveMailboxEmail, "attachments"> & {
    attachments?: Array<Partial<MailboxAttachment>>;
  };
  return {
    ...row,
    attachments: (row.attachments ?? []).map((attachment) => ({
      ...attachment,
      filename: attachment.filename?.trim() || "Attachment",
    })),
  };
}

export function splitMailboxMessageParagraphs(text?: string) {
  const message = text?.trim();
  return message ? message.split(/\r?\n(?:[ \t]*\r?\n)+/) : [];
}

export function mailboxReadErrorMessage(error: unknown) {
  if (
    error instanceof ConvexError &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message;
  }
  return getUserFacingErrorMessage(
    error,
    "The live message could not be loaded.",
  );
}

function addressFromNotation(value?: string): MailboxAddress | null {
  const raw = value?.trim();
  if (!raw) return null;
  const named = raw.match(/^(.*?)\s*<([^<>\s]+@[^<>\s]+)>$/);
  if (named) {
    const name = named[1].trim().replace(/^"|"$/g, "");
    return name ? { name, address: named[2] } : { address: named[2] };
  }
  return /^\S+@\S+\.\S+$/.test(raw) ? { address: raw } : null;
}

function MailboxAddressDisclosure({
  contact,
  alignStart = false,
}: {
  contact: MailboxAddress;
  alignStart?: boolean;
}) {
  const name = contact.name?.trim();
  const address = contact.address.trim();

  if (!name || name.toLowerCase() === address.toLowerCase()) {
    return <span className="min-w-0 break-all">{address}</span>;
  }

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Email address copied");
    } catch {
      toast.error("Couldn’t copy email address");
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              `group/address relative inline-flex items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized h-auto min-h-6 min-w-0 max-w-[calc(100%-0.875rem)] shrink-0 justify-start gap-0 px-1.5 py-0.5 text-left whitespace-normal text-foreground hover:bg-foreground/[0.06] data-popup-open:bg-foreground/[0.07] ${typeStyle("control.button")}`,
              alignStart && "-ml-1.5",
            )}
            aria-label={`Show email address for ${name}`}
          >
            <span className="min-w-0 break-words [overflow-wrap:anywhere]">{name}</span>
            <ChevronDown className="pointer-events-none absolute left-full ml-0.5 h-3 w-3 opacity-0 transition-opacity duration-150 group-hover/address:opacity-55 group-focus-visible/address:opacity-55 group-data-[popup-open]/address:opacity-55 [@media(hover:none)]:opacity-45" />
          </button>
        }
      />
      <DropdownMenuContent
        align="start"
        className="w-auto min-w-56 max-w-[min(24rem,calc(100vw-2rem))]"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel className={`min-w-0 px-2 py-1.5 text-foreground ${typeStyle("control.menu")}`}>
            <span className="block break-all">{address}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void copyAddress()}>
          <Copy className="h-4 w-4" />
          Copy address
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MailboxAddressList({
  contacts,
  fallback,
}: {
  contacts?: MailboxAddress[];
  fallback?: string;
}) {
  const fallbackContact = addressFromNotation(fallback);
  const visibleContacts = contacts?.length
    ? contacts
    : fallbackContact
      ? [fallbackContact]
      : [];

  if (visibleContacts.length === 0) return fallback ?? null;

  return (
    <span className="flex min-w-0 flex-wrap items-center">
      {visibleContacts.map((contact, index) => (
        <Fragment key={`${contact.address}-${index}`}>
          {index > 0 ? <span className="mr-0.5 shrink-0 text-muted-foreground">,</span> : null}
          <MailboxAddressDisclosure contact={contact} alignStart={index === 0} />
        </Fragment>
      ))}
    </span>
  );
}

export function formatAttachmentSize(size?: number) {
  if (typeof size !== "number") return undefined;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function isMailboxPdfAttachment(attachment: MailboxAttachment) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return type.includes("pdf") || name.endsWith(".pdf");
}

export function isMailboxRequirementAttachment(attachment: MailboxAttachment) {
  const name = attachment.filename.toLowerCase();
  const type = attachment.contentType?.toLowerCase() ?? "";
  return (
    type.includes("pdf") ||
    type.includes("wordprocessingml") ||
    type.startsWith("text/") ||
    type.includes("json") ||
    type.includes("csv") ||
    name.endsWith(".pdf") ||
    name.endsWith(".docx") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".markdown") ||
    name.endsWith(".csv") ||
    name.endsWith(".json")
  );
}

function totalCreatedRequirements(result: unknown) {
  return asRecords(asRecord(result)?.imports).reduce(
    (total, item) => total + (asNumber(item.createdCount) ?? 0), 0,
  );
}

/** Policy and requirement imports from a mailbox email; callers own toasts. */
export function useMailboxImports(orgId: Id<"organizations">) {
  const importPolicyAttachments = useAction(api.actions.connectedEmail.importPolicyAttachments);
  const importRequirementAttachments = useAction(api.actions.connectedEmail.importRequirementAttachments);
  return {
    async importPolicy(emailRef: string, attachments: MailboxAttachment[]) {
      const filenames = attachments
        .filter(isMailboxPdfAttachment)
        .map((attachment) => attachment.filename);
      const result = (await importPolicyAttachments({ orgId, emailRef, filenames })) as {
        status?: string;
        files?: unknown[];
      };
      const count = result.files?.length ?? filenames.length;
      return {
        status: result.status,
        started: `Started policy import for ${count} file${filenames.length === 1 ? "" : "s"}`,
      };
    },
    async importRequirements(
      emailRef: string,
      attachments: MailboxAttachment[],
      scope: "vendors" | "own_org",
    ) {
      const filenames = attachments
        .filter(isMailboxRequirementAttachment)
        .map((attachment) => attachment.filename);
      const result = await importRequirementAttachments({
        orgId,
        emailRef,
        filenames: filenames.length > 0 ? filenames : undefined,
        includeEmailBody: true,
        sourceType: scope === "vendors" ? "vendor_requirements" : "other",
        scope,
      });
      return {
        status: (result as { status?: string })?.status,
        createdCount: totalCreatedRequirements(result),
      };
    },
  };
}

export function MailboxEmailReviewSidebar({
  email,
  orgId,
  threadId,
  onClose,
}: {
  email: MailboxReviewEmail;
  orgId: Id<"organizations">;
  threadId: Id<"threads">;
  onClose: () => void;
}) {
  const currentOrg = useCurrentOrg();
  const readEmail = useAction(api.actions.connectedEmail.readEmail);
  const previewAttachment = useAction(api.actions.connectedEmail.previewAttachment);
  const { importPolicy, importRequirements } = useMailboxImports(orgId);
  const resolveReview = useMutation(api.connectedEmailAutomation.resolveReview);
  const { openWithUrl } = usePdf();
  const [liveEmail, setLiveEmail] = useState<LiveMailboxEmail | null>(null);
  const [readError, setReadError] = useState<string | null>(
    email.emailRef ? null : "Email reference is unavailable.",
  );
  const [readAttempt, setReadAttempt] = useState(0);
  const { busyKey, runBusy } = useBusyKey();
  const [previewingAttachmentKey, setPreviewingAttachmentKey] = useState<string | null>(null);
  const showConnectFeatures = isFeatureEnabled(currentOrg?.org, "connect_features");

  useEffect(() => {
    if (!email.emailRef) return;
    let cancelled = false;
    void readEmail({
      orgId,
      emailRef: email.emailRef,
      ...(email.automationItemId
        ? { automationItemId: email.automationItemId }
        : {}),
    })
      .then((result) => {
        if (!cancelled) setLiveEmail(normalizeLiveEmail(result));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setReadError(mailboxReadErrorMessage(error));
      });
    return () => {
      cancelled = true;
    };
  }, [email.automationItemId, email.emailRef, orgId, readAttempt, readEmail]);

  async function completeReview(
    resolution: "not_relevant" | "policy_imported" | "requirements_imported",
  ) {
    if (!email.emailRef) throw new Error("Email reference is unavailable");
    const result = await resolveReview({
      threadId,
      emailRef: email.emailRef,
      resolution,
    });
    if (!result.resolved) throw new Error("Email review is no longer available");
    onClose();
  }

  function handleNotRelevant() {
    void runBusy("not-relevant", async () => {
      await completeReview("not_relevant");
      toast.success("Marked not relevant");
    }, "Failed to update email review");
  }

  async function handleAttachmentPreview(
    attachment: MailboxAttachment,
    fallbackIndex: number,
  ) {
    const emailRef = liveEmail?.emailRef ?? email.emailRef;
    if (!emailRef || !isMailboxPdfAttachment(attachment)) return;
    const attachmentIndex = attachment.attachmentIndex ?? fallbackIndex;
    const previewKey = `${attachmentIndex}:${attachment.filename}`;
    setPreviewingAttachmentKey(previewKey);
    try {
      const result = await previewAttachment({
        orgId,
        emailRef,
        filename: attachment.filename,
        attachmentIndex,
      });
      openWithUrl(result.url);
    } catch {
      toast.error("Failed to open attachment preview");
    } finally {
      setPreviewingAttachmentKey(null);
    }
  }

  function handlePolicyImport() {
    if (!liveEmail) return;
    const { emailRef, attachments } = liveEmail;
    void runBusy("policy", async () => {
      const result = await importPolicy(emailRef, attachments);
      if (result.status === "no_pdf_attachments") {
        toast.error("No PDF attachments found");
        return;
      }
      if (result.status === "failed") {
        toast.error("Failed to import policy");
        return;
      }
      await completeReview("policy_imported");
      toast.success(
        result.status === "duplicate" ? "Policy already imported" : result.started,
      );
    }, "Failed to import policy");
  }

  function handleRequirementImport(scope: "vendors" | "own_org") {
    if (!liveEmail) return;
    const { emailRef, attachments } = liveEmail;
    void runBusy(scope, async () => {
      const { status, createdCount } = await importRequirements(
        emailRef,
        attachments,
        scope,
      );
      if (status === "no_requirement_sources") {
        toast.error("No insurance requirements found");
        return;
      }
      await completeReview("requirements_imported");
      toast.success(
        createdCount > 0
          ? `Imported ${createdCount} insurance requirement${createdCount === 1 ? "" : "s"}`
          : "Insurance requirements imported",
      );
    }, "Failed to import insurance requirements");
  }

  const attachments = liveEmail?.attachments ?? [];
  const receivedAt = liveEmail?.date ?? email.date;
  const mailbox = liveEmail?.mailbox ?? email.mailbox;
  const hasPdf = attachments.some(isMailboxPdfAttachment);
  const messageParagraphs = splitMailboxMessageParagraphs(liveEmail?.text);
  const requirementImports: Array<["vendors" | "own_org", string]> = showConnectFeatures
    ? [
        ["vendors", "Import vendor requirements"],
        ["own_org", "Import internal requirements"],
      ]
    : [["own_org", "Import requirements"]];

  return (
    <ArtifactSidebar
      title={liveEmail?.subject ?? email.subject}
      closeLabel="Close email review"
      onClose={onClose}
      bodyClassName="space-y-4"
      footer={
        <>
          <ActionPill
            size="compact"
            variant="ghost"
            disabled={busyKey !== null || !email.emailRef}
            onClick={handleNotRelevant}
            busy={busyKey === "not-relevant"}
            icon={Ban}
          >
            Not relevant
          </ActionPill>
          {liveEmail && hasPdf ? (
            <ActionPill
              size="compact"
              variant="secondary"
              disabled={busyKey !== null}
              onClick={handlePolicyImport}
              busy={busyKey === "policy"}
              icon={FileText}
            >
              Import policy
            </ActionPill>
          ) : null}
          {liveEmail
            ? requirementImports.map(([scope, label]) => (
                <ActionPill
                  key={scope}
                  size="compact"
                  variant="secondary"
                  disabled={busyKey !== null}
                  onClick={() => handleRequirementImport(scope)}
                  busy={busyKey === scope}
                  icon={ClipboardList}
                >
                  {label}
                </ActionPill>
              ))
            : null}
        </>
      }
    >
      <OperationalLabelValueList>
        {(
          [
            ["From", liveEmail?.fromAddresses, liveEmail?.from ?? email.from],
            ["To", liveEmail?.toAddresses, liveEmail?.to],
            ["Cc", liveEmail?.ccAddresses, liveEmail?.cc],
          ] as const
        ).map(([label, contacts, fallback]) => (
          <OperationalLabelValueRow
            key={label}
            label={label}
            value={
              contacts?.length || fallback ? (
                <MailboxAddressList contacts={contacts} fallback={fallback} />
              ) : undefined
            }
          />
        ))}
        <OperationalLabelValueRow
          label="Received"
          value={receivedAt ? formatDisplayDateTime(receivedAt, receivedAt) : undefined}
        />
        <OperationalLabelValueRow label="Mailbox" value={email.accountEmail} />
        <OperationalLabelValueRow
          label="Folder"
          value={mailbox?.toUpperCase() === "INBOX" ? undefined : mailbox}
        />
      </OperationalLabelValueList>

      {liveEmail ? (
        <OperationalPanel as="div">
          <OperationalPanelHeader title="Message" />
          {attachments.length > 0 ? (
            <div className="border-b border-border px-4 py-3">
              <p className={`mb-2 text-muted-foreground ${typeStyle("caption.medium")}`}>
                Attachments
              </p>
              <div className="flex flex-wrap gap-1.5">
                {attachments.map((attachment, index) => {
                  const canPreview = isMailboxPdfAttachment(attachment);
                  const attachmentIndex = attachment.attachmentIndex ?? index;
                  const isPreviewing =
                    previewingAttachmentKey ===
                    `${attachmentIndex}:${attachment.filename}`;
                  return (
                    <ChatAttachmentChip
                      key={`${attachment.filename}-${index}`}
                      attachment={attachment}
                      className="w-fit"
                      onOpen={
                        canPreview
                          ? () => void handleAttachmentPreview(attachment, index)
                          : undefined
                      }
                      isLoading={isPreviewing}
                      disabled={canPreview && previewingAttachmentKey !== null}
                      unavailableTitle={`${attachment.filename} cannot be previewed`}
                    />
                  );
                })}
              </div>
            </div>
          ) : null}
          <OperationalPanelBody>
            {messageParagraphs.length > 0 ? (
              <div className={`space-y-3 break-words text-foreground/80 [overflow-wrap:anywhere] ${typeStyle("body.default")}`}>
                {messageParagraphs.map((paragraph, index) => (
                  <p key={index} className="whitespace-pre-wrap">
                    {paragraph}
                  </p>
                ))}
              </div>
            ) : (
              <p className={`text-foreground/80 ${typeStyle("body.default")}`}>
                This email has no plain-text message body.
              </p>
            )}
          </OperationalPanelBody>
        </OperationalPanel>
      ) : readError ? (
        <OperationalPanel as="div" className="p-4">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>Couldn’t open this email</p>
          <p className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}>{readError}</p>
          {email.emailRef ? (
            <PillButton
              className="mt-3"
              size="compact"
              variant="secondary"
              onClick={() => {
                setReadError(null);
                setLiveEmail(null);
                setReadAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </PillButton>
          ) : null}
        </OperationalPanel>
      ) : (
        <div className={`flex items-center gap-2 py-8 text-muted-foreground ${typeStyle("body.default")}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading email
        </div>
      )}
    </ArtifactSidebar>
  );
}
