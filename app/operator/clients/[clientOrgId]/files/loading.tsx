import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { SkeletonLine, TableSkeleton } from "@/components/route-skeletons";

export default function OperatorClientFilesLoading() {
  return (
    <div className="w-full space-y-6" aria-hidden="true">
      <div className="space-y-4">
        <TableSkeleton
          columns={[
            {
              className: "min-w-60",
              cell: (
                <div className="flex min-w-0 items-center gap-3">
                  <Skeleton className="size-4 shrink-0" />
                  <div className="min-w-0 space-y-1">
                    <SkeletonLine className="w-48" />
                    <Skeleton className="h-3 w-14" />
                  </div>
                </div>
              ),
            },
            { cell: <SkeletonLine className="w-32" /> },
            { cell: <SkeletonLine className="w-16" /> },
            { cell: <SkeletonLine className="w-20" /> },
          ]}
        />
      </div>
    </div>
  );
}
