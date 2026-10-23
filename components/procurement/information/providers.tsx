"use client";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { type Panel } from "./shared";

export function InformationProviders({
  panel,
  questionId,
}: {
  panel: Panel;
  questionId: string;
}) {
  const requirements = panel.requirements.filter(
    (requirement) => requirement.questionId === questionId,
  );
  return (
    <>
      {Array.from(new Set(requirements.map((r) => r.outreachId))).map(
        (outreachId) => {
          const provider = panel.outreaches.find((o) => o._id === outreachId);
          const requirement = requirements.find(
            (r) => r.outreachId === outreachId,
          )!;
          return (
            <span
              key={outreachId}
              className="relative inline-flex min-w-0 items-center"
            >
              <OrgBrandIcon
                name={provider?.brokerName}
                iconUrl={provider?.iconUrl}
                website={provider?.website}
                size="xs"
                className="absolute right-full mr-2"
              />
              <span>
                {provider?.brokerName ?? "Provider"}
                {requirement.carrier ? ` · ${requirement.carrier}` : ""}
              </span>
            </span>
          );
        },
      )}
    </>
  );
}
