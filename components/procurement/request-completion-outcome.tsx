import type { Doc } from "@/convex/_generated/dataModel";
import { OperationalLabelValueRow } from "@claritylabs-inc/ui/components/operational-panel";
import { formatDisplayDate } from "@/lib/date-format";

export function RequestCompletionOutcome({
  outcome,
}: {
  outcome?: Doc<"procurementRequests">["completionOutcome"];
}) {
  if (!outcome) return null;
  return (
    <>
      <OperationalLabelValueRow label="Outcome" value="Placed elsewhere" />
      {outcome.provider ? (
        <OperationalLabelValueRow
          label="Reported provider"
          value={outcome.provider}
        />
      ) : null}
      {outcome.purchaseDate ? (
        <OperationalLabelValueRow
          label="Reported purchase date"
          value={formatDisplayDate(outcome.purchaseDate)}
        />
      ) : null}
    </>
  );
}
