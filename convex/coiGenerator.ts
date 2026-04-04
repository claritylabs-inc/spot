"use node";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// ── ACORD-style COI PDF Generator ──
// Uses rawExtracted data fields properly:
//   Producer = broker/brokerAgency (who sold/placed the insurance)
//   Insurer = security/carrierLegalName (actual underwriting company)

interface CoiInput {
  certificateDate: string;
  // Producer = the broker/agency
  producerName: string; // broker or brokerAgency from rawExtracted
  producerAddress?: string;
  producerPhone?: string;
  producerEmail?: string;
  // Insurer = the actual underwriting company
  insurerName: string; // security or carrierLegalName from rawExtracted
  // Insured
  insuredName: string;
  insuredAddress?: string;
  // Policy
  policyNumber: string;
  policyType: string;
  effectiveDate: string;
  expirationDate: string;
  // Coverages
  coverages: Array<{
    name: string;
    limit?: string;
    deductible?: string;
  }>;
  // Certificate holder
  holderName: string;
  holderAddress?: string;
  purpose?: string;
}

const NAVY = rgb(0.067, 0.094, 0.153);
const GRAY = rgb(0.54, 0.514, 0.47);
const LIGHT_BG = rgb(0.98, 0.973, 0.957);
const WHITE = rgb(1, 1, 1);
const BORDER = rgb(0.898, 0.886, 0.863);

function drawBox(page: any, x: number, y: number, w: number, h: number, fill?: any) {
  page.drawRectangle({
    x, y, width: w, height: h,
    color: fill || WHITE,
    borderColor: BORDER,
    borderWidth: 0.5,
  });
}

export async function generateCoiPdf(input: CoiInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 8;
  const labelSize = 6.5;

  const margin = 36;
  const pageWidth = 612 - 2 * margin;
  let y = 792 - margin;

  // ── Header ──
  drawBox(page, margin, y - 50, pageWidth, 50, LIGHT_BG);
  page.drawText("CERTIFICATE OF LIABILITY INSURANCE", {
    x: margin + 8, y: y - 20, size: 14, font: helveticaBold, color: NAVY,
  });
  page.drawText(`DATE (MM/DD/YYYY): ${input.certificateDate}`, {
    x: margin + pageWidth - 180, y: y - 20, size: fontSize, font: helvetica, color: NAVY,
  });
  page.drawText(
    "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.",
    { x: margin + 8, y: y - 38, size: 5.5, font: helvetica, color: GRAY }
  );
  y -= 58;

  // ── Producer / Insured row ──
  const halfWidth = pageWidth / 2;
  drawBox(page, margin, y - 80, halfWidth, 80);
  drawBox(page, margin + halfWidth, y - 80, halfWidth, 80);

  // Producer = broker/agency
  page.drawText("PRODUCER", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(input.producerName, { x: margin + 4, y: y - 22, size: fontSize, font: helveticaBold, color: NAVY });
  if (input.producerAddress) {
    page.drawText(input.producerAddress, { x: margin + 4, y: y - 34, size: fontSize, font: helvetica, color: NAVY });
  }
  if (input.producerPhone) {
    page.drawText(`Phone: ${input.producerPhone}`, { x: margin + 4, y: y - 48, size: fontSize, font: helvetica, color: NAVY });
  }
  if (input.producerEmail) {
    page.drawText(`Email: ${input.producerEmail}`, { x: margin + 4, y: y - 60, size: fontSize, font: helvetica, color: NAVY });
  }

  // Insured
  const ix = margin + halfWidth + 4;
  page.drawText("INSURED", { x: ix, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(input.insuredName, { x: ix, y: y - 22, size: fontSize, font: helveticaBold, color: NAVY });
  if (input.insuredAddress) {
    // Split long addresses across lines
    const addrLines = input.insuredAddress.split(",").map(s => s.trim());
    addrLines.forEach((line, i) => {
      page.drawText(line, { x: ix, y: y - 34 - (i * 12), size: fontSize, font: helvetica, color: NAVY });
    });
  }
  y -= 88;

  // ── Insurer row — uses security/carrierLegalName ──
  drawBox(page, margin, y - 30, pageWidth, 30);
  page.drawText("INSURER(S) AFFORDING COVERAGE", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(`INSURER A: ${input.insurerName}`, { x: margin + 4, y: y - 24, size: fontSize, font: helveticaBold, color: NAVY });
  y -= 38;

  // ── Policy details ──
  drawBox(page, margin, y - 50, pageWidth, 50, LIGHT_BG);
  page.drawText("COVERAGES", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });

  const policyY = y - 26;
  page.drawText("TYPE OF INSURANCE", { x: margin + 4, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY NUMBER", { x: margin + 160, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY EFF", { x: margin + 310, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY EXP", { x: margin + 390, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });

  page.drawLine({ start: { x: margin, y: policyY - 4 }, end: { x: margin + pageWidth, y: policyY - 4 }, thickness: 0.5, color: BORDER });

  page.drawText(input.policyType, { x: margin + 4, y: policyY - 16, size: fontSize, font: helveticaBold, color: NAVY });
  page.drawText(input.policyNumber, { x: margin + 160, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(input.effectiveDate, { x: margin + 310, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(input.expirationDate, { x: margin + 390, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  y -= 58;

  // ── Coverages grid ──
  drawBox(page, margin, y - 18, pageWidth, 18, LIGHT_BG);
  page.drawText("COVERAGE", { x: margin + 4, y: y - 12, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("LIMIT", { x: margin + 320, y: y - 12, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("DEDUCTIBLE", { x: margin + 440, y: y - 12, size: labelSize, font: helveticaBold, color: GRAY });

  y -= 18;
  const maxCoverages = Math.min(input.coverages.length, 20);
  for (let i = 0; i < maxCoverages; i++) {
    const c = input.coverages[i];
    const rowH = 16;
    drawBox(page, margin, y - rowH, pageWidth, rowH);
    page.drawText(c.name.slice(0, 50), { x: margin + 4, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    if (c.limit) page.drawText(c.limit.slice(0, 30), { x: margin + 320, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    if (c.deductible) page.drawText(c.deductible.slice(0, 20), { x: margin + 440, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    y -= rowH;
  }
  y -= 8;

  // ── Description of operations ──
  if (input.purpose) {
    drawBox(page, margin, y - 40, pageWidth, 40);
    page.drawText("DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES", {
      x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY,
    });
    page.drawText(input.purpose, { x: margin + 4, y: y - 26, size: fontSize, font: helvetica, color: NAVY });
    y -= 48;
  }

  // ── Certificate Holder ──
  drawBox(page, margin, y - 60, pageWidth, 60);
  page.drawText("CERTIFICATE HOLDER", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(input.holderName, { x: margin + 4, y: y - 26, size: fontSize, font: helveticaBold, color: NAVY });
  if (input.holderAddress) {
    page.drawText(input.holderAddress, { x: margin + 4, y: y - 38, size: fontSize, font: helvetica, color: NAVY });
  }
  y -= 68;

  // ── Footer ──
  page.drawText(
    "SHOULD ANY OF THE ABOVE DESCRIBED POLICIES BE CANCELLED BEFORE THE EXPIRATION DATE THEREOF, NOTICE WILL BE",
    { x: margin, y: y - 10, size: 5.5, font: helvetica, color: GRAY }
  );
  page.drawText(
    "DELIVERED IN ACCORDANCE WITH THE POLICY PROVISIONS.",
    { x: margin, y: y - 18, size: 5.5, font: helvetica, color: GRAY }
  );

  page.drawText(
    `Generated by Spot (Clarity Labs) on ${input.certificateDate}. This is an informational certificate — not an official ACORD form.`,
    { x: margin, y: margin + 10, size: 6, font: helvetica, color: GRAY }
  );

  return doc.save();
}

/**
 * Build CoiInput from rawExtracted policy data.
 * Uses correct field mapping:
 *   Producer = broker/brokerAgency (who placed the insurance)
 *   Insurer = security/carrierLegalName (the actual underwriter)
 */
export function buildCoiInput(
  policy: any,
  holderName: string,
  purpose: string,
  userName: string,
): CoiInput {
  const today = new Date();
  const dateStr = `${(today.getMonth() + 1).toString().padStart(2, "0")}/${today.getDate().toString().padStart(2, "0")}/${today.getFullYear()}`;

  // rawExtracted is stored on the policy record — use it for rich field access
  const raw = policy.rawExtracted || policy;

  // Producer = broker (who sold/placed the insurance)
  const producerName = raw.broker || raw.brokerAgency || raw.mga || raw.carrier || "Producer";

  // Insurer = security/carrierLegalName (actual underwriting company)
  // The `security` field is the actual insurer. `carrier` is often the broker/brand name.
  const insurerName = raw.security || raw.carrierLegalName || raw.carrier || "Insurer";

  // Build insured address string
  let insuredAddress: string | undefined;
  if (raw.insuredAddress) {
    const a = raw.insuredAddress;
    insuredAddress = [a.street1, a.city, a.state, a.zip].filter(Boolean).join(", ");
  }

  // Policy type — use declarations form type or policyTypes for a friendly label
  const formType = raw.declarations?.formType || "";
  const policyTypeLabel = formType
    ? `${policy.category || "Insurance"} (${formType})`
    : policy.category || "Insurance";

  const coverages: CoiInput["coverages"] = [];
  if (raw.coverages && Array.isArray(raw.coverages)) {
    for (const c of raw.coverages) {
      coverages.push({
        name: c.name || c.type || "Coverage",
        limit: c.limit || c.limitPerOccurrence || c.limitPerPerson || "",
        deductible: c.deductible || "",
      });
    }
  }

  return {
    certificateDate: dateStr,
    producerName,
    producerAddress: undefined, // Could be enriched from raw data if available
    producerPhone: undefined,
    producerEmail: undefined,
    insurerName,
    insuredName: raw.insuredName || userName,
    insuredAddress,
    policyNumber: raw.policyNumber || policy.policyNumber || "",
    policyType: policyTypeLabel,
    effectiveDate: raw.effectiveDate || policy.effectiveDate || "",
    expirationDate: raw.expirationDate || policy.expirationDate || "",
    coverages,
    holderName,
    purpose,
  };
}
