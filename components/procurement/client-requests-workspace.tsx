"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { usePdf } from "@/components/pdf-context";
import { FileDropZone } from "@/components/ui/file-drop";
import { FileDownloadButton } from "@/components/ui/file-download-button";
import { useMutation, useQuery } from "convex/react";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ProseMarkdown } from "@/components/prose-markdown";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { Input } from "@/components/ui/input";
import {
  OperationalItem,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { StatusTag, type StatusTagTone } from "@/components/ui/status-tag";
import { Textarea } from "@/components/ui/textarea";

type ClientRequestStatus =
  | "submitted"
  | "information_needed"
  | "in_progress"
  | "finalizing"
  | "completed"
  | "cancelled";

const STATUS_LABELS: Record<ClientRequestStatus, string> = {
  submitted: "Submitted",
  information_needed: "Information needed",
  in_progress: "In progress",
  finalizing: "Finalizing",
  completed: "Completed",
  cancelled: "Cancelled",
};

function statusTone(status: ClientRequestStatus): StatusTagTone {
  if (status === "completed") return "success";
  if (status === "cancelled") return "danger";
  if (status === "information_needed") return "warning";
  return status === "submitted" ? "neutral" : "info";
}

function RequestStatus({ status }: { status: ClientRequestStatus }) {
  return (
    <StatusTag tone={statusTone(status)}>{STATUS_LABELS[status]}</StatusTag>
  );
}

export function ClientRequestsList({
  onActions,
  onRightPanel,
}: {
  onActions: (actions: ReactNode) => void;
  onRightPanel: (panel: ReactNode) => void;
}) {
  const router = useRouter();
  const rows = useQuery(api.clientProcurementRequests.list, {});
  const create = useMutation(api.clientProcurementRequests.create);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [narrative, setNarrative] = useState("");
  const [targetEffectiveDate, setTargetEffectiveDate] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const { requestId } = await create({
        title: title.trim(),
        narrative: narrative.trim(),
        targetEffectiveDate: targetEffectiveDate || undefined,
      });
      setTitle("");
      setNarrative("");
      setTargetEffectiveDate("");
      setOpen(false);
      toast.success("Request submitted");
      router.push(`/requests/${requestId}`);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not submit the request"),
      );
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    onRightPanel(
      <SettingsDrawer
        open={open}
        onOpenChange={setOpen}
        title="New insurance request"
        footer={
          <PillButton
            type="submit"
            form="client-request-form"
            disabled={saving || !title.trim() || !narrative.trim()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Submit request
          </PillButton>
        }
      >
        <form id="client-request-form" className="space-y-5" onSubmit={submit}>
          <div>
            <label
              htmlFor="client-request-title"
              className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
            >
              Request name
            </label>
            <Input
              id="client-request-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Property and liability coverage"
            />
          </div>
          <div>
            <label
              htmlFor="client-request-narrative"
              className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
            >
              What do you need?
            </label>
            <Textarea
              id="client-request-narrative"
              value={narrative}
              onChange={(event) => setNarrative(event.target.value)}
              rows={8}
              placeholder="Describe the coverage, contract, location, timing, and anything else we should know."
            />
          </div>
          <div>
            <label
              htmlFor="client-request-effective-date"
              className={`mb-1.5 block text-muted-foreground ${typeStyle("label.field")}`}
            >
              Target effective date
            </label>
            <Input
              id="client-request-effective-date"
              type="date"
              value={targetEffectiveDate}
              onChange={(event) => setTargetEffectiveDate(event.target.value)}
            />
          </div>
        </form>
      </SettingsDrawer>,
    );
    return () => onRightPanel(null);
    // The drawer must be rebuilt as its local form state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrative, onRightPanel, open, saving, targetEffectiveDate, title]);

  useEffect(() => {
    onActions(
      <PillButton type="button" onClick={() => setOpen(true)}>
        <Plus className="size-3.5" />
        New request
      </PillButton>,
    );
    return () => onActions(null);
  }, [onActions]);

  return (
    <>
      {rows === undefined ? (
        <OperationalPanel className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </OperationalPanel>
      ) : rows.length === 0 ? (
        <EmptyStateCard
          title="No insurance requests"
          description="Submit a request when you need new coverage or help replacing a policy."
        />
      ) : (
        <OperationalPanel as="section">
          {rows.map((request) => (
            <OperationalItem key={request._id} className="p-0">
              <Link
                href={`/requests/${request._id}`}
                className="flex w-full items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-foreground/3"
              >
                <div className="min-w-0">
                  <p
                    className={`truncate text-foreground ${typeStyle("body.medium")}`}
                  >
                    {request.title}
                  </p>
                  <p
                    className={`mt-1 line-clamp-2 text-muted-foreground ${typeStyle("body.default")}`}
                  >
                    {request.narrative}
                  </p>
                  <p
                    className={`mt-2 text-muted-foreground ${typeStyle("caption.default")}`}
                  >
                    Updated {formatDisplayDate(request.updatedAt)}
                  </p>
                </div>
                <RequestStatus status={request.status} />
              </Link>
            </OperationalItem>
          ))}
        </OperationalPanel>
      )}
    </>
  );
}

export function ClientRequestDetail({
  requestId,
  onBreadcrumb,
  onRightPanel,
}: {
  requestId: Id<"procurementRequests">;
  onBreadcrumb: (detail: string | null) => void;
  onRightPanel: (panel: ReactNode) => void;
}) {
  const details = useQuery(api.clientProcurementRequests.get, { requestId });
  const generateUploadUrl = useMutation(
    api.clientProcurementRequests.generateUploadUrl,
  );
  const attachFile = useMutation(api.clientProcurementRequests.attachFile);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const selectedFile = details?.files.find(
    (file) => file._id === selectedFileId,
  );
  const { openWithUrl } = usePdf();

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      const toastId = toast.loading("Adding file…");
      try {
        const uploadUrl = await generateUploadUrl({ requestId });
        const response = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error("Upload failed");
        const { storageId } = (await response.json()) as {
          storageId: Id<"_storage">;
        };
        await attachFile({
          requestId,
          storageId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        toast.success("File added", { id: toastId });
        setPendingFile(null);
        setUploadOpen(false);
      } catch (error) {
        toast.error(
          getUserFacingErrorMessage(error, "Could not add the file"),
          { id: toastId },
        );
      } finally {
        setBusy(false);
      }
    },
    [attachFile, generateUploadUrl, requestId],
  );

  useEffect(() => {
    onRightPanel(
      uploadOpen ? (
        <SettingsDrawer
          open
          title="Add file"
          onOpenChange={(open) => {
            if (!busy) setUploadOpen(open);
          }}
          footer={
            <PillButton
              disabled={busy || !pendingFile}
              onClick={() => {
                if (pendingFile) void upload(pendingFile);
              }}
            >
              Add file
            </PillButton>
          }
        >
          <FileDropZone
            accept=""
            disabled={busy}
            idleLabel={pendingFile?.name ?? "Choose a supporting file"}
            hint={pendingFile ? "Choose another file to replace it" : undefined}
            onFile={setPendingFile}
          />
        </SettingsDrawer>
      ) : selectedFile ? (
        <SettingsDrawer
          open
          title={selectedFile.name}
          onOpenChange={(open) => {
            if (!open) setSelectedFileId(null);
          }}
          footer={
            selectedFile.url ? (
              <>
                {selectedFile.contentType === "application/pdf" ||
                selectedFile.name.toLowerCase().endsWith(".pdf") ? (
                  <PillButton
                    variant="secondary"
                    onClick={() => {
                      setSelectedFileId(null);
                      openWithUrl(selectedFile.url!);
                    }}
                  >
                    Preview
                  </PillButton>
                ) : null}
                <FileDownloadButton
                  href={selectedFile.url}
                  fileName={selectedFile.name}
                />
              </>
            ) : null
          }
        >
          <OperationalLabelValueList>
            <OperationalLabelValueRow
              label="Added"
              value={formatDisplayDate(selectedFile.createdAt)}
            />
          </OperationalLabelValueList>
        </SettingsDrawer>
      ) : null,
    );
    return () => onRightPanel(null);
  }, [
    busy,
    onRightPanel,
    openWithUrl,
    pendingFile,
    selectedFile,
    upload,
    uploadOpen,
  ]);

  useEffect(() => {
    onBreadcrumb(details?.title ?? null);
    return () => onBreadcrumb(null);
  }, [details?.title, onBreadcrumb]);

  if (details === undefined) {
    return (
      <OperationalPanel className="flex h-40 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }
  if (!details) {
    return (
      <EmptyStateCard
        title="Request not found"
        description="This request is unavailable or you do not have access to it."
        secondary={
          <PillButton href="/requests" variant="secondary">
            Back to requests
          </PillButton>
        }
      />
    );
  }

  const request = details;
  return (
    <div className="space-y-5">
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Status"
          value={<RequestStatus status={request.status} />}
        />
        <OperationalLabelValueRow
          label="Target effective date"
          value={
            request.targetEffectiveDate
              ? formatDisplayDate(request.targetEffectiveDate)
              : "Not set"
          }
        />
        <OperationalLabelValueRow
          label="Submitted"
          value={formatDisplayDate(request.createdAt)}
        />
        {request.resultingPolicy ? (
          <OperationalLabelValueRow
            label="Final policy"
            value={
              <Link
                href={`/policies/${request.resultingPolicy._id}`}
                className="underline underline-offset-4"
              >
                {[
                  request.resultingPolicy.carrier,
                  request.resultingPolicy.policyNumber,
                ]
                  .filter(Boolean)
                  .join(" · ") || "View policy"}
              </Link>
            }
          />
        ) : null}
      </OperationalLabelValueList>

      <OperationalPanel>
        <OperationalPanelHeader title="Submission packet" />
        <OperationalPanelBody>
          {request.packet.markdown ? (
            <ProseMarkdown>{request.packet.markdown}</ProseMarkdown>
          ) : (
            <p
              className={`whitespace-pre-wrap text-foreground ${typeStyle("prose.default")}`}
            >
              {request.narrative}
            </p>
          )}
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel>
        <OperationalPanelHeader
          title="Shared files"
          action={
            <PillButton
              variant="secondary"
              size="compact"
              onClick={() => {
                setSelectedFileId(null);
                setUploadOpen(true);
              }}
            >
              <Upload className="size-3.5" />
              Add file
            </PillButton>
          }
        />
        {request.files.length === 0 ? (
          <OperationalPanelBody
            className={`text-muted-foreground ${typeStyle("body.default")}`}
          >
            No supporting files have been shared yet.
          </OperationalPanelBody>
        ) : (
          request.files.map((file) => (
            <OperationalItem key={file._id} className="p-0">
              <button
                type="button"
                onClick={() => {
                  setUploadOpen(false);
                  setSelectedFileId(file._id);
                }}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left text-foreground hover:bg-muted/50 ${typeStyle("body.medium")}`}
              >
                <FileText className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">{file.name}</span>
              </button>
            </OperationalItem>
          ))
        )}
      </OperationalPanel>
    </div>
  );
}
