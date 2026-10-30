import { v, type Infer } from "convex/values";

/**
 * One value on a filled PDF form. Boxes use the PDF panel's highlight-box
 * coordinates: PDF points at scale 1, top-left origin. A field without a box
 * has a value Jev could not place; the operator can place it in the editor.
 * AcroForm fields keep their `acroFormName`; every other field is overlaid.
 */
export const pdfFormFieldValidator = v.object({
  id: v.string(),
  label: v.string(),
  kind: v.union(v.literal("text"), v.literal("checkbox")),
  /** Text value; checkboxes use "X" for ticked and "" for clear. */
  value: v.string(),
  page: v.number(),
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  /** Overlay font size in points; derived from the box when absent. */
  fontSize: v.optional(v.number()),
  acroFormName: v.optional(v.string()),
  basis: v.union(
    v.literal("operator"),
    v.literal("client_record"),
    v.literal("none"),
    v.literal("manual"),
  ),
});

export type PdfFormField = Infer<typeof pdfFormFieldValidator>;

export const pdfFormModeValidator = v.union(
  v.literal("acroform"),
  v.literal("overlay"),
);

export type PdfFormMode = Infer<typeof pdfFormModeValidator>;

/** `Form (filled).pdf`, then `Form (filled v2).pdf` for later versions. */
export function pdfFormVersionFilename(sourceFilename: string, version: number) {
  const base = sourceFilename.replace(/\.pdf$/i, "");
  return `${base} (filled${version > 1 ? ` v${version}` : ""}).pdf`;
}

export const MAX_PDF_FORM_FIELDS = 400;
export const MAX_PDF_FORM_VALUE_CHARS = 2_000;

export function pdfFormFieldBox(field: PdfFormField) {
  return field.x !== undefined &&
    field.y !== undefined &&
    field.width !== undefined &&
    field.height !== undefined
    ? { x: field.x, y: field.y, width: field.width, height: field.height }
    : null;
}
