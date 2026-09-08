"use client";

import { useCallback, useRef, useState } from "react";
import { X, FileText, FileUp } from "lucide-react";
import { toast } from "sonner";
import { OperationalItem, OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import {
  PolicyUploadModeToggle,
  type PolicyUploadMode,
} from "@/components/policy-upload-mode-toggle";
import { typeStyle } from "@/lib/typography";

const LABEL_CLASSES =
  `text-muted-foreground block mb-1.5 ${typeStyle("caption.medium")}`;

interface PolicyUploadDrawerProps {
  open: boolean;
  onClose: () => void;
  onUpload: (files: File[], mode: PolicyUploadMode) => Promise<boolean>;
  uploading: boolean;
}

function filterPdfs(incoming: File[]): File[] {
  const pdfs: File[] = [];
  let rejected = 0;
  for (const f of incoming) {
    if (f.name.toLowerCase().endsWith(".pdf")) pdfs.push(f);
    else rejected++;
  }
  if (rejected > 0) {
    toast.error(
      rejected === 1
        ? "Skipped a non-PDF file."
        : `Skipped ${rejected} non-PDF files.`,
    );
  }
  return pdfs;
}

export function PolicyUploadDrawer({
  open,
  onClose,
  onUpload,
  uploading,
}: PolicyUploadDrawerProps) {
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadMode, setUploadMode] = useState<PolicyUploadMode>("combined");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((incoming: File[]) => {
    const pdfs = filterPdfs(incoming);
    if (pdfs.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`));
      return [
        ...prev,
        ...pdfs.filter((f) => !existing.has(`${f.name}:${f.size}`)),
      ];
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleUploadClick = useCallback(async () => {
    if (files.length === 0) {
      fileInputRef.current?.click();
      return;
    }
    if (!(await onUpload(files, uploadMode))) return;
    setFiles([]);
    setUploadMode("combined");
    onClose();
  }, [files, uploadMode, onUpload, onClose]);

  const canUpload = files.length > 0 && !uploading;

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
      title="Upload policy"
      footer={
        <PillButton
          variant="primary"
          disabled={!canUpload}
          onClick={handleUploadClick}
        >
          {uploading
            ? "Uploading…"
            : files.length > 1 && uploadMode === "separate"
              ? `Upload as ${files.length} policies`
              : files.length > 1
                ? "Upload as one policy"
              : files.length === 1
                ? "Upload policy"
                : "Choose files to upload"}
        </PillButton>
      }
    >
      <div className="space-y-5">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const dropped = Array.from(e.dataTransfer.files);
            if (dropped.length > 0) addFiles(dropped);
          }}
          className={`w-full rounded-lg border-2 border-dashed transition-colors px-6 py-10 text-center ${
            dragOver
              ? "border-border-focus bg-foreground/3"
              : "border-border-emphasized hover:border-border-focus"
          }`}
        >
          <div className="mx-auto h-10 w-10 flex items-center justify-center rounded-full bg-foreground/4 text-muted-foreground mb-3">
            <FileUp className="h-4 w-4" />
          </div>
          <p className={`text-foreground ${typeStyle("body.strong")}`}>
            Drag and drop policy PDFs
          </p>
          <p className={`text-muted-foreground mt-1 ${typeStyle("body.default")}`}>
            {files.length > 0
              ? "or click to add more files"
              : "or click to choose files"}
          </p>
          <p className={`text-muted-foreground/60 mt-3 ${typeStyle("caption.default")}`}>
            {uploadMode === "separate"
              ? "Multiple PDFs will create separate policies."
              : "Multiple PDFs will be combined into a single policy."}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            className="sr-only"
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              if (picked.length > 0) addFiles(picked);
              e.target.value = "";
            }}
          />
        </button>

        {files.length > 1 ? (
          <PolicyUploadModeToggle
            value={uploadMode}
            onChange={setUploadMode}
            disabled={uploading}
          />
        ) : null}

        {files.length > 0 ? (
          <div>
            <label className={LABEL_CLASSES}>
              {files.length} file{files.length === 1 ? "" : "s"} selected
            </label>
            <OperationalPanel as="div">
              {files.map((file, i) => (
                <OperationalItem
                  key={`${file.name}:${file.size}:${i}`}
                  className="flex items-center gap-2 border-border-subtle px-3 py-2"
                >
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className={`truncate flex-1 ${typeStyle("body.default")}`}>
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    disabled={uploading}
                    className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground/50 hover:text-foreground hover:bg-foreground/4 transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </OperationalItem>
              ))}
            </OperationalPanel>
          </div>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}
