"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { File, FileImage, FileText, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { FileDownloadButton } from "@/components/ui/file-download-button";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { FileDropZone } from "@/components/ui/file-drop";
import { Input } from "@/components/ui/input";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { formatDisplayDate } from "@/lib/date-format";
import { inferAttachmentContentType } from "@/lib/thread-prompt";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NO_POLICY = "__none__";
const MAX_CLIENT_FILE_BYTES = 50 * 1024 * 1024;

type ClientFilesView = "private" | "shared" | "archived";

const CLIENT_FILE_EMPTY_STATES: Record<
  ClientFilesView,
  { title: string; description: string }
> = {
  private: {
    title: "No private files",
    description:
      "Keep quotes, appraisals, roof reports, and other documents here for this client.",
  },
  shared: {
    title: "No shared files",
    description: "Files shared with the client will appear here.",
  },
  archived: {
    title: "No archived files",
    description: "Archived files stay here until you restore them.",
  },
};

export type ClientFilePolicyOption = {
  _id: Id<"policies">;
  carrier?: string | null;
  policyNumber?: string | null;
  fileName?: string | null;
};

type ClientFileRow = {
  _id: Id<"clientFiles">;
  name: string;
  originalName: string;
  contentType: string;
  size: number;
  clientVisible: boolean;
  policyId?: Id<"policies">;
  policyLabel: string | null;
  nameStatus: "pending" | "ready" | "failed";
  archivedAt?: number;
  createdAt: number;
  url: string | null;
};

function policyOptionLabel(policy: ClientFilePolicyOption) {
  return (
    [policy.carrier, policy.policyNumber]
      .map((value) => value?.trim())
      .filter((value) => value && value !== "Extracting...")
      .join(" · ") ||
    policy.fileName?.trim() ||
    "Policy"
  );
}

function formatFileSize(size: number) {
  if (size < 1_024) return `${size} B`;
  if (size < 1_024 * 1_024) return `${Math.round(size / 1_024)} KB`;
  return `${(size / (1_024 * 1_024)).toFixed(size < 10 * 1_024 * 1_024 ? 1 : 0)} MB`;
}

function isPdf(file: Pick<ClientFileRow, "contentType" | "name">) {
  return file.contentType === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImage(file: Pick<ClientFileRow, "contentType" | "name">) {
  return (
    file.contentType.startsWith("image/") ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(file.name)
  );
}

function FileKindIcon({ file }: { file: ClientFileRow }) {
  if (isImage(file)) return <FileImage className="size-4" />;
  if (isPdf(file)) return <FileText className="size-4" />;
  return <File className="size-4" />;
}

function PolicySelect({
  value,
  policies,
  disabled,
  onValueChange,
  className,
}: {
  value: string;
  policies: ClientFilePolicyOption[];
  disabled?: boolean;
  onValueChange: (value: string) => void;
  className?: string;
}) {
  const selected = policies.find((policy) => policy._id === value);
  return (
    <Select
      value={value}
      onValueChange={(next) => next && onValueChange(next)}
      disabled={disabled}
    >
      <SelectTrigger size="sm" className={className ?? "w-48 max-w-full"}>
        <SelectValue>
          {selected ? policyOptionLabel(selected) : "No policy"}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NO_POLICY}>No policy</SelectItem>
        {policies.map((policy) => (
          <SelectItem key={policy._id} value={policy._id}>
            {policyOptionLabel(policy)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ClientFileImagePanel({
  file,
  onClose,
}: {
  file: ClientFileRow;
  onClose: () => void;
}) {
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={file.name}
      footer={
        file.url ? (
          <FileDownloadButton href={file.url} fileName={file.name} />
        ) : null
      }
    >
      {file.url ? (
        <div className="relative flex min-h-80 items-center justify-center overflow-hidden rounded-lg border border-border bg-foreground/[0.02]">
          {/* Convex storage URLs are dynamic and intentionally bypass Next image optimization. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={file.url}
            alt={file.name}
            className="h-auto max-h-[calc(100vh-11rem)] w-auto max-w-full object-contain"
          />
        </div>
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
          This image is no longer available.
        </p>
      )}
    </SettingsDrawer>
  );
}

function ClientFileEditor({
  file,
  policies,
  onClose,
  onPreview,
  canEdit,
  canManage,
}: {
  file: ClientFileRow;
  policies: ClientFilePolicyOption[];
  onClose: () => void;
  onPreview: () => void;
  canEdit: boolean;
  canManage: boolean;
}) {
  const updateClientFile = useMutation(api.clientFiles.update);
  const [name, setName] = useState(file.name);
  const [clientVisible, setClientVisible] = useState(file.clientVisible);
  const [policyId, setPolicyId] = useState<string>(file.policyId ?? NO_POLICY);
  const setArchived = useMutation(api.clientFiles.setArchived);
  const [working, setWorking] = useState(false);
  const values = { name, clientVisible, policyId };
  const saved = useRef(values);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "clientFiles.update",
    args: values,
    enabled: canEdit,
    canSave: !!name.trim(),
    flush: async (next) => {
      await updateClientFile({
        clientFileId: file._id,
        name: next.name !== saved.current.name ? next.name : undefined,
        clientVisible:
          next.clientVisible !== saved.current.clientVisible
            ? next.clientVisible
            : undefined,
        policyId:
          next.policyId !== saved.current.policyId
            ? next.policyId === NO_POLICY
              ? null
              : (next.policyId as Id<"policies">)
            : undefined,
      });
      saved.current = next;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not update the file"),
  });
  async function afterSaving(action: () => void | Promise<void>) {
    if (!canEdit || (await autoSave.saveNow())) await action();
  }
  async function archive() {
    if (!canManage || working) return;
    setWorking(true);
    try {
      await afterSaving(async () => {
        await setArchived({
          clientFileId: file._id,
          archived: !file.archivedAt,
        });
        toast.success(file.archivedAt ? "File restored" : "File archived");
        onClose();
      });
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not update the file"),
      );
    } finally {
      setWorking(false);
    }
  }
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !working) void afterSaving(onClose);
      }}
      title={file.name}
      footer={
        <>
          {canManage ? (
            <PillButton
              variant={file.archivedAt ? "secondary" : "destructive"}
              disabled={working}
              onClick={() => void archive()}
            >
              {file.archivedAt ? "Restore" : "Archive"}
            </PillButton>
          ) : null}
          {file.url && (isPdf(file) || isImage(file)) ? (
            <PillButton
              variant="secondary"
              disabled={working}
              onClick={() => void afterSaving(onPreview)}
            >
              Preview
            </PillButton>
          ) : null}
          {file.url ? (
            <FileDownloadButton href={file.url} fileName={name} />
          ) : null}
        </>
      }
    >
      <AutoSaveStatus status={autoSave.status} />
      <fieldset disabled={!canEdit || working} className="min-w-0 space-y-5">
        <label className="space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            File name
          </span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Associated policy
          </span>
          <PolicySelect
            value={policyId}
            policies={policies}
            onValueChange={setPolicyId}
            className="w-full"
          />
        </div>
        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              Visible to client
            </p>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              The client can open or download this file from their portal.
            </p>
          </div>
          <SettingsSwitch
            checked={clientVisible}
            onCheckedChange={() => setClientVisible((value) => !value)}
            label="Visible to client"
          />
        </div>
      </fieldset>
    </SettingsDrawer>
  );
}

export function ClientFileUploadPanel({
  clientOrgId,
  policies,
  onClose,
  onUploaded,
}: {
  clientOrgId: Id<"organizations">;
  policies: ClientFilePolicyOption[];
  onClose: () => void;
  onUploaded?: (
    files: Array<{
      clientFileId: Id<"clientFiles">;
      originalName: string;
    }>,
  ) => void | Promise<void>;
}) {
  const generateUploadUrl = useMutation(api.clientFiles.generateUploadUrl);
  const registerUpload = useMutation(api.clientFiles.registerUpload);
  const discardUpload = useMutation(api.clientFiles.discardUpload);
  const [files, setFiles] = useState<File[]>([]);
  const [hint, setHint] = useState("");
  const [clientVisible, setClientVisible] = useState(false);
  const [policyId, setPolicyId] = useState<string>(NO_POLICY);
  const [uploading, setUploading] = useState(false);

  const addFiles = useCallback((selected: File[]) => {
    const oversized = selected.filter(
      (file) => file.size > MAX_CLIENT_FILE_BYTES,
    );
    if (oversized.length > 0) {
      toast.error("Client files must be 50 MB or smaller");
    }
    setFiles((current) => {
      const next = [...current];
      for (const file of selected.filter(
        (candidate) => candidate.size <= MAX_CLIENT_FILE_BYTES,
      )) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (
          !next.some(
            (candidate) =>
              `${candidate.name}:${candidate.size}:${candidate.lastModified}` ===
              key,
          )
        ) {
          next.push(file);
        }
      }
      return next;
    });
  }, []);

  async function upload() {
    if (files.length === 0) return;
    setUploading(true);
    const toastId = toast.loading("Uploading files…");
    try {
      const uploaded: Array<{
        clientFileId: Id<"clientFiles">;
        originalName: string;
      }> = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const target = await generateUploadUrl({ clientOrgId });
        let fileId: Id<"_storage"> | undefined;
        try {
          const contentType = inferAttachmentContentType(file.name, file.type);
          const response = await fetch(target.uploadUrl, {
            method: "POST",
            headers: { "Content-Type": contentType },
            body: file,
          });
          if (!response.ok)
            throw new Error(`Upload failed (${response.status})`);
          const result = (await response.json()) as { storageId: string };
          fileId = result.storageId as Id<"_storage">;
          const registered = await registerUpload({
            uploadIntentId: target.uploadIntentId,
            fileId,
            originalName: file.name,
            contentType,
            clientVisible,
            policyId:
              policyId === NO_POLICY ? undefined : (policyId as Id<"policies">),
            hint: hint.trim() || undefined,
          });
          uploaded.push({
            clientFileId: registered.clientFileId,
            originalName: file.name,
          });
        } catch (error) {
          await discardUpload({
            uploadIntentId: target.uploadIntentId,
            fileId,
          }).catch(() => undefined);
          throw error;
        }
        toast.loading(`Uploaded ${index + 1} of ${files.length} files…`, {
          id: toastId,
        });
      }
      await onUploaded?.(uploaded);
      toast.success(
        `${files.length} ${files.length === 1 ? "file" : "files"} uploaded. Names will update automatically.`,
        { id: toastId },
      );
      onClose();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Failed to upload file"), {
        id: toastId,
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open && !uploading) onClose();
      }}
      title="Upload client files"
      footer={
        <>
          <PillButton
            type="button"
            onClick={upload}
            disabled={uploading || files.length === 0}
          >
            {uploading ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Upload files
          </PillButton>
        </>
      }
    >
      <div className="space-y-5">
        <FileDropZone
          multiple
          onFiles={addFiles}
          accept="*/*"
          disabled={uploading}
          idleLabel="Drop client files here"
          activeLabel="Add these files"
          busyLabel="Uploading files…"
          hint="PDFs and images can be previewed; other files download directly. 50 MB per file."
        />

        {files.length > 0 ? (
          <div className="divide-y divide-border rounded-lg border border-border">
            {files.map((file) => (
              <div
                key={`${file.name}:${file.size}:${file.lastModified}`}
                className="flex min-w-0 items-center gap-3 px-3 py-2.5"
              >
                <File className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p
                    className={`truncate text-foreground ${typeStyle("body.default")}`}
                  >
                    {file.name}
                  </p>
                  <p
                    className={`text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    {formatFileSize(file.size)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((current) =>
                      current.filter((item) => item !== file),
                    )
                  }
                  disabled={uploading}
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground disabled:opacity-50"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <label className="space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Naming hint{" "}
            <span className="text-muted-foreground/60">(optional)</span>
          </span>
          <Textarea
            value={hint}
            onChange={(event) => setHint(event.target.value)}
            maxLength={500}
            className="min-h-20"
            placeholder="For example: These are the latest roof reports for the Main Street properties."
          />
          <span
            className={`block text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Spot reads each file and proposes a more useful name. Your hint is
            supporting context.
          </span>
        </label>

        <div className="space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Associated policy
          </span>
          <PolicySelect
            value={policyId}
            policies={policies}
            onValueChange={setPolicyId}
            className="w-full"
          />
        </div>

        <div className="flex items-start justify-between gap-4 border-t border-border pt-4">
          <div>
            <p className={`text-foreground ${typeStyle("body.medium")}`}>
              Visible to client
            </p>
            <p
              className={`mt-1 text-muted-foreground ${typeStyle("body.default")}`}
            >
              Files are private to operators by default.
            </p>
          </div>
          <SettingsSwitch
            checked={clientVisible}
            onCheckedChange={() => setClientVisible((value) => !value)}
            label="Visible to client"
            disabled={uploading}
          />
        </div>
      </div>
    </SettingsDrawer>
  );
}

export function ClientFilesWorkspace({
  clientOrgId,
  readOnly = false,
  onActions,
  onRightPanel,
}: {
  clientOrgId: Id<"organizations">;
  readOnly?: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  const [view, setView] = useState<ClientFilesView>("private");
  const result = useQuery(api.clientFiles.list, {
    clientOrgId,
    limit: 200,
    archived: view === "archived",
  });
  const policyRows = useQuery(api.policies.listForOrg, {
    orgId: clientOrgId,
    documentType: "policy",
  });
  const { openWithUrl, closePdf } = usePdf();
  const policies = useMemo(
    () => (policyRows ?? []) as ClientFilePolicyOption[],
    [policyRows],
  );
  const operatorView = Boolean(result?.canManage);
  const canManage = operatorView && !readOnly;
  const archivedView = view === "archived";
  const canEdit = canManage && !archivedView;

  const closeRightPanel = useCallback(() => onRightPanel(null), [onRightPanel]);
  const openUpload = useCallback(() => {
    closePdf();
    onRightPanel(
      <ClientFileUploadPanel
        clientOrgId={clientOrgId}
        policies={policies}
        onClose={closeRightPanel}
      />,
    );
  }, [clientOrgId, closePdf, closeRightPanel, onRightPanel, policies]);

  useEffect(() => {
    onActions?.(
      canManage ? (
        <PillButton type="button" onClick={openUpload}>
          <Upload className="size-3.5" />
          Upload files
        </PillButton>
      ) : null,
    );
    return () => onActions?.(null);
  }, [canManage, onActions, openUpload]);

  const preview = useCallback(
    (file: ClientFileRow) => {
      if (!file.url) return;
      if (isPdf(file)) {
        onRightPanel(null);
        openWithUrl(file.url);
        return;
      }
      if (isImage(file)) {
        closePdf();
        onRightPanel(
          <ClientFileImagePanel file={file} onClose={closeRightPanel} />,
        );
      }
    },
    [closePdf, closeRightPanel, onRightPanel, openWithUrl],
  );

  const edit = useCallback(
    (file: ClientFileRow) => {
      closePdf();
      onRightPanel(
        <ClientFileEditor
          key={file._id}
          file={file}
          policies={policies}
          onClose={closeRightPanel}
          onPreview={() => preview(file)}
          canEdit={canEdit}
          canManage={canManage}
        />,
      );
    },
    [
      canEdit,
      canManage,
      closePdf,
      closeRightPanel,
      onRightPanel,
      policies,
      preview,
    ],
  );

  if (result === undefined || policyRows === undefined) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  const files = result.files as ClientFileRow[];
  const visibleFiles =
    operatorView && !archivedView
      ? files.filter((file) =>
          view === "shared" ? file.clientVisible : !file.clientVisible,
        )
      : files;
  const visibilityTabs = operatorView ? (
    <div className="flex min-w-0 items-center justify-between gap-4">
      <div className="overflow-x-auto">
        <Tabs
          value={view}
          onValueChange={(value) => {
            if (
              value === "private" ||
              value === "shared" ||
              value === "archived"
            ) {
              setView(value);
            }
          }}
        >
          <TabsList variant="pill" aria-label="Client files view">
            <TabsTrigger value="private">Private</TabsTrigger>
            <TabsTrigger value="shared">Shared</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      {result.truncated ? (
        <span
          className={`shrink-0 text-muted-foreground ${typeStyle("caption.default")}`}
        >
          Showing the latest 200
        </span>
      ) : null}
    </div>
  ) : null;

  if (visibleFiles.length === 0) {
    if (!operatorView) {
      return (
        <EmptyStateCard
          title="No shared files yet"
          description="Files your Spot team shares with your organization will appear here."
          icon={<FileText className="size-6" />}
        />
      );
    }
    return (
      <div className="space-y-4">
        {visibilityTabs}
        <EmptyStateCard
          title={CLIENT_FILE_EMPTY_STATES[view].title}
          description={CLIENT_FILE_EMPTY_STATES[view].description}
          icon={<FileText className="size-6" />}
          actionLabel={canEdit ? "Upload files" : undefined}
          onAction={canEdit ? openUpload : undefined}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visibilityTabs}
      <OperationalPanel as="div">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Policy</TableHead>
              {operatorView ? <TableHead>Client access</TableHead> : null}
              <TableHead>{archivedView ? "Archived" : "Added"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleFiles.map((file) => {
              return (
                <TableRow
                  key={file._id}
                  tabIndex={0}
                  onClick={() => edit(file)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      edit(file);
                    }
                  }}
                  className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <TableCell className="min-w-60 whitespace-normal">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="shrink-0 text-muted-foreground">
                        <FileKindIcon file={file} />
                      </span>
                      <div className="min-w-0">
                        <span
                          className={`block truncate text-foreground ${typeStyle("body.medium")}`}
                        >
                          {file.name}
                        </span>
                        <p
                          className={`mt-0.5 text-muted-foreground ${typeStyle("caption.default")}`}
                        >
                          {file.nameStatus === "pending" ? (
                            <span className="inline-flex items-center gap-1">
                              <Loader2 className="size-3 animate-spin" />
                              Naming from contents…
                            </span>
                          ) : (
                            formatFileSize(file.size)
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="text-muted-foreground">
                      {file.policyLabel ?? "None"}
                    </span>
                  </TableCell>
                  {operatorView ? (
                    <TableCell className="text-muted-foreground">
                      {file.clientVisible ? "Shared" : "Private"}
                    </TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground">
                    {formatDisplayDate(
                      archivedView
                        ? (file.archivedAt ?? file.createdAt)
                        : file.createdAt,
                      "—",
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </OperationalPanel>
    </div>
  );
}
