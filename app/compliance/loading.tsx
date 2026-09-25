import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";
import { PillTabsSkeleton } from "@/components/route-skeletons";

export default function ComplianceLoading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-hidden="true">
      <PillTabsSkeleton tabs={["w-20", "w-24"]} />
      <OperationalSkeletonList rows={4} />
    </div>
  );
}
