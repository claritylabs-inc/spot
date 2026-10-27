"use node";

import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import PDFDocument from "pdfkit/js/pdfkit.standalone.js";
import wordmark from "@claritylabs-inc/ui/lib/spot-wordmark.json";
import { SPOT_BLUE, SPOT_MARK_PATH } from "../../lib/spot-mark";
import { INTAKE_AUTHORIZATION_CONSENT, INTAKE_BASE_TERMS_URL, intakeTermsForVersion } from "../../lib/intake-terms";
import signatureFont from "./assets/allura-regular.json";
import bodyFont from "./assets/geist-regular.json";

dayjs.extend(utc);

export type AuthorizationPdfInput = {
  declarationId: string;
  requestId: string;
  signerName: string;
  signerEmail: string;
  legalName: string;
  dba?: string;
  acceptedAt: number;
  submittedAt: number;
  contentHash: string;
  termsVersion: string;
  termsUrl: string;
  statement: string;
  representationTerms: string;
  authorityStatement: string;
};

/** Deterministic rendering of stored consent; no model or inferred signature. */
export async function generateIntakeAuthorizationPdf(input: AuthorizationPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "LETTER", margins: { top: 48, bottom: 52, left: 48, right: 48 }, bufferPages: true,
    info: {
      Title: `Spot authorization - ${input.legalName}`,
      Author: "Spot / Tools for Enlightenment Inc.",
    },
  });
  Object.assign(doc.info, {
    ConsentStatement: input.statement,
    DeclarationId: input.declarationId,
    RequestId: input.requestId,
    SubmissionSHA256: input.contentHash,
    SignatureMethod: "Electronic checkbox acceptance; cursive name is a typographic placeholder.",
  });
  const chunks: Buffer[] = [];
  const output = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = 516;
  const ink = "#181818";
  const muted = "#5B626C";
  const rule = "#DDE3E8";
  doc.registerFont("Body", Buffer.from(bodyFont.base64, "base64"));
  doc.registerFont("SignaturePlaceholder", Buffer.from(signatureFont.base64, "base64"));
  const timestamp = (value: number) => dayjs(value).utc().format("MMM D, YYYY [at] HH:mm:ss [UTC]");
  const text = (value: string, x: number, y: number, size: number, color = ink, textWidth = width, lineHeight = size * 1.6) => {
    doc.font("Body").fontSize(size).fillColor(color);
    doc.text(value, x, y, { width: textWidth, lineGap: lineHeight - doc.currentLineHeight(true) });
    return doc.y;
  };
  const label = (value: string, y: number) => {
    if (y > 680) { doc.addPage(); y = 48; }
    text(value, 48, y, 8.5, muted);
    return doc.y;
  };
  // Match the reference's canonical Spot lockup, divider and generous title spacing.
  doc.save().translate(48, 40).scale(24 / 65).path(SPOT_MARK_PATH).fill(SPOT_BLUE).restore();
  doc.save().translate(48, 40).scale(0.12).path(wordmark.path).fill(ink).restore();
  doc.font("Body").fontSize(8.5).fillColor(muted).text("ELECTRONIC ACCEPTANCE", 350, 48, { width: 214, align: "right" });
  doc.moveTo(48, 83).lineTo(564, 83).strokeColor(rule).lineWidth(0.7).stroke();
  text("Authorization to represent", 48, 107, 26, ink, width, 34);
  text("Insurance procurement", 48, 147, 10, muted);
  label("BUSINESS GRANTING AUTHORIZATION", 180);
  text(input.legalName, 48, doc.y + 10, 16, ink, width, 23);
  if (input.dba) text(`Trading as ${input.dba}`, 48, doc.y + 2, 10.5, muted, width, 20);
  text(`Applicant: ${input.signerName}  /  ${input.signerEmail}`, 48, doc.y, 10, muted, width, 16);
  label("AUTHORIZATION", Math.max(285, doc.y + 21));
  text(INTAKE_AUTHORIZATION_CONSENT, 48, doc.y + 8, 11, ink, width, 17.3);
  label("SCOPE UNDER SPOT’S PUBLISHED TERMS", doc.y + 18);
  text(input.representationTerms, 48, doc.y + 8, 10.2, ink, width, 16.25);
  text(input.authorityStatement, 48, doc.y + 12, 10.2, ink, width, 16.25);

  // Keep the signature panel and its references together, with room for long identities.
  doc.font("Body").fontSize(10.5);
  let identity = `${input.signerName}, on behalf of ${input.legalName}`;
  const identityOptions = { width: width - 32, lineGap: 16 - doc.currentLineHeight(true) };
  if (doc.heightOfString(identity, identityOptions) > 48)
    identity = `${input.signerName}, on behalf of the business named above`;
  const identityHeight = doc.heightOfString(identity, identityOptions);
  const boxHeight = 116 + Math.max(0, identityHeight - 16);
  let boxY = Math.max(526, doc.y + 20);
  if (boxY + boxHeight + 96 > 740) {
    doc.addPage();
    boxY = Math.min(526, 740 - boxHeight - 96);
  }
  doc.roundedRect(48, boxY, width, boxHeight, 6).fill("#EDF6FD");
  text("APPLICANT SIGNATURE", 64, boxY + 13, 8.5, muted, width - 32);
  text(identity, 64, boxY + 31, 10.5, ink, width - 32, 16);
  const fieldsY = boxY + 52 + Math.max(0, identityHeight - 16);
  const signatureWidth = 308;
  doc.rect(65, fieldsY, signatureWidth, 30).fill("#FFFFFF");
  doc.rect(396, fieldsY, 151, 30).fill("#FFFFFF");
  doc.font("SignaturePlaceholder");
  let signatureSize = 24;
  while (signatureSize > 8 && doc.fontSize(signatureSize).widthOfString(input.signerName) > signatureWidth - 16) signatureSize--;
  doc.fontSize(signatureSize).fillColor("#000000").text(input.signerName, 73, fieldsY - 1, { width: signatureWidth - 16, lineBreak: false });
  text(dayjs(input.acceptedAt).utc().format("MMM D, YYYY"), 404, fieldsY + 7, 10, ink, 135);
  text("Signature", 64, fieldsY + 36, 8, muted, signatureWidth);
  text("Date signed", 396, fieldsY + 36, 8, muted, 152);

  const termsY = boxY + boxHeight + 18;
  const effectiveDate = intakeTermsForVersion(input.termsVersion)?.effectiveDate ?? input.termsVersion;
  text(`Published terms effective ${dayjs(effectiveDate).format("MMMM D, YYYY")}`, 48, termsY, 9, muted);
  const linkY = termsY + 17;
  doc.font("Body").fontSize(9).fillColor("#225D88").text("Spot Terms of Service", 48, linkY, { width: 170, link: input.termsUrl, underline: true });
  doc.text("Tools for Enlightenment Terms of Service", 230, linkY, { width: 334, link: INTAKE_BASE_TERMS_URL, underline: true });
  // Retain the full consent in PDF metadata and the immutable snapshot; keep visible provenance compact.
  text(`Accepted ${timestamp(input.acceptedAt)}  /  Submitted ${timestamp(input.submittedAt)}`, 48, linkY + 23, 6.8, muted, width, 8);
  text(`Declaration: ${input.declarationId}  /  Request: ${input.requestId}`, 48, doc.y + 1, 6.8, muted, width, 8);
  text(`Submission SHA-256: ${input.contentHash}`, 48, doc.y + 1, 6.8, muted, width, 8);
  text("Electronic checkbox acceptance; cursive name is a typographic placeholder.", 48, doc.y + 1, 6.8, muted, width, 8);
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    // Footer text sits outside the body margin; prevent PDFKit adding a page.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.moveTo(48, 752).lineTo(564, 752).strokeColor(rule).lineWidth(0.7).stroke();
    doc.font("Body").fontSize(8).fillColor(muted).text("Spot / Tools for Enlightenment Inc.", 48, 762, { width: 300, lineBreak: false });
    doc.text(`${index + 1} / ${range.count}`, 510, 762, { width: 54, align: "right", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return output;
}
