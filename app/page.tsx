"use client";

import { RootLoading } from "@/components/root-loading";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCurrentOrg } from "@/hooks/use-current-org";

export default function RootPage() {
  const router = useRouter();
  const currentOrg = useCurrentOrg();
  const targetHref = !currentOrg
    ? null
    : currentOrg.isBroker
      ? "/broker"
      : currentOrg.org.clientAccessStatus === "active"
        ? "/requests"
        : "/signup";

  useEffect(() => {
    if (!targetHref) return;
    router.replace(targetHref);
  }, [router, targetHref]);

  return <RootLoading />;
}
