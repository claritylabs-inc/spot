import { OperationalSkeletonList } from "@claritylabs-inc/ui/components/operational-panel";

export default function CertificatesLoading() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <OperationalSkeletonList rows={4} />
    </div>
  );
}
