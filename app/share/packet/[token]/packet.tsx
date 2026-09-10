"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Download, FileText } from "lucide-react";
import { SpotWordmark } from "@/components/ui/spot-wordmark";
import { ProseMarkdown } from "@/components/prose-markdown";
import { PillButton } from "@/components/ui/pill-button";
import type { PacketView } from "./view";
import { formatDisplayDateTimeUtc } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";

const getPacket = makeFunctionReference<"query", { token: string }, PacketView>(
  "procurementPacket:getByToken",
);
const recordView = makeFunctionReference<
  "mutation",
  { token: string; userAgent?: string },
  { ok: boolean }
>("procurementPacket:recordView");

export function Packet({
  token,
  initialView,
}: {
  token: string;
  initialView: PacketView;
}) {
  const live = useQuery(getPacket, { token });
  const view = live === undefined ? initialView : live;
  const record = useMutation(recordView);
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current || view?.state !== "ready") return;
    recorded.current = true;
    void record({
      token,
      userAgent: navigator.userAgent,
    });
  }, [record, token, view]);
  if (!view)
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SpotWordmark />
        <h1 className={`mt-12 ${typeStyle("heading.page")}`}>
          Packet unavailable
        </h1>
      </main>
    );
  return (
    <main className="mx-auto max-w-4xl px-6 py-8 print:max-w-none">
      <header className="border-b border-border pb-6">
        <SpotWordmark />
        <p
          className={`mt-6 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Prepared for {view.recipientLabel}
        </p>
        {view.expiresAt !== undefined && (
          <p
            className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Available until {formatDisplayDateTimeUtc(view.expiresAt)}
          </p>
        )}
      </header>
      <article className="prose prose-neutral mt-8 max-w-none">
        <ProseMarkdown>{view.markdown}</ProseMarkdown>
      </article>
      {view.files.length ? (
        <section className="mt-10 border-t border-border pt-6">
          <h2 className={typeStyle("heading.section")}>Packet files</h2>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {view.files.map((file) => (
              <div
                key={file._id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className={`truncate ${typeStyle("body.medium")}`}>
                    {file.name}
                  </span>
                </span>
                {file.downloadUrl ? (
                  <PillButton
                    href={file.downloadUrl}
                    download
                    size="compact"
                    variant="secondary"
                  >
                    <Download className="size-3.5" />
                    Download
                  </PillButton>
                ) : (
                  <span
                    className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Listed
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <p
        className={`mt-12 border-t border-border pt-4 text-muted-foreground ${typeStyle("caption.default")}`}
      >
        This submission is confidential and watermarked for{" "}
        {view.recipientLabel}.
      </p>
    </main>
  );
}
