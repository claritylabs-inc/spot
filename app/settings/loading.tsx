import {
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  PillTabsSkeleton,
  SkeletonLine,
} from "@/components/route-skeletons";

export default function SettingsLoading() {
  return (
    <div aria-hidden="true">
      <div className="-mx-6 mb-6 overflow-hidden px-6 lg:hidden">
        <PillTabsSkeleton tabs={["w-28", "w-20", "w-20", "w-24", "w-28"]} />
      </div>

      <OperationalPanel as="div" className="mb-4">
        <OperationalPanelHeader
          title={<SkeletonLine className="w-28" />}
          className="px-5 py-3.5"
        />
        <OperationalPanelBody className="space-y-4 px-5 py-5">
          {["w-32", "w-16"].map((width) => (
            <div key={width}>
              <Skeleton className={`mb-1.5 h-3 ${width}`} />
              <Skeleton className="h-9 w-full rounded-lg" />
            </div>
          ))}
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel as="div" className="mb-4">
        <OperationalPanelHeader
          title={<SkeletonLine className="w-36" />}
          className="px-5 py-3.5"
        />
        <OperationalPanelBody className="px-5 py-5">
          <Skeleton className="mb-1.5 h-4 w-10" />
          <div className="flex items-center gap-4 rounded-lg border border-dashed border-border px-4 py-3">
            <Skeleton className="size-10 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <SkeletonLine className="w-24" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="mt-3 h-8 w-40 rounded-full" />
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
