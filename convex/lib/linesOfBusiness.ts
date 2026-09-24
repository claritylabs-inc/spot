import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  AcordLobCodeSchema,
  isLobCode,
  isPersonalLob,
  lobLabel,
  toLobCodes,
  type AcordLobCode,
} from "@claritylabs/cl-sdk/policy-taxonomy";

export {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  AcordLobCodeSchema,
  isLobCode,
  lobLabel,
  toLobCodes,
};
export type { AcordLobCode };

export function policyLobCodes(policy: {
  linesOfBusiness?: readonly string[];
}): AcordLobCode[] {
  return toLobCodes(policy.linesOfBusiness);
}

export { isPersonalLob };
