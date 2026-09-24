// Owner: P7 (docs/architecture/convex-section-extraction.md).
// Spot-owned replacement for cl-sdk chunkDocument(); same output shape.

import type { DocumentChunk, InsuranceDocument } from "@claritylabs/cl-sdk";

export function chunkPolicyDocument(_document: InsuranceDocument): DocumentChunk[] {
  throw new Error("chunkPolicyDocument: not implemented (P7)");
}
