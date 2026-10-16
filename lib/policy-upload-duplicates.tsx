"use client";

import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

export type PolicyUploadCandidate = {
  file: File;
  fileSha256: string;
};

type DuplicatePolicyUploadMatch = {
  policyId?: string;
  fileName?: string | null;
  policyNumber?: string | null;
  carrier?: string | null;
};

type CheckDuplicateUpload = (
  fileSha256: string,
) => Promise<DuplicatePolicyUploadMatch | null>;

function hexDigest(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPolicyUploadFile(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return hexDigest(digest);
}

function duplicatePolicyLabel(duplicate: DuplicatePolicyUploadMatch) {
  return (
    [duplicate.carrier, duplicate.policyNumber]
      .filter((value) => value && value !== "Extracting...")
      .join(" · ") ||
    duplicate.fileName ||
    "an existing policy"
  );
}

function DuplicatePolicyUploadToast({
  file,
  duplicate,
  onCancel,
  onContinue,
}: {
  file: File;
  duplicate: DuplicatePolicyUploadMatch;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const policyLabel = duplicatePolicyLabel(duplicate);

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-3 overflow-hidden px-4 py-3.5 outline-none"
      role="alertdialog"
      aria-label="Possible duplicate upload"
    >
      <div className="grid min-w-0 grid-cols-[1rem_minmax(0,1fr)] gap-3">
        <div className="flex h-5 items-center justify-center pt-px">
          <CircleAlert className="size-4 text-muted-foreground" />
        </div>
        <div className="min-w-0">
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            Possible duplicate upload
          </p>
          <p className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}>
            <span className={`break-words text-foreground ${typeStyle("caption.medium")}`}>
              {file.name}
            </span>{" "}
            already matches{" "}
            <span className={`break-words text-foreground ${typeStyle("caption.medium")}`}>
              {policyLabel}
            </span>
            .
          </p>
        </div>
      </div>
      <div className="flex flex-wrap justify-end gap-2 pl-7">
        <PillButton size="compact" variant="secondary" onClick={onCancel}>
          Cancel
        </PillButton>
        <PillButton size="compact" variant="primary" onClick={onContinue}>
          Continue upload
        </PillButton>
      </div>
    </div>
  );
}

function confirmDuplicateUpload(
  file: File,
  duplicate: DuplicatePolicyUploadMatch,
) {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    function finish(confirmed: boolean) {
      if (settled) return;
      settled = true;
      toast.dismiss(toastId);
      resolve(confirmed);
    }
    const toastId = toast.custom(
      () => (
        <DuplicatePolicyUploadToast
          file={file}
          duplicate={duplicate}
          onCancel={() => finish(false)}
          onContinue={() => finish(true)}
        />
      ),
      {
        duration: Infinity,
        onDismiss: () => {
          if (settled) return;
          settled = true;
          resolve(false);
        },
        onAutoClose: () => {
          if (settled) return;
          settled = true;
          resolve(false);
        },
      },
    );
  });
}

export async function preparePolicyUploadCandidates(
  files: File[],
  checkDuplicate: CheckDuplicateUpload,
): Promise<PolicyUploadCandidate[] | null> {
  const candidates: PolicyUploadCandidate[] = [];
  for (const file of files) {
    const fileSha256 = await hashPolicyUploadFile(file);
    const duplicateInBatch = candidates.find(
      (candidate) => candidate.fileSha256 === fileSha256,
    );
    if (
      duplicateInBatch &&
      !(await confirmDuplicateUpload(file, { fileName: duplicateInBatch.file.name }))
    ) {
      return null;
    }
    const duplicate = await checkDuplicate(fileSha256);
    if (duplicate && !(await confirmDuplicateUpload(file, duplicate))) {
      return null;
    }
    candidates.push({ file, fileSha256 });
  }
  return candidates;
}
