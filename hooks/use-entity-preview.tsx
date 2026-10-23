"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";

import { useFollowedState } from "@/hooks/use-followed-state";

export interface EntityPreview {
  type: "policy";
  id: string;
  page?: number; // optional page from ?page= param
  citedSections?: string[]; // section/endorsement titles or form numbers referenced in the agent answer
  citedCoverageNames?: string[]; // structured coverage names referenced in the agent answer
  citedSourceSpanIds?: string[]; // exact source evidence spans to highlight in the PDF
}

interface EntityPreviewContextValue {
  preview: EntityPreview | null;
  openPreview: (entity: EntityPreview) => void;
  closePreview: () => void;
}

const Ctx = createContext<EntityPreviewContextValue>({
  preview: null,
  openPreview: () => {},
  closePreview: () => {},
});

/** `resetKey` changes (e.g. the route) close the preview before children render. */
export function EntityPreviewProvider({
  children,
  resetKey,
}: {
  children: React.ReactNode;
  resetKey?: string;
}) {
  const [preview, setPreview] = useFollowedState<EntityPreview | null>(
    "shell:entity-preview",
    null,
  );
  const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
  if (appliedResetKey !== resetKey) {
    setAppliedResetKey(resetKey);
    setPreview(null);
  }

  const openPreview = useCallback((entity: EntityPreview) => {
    setPreview(entity);
  }, [setPreview]);

  const closePreview = useCallback(() => {
    setPreview(null);
  }, [setPreview]);

  const value = useMemo(
    () => ({ preview, openPreview, closePreview }),
    [preview, openPreview, closePreview],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useEntityPreview() {
  return useContext(Ctx);
}
