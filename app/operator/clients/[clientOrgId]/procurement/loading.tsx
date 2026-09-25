import {
  SkeletonLine,
  SkeletonTag,
  TableSkeleton,
} from "@/components/route-skeletons";

export default function OperatorClientProcurementLoading() {
  return (
    <div className="w-full space-y-6" aria-hidden="true">
      <TableSkeleton
        rows={5}
        columns={[
          {
            className: "w-[52%] min-w-64",
            cell: <SkeletonLine className="w-56 max-w-full" />,
          },
          { className: "w-[18%]", cell: <SkeletonTag className="w-24" /> },
          { className: "w-[18%]", cell: <SkeletonLine className="w-24" /> },
          { className: "w-[12%]", cell: <SkeletonLine className="w-20" /> },
        ]}
      />
    </div>
  );
}
