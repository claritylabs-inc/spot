"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { buildPendingEmailResendPayload } from "../lib/emailDelivery";

type RenderFormat = "png" | "pdf";
type RenderResult =
  | {
      status: "not_found";
      message: string;
    }
  | {
      status: "renderer_unavailable";
      message: string;
    }
  | {
      status: "rendered";
      draftId: Id<"pendingEmails">;
      attachment: {
        filename: string;
        contentType: string;
        size: number;
        fileId: Id<"_storage">;
      };
    };

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function recipientLabel(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").join(", ") || fallback;
  }
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function buildPreviewDocument(draft: Doc<"pendingEmails">) {
  const payload = buildPendingEmailResendPayload(draft, {
    outboundMessageId: "email-preview",
  });
  const bodyHtml = payload.html
    ? payload.html
    : `<pre class="plain">${escapeHtml(payload.text ?? draft.emailBody)}</pre>`;
  const subject = payload.subject ?? draft.subject;
  const to = recipientLabel(payload.to, draft.recipientEmail);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(subject)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f6f7f9;
      color: #111827;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
    }
    .page {
      width: min(760px, calc(100vw - 40px));
      margin: 24px auto;
    }
    .chrome {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #ffffff;
      overflow: hidden;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08);
    }
    .meta {
      border-bottom: 1px solid #edf0f3;
      padding: 16px 18px;
      background: #fbfbfc;
    }
    .meta-row {
      display: flex;
      gap: 10px;
      margin: 3px 0;
    }
    .meta-key {
      width: 54px;
      flex: 0 0 54px;
      color: #6b7280;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .meta-value {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #111827;
    }
    .email-body {
      padding: 24px 40px 30px;
      background: #ffffff;
    }
    .email-body img {
      max-width: 100%;
      height: auto;
    }
    .plain {
      margin: 0;
      white-space: pre-wrap;
      font: inherit;
    }
    @page {
      margin: 0.5in;
    }
    @media print {
      body { background: #ffffff; }
      .page { width: auto; margin: 0; }
      .chrome { border: 0; border-radius: 0; box-shadow: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="chrome">
      <header class="meta">
        <div class="meta-row"><div class="meta-key">To</div><div class="meta-value">${escapeHtml(to)}</div></div>
        ${payload.cc?.length ? `<div class="meta-row"><div class="meta-key">Cc</div><div class="meta-value">${escapeHtml(recipientLabel(payload.cc, ""))}</div></div>` : ""}
        ${payload.bcc?.length ? `<div class="meta-row"><div class="meta-key">Bcc</div><div class="meta-value">${escapeHtml(recipientLabel(payload.bcc, ""))}</div></div>` : ""}
        <div class="meta-row"><div class="meta-key">Subject</div><div class="meta-value">${escapeHtml(subject)}</div></div>
      </header>
      <article class="email-body">${bodyHtml}</article>
    </section>
  </main>
</body>
</html>`;
}

async function renderWithPlaywright(html: string, format: RenderFormat) {
  const loadPlaywright = new Function("specifier", "return import(specifier)") as (
    specifier: string,
  ) => Promise<{ chromium: { launch: (options: Record<string, unknown>) => Promise<any> } }>;
  const { chromium } = await loadPlaywright("playwright");
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle", timeout: 15_000 });
    if (format === "pdf") {
      return Buffer.from(await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "0.35in", right: "0.35in", bottom: "0.35in", left: "0.35in" },
      }));
    }
    return Buffer.from(await page.screenshot({ fullPage: true, type: "png" }));
  } finally {
    await browser.close();
  }
}

function extensionForFormat(format: RenderFormat) {
  return format === "pdf" ? "pdf" : "png";
}

function contentTypeForFormat(format: RenderFormat) {
  return format === "pdf" ? "application/pdf" : "image/png";
}

export const run = internalAction({
  args: {
    orgId: v.id("organizations"),
    threadId: v.id("threads"),
    userId: v.id("users"),
    draftId: v.optional(v.id("pendingEmails")),
    format: v.optional(v.union(v.literal("png"), v.literal("pdf"))),
  },
  handler: async (ctx, args): Promise<RenderResult> => {
    const format = args.format ?? "png";
    const draft = (args.draftId
      ? await ctx.runQuery(internal.pendingEmails.getInternal, { id: args.draftId })
      : await ctx.runQuery(internal.pendingEmails.findDraftByThread, { threadId: args.threadId })) as
        | Doc<"pendingEmails">
        | null;

    if (!draft || draft.orgId !== args.orgId) {
      return {
        status: "not_found" as const,
        message: "No matching email draft was found for this thread.",
      };
    }

    const html = buildPreviewDocument(draft);
    let rendered: Buffer;
    try {
      rendered = await renderWithPlaywright(html, format);
    } catch (error) {
      return {
        status: "renderer_unavailable" as const,
        message:
          error instanceof Error
            ? `Email renderer unavailable: ${error.message}`
            : "Email renderer unavailable.",
      };
    }

    const contentType = contentTypeForFormat(format);
    const storageId = await ctx.storage.store(new Blob([new Uint8Array(rendered)], { type: contentType }));
    const extension = extensionForFormat(format);
    const filename = `email-preview-${String(draft._id).slice(-8)}.${extension}`;
    return {
      status: "rendered" as const,
      draftId: draft._id,
      attachment: {
        filename,
        contentType,
        size: rendered.byteLength,
        fileId: storageId as Id<"_storage">,
      },
    };
  },
});
