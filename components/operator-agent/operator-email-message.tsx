"use client";

import type { ReactNode } from "react";
import { ChatMessageBubble } from "@/components/chat/message-bubble";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import type { OperatorAgentMessage } from "@/lib/operator-agent-api";
import { typeStyle } from "@/lib/typography";

type EmailSection = {
  kind: "forwarded" | "quoted";
  headers: Array<[string, string]>;
  body: string;
};

function cleanEmailText(text: string) {
  // Embedded attachment placeholders otherwise appear as boxed “OBJ” glyphs.
  return text.replace(/\uFFFC/g, "").trim();
}

function unquote(text: string) {
  return text.replace(/^\s*> ?/gm, "").trim();
}

function quotedSection(text: string): EmailSection {
  const attribution = text.match(/^On [\s\S]+?wrote:\s*\n/i);
  return {
    kind: "quoted",
    headers: attribution ? [["Reply to", attribution[0].trim()]] : [],
    body: unquote(attribution ? text.slice(attribution[0].length) : text),
  };
}

// Older operator messages only stored the combined plain-text email.
function legacyEmail(content: string) {
  content = cleanEmailText(content);
  const subjectLine = content.match(/^Subject: ([^\n]*)\n*/);
  const text = subjectLine ? content.slice(subjectLine[0].length) : content;
  const boundary =
    /^\s*(?:>\s*)?(?:Begin forwarded message:|-+\s*Forwarded message\s*-+)\s*$/im.exec(
      text,
    );
  const quote = /^On .+wrote:\s*$|^\s*>/im.exec(text);
  if (boundary && (!quote || boundary.index <= quote.index)) {
    const source = unquote(text.slice(boundary.index + boundary[0].length));
    const lines = source.split("\n");
    const headers: Array<[string, string]> = [];
    let cursor = 0;
    for (; cursor < lines.length; cursor++) {
      const line = lines[cursor];
      const header = /^(From|To|Cc|Subject|Date|Sent):\s*(.*)$/i.exec(line);
      if (header) headers.push([header[1], header[2]]);
      else if (line.trim() && headers.length)
        headers[headers.length - 1][1] += ` ${line.trim()}`;
      else break;
    }
    return {
      subject: subjectLine?.[1],
      currentText: text.slice(0, boundary.index).trim(),
      sections: [
        {
          kind: "forwarded",
          headers,
          body: lines.slice(cursor).join("\n").trim(),
        } satisfies EmailSection,
      ],
    };
  }
  return {
    subject: subjectLine?.[1],
    currentText: quote ? text.slice(0, quote.index).trim() : text.trim(),
    sections: quote ? [quotedSection(text.slice(quote.index))] : [],
  };
}

export function OperatorEmailMessage({
  message,
  attachments,
}: {
  message: Pick<OperatorAgentMessage, "content" | "emailContent" | "status">;
  attachments?: ReactNode;
}) {
  const email = message.emailContent;
  const legacy = email ? null : legacyEmail(message.content);
  const sections: EmailSection[] = legacy?.sections ?? [];
  const forwarded = email?.forwarded?.email;
  if (forwarded) {
    const mailbox = (value: { name?: string; address?: string }) =>
      value.name && value.address
        ? `${value.name} <${value.address}>`
        : value.address || value.name || "";
    sections.push({
      kind: "forwarded",
      headers: [
        ["Subject", forwarded.subject || ""],
        ["From", forwarded.from ? mailbox(forwarded.from) : ""],
        ["To", forwarded.to.map(mailbox).join(", ")],
        ["Cc", forwarded.cc.map(mailbox).join(", ")],
        ["Date", forwarded.date || ""],
      ].filter((row): row is [string, string] => Boolean(row[1])),
      body: forwarded.body || "",
    });
  }
  if (email?.quotedText) sections.push(quotedSection(email.quotedText));
  const subject = email?.subject ?? legacy?.subject;
  const currentText = cleanEmailText(
    email?.currentText ?? legacy?.currentText ?? "",
  );

  return (
    <div className="min-w-0 space-y-3">
      <ChatMessageBubble
        role="user"
        channel="email"
        isOwnMessage
        isError={message.status === "error"}
      >
        <div className="min-w-0 space-y-3">
          {subject ? (
            <p
              className={`wrap-anywhere text-muted-foreground ${typeStyle("caption.medium")}`}
            >
              {subject}
            </p>
          ) : null}
          {currentText ? (
            <p className="whitespace-pre-wrap wrap-anywhere">{currentText}</p>
          ) : null}
        </div>
        {attachments}
      </ChatMessageBubble>
      {sections.map((section, index) => (
        <OperationalPanel
          key={index}
          aria-label={
            section.kind === "forwarded" ? "Forwarded email" : "Quoted reply"
          }
        >
          <div className="space-y-2 border-b border-border px-4 py-3">
            <p
              className={`text-muted-foreground ${typeStyle("caption.medium")}`}
            >
              {section.kind === "forwarded"
                ? "Forwarded email"
                : "Quoted reply"}
            </p>
            {section.headers.length ? (
              <dl className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                {section.headers.map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt
                      className={`text-muted-foreground ${typeStyle("label.metadata")}`}
                    >
                      {label}
                    </dt>
                    <dd
                      className={`min-w-0 wrap-anywhere ${typeStyle("body.default")}`}
                    >
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          <OperationalPanelBody>
            <ProseMarkdown
              gfm
              breaks
              components={{ img: ({ alt }) => <span>{alt}</span> }}
            >
              {cleanEmailText(section.body)}
            </ProseMarkdown>
          </OperationalPanelBody>
        </OperationalPanel>
      ))}
      {email?.parseInputTruncated ? (
        <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
          Full email attached as forwarded-email.txt
        </p>
      ) : null}
    </div>
  );
}
