import { PolicyDetailSkeleton } from "@/app/policies/[id]/policy-detail-skeleton";

export default function OperatorClientPolicyDetailLoading() {
  return (
    <div className="space-y-4">
      <PolicyDetailSkeleton />
    </div>
  );
}
