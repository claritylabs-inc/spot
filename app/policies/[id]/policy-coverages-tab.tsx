"use client";

import { FadeIn } from "@claritylabs-inc/ui/components/fade-in";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import type { Id } from "@/convex/_generated/dataModel";
import { buildCoverageBreakdown } from "@/convex/lib/coverageBreakdown";

import { CoverageBreakdownCards } from "./policy-coverage-breakdown";
import { PolicyCoveredAssets } from "./policy-covered-assets";
import { typeStyle } from "@/lib/typography";

export function PolicyCoveragesTab({
  policy,
  fileUrl,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  fileUrl?: string | null;
}) {
  const breakdown = buildCoverageBreakdown(policy);

  return (
    <FadeIn when={true} staggerIndex={1} duration={0.5}>
      {breakdown.all.length > 0 || breakdown.schedules.length > 0 ? (
        <>
          <PolicyCoveredAssets schedules={breakdown.schedules} />
          <CoverageBreakdownCards
            breakdown={breakdown}
            policyId={policy._id}
            fileUrl={fileUrl}
            showCoveredAssetSchedules={false}
          />
        </>
      ) : (
        <OperationalPanel as="div">
          <OperationalPanelBody className={`px-4 py-8 text-center text-muted-foreground ${typeStyle("body.default")}`}>
            No coverage information was found in the extracted policy.
          </OperationalPanelBody>
        </OperationalPanel>
      )}
    </FadeIn>
  );
}
