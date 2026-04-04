"use node";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

// ── ACORD-style COI PDF Generator ──
// Generates a professional Certificate of Insurance PDF that mirrors the standard ACORD 25 layout.
// Not an official ACORD form (those are copyrighted), but follows the same structure and fields.

interface CoiInput {
  // Certificate info
  certificateDate: string; // date of issue
  // Producer / agent (Spot acts as the sender)
  producerName: string; // "Spot by Clarity Labs"
  producerAddress: string;
  producerPhone: string;
  producerEmail: string;
  // Insured
  insuredName: string;
  insuredAddress?: string;
  // Policy details
  carrier: string;
  policyNumber: string;
  policyType: string; // e.g. "General Liability", "Auto", "Homeowners (HO-3)"
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
  // Purpose
  purpose?: string; // e.g. "Apartment Lease at 123 Main St"
}

const NAVY = rgb(0.067, 0.094, 0.153); // #111827
const GRAY = rgb(0.54, 0.514, 0.47); // #8a8578
const LIGHT_BG = rgb(0.98, 0.973, 0.957); // #faf8f4
const WHITE = rgb(1, 1, 1);
const BORDER = rgb(0.898, 0.886, 0.863); // #e5e2dc

function drawLine(page: any, x: number, y: number, width: number) {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: 0.5,
    color: BORDER,
  });
}

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
  const page = doc.addPage([612, 792]); // US Letter
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const fontSize = 8;
  const labelSize = 6.5;

  const margin = 36; // 0.5 inch
  const pageWidth = 612 - 2 * margin;
  let y = 792 - margin;

  // ── Header ──
  drawBox(page, margin, y - 50, pageWidth, 50, LIGHT_BG);
  page.drawText("CERTIFICATE OF LIABILITY INSURANCE", {
    x: margin + 8,
    y: y - 20,
    size: 14,
    font: helveticaBold,
    color: NAVY,
  });
  page.drawText(`DATE (MM/DD/YYYY): ${input.certificateDate}`, {
    x: margin + pageWidth - 180,
    y: y - 20,
    size: fontSize,
    font: helvetica,
    color: NAVY,
  });
  page.drawText(
    "THIS CERTIFICATE IS ISSUED AS A MATTER OF INFORMATION ONLY AND CONFERS NO RIGHTS UPON THE CERTIFICATE HOLDER.",
    {
      x: margin + 8,
      y: y - 38,
      size: 5.5,
      font: helvetica,
      color: GRAY,
    }
  );
  y -= 58;

  // ── Producer / Insured row ──
  const halfWidth = pageWidth / 2;
  drawBox(page, margin, y - 80, halfWidth, 80);
  drawBox(page, margin + halfWidth, y - 80, halfWidth, 80);

  // Producer
  page.drawText("PRODUCER", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(input.producerName, { x: margin + 4, y: y - 22, size: fontSize, font: helveticaBold, color: NAVY });
  page.drawText(input.producerAddress, { x: margin + 4, y: y - 34, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(`Phone: ${input.producerPhone}`, { x: margin + 4, y: y - 48, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(`Email: ${input.producerEmail}`, { x: margin + 4, y: y - 60, size: fontSize, font: helvetica, color: NAVY });

  // Insured
  const ix = margin + halfWidth + 4;
  page.drawText("INSURED", { x: ix, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(input.insuredName, { x: ix, y: y - 22, size: fontSize, font: helveticaBold, color: NAVY });
  if (input.insuredAddress) {
    page.drawText(input.insuredAddress, { x: ix, y: y - 34, size: fontSize, font: helvetica, color: NAVY });
  }
  y -= 88;

  // ── Insurer row ──
  drawBox(page, margin, y - 30, pageWidth, 30);
  page.drawText("INSURER(S) AFFORDING COVERAGE", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(`INSURER A: ${input.carrier}`, { x: margin + 4, y: y - 24, size: fontSize, font: helvetica, color: NAVY });
  y -= 38;

  // ── Policy details row ──
  drawBox(page, margin, y - 50, pageWidth, 50, LIGHT_BG);
  page.drawText("COVERAGES", { x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText(
    "CERTIFICATE NUMBER:                                                                    REVISION NUMBER:",
    { x: margin + 100, y: y - 10, size: labelSize, font: helvetica, color: GRAY }
  );

  const policyY = y - 26;
  page.drawText("TYPE OF INSURANCE", { x: margin + 4, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY NUMBER", { x: margin + 160, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY EFF", { x: margin + 310, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("POLICY EXP", { x: margin + 390, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("LIMITS", { x: margin + 470, y: policyY, size: labelSize, font: helveticaBold, color: GRAY });
  drawLine(page, margin, policyY - 4, pageWidth);

  page.drawText(input.policyType, { x: margin + 4, y: policyY - 16, size: fontSize, font: helveticaBold, color: NAVY });
  page.drawText(input.policyNumber, { x: margin + 160, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(input.effectiveDate, { x: margin + 310, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  page.drawText(input.expirationDate, { x: margin + 390, y: policyY - 16, size: fontSize, font: helvetica, color: NAVY });
  y -= 58;

  // ── Coverages grid ──
  const coverageHeaderY = y;
  drawBox(page, margin, coverageHeaderY - 18, pageWidth, 18, LIGHT_BG);
  page.drawText("COVERAGE", { x: margin + 4, y: coverageHeaderY - 12, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("LIMIT", { x: margin + 320, y: coverageHeaderY - 12, size: labelSize, font: helveticaBold, color: GRAY });
  page.drawText("DEDUCTIBLE", { x: margin + 440, y: coverageHeaderY - 12, size: labelSize, font: helveticaBold, color: GRAY });

  y = coverageHeaderY - 18;
  const maxCoverages = Math.min(input.coverages.length, 20);
  for (let i = 0; i < maxCoverages; i++) {
    const c = input.coverages[i];
    const rowH = 16;
    drawBox(page, margin, y - rowH, pageWidth, rowH);
    page.drawText(c.name.slice(0, 50), { x: margin + 4, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    if (c.limit) {
      page.drawText(c.limit.slice(0, 30), { x: margin + 320, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    }
    if (c.deductible) {
      page.drawText(c.deductible.slice(0, 20), { x: margin + 440, y: y - 11, size: fontSize, font: helvetica, color: NAVY });
    }
    y -= rowH;
  }
  y -= 8;

  // ── Description of operations ──
  if (input.purpose) {
    drawBox(page, margin, y - 40, pageWidth, 40);
    page.drawText("DESCRIPTION OF OPERATIONS / LOCATIONS / VEHICLES", {
      x: margin + 4, y: y - 10, size: labelSize, font: helveticaBold, color: GRAY,
    });
    page.drawText(input.purpose, {
      x: margin + 4, y: y - 26, size: fontSize, font: helvetica, color: NAVY,
    });
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
 * Build a CoiInput from policy data.
 */
export function buildCoiInput(
  policy: any,
  holderName: string,
  purpose: string,
  userName: string,
  userEmail?: string
): CoiInput {
  const today = new Date();
  const dateStr = `${(today.getMonth() + 1).toString().padStart(2, "0")}/${today.getDate().toString().padStart(2, "0")}/${today.getFullYear()}`;

  const coverages: CoiInput["coverages"] = [];
  if (policy.coverages && Array.isArray(policy.coverages)) {
    for (const c of policy.coverages) {
      coverages.push({
        name: c.name || c.type || "Coverage",
        limit: c.limit || c.limitPerOccurrence || c.limitPerPerson || "",
        deductible: c.deductible || "",
      });
    }
  }

  return {
    certificateDate: dateStr,
    producerName: "Spot by Clarity Labs",
    producerAddress: "claritylabs.inc",
    producerPhone: "(929) 443-0153",
    producerEmail: userEmail || "spot@spot.claritylabs.inc",
    insuredName: policy.insuredName || userName,
    carrier: policy.carrier || "Insurance Carrier",
    policyNumber: policy.policyNumber || "",
    policyType: policy.category || "General",
    effectiveDate: policy.effectiveDate || "",
    expirationDate: policy.expirationDate || "",
    coverages,
    holderName,
    purpose,
  };
}
