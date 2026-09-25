import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  SkeletonLine,
  SkeletonTag,
  TableSkeleton,
} from "@/components/route-skeletons";

export default function OperatorClientsLoading() {
  return (
    <div className="flex w-full flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-9 w-full max-w-sm rounded-lg" />
      <TableSkeleton
        rows={8}
        columns={[
          {
            className: "w-[25%]",
            cell: (
              <div className="flex min-w-0 items-center gap-2.5">
                <Skeleton className="size-7 shrink-0 rounded-md" />
                <SkeletonLine className="w-36" />
              </div>
            ),
          },
          { className: "w-[22%]", cell: <SkeletonLine className="w-40" /> },
          { className: "w-[18%]", cell: <SkeletonLine className="w-32" /> },
          { className: "w-[10%]", cell: <SkeletonTag className="w-16" /> },
          { className: "w-[8%]", cell: <SkeletonLine className="w-20" /> },
        ]}
      />
    </div>
  );
}
