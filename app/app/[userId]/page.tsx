"use client";
import { useParams } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState, useCallback } from "react";
import { LogoIcon } from "@/components/LogoIcon";
import { Upload, CheckCircle, AlertCircle, FileText } from "lucide-react";

type UploadState = "idle" | "uploading" | "processing" | "done" | "error";

export default function UploadPage() {
  const params = useParams();
  const token = params.userId as string;

  const user = useQuery(api.users.getByUploadToken, { token });
  const generateUploadUrl = useMutation(api.users.generateUploadUrl);
  const submitPolicy = useMutation(api.users.submitPolicy);

  const [state, setState] = useState<UploadState>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [fileName, setFileName] = useState("");

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        alert("Please upload a PDF file.");
        return;
      }
      if (file.size > 20 * 1024 * 1024) {
        alert("File is too large. Max 20MB.");
        return;
      }

      setFileName(file.name);
      setState("uploading");

      try {
        const uploadUrl = await generateUploadUrl();
        const result = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });

        if (!result.ok) throw new Error("Upload failed");

        const { storageId } = await result.json();

        setState("processing");
        await submitPolicy({ token, storageId });
        setState("done");
      } catch (err) {
        console.error(err);
        setState("error");
      }
    },
    [generateUploadUrl, submitPolicy, token]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  // Loading
  if (user === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="size-8 animate-spin rounded-full border-3 border-border border-t-foreground" />
      </div>
    );
  }

  // Invalid token
  if (user === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-[440px] text-center">
          <div className="mb-8 flex items-center justify-center gap-2">
            <LogoIcon size={22} />
            <span className="font-logo text-lg tracking-wide text-foreground">
              SPOT
            </span>
          </div>
          <h1 className="mb-3 font-heading text-3xl tracking-tight text-foreground">
            Invalid link
          </h1>
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
            This upload link isn&apos;t valid. Text Spot to get a new one.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="mb-8 flex items-center justify-center gap-2">
          <LogoIcon size={22} />
          <span className="font-logo text-lg tracking-wide text-foreground">
            SPOT
          </span>
        </div>

        {/* Header */}
        <div className="mb-10 text-center">
          <p className="mb-1 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Secure upload for {user.phone}
          </p>
          <h1 className="mb-3 font-heading text-3xl tracking-tight text-foreground">
            Upload your policy
          </h1>
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
            Drop your insurance policy PDF below. Spot will read through it and
            text you a breakdown.
          </p>
        </div>

        {/* Upload area */}
        {state === "idle" && (
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-8 py-12 text-center transition-all ${
              dragOver
                ? "border-foreground bg-warm-card"
                : "border-border bg-white hover:border-muted-foreground/40 hover:bg-warm-card/50"
            }`}
          >
            <input
              type="file"
              accept=".pdf"
              onChange={handleInputChange}
              className="hidden"
            />
            <div className="mb-4 flex size-14 items-center justify-center rounded-xl bg-secondary">
              <Upload className="size-6 text-muted-foreground" />
            </div>
            <p className="mb-1 text-[0.95rem] font-medium text-foreground">
              Drop your PDF here
            </p>
            <p className="text-sm text-muted-foreground">
              or tap to choose a file
            </p>
          </label>
        )}

        {state === "uploading" && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-white px-8 py-12 text-center">
            <div className="mb-4 size-8 animate-spin rounded-full border-3 border-border border-t-foreground" />
            <div className="mb-1 flex items-center gap-2 text-sm text-muted-foreground">
              <FileText className="size-4" />
              <span className="max-w-[200px] truncate">{fileName}</span>
            </div>
            <p className="text-[0.95rem] leading-relaxed text-foreground">
              Uploading...
            </p>
          </div>
        )}

        {state === "processing" && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-white px-8 py-12 text-center">
            <div className="mb-4 size-8 animate-spin rounded-full border-3 border-border border-t-foreground" />
            <p className="text-[0.95rem] leading-relaxed text-foreground">
              Spot is reading your policy. You&apos;ll get a text with the
              breakdown shortly.
            </p>
          </div>
        )}

        {state === "done" && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-white px-8 py-12 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-foreground text-white">
              <CheckCircle className="size-6" />
            </div>
            <p className="text-[0.95rem] leading-relaxed text-foreground">
              All set! Check your texts — Spot will send you a breakdown
              shortly.
            </p>
            <button
              onClick={() => {
                setState("idle");
                setFileName("");
              }}
              className="mt-6 cursor-pointer rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Upload another policy
            </button>
          </div>
        )}

        {state === "error" && (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-white px-8 py-12 text-center">
            <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertCircle className="size-6" />
            </div>
            <p className="text-[0.95rem] leading-relaxed text-red-600">
              Something went wrong. Try again.
            </p>
            <button
              onClick={() => {
                setState("idle");
                setFileName("");
              }}
              className="mt-6 cursor-pointer rounded-full bg-foreground px-6 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Try again
            </button>
          </div>
        )}

        {/* Footer */}
        <p className="mt-10 text-center text-xs text-muted-foreground/70">
          Your documents are encrypted and only used to help you understand your
          coverage.
        </p>
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted-foreground/50">
          <LogoIcon size={12} color="#9ca3af" />
          <span>Spot from Clarity Labs</span>
        </div>
      </div>
    </div>
  );
}
