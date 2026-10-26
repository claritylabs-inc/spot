import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";

// Tabs load with the page, so the skeleton shows only the body.
export default function OperatorClientComplianceLoading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-hidden="true">
      <OperationalSkeletonList rows={4} />
    </div>
  );
}
