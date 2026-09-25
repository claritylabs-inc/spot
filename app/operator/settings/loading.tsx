import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { SkeletonLine } from "@/components/route-skeletons";

export default function OperatorSettingsLoading() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <OperationalPanel as="div">
        <OperationalPanelHeader title={<SkeletonLine className="w-32" />} />
        <OperationalPanelBody>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-1">
              <SkeletonLine className="w-24" />
              <SkeletonLine className="w-full max-w-xl" />
              <SkeletonLine className="w-2/3 max-w-md" />
            </div>
            <Skeleton className="h-5 w-9 shrink-0 rounded-full" />
          </div>
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel as="div">
        <OperationalPanelHeader
          title={<SkeletonLine className="w-28" />}
          action={<Skeleton className="h-7 w-24 rounded-full" />}
        />
        <OperationalPanelBody>
          <div className="divide-y divide-border">
            {["w-40", "w-32", "w-48"].map((width) => (
              <div key={width} className="flex items-center gap-3 py-3">
                <Skeleton className="size-6 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1">
                  <SkeletonLine className={width} />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
