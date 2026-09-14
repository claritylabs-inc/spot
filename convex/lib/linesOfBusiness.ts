import {
  ACORD_LOB_CODES,
  ACORD_LOB_LABELS,
  EXCLUDED_ACORD_LOB_CODES,
  LEGACY_ACORD_LOB_CODE_TO_CURRENT,
  LEGACY_POLICY_TYPE_TO_LOB,
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
  LEGACY_ACORD_LOB_CODE_TO_CURRENT,
  LEGACY_POLICY_TYPE_TO_LOB,
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
