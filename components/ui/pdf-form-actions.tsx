"use client";

import { useMutation, useQuery } from "convex/react";
import { Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { PdfFormField as ViewerFormField } from "@claritylabs-inc/ui/components/pdf-viewer";
import { useOptionalAgentDock } from "@/components/agent-dock/agent-dock-provider";
import { PillButton } from "@/components/ui/pill-button";
import type { PdfDocumentSource } from "@/components/pdf-context";
import { api } from "@/convex/_generated/api";
import {
  pdfFormFieldBox,
  type PdfFormField,
} from "@/convex/lib/pdfFormFields";
import {
  PDF_DOCUMENT_PAGE_TYPE,
  pdfFormSourceId,
} from "@/convex/lib/pdfFormSource";
import { operatorAgentApi } from "@/lib/operator-agent-api";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

/** Fields with a box, without record-only keys; fontSize passes through. */
function toViewerFields(fields: PdfFormField[]): ViewerFormField[] {
  return fields.flatMap((field) => {
    const box = pdfFormFieldBox(field);
    if (!box) return [];
    const { acroFormName: _name, basis: _basis, ...viewerField } = field;
    return [{ ...viewerField, ...box }];
  });
}

/**
 * Form actions for the PDF open in the panel, for operators. A blank form
 * offers Fill form, which starts the agent's fill. While Spot fills, everyone
 * viewing the form watches each field appear, then moves to the filled copy.
 * A filled form is edited through the agent: Edit with Spot opens a chat
 * with the form as context.
 */
export function usePdfFormActions({
  source,
  onOpen,
}: {
  source: PdfDocumentSource | null;
  /** Opens a fill's result in the panel. */
  onOpen: (document: { url: string; source: PdfDocumentSource }) => void;
}) {
  const sourceId = source ? pdfFormSourceId(source) : null;
  const formState = useQuery(
    api.pdfFormFill.getForDocument,
    sourceId ? { source: sourceId } : "skip",
  );
  const dock = useOptionalAgentDock();
  const startIntent = useMutation(operatorAgentApi.startIntent);
  const [startingFill, setStartingFill] = useState(false);

  const filling = formState?.status === "filling" ? formState : null;
  // Everyone who watched a fill moves to the filled copy when it finishes.
  const [watchedRunId, setWatchedRunId] = useState<string | null>(null);
  if (filling && watchedRunId !== filling.runId) setWatchedRunId(filling.runId);
  const finished =
    formState?.status === "fillable" &&
    formState.finished?.runId === watchedRunId
      ? formState.finished
      : null;
  const openedRunId = useRef<string | null>(null);
  useEffect(() => {
    if (!finished || openedRunId.current === finished.runId) return;
    openedRunId.current = finished.runId;
    onOpen({ url: finished.url, source: finished.source });
  }, [finished, onOpen]);

  if (!formState || !dock) return { active: false as const };

  if (filling) {
    const placed = filling.fields.filter((field) => pdfFormFieldBox(field));
    const recent =
      filling.total && placed.length < filling.total ? placed.slice(-3) : [];
    return {
      active: true as const,
      toolbarActions: null,
      footer: (
        <div className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-3">
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
          <p
            role="status"
            className={`min-w-0 flex-1 truncate text-muted-foreground ${typeStyle("caption.default")}`}
          >
            {filling.stage === "reading"
              ? "Spot is reading the form…"
              : `Spot is filling the form · ${placed.length}${filling.total ? ` of ${filling.total}` : ""} fields`}
          </p>
        </div>
      ),
      viewerProps: {
        formFields: toViewerFields(filling.fields),
        highlightBoxes: toViewerFields(recent).map(
          ({ page, x, y, width, height }) => ({ page, x, y, width, height }),
        ),
      },
    };
  }

  if (formState.status === "filled")
    return {
      active: true as const,
      toolbarActions: (
        <PillButton
          variant="ghost"
          size="compact"
          title={
            formState.isLatest
              ? "Tell Spot what to change, or paste a screenshot"
              : `This is an older copy; Spot edits the latest, version ${formState.version}`
          }
          onClick={dock.newChat}
        >
          <Sparkles />
          Edit with Spot
        </PillButton>
      ),
      footer: null,
      viewerProps: {},
    };

  const startFill = async () => {
    if (!source || !sourceId) return;
    setStartingFill(true);
    try {
      const started = await startIntent({
        intentId: "fill_pdf_form",
        pageContext: {
          pageType: PDF_DOCUMENT_PAGE_TYPE,
          entityId: sourceId,
          summary: `PDF: ${source.filename.slice(0, 200)}`,
        },
      });
      dock.openThread(started.threadId);
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not start filling the form"));
    } finally {
      setStartingFill(false);
    }
  };
  return {
    active: true as const,
    toolbarActions: (
      <PillButton
        variant="ghost"
        size="compact"
        title="Fill this form from the client's records"
        disabled={startingFill}
        onClick={() => void startFill()}
      >
        <Sparkles />
        Fill form
      </PillButton>
    ),
    footer: null,
    viewerProps: {},
  };
}
