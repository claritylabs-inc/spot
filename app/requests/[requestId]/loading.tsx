import type { ReactNode } from "react";
import {
  OperationalItem,
  OperationalPanel,
  OperationalPanelBody,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { SkeletonLine, SkeletonTag } from "@/components/route-skeletons";

function LabelValueRow({ children }: { children: ReactNode }) {
  return (
    <OperationalItem className="grid grid-cols-1 gap-1 sm:grid-cols-[minmax(7.5rem,0.32fr)_minmax(0,1fr)] sm:gap-3">
      <SkeletonLine className="w-24" />
      {children}
    </OperationalItem>
  );
}

export default function RequestDetailLoading() {
  return (
    <div className="space-y-5" aria-hidden="true">
      <OperationalPanel as="div">
        <LabelValueRow>
          <SkeletonTag />
        </LabelValueRow>
        <LabelValueRow>
          <SkeletonLine className="w-28" />
        </LabelValueRow>
        <LabelValueRow>
          <SkeletonLine className="w-24" />
        </LabelValueRow>
      </OperationalPanel>

      <OperationalPanel as="div">
        <OperationalPanelHeader title={<SkeletonLine className="w-32" />} />
        <OperationalPanelBody className="space-y-2">
          <SkeletonLine className="w-full" />
          <SkeletonLine className="w-11/12" />
          <SkeletonLine className="w-3/4" />
        </OperationalPanelBody>
      </OperationalPanel>

      <OperationalPanel as="div">
        <OperationalPanelHeader
          title={<SkeletonLine className="w-28" />}
          action={<Skeleton className="h-7 w-24 rounded-full" />}
        />
        <OperationalItem className="flex items-center gap-3">
          <Skeleton className="size-4 shrink-0" />
          <SkeletonLine className="w-48" />
        </OperationalItem>
      </OperationalPanel>
    </div>
  );
}
