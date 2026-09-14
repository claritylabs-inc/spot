"use client";

import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Copy, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { parseMarkdownDocument } from "@/convex/lib/markdownDocument";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { ProseMarkdown } from "@/components/prose-markdown";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag } from "@/components/ui/status-tag";
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

export function PacketWorkspace({
  requestId,
}: {
  requestId: Id<"procurementRequests">;
  readOnly: boolean;
}) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  if (!packet)
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  return (
    <div className="space-y-4">
      {packet.documents.length ? (
        packet.documents.map((document) => (
          <OperationalPanel
            key={document.filename}
            as="section"
            aria-label={document.filename}
          >
            <OperationalPanelBody className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <span className={typeStyle("label.field")}>
                  {document.filename}
                </span>
                <StatusTag tone="neutral">
                  {document.visibility === "shared" ? "Shared" : "Private"}
                </StatusTag>
              </div>
              <ProseMarkdown>
                {markdownBody(document.markdown) || "No content yet."}
              </ProseMarkdown>
            </OperationalPanelBody>
          </OperationalPanel>
        ))
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          No Markdown files yet.
        </p>
      )}
    </div>
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
  const fieldId = useId();
  const [filename, setFilename] = useState("");
  const [files, setFiles] = useState(
    documents.map((document) => document.filename),
  );
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      documents.map((document) => [document.filename, document.markdown]),
    ),
  );
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
      for (const [filename, markdown] of Object.entries(next)) {
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
    >
      <AutoSaveStatus status={autoSave.status} />
      <div className="space-y-5">
        {files.map((filename) => (
          <div key={filename} className="space-y-1.5">
            <label
              htmlFor={`${fieldId}-${filename}`}
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              {filename}
            </label>
            <Textarea
              id={`${fieldId}-${filename}`}
              value={drafts[filename]}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [filename]: event.target.value,
                }))
              }
              className="min-h-72"
            />
          </div>
        ))}
        <div className="flex items-end gap-2">
          <label className="flex-1 space-y-1.5">
            <span
              className={`text-muted-foreground ${typeStyle("label.field")}`}
            >
              New Markdown file
            </span>
            <Input
              value={filename}
              onChange={(event) => setFilename(event.target.value)}
              placeholder="notes.md"
            />
          </label>
          <PillButton
            variant="secondary"
            onClick={() => {
              const name = filename.trim();
              if (!/^[^/\\\u0000-\u001f]+\.md$/i.test(name)) {
                toast.error("Enter a plain .md filename");
                return;
              }
              if (files.includes(name)) {
                toast.error("A file with that name already exists");
                return;
              }
              setFiles((current) => [...current, name]);
              setDrafts((current) => ({
                ...current,
                [name]: "---\nvisibility: private\n---\n",
              }));
              setFilename("");
            }}
          >
            Add file
          </PillButton>
        </div>
      </div>
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
