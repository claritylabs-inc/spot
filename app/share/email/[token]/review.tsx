"use client";

import { AlertTriangle, Check, Paperclip, Send } from "lucide-react";
import { useAction, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { useState } from "react";
import { SpotWordmark } from "@claritylabs-inc/ui/components/brand/spot-wordmark";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import type { EmailDraftReviewView } from "./view";

const getEmailDraftReview = makeFunctionReference<
  "query",
  { token: string },
  EmailDraftReviewView
>("emailDraftReviewLinks:getByToken");
const sendEmailDraft = makeFunctionReference<
  "action",
  { token: string },
  { status: "sent" }
>("actions/emailDraftReview:send");

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function EmptyReview({ state }: { state: "missing" | "expired" | "stale" }) {
  const content = {
    missing: {
      title: "Draft link unavailable",
      body: "This review link could not be found. Ask Spot to show the draft again.",
    },
    expired: {
      title: "Draft link expired",
      body: "For your protection, draft review links expire. Ask Spot to show the current draft again.",
    },
    stale: {
      title: "Draft changed",
      body: "The email changed after this link was created. Ask Spot for a fresh review link before sending.",
    },
  }[state];
  return (
    <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-8 sm:py-12">
      <div className="mx-auto max-w-xl">
        <SpotWordmark />
        <section className="mt-10 border-t border-border pt-8">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          <h1 className={`mt-4 ${typeStyle("heading.micro")}`}>{content.title}</h1>
          <p className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}>
            {content.body}
          </p>
        </section>
      </div>
    </main>
  );
}

export function EmailDraftReview({
  token,
  initialView,
}: {
  token: string;
  initialView: EmailDraftReviewView;
}) {
  const liveView = useQuery(getEmailDraftReview, { token });
  const sendDraft = useAction(sendEmailDraft);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const view = liveView === undefined ? initialView : liveView;

  if (!view) return <EmptyReview state="missing" />;
  if (view.state === "expired") return <EmptyReview state="expired" />;
  if (view.state === "stale") return <EmptyReview state="stale" />;

  const displayState = sent ? "sent" : sending ? "sending" : view.state;
  const canSend = view.canSend && displayState === "draft";
  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(undefined);
    try {
      await sendDraft({ token });
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The email could not be sent.");
    } finally {
      setSending(false);
    }
  };
  const statusMessage = error
    ? error
    : displayState === "sent"
      ? "Email sent successfully."
      : displayState === "cancelled"
        ? "This draft was cancelled."
        : displayState === "pending"
          ? "This email is already scheduled."
          : displayState === "draft" && !view.canSend
            ? "This draft needs a fresh confirmation in Spot."
            : undefined;

  return (
    <main className="min-h-screen bg-background px-5 py-7 text-foreground sm:px-8 sm:py-10">
      <div className="mx-auto max-w-5xl">
        <header className="border-b border-border pb-6">
          <div className="flex items-center justify-between gap-4">
            <SpotWordmark />
            <p className={`truncate text-muted-foreground ${typeStyle("body.default")}`}>
              {view.orgName}
            </p>
          </div>
          <div className="mt-7 min-w-0">
            <h1 className={`break-words text-foreground ${typeStyle("heading.micro")}`}>
              {view.subject}
            </h1>
            <dl className="mt-4 grid min-w-0 gap-2">
              <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                <dt className={`text-muted-foreground ${typeStyle("caption.default")}`}>To</dt>
                <dd className={`break-words ${typeStyle("body.medium")}`}>{view.recipientEmail}</dd>
              </div>
              {view.ccAddresses.length > 0 ? (
                <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                  <dt className={`text-muted-foreground ${typeStyle("caption.default")}`}>Cc</dt>
                  <dd className={`break-words ${typeStyle("body.default")}`}>{view.ccAddresses.join(", ")}</dd>
                </div>
              ) : null}
              {view.bccAddresses.length > 0 ? (
                <div className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                  <dt className={`text-muted-foreground ${typeStyle("caption.default")}`}>Bcc</dt>
                  <dd className={`break-words ${typeStyle("body.default")}`}>{view.bccAddresses.join(", ")}</dd>
                </div>
              ) : null}
            </dl>
          </div>
        </header>

        <section className="pt-6">
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {view.renderedHtml ? (
              <iframe
                className="h-[440px] w-full bg-white sm:h-[520px]"
                referrerPolicy="no-referrer"
                sandbox=""
                srcDoc={view.renderedHtml}
                title={`Email preview: ${view.subject}`}
              />
            ) : (
              <pre className={`min-h-80 whitespace-pre-wrap break-words p-5 text-foreground ${typeStyle("body.default")}`}>
                {view.renderedText}
              </pre>
            )}
          </div>
        </section>

        {view.attachments.length > 0 ? (
          <section className="border-b border-border py-4">
            <div className="divide-y divide-border rounded-lg border border-border">
              {view.attachments.map((attachment) => (
                <div key={`${attachment.filename}:${attachment.size}`} className="flex items-center gap-3 px-4 py-3">
                  <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className={`truncate ${typeStyle("body.medium")}`}>{attachment.filename}</p>
                    <p className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}>
                      {attachment.contentType} · {fileSize(attachment.size)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className={`flex flex-col gap-4 py-6 sm:flex-row sm:items-center ${statusMessage ? "sm:justify-between" : "sm:justify-end"}`}>
          {statusMessage ? (
            <div aria-live="polite" className={`${error ? "text-destructive" : "text-muted-foreground"} ${typeStyle("body.default")}`}>
              {statusMessage}
            </div>
          ) : null}
          <PillButton
            className="w-full sm:w-auto"
            disabled={!canSend || sending}
            onClick={() => void send()}
          >
            {displayState === "sent" ? <Check className="h-4 w-4" /> : <Send className="h-4 w-4" />}
            {displayState === "sent" ? "Sent" : sending ? "Sending…" : "Send email"}
          </PillButton>
        </footer>
      </div>
    </main>
  );
}
