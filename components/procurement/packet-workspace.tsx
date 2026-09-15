"use client";

import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { useMutation, useQuery } from "convex/react";
import {
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

import {
  MAX_MARKDOWN_BYTES,
  parseMarkdownDocument,
} from "@/convex/lib/markdownDocument";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export function PacketLinkDrawer({
  requestId,
  onClose,
  beforeRegenerate,
}: {
  requestId: Id<"procurementRequests">;
  onClose: () => void;
  beforeRegenerate: () => Promise<boolean>;
}) {
  const links = useQuery(api.procurementPacket.listLinks, { requestId });
  const mintLink = useMutation(api.procurementPacket.mintLink);
  const rotateLink = useMutation(api.procurementPacket.rotateLink);
  const activeLink = links?.find(
    (link) => link.outreachId === null && link.state === "active",
  );
  const url = activeLink?.url;
  const [regenerating, setRegenerating] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopyFailed(false);
      toast.success("Packet link copied");
    } catch {
      setCopyFailed(true);
    }
  }
  async function regenerate() {
    setRegenerating(true);
    try {
      if (!(await beforeRegenerate())) return;
      if (activeLink) await rotateLink({ linkId: activeLink.linkId });
      else await mintLink({ requestId });
      setCopyFailed(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(
          error,
          "Could not regenerate the packet link",
        ),
      );
    } finally {
      setRegenerating(false);
    }
  }
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => !open && onClose()}
      title="Share link"
      footer={
        <>
          <PillButton
            type="button"
            variant="secondary"
            disabled={regenerating || links === undefined}
            onClick={() => void regenerate()}
          >
            {regenerating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {activeLink ? "Regenerate link" : "Create link"}
          </PillButton>
          {url ? (
            <PillButton type="button" onClick={() => void copy()}>
              <Copy className="size-3.5" />
              Copy link
            </PillButton>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        {links === undefined ? (
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        ) : url ? (
          <>
            <Input
              aria-label="Packet link"
              readOnly
              value={url}
              onFocus={(event) => event.currentTarget.select()}
            />
            {copyFailed ? (
              <p
                role="status"
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                Select the link above and copy it manually.
              </p>
            ) : null}
            <PillButton
              href={url}
              target="_blank"
              rel="noreferrer"
              variant="secondary"
            >
              <ExternalLink className="size-3.5" />
              Preview shared packet
            </PillButton>
          </>
        ) : (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            {activeLink
              ? "The existing link is still valid, but its URL was not saved. Regenerate it to get a copyable link."
              : "Create a link to share this packet."}
          </p>
        )}
        {activeLink ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Saved changes and file visibility updates appear automatically on this
            link. Regenerating replaces the existing link.
          </p>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

type PacketFilename = "private.md" | "public.md";
export type PacketEditorHandle = { save: () => Promise<boolean> };
type PacketWorkspaceProps = {
  requestId: Id<"procurementRequests">;
  filename: PacketFilename;
  readOnly?: boolean;
  ref?: Ref<PacketEditorHandle>;
};

export function PacketWorkspace({
  requestId,
  filename,
  readOnly = false,
  ref,
}: PacketWorkspaceProps) {
  const packet = useQuery(api.procurementPacket.get, { requestId });
  if (!packet)
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  const document = packet.documents.find(
    (document) => document.filename === filename,
  );
  return (
    <LoadedPacketEditor
      key={`${requestId}:${filename}`}
      ref={ref}
      requestId={requestId}
      filename={filename}
      readOnly={readOnly}
      document={
        document ?? {
          markdown: `---\nvisibility: ${filename === "public.md" ? "shared" : "private"}\n---\n`,
          revision: 0,
        }
      }
    />
  );
}

function LoadedPacketEditor({
  requestId,
  filename,
  readOnly,
  ref,
  document,
}: PacketWorkspaceProps & {
  document: { markdown: string; revision: number };
}) {
  const updateDocument = useMutation(api.procurementPacket.updateDocument);
  const [draft, setDraft] = useState(document.markdown);
  const saved = useRef(document.markdown);
  const revision = useRef(document.revision);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (document.revision > revision.current && draft === saved.current) {
      saved.current = document.markdown;
      revision.current = document.revision;
      setDraft(document.markdown);
    }
  }, [document.markdown, document.revision, draft]);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "procurementPacket.updateDocument",
    args: draft,
    enabled: !readOnly,
    flush: async (markdown) => {
      if (markdown === saved.current) return;
      const result = await updateDocument({
        requestId,
        filename,
        markdown,
        expectedRevision: revision.current,
      });
      revision.current = result.revision;
      saved.current = markdown;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the packet"),
  });
  useImperativeHandle(
    ref,
    () => ({ save: readOnly ? async () => true : autoSave.saveNow }),
    [autoSave.saveNow, readOnly],
  );
  return (
    <>
      <AutoSaveStatus status={autoSave.status} />
      <input
        ref={fileInput}
        type="file"
        accept=".md,text/markdown"
        aria-label={`Import ${filename}`}
        className="sr-only"
        disabled={readOnly}
        onChange={async (event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          try {
            if (
              !file.name.toLowerCase().endsWith(".md") ||
              file.size > MAX_MARKDOWN_BYTES
            )
              throw new Error("Choose a .md file under 512 KiB");
            const markdown = await file.text();
            parseMarkdownDocument(markdown);
            setDraft(markdown);
          } catch (error) {
            toast.error(
              getUserFacingErrorMessage(
                error,
                "Could not read this Markdown file",
              ),
            );
          }
          input.value = "";
        }}
      />
      <MarkdownEditor
        label={filename}
        value={draft}
        onChange={setDraft}
        readOnly={readOnly}
        defaultMode="preview"
        footer={
          <>
            {autoSave.status === "error" ? (
              <>
                <PillButton
                  variant="destructive"
                  onClick={() => {
                    revision.current = document.revision;
                    saved.current = document.markdown;
                    setDraft(document.markdown);
                  }}
                >
                  Discard edits
                </PillButton>
                <PillButton
                  variant="secondary"
                  onClick={() => void autoSave.saveNow()}
                >
                  Retry save
                </PillButton>
              </>
            ) : null}
            {!readOnly ? (
              <PillButton
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-3.5" />
                Import
              </PillButton>
            ) : null}
            <PillButton
              variant="secondary"
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(draft)}`}
              download={filename}
            >
              <Download className="size-3.5" />
              Download
            </PillButton>
          </>
        }
      />
    </>
  );
}
