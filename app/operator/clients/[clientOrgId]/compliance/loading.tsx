import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";
import { FolderTabsSkeleton } from "@/components/route-skeletons";

export default function OperatorClientComplianceLoading() {
  return (
    <FolderTabsSkeleton tabs={["w-20", "w-20"]}>
      <OperationalSkeletonList rows={4} />
    </FolderTabsSkeleton>
  );
}
