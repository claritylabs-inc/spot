"use client";

import { createContext, useContext } from "react";
import type { PresentationReference } from "@/lib/chat-presentation";

export type PresentationContextValue = {
  references: Map<string, PresentationReference>;
  disabled: boolean;
  audience?: "operator" | "client";
  onFollowUp?: (message: string) => Promise<void>;
  closeRecord?: () => void;
  openRecord: (reference: PresentationReference, detail?: string) => void;
};

export const PresentationContext =
  createContext<PresentationContextValue | null>(null);

export function usePresentation() {
  const context = useContext(PresentationContext);
  if (!context) throw new Error("Chat presentation context is missing");
  return context;
}
