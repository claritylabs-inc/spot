"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { PdfHighlightBox } from "@/components/pdf-context";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import {
  ChevronUp,
  ChevronDown,
  ZoomIn,
  ZoomOut,
  Loader2,
  AlertTriangle,
  PanelRightClose,
} from "lucide-react";
import { PillButton } from "@/components/ui/pill-button";
import { FileDownloadButton } from "@/components/ui/file-download-button";
import { typeStyle } from "@/lib/typography";

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

interface PdfViewerProps {
  fileUrl: string;
  currentPage: number;
  highlightedPage: number | null;
  highlightBoxes?: PdfHighlightBox[];
  onPageChange: (page: number) => void;
  onDocumentLoad: (numPages: number) => void;
  /** When provided, renders close + download buttons in the toolbar */
  onClose?: () => void;
}

const RENDER_BUFFER = 2;
const PAGE_GAP = 12; // mb-3 = 0.75rem = 12px

/** Clear scrollingToPage flag using scrollend event with fallback */
function clearScrollFlag(
  container: HTMLElement,
  scrollingRef: React.MutableRefObject<number | null>,
) {
  let cleared = false;
  const cleanup = () => {
    if (cleared) return;
    cleared = true;
    scrollingRef.current = null;
    container.removeEventListener("scrollend", onScrollEnd);
  };
  const onScrollEnd = () => cleanup();
  container.addEventListener("scrollend", onScrollEnd, { once: true });
  setTimeout(cleanup, 2000);
}

type PageDims = Map<number, { width: number; height: number }>;

/** Compute scaled page height from intrinsic dimensions */
function getPageHeight(
  page: number,
  pageWidth: number | undefined,
  dims: PageDims,
): number {
  if (!pageWidth) return 792;
  const d = dims.get(page);
  if (!d) return 792;
  return (d.height / d.width) * pageWidth;
}

/** Compute scroll offset to the top of a target page using cached dimensions */
function computeScrollOffset(
  targetPage: number,
  pageWidth: number,
  dims: PageDims,
  gap: number,
): number {
  let offset = 0;
  for (let p = 1; p < targetPage; p++) {
    offset += getPageHeight(p, pageWidth, dims) + gap;
  }
  // The container has padding at the top, and pages start after that padding.
  // scrollTop=0 means we're at the top of the padded area, so no need to add padding.
  return offset;
}

/** Find which page is visible at a given scroll position */
function findVisiblePage(
  scrollTop: number,
  viewportHeight: number,
  numPages: number,
  pageWidth: number,
  dims: PageDims,
  gap: number,
): number {
  const scrollCenter = scrollTop + viewportHeight / 3; // bias toward top
  let offset = 0;
  for (let p = 1; p <= numPages; p++) {
    const h = getPageHeight(p, pageWidth, dims);
    const pageTop = offset;
    const pageBottom = offset + h;
    // If scroll center is within this page, it's the visible one
    if (scrollCenter >= pageTop && scrollCenter < pageBottom + gap) {
      return p;
    }
    offset = pageBottom + gap;
  }
  return numPages;
}

export function PdfViewer({
  fileUrl,
  currentPage,
  highlightedPage,
  highlightBoxes = [],
  onPageChange,
  onDocumentLoad,
  onClose,
}: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [scale, setScale] = useState(1);
  const [containerWidth, setContainerWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [visiblePage, setVisiblePage] = useState(1);
  const [pageDimensions, setPageDimensions] = useState<PageDims>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const scrollingToPage = useRef<number | null>(null);
  const visiblePageRef = useRef(1);
  const pageWidthRef = useRef<number | undefined>(undefined);
  const [pageInput, setPageInput] = useState(String(currentPage));

  // Keep ref in sync
  useEffect(() => {
    visiblePageRef.current = visiblePage;
  }, [visiblePage]);

  // Measure container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setContainerWidth(width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Scroll to page when currentPage changes (from click or toolbar)
  useEffect(() => {
    if (!numPages || !containerRef.current) return;
    const container = containerRef.current;
    const pw = pageWidthRef.current;

    if (!pw || pageDimensions.size === 0) {
      // Dimensions not loaded yet — try DOM-based fallback
      const pageEl = pageRefs.current.get(currentPage);
      if (pageEl) {
        const elRect = pageEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const paddingTop =
          parseFloat(getComputedStyle(container).paddingTop) || 0;
        const targetTop =
          elRect.top - containerRect.top + container.scrollTop - paddingTop;
        const diff = Math.abs(container.scrollTop - targetTop);
        if (diff > 10) {
          scrollingToPage.current = currentPage;
          container.scrollTo({ top: targetTop, behavior: "auto" });
          clearScrollFlag(container, scrollingToPage);
        }
      }
    } else {
      // Use arithmetic offset
      const targetTop = computeScrollOffset(
        currentPage,
        pw,
        pageDimensions,
        PAGE_GAP,
      );
      const diff = Math.abs(container.scrollTop - targetTop);
      if (diff > 10) {
        scrollingToPage.current = currentPage;
        const viewportH = container.clientHeight;
        const isDistant = diff > viewportH * 2;

        if (isDistant) {
          // Instant jump for distant pages, then micro-correct
          container.scrollTo({ top: targetTop, behavior: "instant" });
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              // Micro-correct using actual DOM position if the page is now rendered
              const pageEl = pageRefs.current.get(currentPage);
              if (pageEl) {
                const elRect = pageEl.getBoundingClientRect();
                const containerRect = container.getBoundingClientRect();
                const paddingTop =
                  parseFloat(getComputedStyle(container).paddingTop) || 0;
                const corrected =
                  elRect.top -
                  containerRect.top +
                  container.scrollTop -
                  paddingTop;
                const corrDiff = Math.abs(container.scrollTop - corrected);
                if (corrDiff > 2) {
                  container.scrollTo({ top: corrected, behavior: "instant" });
                }
              }
              scrollingToPage.current = null;
            });
          });
        } else {
          container.scrollTo({ top: targetTop, behavior: "auto" });
          clearScrollFlag(container, scrollingToPage);
        }
      }
    }

    const inputTimer = setTimeout(() => {
      setPageInput(String(currentPage));
      setVisiblePage(currentPage);
    }, 0);
    return () => clearTimeout(inputTimer);
  }, [currentPage, numPages, pageDimensions]);

  // Detect visible page on manual scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !numPages) return;

    const handleScroll = () => {
      if (scrollingToPage.current !== null) return;
      const pw = pageWidthRef.current;

      if (pw && pageDimensions.size > 0) {
        // Arithmetic-based detection
        const page = findVisiblePage(
          container.scrollTop,
          container.clientHeight,
          numPages,
          pw,
          pageDimensions,
          PAGE_GAP,
        );
        if (page !== visiblePageRef.current) {
          visiblePageRef.current = page;
          setVisiblePage(page);
          setPageInput(String(page));
        }
      } else {
        // DOM-based fallback
        const scrollCenter = container.scrollTop + container.clientHeight / 3;
        let closest = 1;
        let closestDist = Infinity;
        for (const [page, el] of pageRefs.current) {
          const elTop =
            el.getBoundingClientRect().top -
            container.getBoundingClientRect().top +
            container.scrollTop;
          const dist = Math.abs(elTop - scrollCenter);
          if (dist < closestDist) {
            closestDist = dist;
            closest = page;
          }
        }
        if (closest !== visiblePageRef.current) {
          visiblePageRef.current = closest;
          setVisiblePage(closest);
          setPageInput(String(closest));
        }
      }
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [numPages, pageDimensions]);

  // Zoom preservation: when scale changes, keep current page in view
  const prevScaleRef = useRef(scale);
  useEffect(() => {
    if (prevScaleRef.current !== scale && numPages > 0) {
      const pageToRestore = visiblePageRef.current;
      prevScaleRef.current = scale;

      // Suppress scroll detection during zoom transition
      scrollingToPage.current = pageToRestore;

      const container = containerRef.current;
      const pw = pageWidthRef.current;
      if (!container || !pw) {
        scrollingToPage.current = null;
        return;
      }

      // Scroll immediately with current dimensions if available
      if (pageDimensions.size > 0) {
        const targetTop = computeScrollOffset(
          pageToRestore,
          pw,
          pageDimensions,
          PAGE_GAP,
        );
        container.scrollTo({ top: targetTop, behavior: "instant" });
      }

      // After layout settles, micro-correct using actual DOM positions
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!container) return;
          if (pageDimensions.size > 0) {
            const targetTop = computeScrollOffset(
              pageToRestore,
              pw,
              pageDimensions,
              PAGE_GAP,
            );
            container.scrollTo({ top: targetTop, behavior: "instant" });
          } else {
            const pageEl = pageRefs.current.get(pageToRestore);
            if (pageEl) {
              const elRect = pageEl.getBoundingClientRect();
              const containerRect = container.getBoundingClientRect();
              const paddingTop =
                parseFloat(getComputedStyle(container).paddingTop) || 0;
              const targetTop =
                elRect.top -
                containerRect.top +
                container.scrollTop -
                paddingTop;
              container.scrollTo({ top: targetTop, behavior: "instant" });
            }
          }
          scrollingToPage.current = null;
        });
      });
    }
  }, [scale, numPages, pageDimensions]);

  const handleDocumentLoad = useCallback(
    (pdf: {
      numPages: number;
      getPage: (n: number) => Promise<{
        getViewport: (opts: { scale: number }) => {
          width: number;
          height: number;
        };
      }>;
    }) => {
      const n = pdf.numPages;
      setNumPages(n);
      setError(null);
      onDocumentLoad(n);
      // Pre-fetch page dimensions from PDF metadata
      (async () => {
        const dims: PageDims = new Map();
        await Promise.all(
          Array.from({ length: n }, (_, i) =>
            pdf.getPage(i + 1).then((page) => {
              const vp = page.getViewport({ scale: 1 });
              dims.set(i + 1, { width: vp.width, height: vp.height });
            }),
          ),
        );
        setPageDimensions(dims);
      })();
    },
    [onDocumentLoad],
  );

  const handleLoadError = useCallback(() => {
    setError("Failed to load PDF");
  }, []);

  // Navigate via toolbar buttons or page input
  const goToPage = useCallback(
    (page: number) => {
      const clamped = Math.max(1, Math.min(page, numPages));
      onPageChange(clamped);
    },
    [numPages, onPageChange],
  );

  const handlePageInputSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const page = parseInt(pageInput, 10);
    if (!isNaN(page) && page >= 1 && page <= numPages) {
      goToPage(page);
    } else {
      setPageInput(String(currentPage));
    }
  };

  const zoomIn = () => setScale((s) => Math.min(s + 0.25, 3));
  const zoomOut = () => setScale((s) => Math.max(s - 0.25, 0.5));

  const pageWidth =
    containerWidth > 0 ? (containerWidth - 24) * scale : undefined;
  // Keep ref in sync with computed pageWidth (outside of render body — using layout effect)
  // We use a layout effect here so the ref is updated before paint
  useEffect(() => {
    pageWidthRef.current = pageWidth;
  });

  const displayPage = visiblePage;

  const shouldRenderPage = (page: number) => {
    return Math.abs(page - displayPage) <= RENDER_BUFFER;
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Toolbar — single unified bar */}
      <div className="flex items-center gap-0.5 px-2 h-12 border-b border-border shrink-0">
        {onClose && (
          <PillButton
            size="compact"
            variant="icon"
            onClick={onClose}
            label="Close"
          >
            <PanelRightClose className="w-4 h-4" />
          </PillButton>
        )}

        {onClose && <div className="w-px h-4 bg-foreground/8 mx-1" />}

        {/* Page navigation */}
        <PillButton
          size="compact"
          variant="icon"
          onClick={() => goToPage(displayPage - 1)}
          label="Previous page"
          disabled={displayPage <= 1}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </PillButton>
        <PillButton
          size="compact"
          variant="icon"
          onClick={() => goToPage(displayPage + 1)}
          label="Next page"
          disabled={displayPage >= numPages}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </PillButton>
        <form
          onSubmit={handlePageInputSubmit}
          className="flex items-center gap-1 ml-0.5"
        >
          <input
            type="text"
            aria-label="Page"
            value={pageInput}
            onChange={(e) => setPageInput(e.target.value)}
            className={`w-9 text-center border border-input rounded px-1 py-0.5 bg-popover focus:outline-none focus:border-border-focus ${typeStyle("control.input")}`}
          />
          <span
            className={`text-muted-foreground/40 ${typeStyle("caption.default")}`}
          >
            / {numPages || "—"}
          </span>
        </form>

        <div className="flex-1" />

        {/* Zoom */}
        <PillButton
          size="compact"
          variant="icon"
          onClick={zoomOut}
          label="Zoom out"
          disabled={scale <= 0.5}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </PillButton>
        <span
          className={`text-muted-foreground/40 w-10 text-center ${typeStyle("data.numeric")}`}
        >
          {Math.round(scale * 100)}%
        </span>
        <PillButton
          size="compact"
          variant="icon"
          onClick={zoomIn}
          label="Zoom in"
          disabled={scale >= 3}
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </PillButton>

        {onClose && (
          <>
            <div className="w-px h-4 bg-foreground/8 mx-1" />
            <FileDownloadButton
              href={fileUrl}
              fileName="document.pdf"
              iconOnly
            />
          </>
        )}
      </div>

      {/* PDF content */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-auto bg-neutral-100/80 dark:bg-neutral-900/80 p-3 -webkit-overflow-scrolling-touch"
        style={{
          overscrollBehavior: "contain",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
        }}
      >
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
            <AlertTriangle className="w-8 h-8 text-red-400" />
            <p className={`${typeStyle("body.default")}`}>{error}</p>
            <button
              type="button"
              onClick={() => {
                setError(null);
              }}
              className={`text-blue-600 hover:underline ${typeStyle("control.buttonCompact")}`}
            >
              Retry
            </button>
          </div>
        ) : (
          <Document
            file={fileUrl}
            onLoadSuccess={handleDocumentLoad}
            onLoadError={handleLoadError}
            loading={
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            }
          >
            {Array.from({ length: numPages }, (_, i) => i + 1).map((page) => {
              const h = getPageHeight(page, pageWidth, pageDimensions);
              const pageHighlightBoxes = highlightBoxes.filter(
                (box) => box.page === page,
              );
              const intrinsicDims = pageDimensions.get(page);
              return (
                <div
                  key={page}
                  ref={(el) => {
                    if (el) pageRefs.current.set(page, el);
                    else pageRefs.current.delete(page);
                  }}
                  data-page={page}
                  className="mb-3 last:mb-0 mx-auto relative"
                  style={{ width: pageWidth ? `${pageWidth}px` : "100%" }}
                >
                  {/* Highlight overlay */}
                  {highlightedPage === page && (
                    <div
                      className="absolute inset-0 z-10 pointer-events-none"
                      style={{
                        boxShadow: "inset 0 0 0 2px rgba(59, 130, 246, 0.5)",
                        backgroundColor: "rgba(59, 130, 246, 0.04)",
                      }}
                    />
                  )}
                  {pageHighlightBoxes.map((box, index) => {
                    const coordinateWidth =
                      box.coordinateWidth ??
                      intrinsicDims?.width ??
                      pageWidth ??
                      1;
                    const coordinateHeight =
                      box.coordinateHeight ?? intrinsicDims?.height ?? h;
                    const left = (box.x / coordinateWidth) * 100;
                    const top = (box.y / coordinateHeight) * 100;
                    const width = (box.width / coordinateWidth) * 100;
                    const height = (box.height / coordinateHeight) * 100;
                    return (
                      <div
                        key={`${page}:${index}:${box.x}:${box.y}`}
                        className="absolute z-20 pointer-events-none rounded-[2px] border border-sky-500/70 bg-sky-400/18 shadow-[0_0_0_1px_rgba(255,255,255,0.65)]"
                        style={{
                          left: `${left}%`,
                          top: `${top}%`,
                          width: `${width}%`,
                          height: `${height}%`,
                        }}
                      />
                    );
                  })}
                  {shouldRenderPage(page) ? (
                    <Page
                      pageNumber={page}
                      width={pageWidth}
                      renderAnnotationLayer={false}
                      loading={
                        <div
                          className="flex items-center justify-center bg-white"
                          style={{ height: h, width: pageWidth }}
                        >
                          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground/40" />
                        </div>
                      }
                    />
                  ) : (
                    <div
                      className="bg-white"
                      style={{ height: h, width: pageWidth }}
                    />
                  )}
                </div>
              );
            })}
          </Document>
        )}
      </div>
    </div>
  );
}
