"use client";
import { ClientInformationForms } from "@/components/insurance-intake/information-form";

import { RequestCompletionOutcome } from "./request-completion-outcome";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBackgroundTasks } from "@claritylabs-inc/ui/components/background-tasks";
import { usePdf } from "@/components/pdf-context";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import { FileDownloadButton } from "@claritylabs-inc/ui/components/file-download-button";
import { useMutation, useQuery } from "convex/react";
import { FileText, Loader2, Plus, Upload } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatDisplayDate } from "@/lib/date-format";
import { useFollowedState } from "@/hooks/use-followed-state";
import { typeStyle } from "@/lib/typography";
import { IntakeApplicationReview } from "@/components/insurance-intake/application-review";
import { MarkdownReview } from "@/components/ui/markdown-review";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import {
  OperationalItem,
  OperationalLabelValueList,
  OperationalLabelValueRow,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import {
  StatusTag,
  type StatusTagTone,
} from "@claritylabs-inc/ui/components/status-tag";

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
    <StatusTag
      tone={statusTone(status)}
      indicator={
        status === "cancelled"
          ? "cancelled"
          : status === "information_needed"
            ? "waiting"
            : undefined
      }
      progress={
        status === "finalizing"
          ? 0.88
          : status === "in_progress"
            ? 0.5
            : undefined
      }
    >
      {STATUS_LABELS[status]}
    </StatusTag>
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
  const viewer = useQuery(api.users.viewer, {});
  const viewerOrg = useQuery(
    api.orgs.viewerOrg,
    viewer && !viewer.intakeRestricted ? {} : "skip",
  );
  const canViewRequests = !!viewerOrg?.org && viewerOrg.org.type === "client";
  const rows = useQuery(
    api.clientProcurementRequests.list,
    canViewRequests ? {} : "skip",
  );
  const drafts = useQuery(api.requestIntake.drafts, {});
  const start = useMutation(api.requestIntake.start);
  useEffect(() => {
    if (viewer?.intakeRestricted || (viewer && viewerOrg === null)) {
      router.replace("/signup");
    }
  }, [viewer, viewerOrg, router]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");
  useEffect(() => {
    onRightPanel(null);
    return () => onRightPanel(null);
  }, [onRightPanel]);
  useEffect(() => {
    onActions(
      <PillButton
        disabled={starting || !viewerOrg?.org}
        onClick={async () => {
          setStarting(true);
          setStartError("");
          try {
            const id = await start({ orgId: viewerOrg!.org._id });
            router.push(`/intake?request=${id}`);
          } catch (error) {
            setStartError(
              error instanceof Error
                ? error.message
                : "Could not start request",
            );
            setStarting(false);
          }
        }}
      >
        <Plus className="size-3.5" />
        {starting ? "Starting…" : "New request"}
      </PillButton>,
    );
    return () => onActions(null);
  }, [onActions, start, starting, viewerOrg, router]);

  return (
    <>
      {startError && (
        <p
          role="alert"
          className={`text-destructive ${typeStyle("body.large")}`}
        >
          {startError}
        </p>
      )}
      {!!drafts?.length && (
        <OperationalPanel as="section">
          {drafts.map((draft) => (
            <OperationalItem key={draft.id} className="p-0">
              <Link
                href={`/intake?request=${draft.id}`}
                className="flex w-full items-center justify-between gap-4 px-4 py-3"
              >
                <span>{draft.title}</span>
                <span
                  className={`text-muted-foreground ${typeStyle("body.large")}`}
                >
                  Draft · Resume application
                </span>
              </Link>
            </OperationalItem>
          ))}
        </OperationalPanel>
      )}
      {rows === undefined ? (
        <OperationalPanel className="flex h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </OperationalPanel>
      ) : rows.length === 0 && !drafts?.length ? (
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
  const router = useRouter();
  const { run, tasks } = useBackgroundTasks();
  const taskId = `request-file-upload:${requestId}`;
  const busy = tasks.get(taskId)?.status === "running";
  const [uploadOpen, setUploadOpen] = useFollowedState(
    `requests:${requestId}:upload-open`,
    false,
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [selectedFileId, setSelectedFileId] = useFollowedState<string | null>(
    `requests:${requestId}:file`,
    null,
  );
  const selectedFile = details?.files.find(
    (file) => file._id === selectedFileId,
  );
  const { openWithUrl } = usePdf();

  const upload = useCallback(
    async (file: File) => {
      const outcome = await run({
        id: taskId,
        title: "Adding file",
        successTitle: "File added",
        errorTitle: "Could not add the file",
        onSuccess: () => [
          {
            label: "Open request",
            onClick: () => router.push(`/requests/${requestId}`),
          },
        ],
        execute: async (report) => {
          report({ message: "Uploading file", completed: 0, total: 1 });
          const uploadUrl = await generateUploadUrl({ requestId });
          const response = await fetch(uploadUrl, {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
            },
            body: file,
          });
          if (!response.ok) throw new Error("Upload failed");
          const { storageId } = (await response.json()) as {
            storageId: Id<"_storage">;
          };
          report({ message: "Attaching file" });
          await attachFile({
            requestId,
            storageId,
            fileName: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          });
          report({ message: "File attached", completed: 1, total: 1 });
        },
      });
      if (outcome.status === "success") {
        setPendingFile(null);
        setUploadOpen(false);
      }
    },
    [attachFile, generateUploadUrl, requestId, router, run, setUploadOpen, taskId],
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
                    onClick={() => openWithUrl(selectedFile.url!)}
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
    setSelectedFileId,
    setUploadOpen,
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
      <ClientInformationForms requestId={requestId} />
      <OperationalLabelValueList>
        <OperationalLabelValueRow
          label="Status"
          value={<RequestStatus status={request.status} />}
        />
        <RequestCompletionOutcome outcome={request.completionOutcome} />
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

      {request.application ? (
        <IntakeApplicationReview application={request.application} />
      ) : null}
      {request.packet.markdown ? (
        <MarkdownReview>{request.packet.markdown}</MarkdownReview>
      ) : !request.application ? (
        <p>No packet content shared yet.</p>
      ) : null}

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
