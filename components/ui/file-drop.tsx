"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { FileUp } from "lucide-react";
import { typeStyle } from "@/lib/typography";

type FileDropHandlers<T extends HTMLElement> = {
  onDragEnter: (e: DragEvent<T>) => void;
  onDragOver: (e: DragEvent<T>) => void;
  onDragLeave: (e: DragEvent<T>) => void;
  onDrop: (e: DragEvent<T>) => void;
};

export function useFileDrop<T extends HTMLElement = HTMLElement>(
  onFiles: (files: FileList) => void,
): { dragging: boolean; handlers: FileDropHandlers<T> } {
  const [dragging, setDragging] = useState(false);

  const handlers: FileDropHandlers<T> = {
    onDragEnter: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => {
      e.preventDefault();
      setDragging(false);
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files);
    },
  };

  return { dragging, handlers };
}

type FileDropZoneProps = {
  accept?: string;
  disabled?: boolean;
  /** Primary headline shown at rest. */
  idleLabel: ReactNode;
  /** Message while a file is being uploaded. */
  busyLabel?: ReactNode;
  /** Message while a file is hovering over the zone. */
  activeLabel?: ReactNode;
  /** Secondary text below the headline. Defaults to "or click to choose a file". */
  hint?: ReactNode;
  /** Tailwind padding override for the zone. */
  padding?: string;
  className?: string;
} & (
  | {
      onFile: (file: File) => void;
      onFiles?: never;
      multiple?: false;
    }
  | {
      onFile?: never;
      onFiles: (files: File[]) => void;
      multiple: true;
    }
);

export function FileDropZone({
  onFile,
  onFiles,
  multiple = false,
  accept = "application/pdf,.pdf",
  disabled = false,
  idleLabel,
  busyLabel,
  activeLabel,
  hint = "or click to choose a file",
  padding = "px-6 py-8",
  className = "",
}: FileDropZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const selectFiles = (files: FileList) => {
    const selected = Array.from(files);
    if (onFiles) {
      onFiles(multiple ? selected : selected.slice(0, 1));
      return;
    }
    const file = selected[0];
    if (file) onFile?.(file);
  };
  const { dragging, handlers } = useFileDrop<HTMLButtonElement>((files) => {
    if (!disabled) selectFiles(files);
  });

  const label = disabled
    ? busyLabel ?? idleLabel
    : dragging
      ? activeLabel ?? idleLabel
      : idleLabel;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        {...handlers}
        className={`w-full rounded-lg border border-dashed ${padding} text-center transition-colors ${
          dragging
            ? "border-primary/40 bg-primary/[0.03]"
            : "border-border-emphasized hover:border-border-focus hover:bg-foreground/[0.01]"
        } ${disabled ? "opacity-70 cursor-not-allowed" : ""} ${className}`}
      >
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-foreground/[0.04]">
          <FileUp className="h-5 w-5 text-foreground/70" />
        </div>
        <p className={`text-foreground ${typeStyle("body.medium")}`}>{label}</p>
        {hint && <p className={`mt-1 text-muted-foreground ${typeStyle("caption.default")}`}>{hint}</p>}
      </button>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) selectFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
    </>
  );
}
