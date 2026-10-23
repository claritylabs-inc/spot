"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";

import { useFollowedState } from "@/hooks/use-followed-state";
import type { PdfHighlightBox } from "@claritylabs-inc/ui/components/pdf-viewer";
export type { PdfHighlightBox } from "@claritylabs-inc/ui/components/pdf-viewer";

interface PdfContextValue {
  currentPage: number;
  numPages: number;
  setNumPages: (n: number) => void;
  navigateToPage: (page: number) => void;
  isPdfOpen: boolean;
  togglePdf: () => void;
  openPdf: () => void;
  closePdf: () => void;
  fileUrl: string | null;
  /** Pre-load a URL without opening the viewer */
  setFileUrl: (url: string) => void;
  highlightedPage: number | null;
  highlightBoxes: PdfHighlightBox[];
  /** Imperatively open a PDF by URL, optionally jumping to a page */
  openWithUrl: (
    url: string,
    page?: number,
    highlightBoxes?: PdfHighlightBox[],
  ) => void;
}

const PdfContext = createContext<PdfContextValue | null>(null);

/** `resetKey` changes (e.g. the route) close the viewer before children render. */
export function PdfProvider({
  children,
  resetKey,
}: {
  children: React.ReactNode;
  resetKey?: string;
}) {
  const [sharedUrl, setSharedUrl] = useFollowedState<string | null>(
    "shell:pdf:url",
    null,
  );
  // blob: and data: URLs (unsent attachments) only exist in this browser.
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const fileUrl = localUrl ?? sharedUrl;
  const setFileUrlState = useCallback(
    (url: string | null) => {
      const local = url !== null && /^(blob|data):/.test(url);
      setLocalUrl(local ? url : null);
      setSharedUrl(local ? null : url);
    },
    [setSharedUrl],
  );
  const [currentPage, setCurrentPage] = useFollowedState("shell:pdf:page", 1);
  const [numPages, setNumPages] = useState(0);
  const [isPdfOpen, setIsPdfOpen] = useFollowedState("shell:pdf:open", false);
  const [highlightedPage, setHighlightedPage] = useFollowedState<number | null>(
    "shell:pdf:highlighted-page",
    null,
  );
  const [highlightBoxes, setHighlightBoxes] = useFollowedState<
    PdfHighlightBox[]
  >("shell:pdf:highlight-boxes", []);
  const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
  if (appliedResetKey !== resetKey) {
    setAppliedResetKey(resetKey);
    setFileUrlState(null);
    setIsPdfOpen(false);
    setCurrentPage(1);
    setNumPages(0);
    setHighlightedPage(null);
    setHighlightBoxes([]);
  }

  const setFileUrl = useCallback((url: string) => {
    setFileUrlState(url);
  }, [setFileUrlState]);

  const navigateToPage = useCallback(
    (page: number) => {
      if (!fileUrl) return;
      const clamped = Math.max(1, Math.min(page, numPages || Infinity));
      setCurrentPage(clamped);
      setIsPdfOpen(true);
      setHighlightedPage(clamped);
      setHighlightBoxes([]);
    },
    [
      fileUrl,
      numPages,
      setCurrentPage,
      setHighlightBoxes,
      setHighlightedPage,
      setIsPdfOpen,
    ],
  );

  const openWithUrl = useCallback(
    (url: string, page?: number, boxes?: PdfHighlightBox[]) => {
      setFileUrlState(url);
      setIsPdfOpen(true);
      setCurrentPage(page ?? 1);
      setHighlightedPage(page ?? null);
      setHighlightBoxes(boxes ?? []);
      setNumPages(0);
    },
    [
      setCurrentPage,
      setFileUrlState,
      setHighlightBoxes,
      setHighlightedPage,
      setIsPdfOpen,
    ],
  );

  const togglePdf = useCallback(
    () => setIsPdfOpen((v) => !v),
    [setIsPdfOpen],
  );
  const openPdf = useCallback(() => setIsPdfOpen(true), [setIsPdfOpen]);
  const closePdf = useCallback(() => setIsPdfOpen(false), [setIsPdfOpen]);

  const value = useMemo(
    () => ({
      currentPage,
      numPages,
      setNumPages,
      navigateToPage,
      isPdfOpen,
      togglePdf,
      openPdf,
      closePdf,
      fileUrl,
      setFileUrl,
      highlightedPage,
      highlightBoxes,
      openWithUrl,
    }),
    [
      currentPage,
      numPages,
      setNumPages,
      navigateToPage,
      isPdfOpen,
      togglePdf,
      openPdf,
      closePdf,
      fileUrl,
      setFileUrl,
      highlightedPage,
      highlightBoxes,
      openWithUrl,
    ],
  );

  return <PdfContext.Provider value={value}>{children}</PdfContext.Provider>;
}

const NOOP_PDF: PdfContextValue = {
  currentPage: 1,
  numPages: 0,
  setNumPages: () => {},
  navigateToPage: () => {},
  isPdfOpen: false,
  togglePdf: () => {},
  openPdf: () => {},
  closePdf: () => {},
  fileUrl: null,
  setFileUrl: () => {},
  highlightedPage: null,
  highlightBoxes: [],
  openWithUrl: () => {},
};

export function usePdf() {
  const ctx = useContext(PdfContext);
  return ctx ?? NOOP_PDF;
}
