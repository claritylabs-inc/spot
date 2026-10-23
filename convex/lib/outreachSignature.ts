import { buildOperatorSignature } from "./teamEmail";

/**
 * @deprecated Compatibility alias for `buildOperatorSignature` in
 * `teamEmail.ts`. The signature is now the operator's name and "Spot" with the
 * Spot mark, with no address line; `email` is ignored. A missing name (or the
 * "Spot" placeholder) throws `TeamEmailError("name_required")`.
 */
export function buildOutreachSignature(operator: { name?: string | null; email?: string }) {
  return buildOperatorSignature({ name: operator.name });
}
