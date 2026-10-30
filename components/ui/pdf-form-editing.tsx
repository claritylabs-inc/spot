"use client";

import { useAction, useQuery } from "convex/react";
import { Check, ListPlus, Pencil, TextCursorInput } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import type {
  PdfFormField as ViewerFormField,
  PdfFormFieldBox,
  PdfPagePoint,
} from "@claritylabs-inc/ui/components/pdf-viewer";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@claritylabs-inc/ui/components/popover";
import { PillButton } from "@/components/ui/pill-button";
import type { PdfDocumentSource } from "@/components/pdf-context";
import { api } from "@/convex/_generated/api";
import {
  pdfFormFieldBox,
  type PdfFormField,
} from "@/convex/lib/pdfFormFields";
import { pdfFormSourceId } from "@/convex/lib/pdfFormSource";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

// Default box for a value placed by click, in PDF points.
const PLACED_TEXT = { width: 140, height: 14 };
const PLACED_CHECKBOX = { width: 10, height: 10 };

type Placing = { kind: "new" } | { kind: "field"; id: string } | null;

/**
 * Editing for a filled form open in the PDF panel, from the conversation or
 * client files: while editing, the panel shows the original PDF with the
 * shared viewer's field layer, and Save files the next version.
 */
export function usePdfFormEditing({
  source,
  onSaved,
}: {
  source: PdfDocumentSource | null;
  onSaved: (saved: { url: string; source: PdfDocumentSource }) => void;
}) {
  const sourceId =
    source?.kind === "operatorAttachment" || source?.kind === "clientFile"
      ? pdfFormSourceId(source)
      : null;
  const fill = useQuery(
    api.pdfFormEdits.getForDocument,
    sourceId ? { source: sourceId } : "skip",
  );
  const saveEdits = useAction(api.actions.pdfFormEdits.saveEdits);
  const [draft, setDraft] = useState<PdfFormField[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [placing, setPlacing] = useState<Placing>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placeListOpen, setPlaceListOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null && Boolean(fill);

  // Opening another document ends editing without saving.
  const [editedSourceId, setEditedSourceId] = useState(sourceId);
  if (editedSourceId !== sourceId) {
    setEditedSourceId(sourceId);
    setDraft(null);
    setPlacing(null);
  }

  const stopEditing = useCallback(() => {
    setDraft(null);
    setDirty(false);
    setPlacing(null);
  }, []);

  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  const update = useCallback((id: string, patch: Partial<PdfFormField>) => {
    setDirty(true);
    setDraft(
      (current) =>
        current?.map((field) =>
          field.id === id ? { ...field, ...patch, basis: "manual" } : field,
        ) ?? null,
    );
  }, []);

  const formFields = useMemo<ViewerFormField[] | undefined>(
    () =>
      draft?.flatMap((field) => {
        const box = pdfFormFieldBox(field);
        if (!box) return [];
        // Drops record-only keys; fontSize passes through unchanged.
        const { acroFormName: _name, basis: _basis, ...viewerField } = field;
        return [{ ...viewerField, ...box }];
      }),
    [draft],
  );
  const unplaced = draft?.filter((field) => !pdfFormFieldBox(field)) ?? [];

  const onPagePlace = useCallback(
    (point: PdfPagePoint) => {
      if (!placing) return;
      const target =
        placing.kind === "field"
          ? draft?.find((field) => field.id === placing.id)
          : undefined;
      const kind = target?.kind ?? "text";
      const size = kind === "checkbox" ? PLACED_CHECKBOX : PLACED_TEXT;
      const box = {
        page: point.page,
        x: Math.max(0, Math.min(point.x, point.coordinateWidth - size.width)),
        y: Math.max(0, point.y - size.height / 2),
        ...size,
      };
      if (target) update(target.id, box);
      else {
        const id = `m${crypto.randomUUID()}`;
        setDirty(true);
        setDraft((current) => [
          ...(current ?? []),
          {
            id,
            label: "Added text",
            kind: "text",
            value: "",
            basis: "manual",
            ...box,
          },
        ]);
        setFocusedId(id);
      }
      setPlacing(null);
    },
    [draft, placing, update],
  );

  const onFormFieldRemove = useCallback(
    (id: string) => {
      setDirty(true);
      setDraft(
        (current) =>
          current?.flatMap((field) =>
            field.id !== id
              ? [field]
              : // AcroForm fields belong to the form; removing one clears it.
                fill?.mode === "acroform" && field.acroFormName
                ? [{ ...field, value: "", basis: "manual" as const }]
                : [],
          ) ?? null,
      );
    },
    [fill?.mode],
  );

  const save = useCallback(async () => {
    if (!fill || !draft) return;
    setSaving(true);
    try {
      const saved = await saveEdits({
        fillId: fill.fillId,
        expectedVersion: fill.version,
        fields: draft,
      });
      stopEditing();
      toast.success(`Saved version ${saved.version}`);
      onSaved({
        url: saved.url,
        source: saved.clientFileId
          ? {
              kind: "clientFile",
              clientFileId: saved.clientFileId,
              filename: saved.filename,
            }
          : {
              kind: "operatorAttachment",
              fileId: saved.fileId,
              filename: saved.filename,
            },
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "The form could not be saved"));
    } finally {
      setSaving(false);
    }
  }, [draft, fill, onSaved, saveEdits, stopEditing]);

  if (!fill) return { active: false as const };

  const placingField =
    placing?.kind === "field"
      ? draft?.find((field) => field.id === placing.id)
      : undefined;
  const hint = placing
    ? `Click where ${placingField ? `“${placingField.label}”` : "the text"} goes. Esc cancels.`
    : `Type into any highlighted field. Save files version ${fill.version + 1}.`;

  const toolbarActions = editing ? null : (
    <PillButton
      variant="ghost"
      size="compact"
      title={
        fill.isLatest
          ? `Edit version ${fill.version}`
          : `This is an older copy. Edit the latest, version ${fill.version}`
      }
      onClick={() => {
        setDraft(fill.fields);
        setDirty(false);
      }}
    >
      <Pencil />
      {fill.isLatest ? "Edit" : "Edit latest"}
    </PillButton>
  );

  const footer = editing ? (
    <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
      <p
        role="status"
        className={`min-w-0 flex-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}
      >
        {hint}
      </p>
      <PillButton
        variant="ghost"
        size="compact"
        aria-pressed={placing?.kind === "new"}
        onClick={() => setPlacing(placing?.kind === "new" ? null : { kind: "new" })}
      >
        <TextCursorInput />
        Add text
      </PillButton>
      {unplaced.length ? (
        <Popover open={placeListOpen} onOpenChange={setPlaceListOpen}>
          <PopoverTrigger
            render={
              <PillButton variant="ghost" size="compact">
                <ListPlus />
                {`Place ${unplaced.length}`}
              </PillButton>
            }
          />
          <PopoverContent align="end" side="top" className="w-72 p-1">
            <p className={`px-2 py-1.5 text-muted-foreground ${typeStyle("caption.default")}`}>
              Spot couldn&apos;t find where these go. Pick one, then click its spot on the page.
            </p>
            {unplaced.map((field) => (
              <button
                key={field.id}
                type="button"
                className={`flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted ${typeStyle("body.default")}`}
                onClick={() => {
                  setPlaceListOpen(false);
                  setPlacing({ kind: "field", id: field.id });
                }}
              >
                <span className="w-full truncate">{field.label}</span>
                <span className={`w-full truncate text-muted-foreground ${typeStyle("caption.default")}`}>
                  {field.kind === "checkbox" ? "Tick" : field.value}
                </span>
              </button>
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      <PillButton
        variant="ghost"
        size="compact"
        disabled={saving}
        onClick={stopEditing}
      >
        Cancel
      </PillButton>
      <PillButton
        variant="primary"
        size="compact"
        disabled={saving || !dirty}
        onClick={() => void save()}
      >
        <Check />
        {saving ? "Saving…" : "Save"}
      </PillButton>
    </div>
  ) : null;

  return {
    active: true as const,
    editing,
    toolbarActions,
    footer,
    viewerProps: editing
      ? {
          ...(fill.originalUrl ? { fileUrl: fill.originalUrl } : {}),
          formFields,
          onFormFieldChange: (id: string, value: string) => update(id, { value }),
          onFormFieldBoxChange: (id: string, box: PdfFormFieldBox) => update(id, box),
          onFormFieldRemove,
          placing: placing !== null,
          onPagePlace,
          focusedFormFieldId: focusedId,
        }
      : {},
  };
}
