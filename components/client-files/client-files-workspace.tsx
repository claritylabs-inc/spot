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
import { useFollowedState } from "@/hooks/use-followed-state";
import { useTableSort } from "@/hooks/use-table-sort";
import { usePdf } from "@/components/pdf-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { Input } from "@claritylabs-inc/ui/components/input";
import {
  OperationalItem,
  OperationalPanel,
} from "@claritylabs-inc/ui/components/operational-panel";
import {
  ListToolbar,
  type FilterDefinition,
} from "@/components/ui/list-toolbar";
import { PillButton } from "@/components/ui/pill-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
  SortableTableHead,
} from "@/components/ui/table";
import { TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { PageTabsList, PageTabsRail } from "@/components/ui/folder-tabs";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { formatDisplayDate } from "@/lib/date-format";
import { inferAttachmentContentType } from "@/lib/thread-prompt";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const NO_POLICY = "__none__";
const MAX_CLIENT_FILE_BYTES = 50 * 1024 * 1024;

type ClientFilesView = "private" | "shared";
type ClientFilesStatus = "active" | "archived";

type ClientFilesPanel =
  | { kind: "upload"; clientVisible?: boolean }
  | { kind: "edit" | "image"; fileId: string }
  | null;

function clientFilesEmptyState(
  status: ClientFilesStatus,
  view: ClientFilesView,
  separated: boolean,
) {
  if (status === "archived") {
    return {
      title: separated ? `No archived ${view} files` : "No archived files",
      description: "Archived files stay here until you restore them.",
    };
  }
  return view === "shared"
    ? {
        title: "No shared files",
        description: "Files shared with the client will appear here.",
      }
    : {
        title: "No private files",
        description:
          "Keep quotes, appraisals, roof reports, and other documents here for this client.",
      };
}

type ClientFilePolicyOption = {
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

const CLIENT_FILE_SORT_COLUMNS = {
  name: (file: ClientFileRow) => file.name,
  policy: (file: ClientFileRow) => file.policyLabel,
  access: (file: ClientFileRow) => (file.clientVisible ? "Shared" : "Private"),
  date: (file: ClientFileRow) => file.archivedAt ?? file.createdAt,
};

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
            disabled={!canEdit || working}
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
  showBrokerVisibility = false,
  defaultClientVisible = false,
  onClose,
  onUploaded,
}: {
  clientOrgId: Id<"organizations">;
  showBrokerVisibility?: boolean;
  defaultClientVisible?: boolean;
  onClose: () => void;
  onUploaded?: (
    files: Array<{
      clientFileId: Id<"clientFiles">;
      originalName: string;
    }>,
    visibility: { clientVisible: boolean; brokerVisible: boolean },
  ) => void | Promise<void>;
}) {
  const generateUploadUrl = useMutation(api.clientFiles.generateUploadUrl);
  const registerUpload = useMutation(api.clientFiles.registerUpload);
  const discardUpload = useMutation(api.clientFiles.discardUpload);
  const [files, setFiles] = useState<File[]>([]);
  const [hint, setHint] = useState("");
  const [clientVisible, setClientVisible] = useState(defaultClientVisible);
  const [brokerVisible, setBrokerVisible] = useState(showBrokerVisibility);
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
      await onUploaded?.(uploaded, { clientVisible, brokerVisible });
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

        <OperationalPanel aria-label="File sharing">
          <OperationalItem className="flex items-center justify-between gap-4">
            <span className={typeStyle("body.default")}>Client visibility</span>
            <SettingsSwitch
              checked={clientVisible}
              onCheckedChange={() => setClientVisible((value) => !value)}
              label="Client visibility"
              disabled={uploading}
            />
          </OperationalItem>
          {showBrokerVisibility ? (
            <OperationalItem className="flex items-center justify-between gap-4">
              <span className={typeStyle("body.default")}>
                Provider visibility
              </span>
              <SettingsSwitch
                checked={brokerVisible}
                onCheckedChange={() => setBrokerVisible((value) => !value)}
                label="Provider visibility"
                disabled={uploading}
              />
            </OperationalItem>
          ) : null}
        </OperationalPanel>
      </div>
    </SettingsDrawer>
  );
}

function UploadFilesButton({ onClick }: { onClick: () => void }) {
  return (
    <PillButton type="button" onClick={onClick}>
      <Upload className="size-3.5" />
      Upload files
    </PillButton>
  );
}

export function ClientFilesWorkspace({
  clientOrgId,
  readOnly = false,
  onActions,
  onRightPanel,
  notice,
}: {
  clientOrgId: Id<"organizations">;
  readOnly?: boolean;
  /** Page-level notice (such as read-only), shown under the view tabs. */
  notice?: ReactNode;
  /**
   * Navbar actions for a workspace without view tabs. With tabs, the upload
   * action lives in the selected tab's toolbar and this receives `null`.
   */
  onActions?: (node: ReactNode) => void;
  onRightPanel: (node: ReactNode) => void;
}) {
  // Older sessions stored "archived" as a view; it now maps to Archived status.
  const [requestedView, setView] = useFollowedState<
    ClientFilesView | "archived"
  >(`clients:${clientOrgId}:files:view`, "private");
  const [requestedStatus, setStatus] = useFollowedState<ClientFilesStatus>(
    `clients:${clientOrgId}:files:status`,
    "active",
  );
  const [panel, setPanel] = useFollowedState<ClientFilesPanel>(
    `clients:${clientOrgId}:files:panel`,
    null,
  );
  const activeResult = useQuery(api.clientFiles.list, {
    clientOrgId,
    limit: 200,
    archived: false,
  });
  const archivedResult = useQuery(api.clientFiles.list, {
    clientOrgId,
    limit: 200,
    archived: true,
  });
  // Both lists must settle before the tab set, and so the action home, is known.
  const listsReady = activeResult !== undefined && archivedResult !== undefined;
  // Shared availability spans both sources so switching status never removes
  // the selected view.
  const hasSharedFiles = [activeResult, archivedResult].some((list) =>
    Boolean(list?.truncated || list?.files.some((file) => file.clientVisible)),
  );
  const hasArchivedFiles = (archivedResult?.files.length ?? 0) > 0;
  const status: ClientFilesStatus =
    (requestedStatus === "archived" || requestedView === "archived") &&
    !(listsReady && !hasArchivedFiles)
      ? "archived"
      : "active";
  const view: ClientFilesView =
    requestedView === "shared" && !(listsReady && !hasSharedFiles)
      ? "shared"
      : "private";
  const result = status === "archived" ? archivedResult : activeResult;
  const policyRows = useQuery(api.policies.listForOrg, {
    orgId: clientOrgId,
    documentType: "policy",
  });
  const { openWithUrl, closePdf } = usePdf();
  const policies = useMemo(
    () => (policyRows ?? []) as ClientFilePolicyOption[],
    [policyRows],
  );
  const operatorView = Boolean(activeResult?.canManage);
  const hasViewTabs = listsReady && operatorView && hasSharedFiles;
  const showStatusFilter = listsReady && operatorView && hasArchivedFiles;
  const canManage = operatorView && !readOnly;
  const archivedView = status === "archived";
  const canEdit = canManage && !archivedView;
  // Uploads create active files, so archived views offer none.
  const canUpload = canManage && !archivedView;

  const closeRightPanel = useCallback(() => setPanel(null), [setPanel]);
  const openUpload = useCallback(() => {
    closePdf();
    setPanel({
      kind: "upload",
      ...(view === "shared" ? { clientVisible: true } : {}),
    });
  }, [closePdf, setPanel, view]);
  const changeStatus = useCallback(
    (next: ClientFilesStatus) => {
      setStatus(next);
      if (requestedView === "archived") setView("private");
      if (next === "archived" && panel?.kind === "upload") setPanel(null);
    },
    [panel?.kind, requestedView, setPanel, setStatus, setView],
  );

  const navbarUpload = listsReady && canUpload && !hasViewTabs;
  useEffect(() => {
    onActions?.(
      navbarUpload ? <UploadFilesButton onClick={openUpload} /> : null,
    );
    return () => onActions?.(null);
  }, [navbarUpload, onActions, openUpload]);

  const preview = useCallback(
    (file: ClientFileRow) => {
      if (!file.url) return;
      if (isPdf(file)) {
        setPanel(null);
        openWithUrl(file.url);
        return;
      }
      if (isImage(file)) {
        closePdf();
        setPanel({ kind: "image", fileId: file._id });
      }
    },
    [closePdf, openWithUrl, setPanel],
  );

  const edit = useCallback(
    (file: ClientFileRow) => {
      closePdf();
      setPanel({ kind: "edit", fileId: file._id });
    },
    [closePdf, setPanel],
  );

  const panelFile = useMemo(() => {
    if (panel === null || panel.kind === "upload") return null;
    const rows = [
      ...(activeResult?.files ?? []),
      ...(archivedResult?.files ?? []),
    ] as ClientFileRow[];
    return rows.find((file) => file._id === panel.fileId) ?? null;
  }, [activeResult, archivedResult, panel]);
  // A panel whose file is gone closes for good rather than reopening if the
  // file returns.
  const panelFileGone =
    panel !== null &&
    panel.kind !== "upload" &&
    activeResult !== undefined &&
    archivedResult !== undefined &&
    !panelFile;
  useEffect(() => {
    if (panelFileGone) setPanel(null);
  }, [panelFileGone, setPanel]);

  const uploadClientVisible =
    panel?.kind === "upload" ? panel.clientVisible : undefined;
  useEffect(() => {
    const panelKind = panel?.kind;
    let node: ReactNode = null;
    if (panelKind === "upload" && canUpload) {
      node = (
        <ClientFileUploadPanel
          key={uploadClientVisible ? "shared" : "private"}
          clientOrgId={clientOrgId}
          defaultClientVisible={uploadClientVisible}
          onClose={closeRightPanel}
        />
      );
    } else if (panelFile && panelKind === "image") {
      node = (
        <ClientFileImagePanel file={panelFile} onClose={closeRightPanel} />
      );
    } else if (panelFile && panelKind === "edit") {
      node = (
        <ClientFileEditor
          key={panelFile._id}
          file={panelFile}
          policies={policies}
          onClose={closeRightPanel}
          onPreview={() => preview(panelFile)}
          canEdit={canEdit}
          canManage={canManage}
        />
      );
    }
    if (!node) return;
    onRightPanel(node);
    return () => onRightPanel(null);
  }, [
    canEdit,
    canManage,
    canUpload,
    clientOrgId,
    closeRightPanel,
    onRightPanel,
    panel?.kind,
    panelFile,
    policies,
    preview,
    uploadClientVisible,
  ]);

  const visibleFiles = useMemo(() => {
    const files = (result?.files ?? []) as ClientFileRow[];
    return hasViewTabs
      ? files.filter((file) =>
          view === "shared" ? file.clientVisible : !file.clientVisible,
        )
      : files;
  }, [hasViewTabs, result, view]);
  const tableSort = useTableSort(
    `clients:${clientOrgId}:files:${status}:${view}`,
    visibleFiles,
    CLIENT_FILE_SORT_COLUMNS,
  );

  if (!listsReady || result === undefined || policyRows === undefined) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  const viewTabs = hasViewTabs ? (
    <PageTabsRail
      value={view}
      onValueChange={(value) => {
        if (value === "private" || value === "shared") {
          if (requestedView === "archived") setStatus("archived");
          setView(value);
        }
      }}
    >
      <PageTabsList aria-label="Client files view">
        <TabsTrigger value="private">Private</TabsTrigger>
        <TabsTrigger value="shared">Shared</TabsTrigger>
      </PageTabsList>
    </PageTabsRail>
  ) : null;
  const statusFilters: FilterDefinition[] = showStatusFilter
    ? [
        {
          id: "status",
          label: "Status",
          inline: true,
          allLabel: "Active",
          options: [
            { value: "archived", label: "Archived" },
          ],
          value: archivedView ? ["archived"] : [],
          onChange: (next) =>
            changeStatus(next[0] === "archived" ? "archived" : "active"),
        },
      ]
    : [];
  const truncatedNote =
    operatorView && result.truncated ? (
      <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Showing the latest 200
      </span>
    ) : null;
  const tabUpload =
    hasViewTabs && canUpload ? (
      <UploadFilesButton onClick={openUpload} />
    ) : null;
  const viewToolbar =
    statusFilters.length > 0 || truncatedNote || tabUpload ? (
      <ListToolbar
        followKey={`clients:${clientOrgId}:files`}
        tabsPlacement="navbar"
        tabs={viewTabs}
        filters={statusFilters}
        onClearFilters={() => changeStatus("active")}
        actions={
          truncatedNote || tabUpload ? (
            <>
              {truncatedNote}
              {tabUpload}
            </>
          ) : undefined
        }
      />
    ) : (
      viewTabs
    );

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
    const emptyState = clientFilesEmptyState(status, view, hasViewTabs);
    return (
      <div className="space-y-4">
        {viewToolbar}
        {notice}
        <EmptyStateCard
          title={emptyState.title}
          description={emptyState.description}
          icon={<FileText className="size-6" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {viewToolbar}
      {notice}
      <OperationalPanel as="div">
        <Table storageKey="spot:client-files:columns">
          <TableHeader>
            <TableRow>
              <SortableTableHead {...tableSort.head("name")}>
                File
              </SortableTableHead>
              <SortableTableHead {...tableSort.head("policy")}>
                Policy
              </SortableTableHead>
              {operatorView ? (
                <SortableTableHead {...tableSort.head("access")}>
                  Client access
                </SortableTableHead>
              ) : null}
              <SortableTableHead {...tableSort.head("date")}>
                {archivedView ? "Archived" : "Added"}
              </SortableTableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tableSort.rows.map((file) => {
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
