"use client";

import { useAction, useQuery } from "convex/react";
import { Check, ListPlus, Pencil, TextCursorInput, X } from "lucide-react";
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
import type { Id } from "@/convex/_generated/dataModel";
import {
  pdfFormFieldBox,
  type PdfFormField,
} from "@/convex/lib/pdfFormFields";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

// Default box for a value placed by click, in PDF points.
const PLACED_TEXT = { width: 140, height: 14 };
const PLACED_CHECKBOX = { width: 10, height: 10 };

type Placing = { kind: "new" } | { kind: "field"; id: string } | null;

/**
 * Editing for a filled form open in the PDF panel: while editing, the panel
 * shows the original PDF with the shared viewer's field layer, and Save
 * renders a new version that replaces the conversation attachment.
 */
export function usePdfFormEditing({
  source,
  onSaved,
}: {
  source: PdfDocumentSource | null;
  onSaved: (saved: { url: string; fileId: Id<"_storage">; filename: string }) => void;
}) {
  const fileId =
    source?.kind === "operatorAttachment"
      ? (source.fileId as Id<"_storage">)
      : null;
  const result = useQuery(
    api.pdfFormEdits.getForAttachment,
    fileId ? { fileId } : "skip",
  );
  // Older versions stay read-only; edits always start from the latest.
  const fill = result && !result.isStale ? result : null;
  const saveEdits = useAction(api.actions.pdfFormEdits.saveEdits);
  const [draft, setDraft] = useState<PdfFormField[] | null>(null);
  const [placing, setPlacing] = useState<Placing>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = draft !== null && fill?.fillId !== undefined;

  // Opening another document ends editing without saving.
  const [editedFileId, setEditedFileId] = useState(fileId);
  if (editedFileId !== fileId) {
    setEditedFileId(fileId);
    setDraft(null);
    setPlacing(null);
  }

  useEffect(() => {
    if (!placing) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placing]);

  const update = useCallback(
    (id: string, patch: Partial<PdfFormField>) =>
      setDraft((current) =>
        current?.map((field) =>
          field.id === id ? { ...field, ...patch, basis: "manual" } : field,
        ) ?? null,
      ),
    [],
  );

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
    (id: string) =>
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
      ),
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
      setDraft(null);
      onSaved(saved);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "The form could not be saved"));
    } finally {
      setSaving(false);
    }
  }, [draft, fill, onSaved, saveEdits]);

  if (!fill) return { active: false as const };

  const toolbarActions = editing ? (
    <div className="flex items-center gap-1">
      <PillButton
        variant="icon"
        size="compact"
        iconOnly
        label={placing?.kind === "new" ? "Click the page to add text" : "Add text"}
        aria-pressed={placing?.kind === "new"}
        onClick={() => setPlacing(placing?.kind === "new" ? null : { kind: "new" })}
      >
        <TextCursorInput />
      </PillButton>
      {unplaced.length ? (
        <Popover>
          <PopoverTrigger
            render={
              <PillButton
                variant="icon"
                size="compact"
                iconOnly
                label={`Place ${unplaced.length} unplaced ${unplaced.length === 1 ? "value" : "values"}`}
              >
                <ListPlus />
              </PillButton>
            }
          />
          <PopoverContent align="end" className="w-72 p-1">
            <p className={`px-2 py-1.5 text-muted-foreground ${typeStyle("caption.default")}`}>
              Pick a value, then click where it goes on the page.
            </p>
            {unplaced.map((field) => (
              <button
                key={field.id}
                type="button"
                className={`flex w-full min-w-0 flex-col items-start rounded-md px-2 py-1.5 text-left hover:bg-muted ${typeStyle("body.default")}`}
                onClick={() => setPlacing({ kind: "field", id: field.id })}
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
        variant="icon"
        size="compact"
        iconOnly
        label="Discard edits"
        disabled={saving}
        onClick={() => {
          setDraft(null);
          setPlacing(null);
        }}
      >
        <X />
      </PillButton>
      <PillButton
        variant="primary"
        size="compact"
        label={`Save as version ${fill.version + 1}`}
        disabled={saving}
        onClick={() => void save()}
      >
        <Check />
        {saving ? "Saving…" : "Save"}
      </PillButton>
    </div>
  ) : (
    <PillButton
      variant="ghost"
      size="compact"
      onClick={() => setDraft(fill.fields)}
      label={`Edit form (version ${fill.version})`}
    >
      <Pencil />
      {`Edit v${fill.version}`}
    </PillButton>
  );

  return {
    active: true as const,
    editing,
    toolbarActions,
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
