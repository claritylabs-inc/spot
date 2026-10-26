import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  SkeletonLine,
  SkeletonTag,
  TableSkeleton,
} from "@/components/route-skeletons";

export default function OperatorProcurementLoading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
      <TableSkeleton
        rows={8}
        columns={[
          { className: "w-[34%]", cell: <SkeletonLine className="w-48" /> },
          {
            className: "w-[24%]",
            cell: (
              <div className="flex min-w-0 items-center gap-2.5">
                <Skeleton className="size-7 shrink-0 rounded-md" />
                <SkeletonLine className="w-32" />
              </div>
            ),
          },
          { className: "w-[16%]", cell: <SkeletonTag className="w-20" /> },
          { className: "w-[14%]", cell: <SkeletonLine className="w-20" /> },
          { className: "w-[12%]", cell: <SkeletonLine className="w-20" /> },
        ]}
      />
    </div>
  );
}
