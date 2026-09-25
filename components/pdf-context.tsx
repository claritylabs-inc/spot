"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";

export type PdfHighlightBox = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  coordinateWidth?: number;
  coordinateHeight?: number;
};

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
  const [fileUrl, setFileUrlState] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [isPdfOpen, setIsPdfOpen] = useState(false);
  const [highlightedPage, setHighlightedPage] = useState<number | null>(null);
  const [highlightBoxes, setHighlightBoxes] = useState<PdfHighlightBox[]>([]);
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
  }, []);

  const navigateToPage = useCallback(
    (page: number) => {
      if (!fileUrl) return;
      const clamped = Math.max(1, Math.min(page, numPages || Infinity));
      setCurrentPage(clamped);
      setIsPdfOpen(true);
      setHighlightedPage(clamped);
      setHighlightBoxes([]);
    },
    [fileUrl, numPages],
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
    [],
  );

  const togglePdf = useCallback(() => setIsPdfOpen((v) => !v), []);
  const openPdf = useCallback(() => setIsPdfOpen(true), []);
  const closePdf = useCallback(() => setIsPdfOpen(false), []);

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
