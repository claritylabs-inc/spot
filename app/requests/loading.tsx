import {
  OperationalItem,
  OperationalPanel,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { SkeletonLine, SkeletonTag } from "@/components/route-skeletons";

export default function RequestsLoading() {
  return (
    <OperationalPanel aria-hidden="true">
      {["w-56", "w-44", "w-64", "w-48"].map((width) => (
        <OperationalItem
          key={width}
          className="flex items-start justify-between gap-4"
        >
          <div className="min-w-0 flex-1">
            <SkeletonLine className={`max-w-full ${width}`} />
            <Skeleton className="mt-2.5 h-3 w-28" />
          </div>
          <SkeletonTag />
        </OperationalItem>
      ))}
    </OperationalPanel>
  );
}
