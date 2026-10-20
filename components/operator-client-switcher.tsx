"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCachedOperatorClients } from "@/lib/sync/operator-cached-queries";

const CLIENT_PATH = /^\/operator\/clients\/([^/]+)(?:\/([^/]+))?/;

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

/** Prev/next chevrons (and j/k) that move between clients, keeping the current section. */
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

  const buttonClass =
    "flex size-6 items-center justify-center rounded-md text-foreground/80 transition-colors hover:bg-foreground/5 hover:text-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/30";
  return (
    <span className="ml-1 flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        className={buttonClass}
        disabled={!goPrevious}
        onClick={() => goPrevious?.()}
        aria-label="Previous client (k)"
        title="Previous client (k)"
      >
        <ChevronLeft className="size-4" />
      </button>
      <button
        type="button"
        className={buttonClass}
        disabled={!goNext}
        onClick={() => goNext?.()}
        aria-label="Next client (j)"
        title="Next client (j)"
      >
        <ChevronRight className="size-4" />
      </button>
    </span>
  );
}
