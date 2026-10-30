/**
 * PDF sources for form filling are `kind:id` strings. The PDF panel uses the
 * same string as its page context entity ID, so the agent can pass it to
 * fill_pdf_form verbatim.
 */
export type PdfFormSource =
  | { kind: "operatorAttachment"; fileId: string }
  | { kind: "clientFile"; clientFileId: string }
  | { kind: "teamEmailAttachment"; messageId: string; storageId: string }
  | { kind: "submissionDefaultForm"; defaultId: string; storageId: string };

export const PDF_FORM_SOURCE_FORMATS =
  "operatorAttachment:<storage fileId>, clientFile:<clientFileId>, teamEmailAttachment:<teamEmailMessageId>:<storageId> or submissionDefaultForm:<submissionDefaultId>:<storageId> (a provider's default application form)";

export const PDF_DOCUMENT_PAGE_TYPE = "pdf_document";

export function pdfFormSourceId(source: PdfFormSource): string {
  switch (source.kind) {
    case "operatorAttachment":
      return `operatorAttachment:${source.fileId}`;
    case "clientFile":
      return `clientFile:${source.clientFileId}`;
    case "teamEmailAttachment":
      return `teamEmailAttachment:${source.messageId}:${source.storageId}`;
    case "submissionDefaultForm":
      return `submissionDefaultForm:${source.defaultId}:${source.storageId}`;
  }
}

export function parsePdfFormSourceId(value: string): PdfFormSource | null {
  const [kind, first, second, ...rest] = value.trim().split(":");
  if (rest.length || !first) return null;
  if (kind === "operatorAttachment" && !second)
    return { kind, fileId: first };
  if (kind === "clientFile" && !second) return { kind, clientFileId: first };
  if (kind === "teamEmailAttachment" && second)
    return { kind, messageId: first, storageId: second };
  if (kind === "submissionDefaultForm" && second)
    return { kind, defaultId: first, storageId: second };
  return null;
}
