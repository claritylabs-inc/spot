import { z } from "zod";
import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS as SDK_ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  AcordLobCodeSchema,
  isLobCode,
  isPersonalLob,
  lobLabel as sdkLobLabel,
  toLobCodes,
  type AcordLobCode,
} from "@claritylabs/cl-sdk/policy-taxonomy";

export {
  ACORD_LOB_CODES,
  EXCLUDED_ACORD_LOB_CODES,
  AcordLobCodeSchema,
  isLobCode,
  toLobCodes,
};
export type { AcordLobCode };

// Verified against the published ACORD PCS 2.11.0 LineOfBusiness list.
// Keep the shared SDK taxonomy; correct its one spelling difference locally.
export const ACORD_LOB_LABELS = {
  ...SDK_ACORD_LOB_LABELS,
  MGMLI: "Management Liability",
};

export function lobLabel(value: string) {
  return value === "MGMLI" ? ACORD_LOB_LABELS.MGMLI : sdkLobLabel(value);
}

// Unknown and blank are valid interchange markers, not provider appetite.
export const PROVIDER_ACORD_LOB_CODES = ACORD_LOB_CODES.filter(
  (code) => code !== "UN" && code !== "BLANK",
);
export const ProviderAcordLobCodeSchema = z.enum(PROVIDER_ACORD_LOB_CODES);

export function policyLobCodes(policy: {
  linesOfBusiness?: readonly string[];
}): AcordLobCode[] {
  return toLobCodes(policy.linesOfBusiness);
}

export { isPersonalLob };
