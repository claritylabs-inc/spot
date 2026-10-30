"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import dayjs from "dayjs";
import { Globe } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { typeStyle } from "@/lib/typography";
import { PillButton } from "@/components/ui/pill-button";
import { type Question, type Suggestion, attempt } from "./shared";

const MAX_SOURCES = 3;

const RUN_ERRORS: Record<string, string> = {
  research_unavailable: "research isn't available right now",
  timed_out: "it took too long",
  research_partially_failed: "some questions couldn't be researched",
};

function sourceHost(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.hostname.replace(/^www\./, "")
      : null;
  } catch {
    return null;
  }
}

/** Cited sources, opened in a new tab. Titles are untrusted web text, shown as plain text. */
export function SuggestionSources({
  citations,
  limit = MAX_SOURCES,
}: {
  citations: { url: string; title?: string }[];
  limit?: number;
}) {
  const sources = citations
    .flatMap((citation) => {
      const host = sourceHost(citation.url);
      return host ? [{ ...citation, host }] : [];
    })
    .slice(0, limit);
  if (!sources.length) return null;
  return (
    <ul
      aria-label="Sources"
      className={`flex min-w-0 flex-wrap gap-x-4 gap-y-1 ${typeStyle("caption.default")}`}
    >
      {sources.map((source) => (
        <li key={source.url} className="min-w-0 max-w-full">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            title={source.title}
            className="block truncate text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {source.host}
            {source.title ? ` · ${source.title}` : ""}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Quiet pending suggestion under an unanswered question. */
export function InformationSuggestion({
  question,
  suggestion,
}: {
  question: Question;
  suggestion: Suggestion;
}) {
  const accept = useMutation(api.procurementInformationSuggestions.accept);
  const dismiss = useMutation(api.procurementInformationSuggestions.dismiss);
  const [busy, setBusy] = useState(false);
  function review(work: () => Promise<unknown>) {
    setBusy(true);
    void attempt(work).finally(() => setBusy(false));
  }
  return (
    <div
      role="group"
      aria-label={`Suggested answer: ${question.question.label}`}
      className="space-y-1.5 rounded-lg border border-dashed px-3 py-2"
    >
      <p className={`text-muted-foreground ${typeStyle("caption.default")}`}>
        Suggested from public sources ·{" "}
        {suggestion.confidence === "high" ? "High" : "Medium"} confidence
      </p>
      <p className="whitespace-pre-wrap break-words">{suggestion.answer}</p>
      <SuggestionSources citations={suggestion.citations} />
      <div className="flex flex-wrap items-center gap-2">
        <PillButton
          variant="secondary"
          size="compact"
          disabled={busy}
          onClick={() =>
            review(async () => {
              await accept({
                suggestionId: suggestion.suggestionId,
                previousAnswerId: question.answerId,
              });
              toast.success("Suggestion accepted");
            })
          }
        >
          Accept
        </PillButton>
        <PillButton
          variant="ghost"
          size="compact"
          disabled={busy}
          onClick={() =>
            review(async () => {
              await dismiss({ suggestionId: suggestion.suggestionId });
            })
          }
        >
          Dismiss
        </PillButton>
      </div>
    </div>
  );
}

/** Pending suggestions by question id; skipped while the request is read-only. */
export function useInformationSuggestions(
  requestId: Id<"procurementRequests">,
  skip = false,
) {
  const research = useQuery(
    api.procurementInformationSuggestions.listForRequest,
    skip ? "skip" : { requestId },
  );
  return {
    run: research?.research ?? null,
    suggestions: new Map(
      research?.suggestions.map((suggestion) => [
        suggestion.questionId,
        suggestion,
      ]),
    ),
  };
}

export function researchRunActive(
  run: ReturnType<typeof useInformationSuggestions>["run"],
) {
  return run?.status === "queued" || run?.status === "running";
}

/** Compact latest-run state; "completed" only once the run has actually finished. */
export function InformationResearchStatus({
  requestId,
}: {
  requestId: Id<"procurementRequests">;
}) {
  const { run } = useInformationSuggestions(requestId);
  if (!run) return null;
  const count = `${run.suggestionCount} ${run.suggestionCount === 1 ? "suggestion" : "suggestions"}`;
  const finished = run.completedAt
    ? dayjs(run.completedAt).format("MMM D")
    : "";
  const message =
    run.status === "queued"
      ? "Public research queued…"
      : run.status === "running"
        ? "Researching public sources…"
        : run.status === "failed"
          ? `Public research failed${run.error ? `: ${RUN_ERRORS[run.error] ?? "try again"}` : ""}`
          : run.suggestionCount
            ? `Public research ${run.status === "partial" ? "partly completed" : "completed"} ${finished} · ${count}`
            : `Public research ${run.status === "partial" ? "partly completed" : "completed"} ${finished} · no suggestions`;
  return (
    <p
      role="status"
      className={`text-muted-foreground ${typeStyle("caption.default")}`}
    >
      {message}
    </p>
  );
}

/** Starts a run; the status line and button reflect the queued run, not its result. */
export function ResearchSourcesAction({
  requestId,
}: {
  requestId: Id<"procurementRequests">;
}) {
  const research = useMutation(api.procurementInformationSuggestions.research);
  const { run } = useInformationSuggestions(requestId);
  const [starting, setStarting] = useState(false);
  return (
    <PillButton
      variant="secondary"
      disabled={starting || researchRunActive(run)}
      onClick={() =>
        void attempt(async () => {
          setStarting(true);
          try {
            const result = await research({ requestId });
            if (result.status === "not_needed") toast.info(result.note);
          } finally {
            setStarting(false);
          }
        })
      }
    >
      <Globe className="size-3.5" />
      Research public sources
    </PillButton>
  );
}
