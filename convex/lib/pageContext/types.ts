import type { OperatorIntentPrefetchRead } from "../operatorAgentIntentRegistry";
import type {
  OperatorAgentToolName,
  OperatorToolFamily,
} from "../operatorAgentToolRegistry";

/**
 * What the operator runner knows about one attached page type. Entries are
 * plain data plus small input builders: the core decides whether to prefetch,
 * runs the reads, frames the system prompt and requires the families.
 */
export type OperatorPageContextEntry = {
  /** Exact page types this entry serves. */
  pageTypes: readonly string[];
  /** Also serves every page type with this prefix, e.g. `operator_client_`. */
  pageTypePrefix?: string;
  /** How the system prompt names the record, e.g. "email conversation". */
  noun: string;
  /** Families every run with this page attached loads, so selection never misses them. */
  families: readonly OperatorToolFamily[];
  /**
   * Reads run before the first model step, in stages; reads within a stage
   * run together. Builders receive `focus.entityId`, `relatedId(kind)` (the
   * first related record of that kind) and earlier stages' successful results. The first stage reads the page's own record: a
   * successful earlier read of the entity by one of its tools suppresses the
   * prefetch on later turns.
   */
  prefetch: ReadonlyArray<readonly OperatorIntentPrefetchRead[]>;
  /**
   * Deterministic facts derived in code from the prefetched results, listed
   * in the system prompt so the model does not search for them.
   */
  hints?: (results: ReadonlyMap<OperatorAgentToolName, unknown>) => string[];
};
