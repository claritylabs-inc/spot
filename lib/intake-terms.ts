/** Version the terms and the exact consent presented to applicants together. */
export const INTAKE_TERMS_VERSION = "2026-10-27-v2";
export const INTAKE_TERMS_URL = "/intake/terms";
export const INTAKE_TERMS_TITLE = "By continuing, I agree to Spot’s Terms of Service.";
export const INTAKE_AUTHORIZATION_CONSENT =
  "I authorize Spot to act as my legal representative to obtain quotes and purchase insurance on my behalf, subject to my approval of the coverage and cost.";
const SIGNATURE_CONSENT_2026_10_27 =
  "By checking this box, I electronically sign this authorization using the name in my application. A signed declaration will be saved when I submit my request.";
export const INTAKE_SIGNATURE_CONSENT =
  "By checking this box, I electronically sign this authorization using the name in my application. When I submit, I authorize Spot to create a PDF bearing my electronic signature and share it with insurance providers to demonstrate my authorization and help obtain insurance quotes on my behalf.";
export const INTAKE_PDF_AUTHORIZATION_TERMS =
  "When you submit an insurance quote request after checking the authorization box, you authorize Spot to create and save a PDF authorization bearing your electronic signature, represented by the name you provide in your application. The PDF may include your name, business name, contact details, the authorization you accepted, the terms version, and acceptance and submission timestamps. You authorize Spot to include the PDF in your Spot Packet and share the PDF or a link to it with insurance providers, including brokers and insurers, to demonstrate Spot’s authority to represent you and help obtain quotes. Your electronic signature records your checkbox acceptance; it is not a captured handwritten signature. Any purchase of insurance still requires your approval of the coverage and cost.";
export const INTAKE_TERMS_STATEMENT =
  `${INTAKE_TERMS_TITLE} ${INTAKE_AUTHORIZATION_CONSENT} ${INTAKE_SIGNATURE_CONSENT}`;
export const INTAKE_AUTHORITY_STATEMENT =
  "By accepting these terms, you confirm that you have authority to act for the business identified in your application and to grant this authorization on its behalf.";
export const INTAKE_BASE_TERMS_URL = "https://toolsforenlightenment.org/terms-of-service";
export const SPOT_REPRESENTATION_TERMS =
  "You authorize Spot to act as your legal representative for the limited purpose of seeking quotes, communicating with insurance providers, and arranging and purchasing insurance on your behalf. Spot may share the application and supporting documents you provide with insurance providers for these purposes. Any purchase requires your approval of the coverage and cost. This authorization does not itself bind coverage or guarantee that insurance will be available.";

// Retain published versions so a declaration's original terms link stays accurate.
const INTAKE_TERMS_VERSIONS = {
  "2026-10-21": {
    effectiveDate: "2026-10-21",
    signatureConsent: null,
    pdfAuthorizationTerms: null,
  },
  "2026-10-27": {
    effectiveDate: "2026-10-27",
    signatureConsent: SIGNATURE_CONSENT_2026_10_27,
    pdfAuthorizationTerms: null,
  },
  "2026-10-27-v2": {
    effectiveDate: "2026-10-27",
    signatureConsent: INTAKE_SIGNATURE_CONSENT,
    pdfAuthorizationTerms: INTAKE_PDF_AUTHORIZATION_TERMS,
  },
} as const;

export function intakeTermsForVersion(version: string) {
  if (!Object.hasOwn(INTAKE_TERMS_VERSIONS, version)) return null;
  return {
    ...INTAKE_TERMS_VERSIONS[version as keyof typeof INTAKE_TERMS_VERSIONS],
    representationTerms: SPOT_REPRESENTATION_TERMS,
    authorityStatement: INTAKE_AUTHORITY_STATEMENT,
  };
}
