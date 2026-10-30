import { v, type Infer } from "convex/values";

/**
 * One value on a filled PDF form. Boxes use the PDF panel's highlight-box
 * coordinates: PDF points at scale 1, top-left origin. A field without a box
 * has a value Jev could not place. Every field is drawn over the original; fillable form fields are flattened.
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
  // Deprecated: AcroForm fills from before every form was filled flat.
  acroFormName: v.optional(v.string()),
  basis: v.union(
    v.literal("operator"),
    v.literal("client_record"),
    v.literal("none"),
    v.literal("manual"),
  ),
});

export type PdfFormField = Infer<typeof pdfFormFieldValidator>;

// Deprecated: kept for fills recorded before every form was filled flat.
export const pdfFormModeValidator = v.union(
  v.literal("acroform"),
  v.literal("overlay"),
);

/** `Form (filled).pdf`, then `Form (filled v2).pdf` for later versions. */
export function pdfFormVersionFilename(sourceFilename: string, version: number) {
  const base = sourceFilename.replace(/\.pdf$/i, "");
  return `${base} (filled${version > 1 ? ` v${version}` : ""}).pdf`;
}

export const MAX_PDF_FORM_VALUE_CHARS = 2_000;

export function pdfFormFieldBox(field: PdfFormField) {
  return field.x !== undefined &&
    field.y !== undefined &&
    field.width !== undefined &&
    field.height !== undefined
    ? { x: field.x, y: field.y, width: field.width, height: field.height }
    : null;
}

const normalizeLabel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}#]+/gu, " ")
    .trim();

/**
 * The field an agent edit names: its id, its exact label, or the one label
 * containing the given text. Otherwise the candidates to choose from.
 */
export function findPdfFormField(
  fields: PdfFormField[],
  name: string,
): { field: PdfFormField } | { candidates: string[] } {
  const byId = fields.find((field) => field.id === name.trim());
  if (byId) return { field: byId };
  const wanted = normalizeLabel(name);
  const exact = fields.filter((field) => normalizeLabel(field.label) === wanted);
  if (exact.length === 1) return { field: exact[0] };
  const containing = exact.length
    ? exact
    : fields.filter((field) => normalizeLabel(field.label).includes(wanted));
  if (containing.length === 1) return { field: containing[0] };
  return { candidates: containing.slice(0, 10).map((field) => field.label) };
}

const TICKED = new Set(["x", "yes", "true", "checked", "on"]);

/** Checkboxes store "X" or ""; text is trimmed. */
export function pdfFormFieldValue(field: PdfFormField, value: string) {
  const trimmed = value.trim();
  if (field.kind !== "checkbox") return trimmed;
  return TICKED.has(trimmed.toLowerCase()) ? "X" : "";
}
