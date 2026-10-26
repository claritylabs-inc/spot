/** Batch summaries have a grouped header followed by one bullet per item. */
export function operatorBatchApprovalDetails(summary: string) {
  const [header, ...lines] = summary.trim().split("\n");
  if (!lines.length || !lines.every((line) => line.startsWith("- ")))
    return null;
  return { header, items: lines.map((line) => line.slice(2)) };
}
