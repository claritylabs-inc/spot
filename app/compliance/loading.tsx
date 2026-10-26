import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";
import { FolderTabsSkeleton } from "@/components/route-skeletons";

export default function ComplianceLoading() {
  return (
    <FolderTabsSkeleton tabs={["w-16", "w-20"]}>
      <OperationalSkeletonList rows={4} />
    </FolderTabsSkeleton>
  );
}
