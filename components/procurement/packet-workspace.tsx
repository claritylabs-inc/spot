"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, Download, ExternalLink, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import {
  MAX_MARKDOWN_BYTES,
  parseMarkdownDocument,
} from "@/convex/lib/markdownDocument";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { ProseMarkdown } from "@/components/prose-markdown";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function PacketLinkDrawer({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      toast.success("Packet link copied");
    } catch {
      setCopyFailed(true);
    }
  }
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title="Share packet"
      footer={
        <PillButton type="button" onClick={() => void copy()}>
          <Copy className="size-3.5" />
          Copy link
        </PillButton>
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className={`text-muted-foreground ${typeStyle("label.field")}`}>
            Packet link
          </span>
          <Input
            readOnly
            value={url}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        {copyFailed ? (
          <p
            role="status"
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            Select the link above and copy it manually.
          </p>
        ) : null}
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This link shares the saved packet and released files with all brokers.
          It replaces the previous shared link.
        </p>
        <PillButton
          href={url}
          target="_blank"
          rel="noreferrer"
          variant="secondary"
        >
          <ExternalLink className="size-3.5" />
          Preview shared packet
        </PillButton>
      </div>
    </SettingsDrawer>
  );
}

const PACKET_FILES = ["private.md", "public.md"] as const;

export function PacketWorkspace({
  requestId,
}: {
  requestId: Id<"procurementRequests">;
}) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  if (!packet)
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  return (
    <Tabs defaultValue="private.md">
      <TabsList variant="pill" aria-label="Packet files">
        {PACKET_FILES.map((filename) => (
          <TabsTrigger key={filename} value={filename}>
            {filename}
          </TabsTrigger>
        ))}
      </TabsList>
      {PACKET_FILES.map((filename) => {
        const document = packet.documents.find(
          (document) => document.filename === filename,
        );
        return (
          <TabsContent key={filename} value={filename} className="pt-3">
            <ProseMarkdown gfm>
              {document
                ? markdownBody(document.markdown) || "No content yet."
                : "No content yet."}
            </ProseMarkdown>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

function markdownBody(markdown: string) {
  return parseMarkdownDocument(markdown).body;
}

type EditablePacketDocument = {
  filename: string;
  markdown: string;
  revision: number;
};

function LoadedPacketEditor({
  requestId,
  documents,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  documents: EditablePacketDocument[];
  onClose: () => void;
}) {
  const updateDocument = useMutation(api.procurementPacket.updateDocument);
  const latestDrafts = () =>
    Object.fromEntries(
      PACKET_FILES.map((filename) => [
        filename,
        documents.find((document) => document.filename === filename)
          ?.markdown ??
          `---\nvisibility: ${filename === "public.md" ? "shared" : "private"}\n---\n`,
      ]),
    );
  const [drafts, setDrafts] = useState(latestDrafts);
  const fileInputs = useRef<
    Partial<Record<(typeof PACKET_FILES)[number], HTMLInputElement | null>>
  >({});
  const revisions = useRef(
    Object.fromEntries(
      documents.map((document) => [document.filename, document.revision]),
    ),
  );
  const saved = useRef(drafts);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementPacket.updateDocument",
    args: drafts,
    flush: async (next) => {
      for (const filename of PACKET_FILES) {
        const markdown = next[filename];
        if (markdown === saved.current[filename]) continue;
        const result = await updateDocument({
          requestId,
          filename,
          markdown,
          expectedRevision: revisions.current[filename] ?? 0,
        });
        revisions.current[filename] = result.revision;
        saved.current = { ...saved.current, [filename]: markdown };
      }
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the packet"),
  });
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onClose();
          });
      }}
      title="Edit packet"
      actions={
        <div className="flex items-center gap-2">
          <AutoSaveStatus status={autoSave.status} />
          {autoSave.status === "error" ? (
            <PillButton
              variant="destructive"
              onClick={() => {
                const latest = latestDrafts();
                revisions.current = Object.fromEntries(
                  documents.map((document) => [
                    document.filename,
                    document.revision,
                  ]),
                );
                saved.current = latest;
                setDrafts(latest);
              }}
            >
              Discard edits
            </PillButton>
          ) : null}
        </div>
      }
    >
      <Tabs defaultValue="private.md">
        <TabsList variant="pill" aria-label="Edit packet files">
          {PACKET_FILES.map((filename) => (
            <TabsTrigger key={filename} value={filename}>
              {filename}
            </TabsTrigger>
          ))}
        </TabsList>
        {PACKET_FILES.map((filename) => (
          <TabsContent key={filename} value={filename} className="pt-3">
            <div className="mb-3 flex justify-end gap-2">
              <input
                ref={(input) => {
                  fileInputs.current[filename] = input;
                }}
                type="file"
                accept=".md,text/markdown"
                aria-label={`Import ${filename}`}
                className="sr-only"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (
                    !file.name.toLowerCase().endsWith(".md") ||
                    file.size > MAX_MARKDOWN_BYTES
                  ) {
                    toast.error("Choose a .md file under 512 KiB");
                    event.target.value = "";
                    return;
                  }
                  try {
                    const markdown = await file.text();
                    parseMarkdownDocument(markdown);
                    setDrafts((current) => ({
                      ...current,
                      [filename]: markdown,
                    }));
                  } catch (error) {
                    toast.error(
                      getUserFacingErrorMessage(
                        error,
                        "Could not read this Markdown file",
                      ),
                    );
                  }
                  event.target.value = "";
                }}
              />
              <PillButton
                type="button"
                size="compact"
                variant="secondary"
                onClick={() => fileInputs.current[filename]?.click()}
              >
                <Upload className="size-3.5" />
                Import
              </PillButton>
              <PillButton
                size="compact"
                variant="secondary"
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(drafts[filename])}`}
                download={filename}
              >
                <Download className="size-3.5" />
                Download
              </PillButton>
            </div>
            <Textarea
              aria-label={filename}
              value={drafts[filename]}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [filename]: event.target.value,
                }))
              }
              className="min-h-96"
            />
          </TabsContent>
        ))}
      </Tabs>
    </SettingsDrawer>
  );
}

export function PacketEditor({
  requestId,
  onClose,
}: {
  requestId: Id<"procurementRequests">;
  onClose: () => void;
}) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  if (!packet)
    return (
      <SettingsDrawer
        open
        onOpenChange={(open) => !open && onClose()}
        title="Edit packet"
      >
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SettingsDrawer>
    );
  return (
    <LoadedPacketEditor
      key={requestId}
      requestId={requestId}
      documents={packet.documents}
      onClose={onClose}
    />
  );
}
