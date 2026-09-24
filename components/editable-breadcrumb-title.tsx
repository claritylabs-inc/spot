"use client";

import { useEffect, useState } from "react";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { BreadcrumbTitleEditor } from "@claritylabs-inc/ui/components/app-shell/editable-breadcrumb-title";

export function EditableBreadcrumbTitle({
  title,
  saveKey,
  onSave,
  errorMessage = "The title could not be saved.",
}: {
  title: string;
  saveKey: string;
  onSave: (next: string) => Promise<void> | void;
  errorMessage?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [localTitle, setLocalTitle] = useState<string | null>(null);
  const [renameGeneration, setRenameGeneration] = useState(0);
  useEffect(() => {
    if (localTitle !== title) return;
    queueMicrotask(() => setLocalTitle(null));
  }, [localTitle, title]);

  const display = localTitle ?? title;
  const autoSave = useLocalFirstAutoSave({
    mutationName: `thread.rename.${saveKey}`,
    args: { title: draft.trim() },
    resetKey: `${saveKey}:${renameGeneration}`,
    autoSave: false,
    canSave: !!draft.trim(),
    flush: (args) => Promise.resolve(onSave(args.title)),
    onError: () => {
      setLocalTitle(null);
      setDraft(title);
      setRenameGeneration((current) => current + 1);
    },
    errorMessage,
  });
  const showSaveStatus = autoSave.status !== "saved";

  async function commit() {
    const next = draft.trim();
    if (!next || next === display) {
      setEditing(false);
      setDraft(display);
      return;
    }
    setLocalTitle(next);
    setEditing(false);
    await autoSave.saveNow();
  }

  return (
    <BreadcrumbTitleEditor
      title={display}
      draft={draft}
      editing={editing}
      onDraftChange={setDraft}
      onEditingChange={(next) => {
        setDraft(display);
        setEditing(next);
      }}
      onCancel={() => {
        setDraft(display);
        setEditing(false);
      }}
      onCommit={() => void commit()}
      statusSlot={
        showSaveStatus ? <AutoSaveStatus status={autoSave.status} /> : null
      }
    />
  );
}
