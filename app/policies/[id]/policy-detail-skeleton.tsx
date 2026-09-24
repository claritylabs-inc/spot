import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";

export function PolicyDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-7 w-56 max-w-full" />
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
        </div>
        <div className="hidden items-center gap-2 md:flex">
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-8 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-full" />
        </div>
      </div>

      <div className="flex items-center gap-1">
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-20 rounded-full" />
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>

      <OperationalPanel as="div">
        <OperationalPanelBody className="px-4 py-3">
        <Skeleton className="h-4 w-40 mb-3" />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <div key={item} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-5 w-36 max-w-full" />
            </div>
          ))}
        </div>
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel as="div">
        <OperationalPanelHeader
          title={<Skeleton className="h-4 w-32" />}
          className="px-4 py-2.5 border-border-subtle"
        />
        <div className="divide-y divide-border-subtle">
          {[0, 1, 2, 3, 4].map((item) => (
            <OperationalItem
              key={item}
              className="grid grid-cols-[minmax(0,1fr)_120px] gap-4 border-border-subtle px-4 py-3 sm:grid-cols-[minmax(0,1fr)_140px_120px]"
            >
              <Skeleton className="h-4 w-44 max-w-full" />
              <Skeleton className="h-4 w-24 justify-self-end" />
              <Skeleton className="hidden h-4 w-20 justify-self-end sm:block" />
            </OperationalItem>
          ))}
        </div>
      </OperationalPanel>
    </div>
  );
}
