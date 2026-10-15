"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";

export default function OnboardingRoutePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewer = useCachedQuery("onboarding.viewer", api.users.viewer, {});
  const viewerOrg = useCachedQuery("onboarding.viewerOrg", api.orgs.viewerOrg, {});

  useEffect(() => {
    if (viewer === undefined || viewerOrg === undefined) return;

    if (viewer?.onboardingComplete) {
      router.replace("/");
      return;
    }

    const requestedBrokerFlow = searchParams?.get("type") === "broker";
    const orgType = (viewerOrg?.org as { type?: "broker" | "client" } | undefined)?.type;
    const source = searchParams?.get("source");
    const client = searchParams?.get("client");
    const setupParams = new URLSearchParams();
    if (source === "vendor-invite") setupParams.set("source", source);
    if (client) setupParams.set("client", client);
    const setupHref = setupParams.size > 0
      ? `/onboarding/setup?${setupParams.toString()}`
      : "/onboarding/setup";

    if (requestedBrokerFlow || orgType === "broker") {
      router.replace("/onboarding/broker");
      return;
    }

    router.replace(source === "vendor-invite" ? setupHref : "/signup");
  }, [viewer, viewerOrg, router, searchParams]);

  return (
    <div className="min-h-screen grid place-items-center bg-background text-foreground">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
