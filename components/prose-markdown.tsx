"use client";

import { createElement, useMemo } from "react";
import Markdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { slackMrkdwnToMarkdown } from "@/lib/slack-mrkdwn";
import {
  remarkConfidence,
  CONFIDENCE_LEVEL_META,
  type ConfidenceLevel,
} from "@/lib/confidence";
import { typeStyle, type TypographyRole } from "@/lib/typography";

/**
 * Shared base styles for markdown-rendered content.
 * Uses Tailwind descendant selectors so they work regardless of
 * which remark plugins are active.
 */
export const PROSE_MARKDOWN_STYLES =
  `max-w-none ${typeStyle("prose.default")} ` +
  "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_ul]:my-3 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-3 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:mt-8 [&_h1]:mb-4 [&_h1:first-child]:mt-0 " +
  "[&_h2]:mt-6 [&_h2]:mb-3 [&_h2:first-child]:mt-0 " +
  "[&_h3]:mt-4 [&_h3]:mb-2 [&_h3:first-child]:mt-0 " +
  "[&_h4]:mt-4 [&_h4]:mb-2 [&_h4:first-child]:mt-0 " +
  "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border-emphasized [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground " +
  "[&_hr]:my-3 [&_hr]:border-input " +
  "[&_code]:bg-foreground/[0.04] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded " +
  "[&_pre]:my-3 [&_pre]:overflow-x-auto " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:wrap-normal " +
  "[&_th]:text-left [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:border-b [&_th]:border-border-emphasized [&_th]:bg-foreground/[0.03] [&_th]:text-muted-foreground " +
  "[&_td]:px-2.5 [&_td]:py-1.5 [&_td]:border-b [&_td]:border-border [&_td]:align-top [&_tr:last-child_td]:border-b-0 " +
  "[&_thead]:align-bottom";

/** Compact variant for quoted/reply text */
const COMPACT_STYLES =
  `max-w-none ${typeStyle("prose.compact")} ` +
  "[&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 " +
  "[&_ul]:my-1 [&_ul]:pl-5 [&_ul]:list-disc " +
  "[&_ol]:my-1 [&_ol]:pl-5 [&_ol]:list-decimal " +
  "[&_li]:my-0.5 " +
  "[&_h1]:mt-2 [&_h1]:mb-0.5 " +
  "[&_h2]:mt-2 [&_h2]:mb-0.5 " +
  "[&_h3]:mt-1.5 [&_h3]:mb-0.5 " +
  "[&_h4]:mt-1 [&_h4]:mb-0.5 " +
  "[&_blockquote]:my-1.5 [&_blockquote]:border-l-2 [&_blockquote]:border-border-emphasized [&_blockquote]:pl-2.5 [&_blockquote]:text-muted-foreground " +
  "[&_pre]:my-2 [&_pre]:overflow-x-auto " +
  "[&_hr]:my-2 [&_hr]:border-input";

export type ProseMarkdownProps = {
  children: string;
  className?: string;
  /** Source syntax to normalize before rendering (default: Markdown). */
  sourceFormat?: "markdown" | "slack-mrkdwn";
  /** Use compact spacing for quoted/reply content */
  compact?: boolean;
  /** Apply a shared heading role while preserving authored heading levels. */
  headingRole?: Extract<TypographyRole, `heading.${string}`>;
  /** Enable GFM tables (default: false) */
  gfm?: boolean;
  /** Convert soft line-breaks to <br> (default: false) */
  breaks?: boolean;
  /**
   * Render `[[g|i|u:...]]` confidence markers (default: false). Used for agent
   * chat answers. By default only low-confidence (unverified) phrases are
   * tinted; set `confidenceFullView` to reveal the full grounded/inferred
   * breakdown.
   */
  flagConfidence?: boolean;
  /** Tint every confidence level, not just always-visible low-confidence ones. */
  confidenceFullView?: boolean;
  /** Extra react-markdown component overrides */
  components?: Components;
  /** Optional transforms of the rendered document, such as packet section cards. */
  rehypePlugins?: Options["rehypePlugins"];
};

/** Tailwind tint per confidence level — kept subtle so prose stays readable. */
const CONFIDENCE_TINT: Record<ConfidenceLevel, string> = {
  grounded:
    "bg-emerald-400/12 decoration-emerald-500/40 dark:bg-emerald-400/15",
  inferred: "bg-amber-400/15 decoration-amber-500/45 dark:bg-amber-400/15",
  unverified: "bg-rose-400/18 decoration-rose-500/50 dark:bg-rose-400/20",
};

/** Levels that stay highlighted even when the full view is collapsed. */
const ALWAYS_VISIBLE_LEVELS: ReadonlySet<ConfidenceLevel> = new Set([
  "unverified",
]);

function isConfidenceLevel(value: unknown): value is ConfidenceLevel {
  return value === "grounded" || value === "inferred" || value === "unverified";
}

/**
 * Build the `<mark>` renderer for confidence phrases. In the collapsed view
 * only always-visible levels are tinted; other phrases render as plain text.
 */
function makeConfidenceComponents(fullView: boolean): Components {
  return {
    mark: ({ children, ...props }) => {
      const rawLevel = (props as Record<string, unknown>)["data-level"];
      const level: ConfidenceLevel = isConfidenceLevel(rawLevel)
        ? rawLevel
        : "inferred";
      if (!fullView && !ALWAYS_VISIBLE_LEVELS.has(level)) {
        return <>{children}</>;
      }
      const meta = CONFIDENCE_LEVEL_META[level];
      return (
        <mark
          className={cn(
            "rounded-[3px] text-foreground underline decoration-dotted underline-offset-2",
            CONFIDENCE_TINT[level],
          )}
          title={`${meta.label}: ${meta.description}`}
        >
          {children}
        </mark>
      );
    },
  };
}

const COLLAPSED_CONFIDENCE_COMPONENTS = makeConfidenceComponents(false);
const FULL_CONFIDENCE_COMPONENTS = makeConfidenceComponents(true);
/**
 * Unified markdown renderer used across Spot.
 *
 * Handles table styling, heading sizes, list spacing, code blocks, etc.
 * in one place so every surface stays consistent.
 */
/** Default table wrapper — horizontal scroll + rounded border */
const defaultGfmComponents: Components = {
  table: ({ children }) => (
    <div className="table-scrollbar my-3 max-w-full overflow-x-auto rounded-md border border-border">
      <table
        className={`w-full border-collapse ${typeStyle("caption.default")}`}
      >
        {children}
      </table>
    </div>
  ),
};

function makeHeadingComponents(
  role: NonNullable<ProseMarkdownProps["headingRole"]>,
): Components {
  const components: Components = {};
  for (const tag of ["h1", "h2", "h3", "h4", "h5", "h6"] as const) {
    components[tag] = ({ node, className, ...props }) => {
      void node;
      return createElement(tag, {
        ...props,
        "data-prose-heading": "",
        className: cn(typeStyle(role), className),
      });
    };
  }
  return components;
}

function useMarkdownComponents({
  components,
  confidenceFullView,
  flagConfidence,
  gfm,
  headingRole,
}: Pick<
  ProseMarkdownProps,
  "components" | "confidenceFullView" | "flagConfidence" | "gfm" | "headingRole"
>) {
  return useMemo(
    () => ({
      ...(headingRole ? makeHeadingComponents(headingRole) : null),
      ...(gfm ? defaultGfmComponents : null),
      ...(flagConfidence
        ? confidenceFullView
          ? FULL_CONFIDENCE_COMPONENTS
          : COLLAPSED_CONFIDENCE_COMPONENTS
        : null),
      ...components,
    }),
    [components, confidenceFullView, flagConfidence, gfm, headingRole],
  );
}

export function ProseMarkdown({
  children,
  className,
  sourceFormat = "markdown",
  compact = false,
  headingRole,
  gfm = false,
  breaks = false,
  flagConfidence = false,
  confidenceFullView = false,
  components,
  rehypePlugins,
}: ProseMarkdownProps) {
  const source = useMemo(
    () =>
      sourceFormat === "slack-mrkdwn"
        ? slackMrkdwnToMarkdown(children)
        : children,
    [children, sourceFormat],
  );
  const plugins = useMemo(() => {
    const next = [];
    if (gfm) next.push(remarkGfm);
    if (breaks) next.push(remarkBreaks);
    if (flagConfidence) next.push(remarkConfidence);
    return next;
  }, [breaks, flagConfidence, gfm]);
  const mergedComponents = useMarkdownComponents({
    components,
    confidenceFullView,
    flagConfidence,
    gfm,
    headingRole,
  });

  return (
    <div
      data-prose=""
      className={cn(
        compact ? COMPACT_STYLES : PROSE_MARKDOWN_STYLES,
        "min-w-0 wrap-break-word wrap-anywhere",
        className,
      )}
    >
      <Markdown
        remarkPlugins={plugins}
        rehypePlugins={rehypePlugins}
        components={mergedComponents}
      >
        {source}
      </Markdown>
    </div>
  );
}

export const PROSE_MARKDOWN_COMPACT_STYLES = COMPACT_STYLES;
