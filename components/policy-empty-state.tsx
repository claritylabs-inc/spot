import { FileText } from "lucide-react";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";

/** The page navbar owns upload; the empty state only describes the list. */
export function PolicyEmptyState() {
  return (
    <EmptyStateCard
      icon={<FileText className="size-6" />}
      title="No policies yet"
      description="Upload a policy PDF to get started."
    />
  );
}
