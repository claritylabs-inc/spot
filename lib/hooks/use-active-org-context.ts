// URL-aware active org context for surfaces that can operate on a selected
// client org instead of only the viewer's own membership org.

"use client";

import { api } from "@/convex/_generated/api";
import { useSearchParams } from "next/navigation";
import { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { useIsStoppingOperatorImpersonation } from "@/lib/operator-impersonation-stop-state";
import type { FeatureFlagMap } from "@/convex/lib/featureFlags";

export type ActiveOrgContext = {
  orgId: Id<"organizations">;
  orgType: "broker" | "client";
  accessType: "member" | "connected_client";
  role: "admin" | "member" | undefined;
  orgName: string;
  slug: string | undefined;
  featureFlags: FeatureFlagMap | undefined;
  isOperatorImpersonation: boolean;
  isReadOnlyImpersonation: boolean;
};

type OperatorContext = {
  activeImpersonation?: {
    targetOrgOperatorStatus?: "onboarding" | "live" | "lost" | "churned";
  } | null;
};

/**
 * Returns the active org context.
 *
 * If the URL contains ?org=<orgId>, that org is used for broker/client
 * navigation. Otherwise this falls back to the viewer's first org membership.
 *
 * Returns `null` while loading, `undefined` if the user has no active org.
 * Use `@/hooks/use-current-org` for ordinary app-shell and settings surfaces
 * that only need the viewer's current membership org summary.
 */
export function useActiveOrgContext(): ActiveOrgContext | null | undefined {
  const searchParams = useSearchParams();
  const isStoppingOperatorImpersonation = useIsStoppingOperatorImpersonation();
  const orgIdFromUrl = searchParams.get("org") as Id<"organizations"> | null;
  const viewer = useCachedQuery(
    "hooks.currentOrg.viewer",
    api.users.viewer,
    {},
  );
  const operatorContext = useCachedQuery(
    "hooks.currentOrg.operator.current",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.current,
    viewer?.accountKind === "operator" ? {} : "skip",
  ) as OperatorContext | undefined;

  const orgData = useCachedQuery(
    orgIdFromUrl ? "orgs.viewerOrg.byUrl" : "orgs.viewerOrg",
    api.orgs.viewerOrg,
    orgIdFromUrl ? { orgId: orgIdFromUrl } : {},
  );

  if (viewer === undefined) return null;
  if (viewer?.accountKind === "operator") {
    if (isStoppingOperatorImpersonation) return undefined;
    if (operatorContext === undefined) return null;
    if (!operatorContext?.activeImpersonation) return undefined;
  }

  if (orgData === undefined) return null;
  if (!orgData) return undefined;

  const org = orgData.org as {
    _id: Id<"organizations">;
    name: string;
    type?: string;
    slug?: string;
    featureFlags?: FeatureFlagMap;
  };

  const membership = orgData.membership as {
    role: "admin" | "member";
  };

  const orgType: "broker" | "client" =
    (org.type as "broker" | "client") ?? "client";

  // viewerOrg only returns an org when the viewer can access it. Cross-org
  // access type can be widened here when the server starts returning it.
  const accessType: "member" | "connected_client" = "member";
  const isOperatorImpersonation =
    viewer?.accountKind === "operator" &&
    Boolean(operatorContext?.activeImpersonation);
  const isReadOnlyImpersonation =
    isOperatorImpersonation &&
    operatorContext?.activeImpersonation?.targetOrgOperatorStatus !==
      "onboarding";

  return {
    orgId: org._id,
    orgType,
    accessType,
    role: membership.role,
    orgName: org.name,
    slug: org.slug,
    featureFlags: org.featureFlags,
    isOperatorImpersonation,
    isReadOnlyImpersonation,
  };
}
