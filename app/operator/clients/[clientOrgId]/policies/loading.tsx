import {
  SkeletonLine,
  SkeletonTag,
  TableSkeleton,
} from "@/components/route-skeletons";

export default function OperatorClientPoliciesLoading() {
  return (
    <div className="w-full space-y-6" aria-hidden="true">
      <TableSkeleton
        className="min-w-[900px]"
        columns={[
          { className: "w-[22%]", cell: <SkeletonLine className="w-36" /> },
          { className: "w-[16%]", cell: <SkeletonLine className="w-24" /> },
          { className: "w-[20%]", cell: <SkeletonLine className="w-36" /> },
          { className: "w-[12%]", cell: <SkeletonLine className="w-16" /> },
          { className: "w-[12%]", cell: <SkeletonLine className="w-16" /> },
          { className: "w-[10%]", cell: <SkeletonTag /> },
          { className: "w-[18%]", cell: <SkeletonLine className="w-32" /> },
        ]}
      />
    </div>
  );
}
