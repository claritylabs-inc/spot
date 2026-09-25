import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";
import { PillTabsSkeleton } from "@/components/route-skeletons";

export default function OperatorClientComplianceLoading() {
  return (
    <div className="w-full space-y-6" aria-hidden="true">
      <PillTabsSkeleton tabs={["w-24", "w-24"]} />
      <div className="flex w-full flex-col gap-4">
        <OperationalSkeletonList rows={4} />
      </div>
    </div>
  );
}
