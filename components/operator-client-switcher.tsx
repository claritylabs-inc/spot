"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { PageNavigation } from "@claritylabs-inc/ui/components/app-shell/page-navigation";
import { useCachedOperatorClients } from "@/lib/sync/operator-cached-queries";

const CLIENT_PATH = /^\/operator\/clients\/([^/]+)(?:\/([^/]+))?/;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Plain prev/next arrows (and j/k) that move between clients, keeping the current section. */
export function OperatorClientSwitcher() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useParams<{ clientOrgId?: string }>();
  const clients = useCachedOperatorClients();
  const clientOrgId = params.clientOrgId;
  const section = CLIENT_PATH.exec(pathname)?.[2];

  const index = clients?.findIndex((client) => client._id === clientOrgId) ?? -1;
  const previous = index > 0 ? clients?.[index - 1] : undefined;
  const next = clients && index >= 0 ? clients[index + 1] : undefined;

  const hrefFor = (id: string) =>
    `/operator/clients/${id}${section ? `/${section}` : ""}`;
  const goPrevious = previous ? () => router.push(hrefFor(previous._id)) : null;
  const goNext = next ? () => router.push(hrefFor(next._id)) : null;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.key === "j") goNext?.();
      else if (event.key === "k") goPrevious?.();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  if (!clientOrgId || index < 0) return null;

  return (
    <PageNavigation
      onPrevious={() => goPrevious?.()}
      onNext={() => goNext?.()}
      previousDisabled={!goPrevious}
      nextDisabled={!goNext}
      previousLabel="Previous client (k)"
      nextLabel="Next client (j)"
    />
  );
}
