import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";

export default function OperatorClientProcurementRequestLoading() {
  return (
    <div className="w-full space-y-6" aria-hidden="true">
      <OperationalSkeletonList rows={4} />
    </div>
  );
}
