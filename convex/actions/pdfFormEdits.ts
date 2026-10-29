"use node";

import { v } from "convex/values";
import { PDFDocument } from "pdf-lib";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { action } from "../_generated/server";
import { NoWriteInputError } from "../lib/noWriteInputError";
import { renderPdfFormFields } from "../lib/pdfFormFill";
import {
  MAX_PDF_FORM_FIELDS,
  MAX_PDF_FORM_VALUE_CHARS,
  pdfFormFieldValidator,
  type PdfFormField,
  type PdfFormMode,
} from "../lib/pdfFormFields";

function validateFields(
  fields: PdfFormField[],
  stored: { fields: PdfFormField[]; pageCount: number; mode: PdfFormMode },
  pageSizes: Array<{ width: number; height: number }>,
) {
  const invalid = (message: string): never => {
    throw new NoWriteInputError("invalid_form_fields", message);
  };
  if (fields.length > MAX_PDF_FORM_FIELDS)
    invalid(`Use at most ${MAX_PDF_FORM_FIELDS} PDF form fields.`);
  if (pageSizes.length !== stored.pageCount)
    invalid(
      "The original PDF's page count changed. Refill the form before editing.",
    );
  const originals = new Map(stored.fields.map((field) => [field.id, field]));
  const ids = new Set<string>();
  const acroFormNames = new Set<string>();
  for (const field of fields) {
    if (!field.id.trim() || ids.has(field.id))
      invalid("Every PDF form field must have a unique, non-empty id.");
    ids.add(field.id);
    if (field.value.length > MAX_PDF_FORM_VALUE_CHARS)
      invalid(
        `Field "${field.label}" exceeds ${MAX_PDF_FORM_VALUE_CHARS} characters.`,
      );
    if (
      !Number.isInteger(field.page) ||
      field.page < 1 ||
      field.page > stored.pageCount
    )
      invalid(`Field "${field.label}" must be on a page within this PDF.`);
    if (field.kind === "checkbox" && field.value !== "X" && field.value !== "")
      invalid(
        `Checkbox "${field.label}" must have value "X" or an empty string.`,
      );
    if (
      field.fontSize !== undefined &&
      (!Number.isFinite(field.fontSize) || field.fontSize <= 0)
    )
      invalid(`Field "${field.label}" must have a positive, finite font size.`);

    const coordinates = [field.x, field.y, field.width, field.height];
    if (coordinates.some((coordinate) => coordinate !== undefined)) {
      const { x, y, width, height } = field;
      if (
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      )
        invalid(`Field "${field.label}" needs all four box coordinates.`);
      else {
        const page = pageSizes[field.page - 1];
        if (
          !coordinates.every((coordinate) => Number.isFinite(coordinate)) ||
          x < 0 ||
          y < 0 ||
          width <= 0 ||
          height <= 0 ||
          x + width > page.width ||
          y + height > page.height
        )
          invalid(
            `Field "${field.label}" needs a finite, positive box within its page.`,
          );
      }
    }

    const original = originals.get(field.id);
    if (
      !original &&
      (field.acroFormName !== undefined || field.basis !== "manual")
    )
      invalid(
        `New field "${field.label}" must have basis "manual" and no AcroForm name.`,
      );
    if (field.acroFormName !== undefined) {
      if (
        stored.mode !== "acroform" ||
        original?.acroFormName !== field.acroFormName ||
        original.kind !== field.kind ||
        acroFormNames.has(field.acroFormName)
      )
        invalid(
          `Field "${field.label}" must keep its existing AcroForm name and kind.`,
        );
      acroFormNames.add(field.acroFormName);
    }
  }
}

export const saveEdits = action({
  args: {
    fillId: v.id("pdfFormFills"),
    expectedVersion: v.number(),
    fields: v.array(pdfFormFieldValidator),
  },
  returns: v.object({
    version: v.number(),
    fileId: v.id("_storage"),
    url: v.string(),
    filename: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    version: number;
    fileId: Id<"_storage">;
    url: string;
    filename: string;
  }> => {
    const source = await ctx.runQuery(
      internal.pdfFormEdits.getSaveInputInternal,
      {
        fillId: args.fillId,
        expectedVersion: args.expectedVersion,
      },
    );
    const blob = await ctx.storage.get(source.sourceFileId);
    if (!blob)
      throw new NoWriteInputError(
        "form_source_unavailable",
        "The original PDF is unavailable.",
      );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const document = await PDFDocument.load(bytes, { ignoreEncryption: true });
    validateFields(
      args.fields,
      source,
      document.getPages().map((page) => page.getSize()),
    );
    const rendered = await renderPdfFormFields(bytes, source.mode, args.fields);
    const fileId = await ctx.storage.store(
      new Blob([new Uint8Array(rendered)], {
        type: "application/pdf",
      }),
    );
    try {
      const committed = await ctx.runMutation(
        internal.pdfFormEdits.commitEditsInternal,
        {
          ...args,
          fileId,
        },
      );
      const url = await ctx.storage.getUrl(fileId);
      if (!url) throw new Error("The saved PDF is unavailable.");
      return { ...committed, fileId, url };
    } catch (error) {
      await ctx.runMutation(
        internal.pdfFormEdits.discardUncommittedFileInternal,
        {
          fillId: args.fillId,
          fileId,
        },
      );
      throw error;
    }
  },
});
