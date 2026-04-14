"use client";
import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useEffect, useState } from "react";

import { Check, Loader2, AlertCircle, Circle } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type StepStatus = "pending" | "active" | "completed" | "failed";

interface Step {
  key: string;
  label: string;
  status: StepStatus;
}

// ─── StepIcon ────────────────────────────────────────────────────────────────

function StepIcon({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-blue">
        <Check className="size-4 text-white" strokeWidth={2.5} />
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-brand-blue bg-white">
        <Loader2 className="size-4 animate-spin text-brand-blue" />
      </div>
    );
  }
  if (status === "failed") {
    return (
      <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full bg-red-100">
        <AlertCircle className="size-4 text-red-600" />
      </div>
    );
  }
  // pending
  return (
    <div className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-border bg-white">
      <Circle className="size-3 text-muted-foreground/40" />
    </div>
  );
}

// ─── ProgressBar ─────────────────────────────────────────────────────────────

function ProgressBar({ steps }: { steps: Step[] }) {
  const completed = steps.filter((s) => s.status === "completed").length;
  const pct = steps.length > 0 ? (completed / steps.length) * 100 : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div
        className="h-full rounded-full bg-brand-blue transition-all duration-700 ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

// ─── TimeEstimate ─────────────────────────────────────────────────────────────

const TOTAL_ESTIMATES: Record<string, number> = {
  extraction: 25,
  "re-extraction": 20,
  reindex: 15,
  merge: 30,
};

function TimeEstimate({
  taskType,
  startedAt,
  running,
}: {
  taskType: string;
  startedAt: number;
  running: boolean;
}) {
  const total = TOTAL_ESTIMATES[taskType] ?? 25;
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!running) return;

    const calc = () => {
      const elapsed = (Date.now() - startedAt) / 1000;
      return Math.max(0, Math.round(total - elapsed));
    };

    setRemaining(calc());
    const id = setInterval(() => setRemaining(calc()), 1000);
    return () => clearInterval(id);
  }, [running, startedAt, total]);

  if (!running || remaining === null) return null;

  return (
    <p className="text-sm text-muted-foreground">
      {remaining === 0 ? "Almost there…" : `~${remaining}s remaining`}
    </p>
  );
}

// ─── ResultCard ──────────────────────────────────────────────────────────────

function ResultCard({
  result,
}: {
  result: {
    summary?: string;
    carrier?: string;
    category?: string;
    documentType?: string;
    policyNumber?: string;
    effectiveDate?: string;
    expirationDate?: string;
    errorMessage?: string;
    rechunkedCount?: number;
  };
}) {
  if (result.errorMessage) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
        <p className="text-sm text-red-600">{result.errorMessage}</p>
      </div>
    );
  }

  if (result.rechunkedCount !== undefined) {
    return (
      <div className="rounded-2xl border border-border bg-white p-6 text-center">
        <p className="text-[0.95rem] text-foreground">
          Reindexed{" "}
          <span className="font-medium">{result.rechunkedCount}</span>{" "}
          {result.rechunkedCount === 1 ? "policy" : "policies"}.
        </p>
      </div>
    );
  }

  const pills = [result.category, result.documentType, result.carrier].filter(
    Boolean
  ) as string[];

  return (
    <div className="rounded-2xl border border-border bg-white p-6">
      {/* Pills */}
      {pills.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {pills.map((pill) => (
            <span
              key={pill}
              className="rounded-full bg-secondary px-3 py-1 text-xs font-medium capitalize text-muted-foreground"
            >
              {pill.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      )}

      {/* Policy number + dates */}
      {(result.policyNumber ||
        result.effectiveDate ||
        result.expirationDate) && (
        <div className="mb-4 space-y-1">
          {result.policyNumber && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Policy #</span>{" "}
              {result.policyNumber}
            </p>
          )}
          {result.effectiveDate && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Effective</span>{" "}
              {result.effectiveDate}
            </p>
          )}
          {result.expirationDate && (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Expires</span>{" "}
              {result.expirationDate}
            </p>
          )}
        </div>
      )}

      {/* Summary */}
      {result.summary && (
        <p className="whitespace-pre-line text-[0.95rem] leading-relaxed text-foreground">
          {result.summary}
        </p>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function TrackPage() {
  const params = useParams();
  const token = params.token as string;

  const task = useQuery(api.tasks.getByToken, { token });

  // ── Loading ──
  if (task === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="size-8 animate-spin rounded-full border-3 border-border border-t-foreground" />
      </div>
    );
  }

  // ── Invalid token ──
  if (task === null) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-[440px] text-center">
          <div className="mb-8 flex items-center justify-center">
            <span className="font-logo text-xl tracking-wide text-foreground">
              SPOT
            </span>
          </div>
          <h1 className="mb-3 font-heading text-3xl tracking-tight text-foreground">
            Link not found
          </h1>
          <p className="text-[0.95rem] leading-relaxed text-muted-foreground">
            This progress link isn&apos;t valid. Text Spot to get a new one.
          </p>
        </div>
      </div>
    );
  }

  // ── Derived state ──
  const isRunning = task.status === "running";
  const isCompleted = task.status === "completed";
  const isFailed = task.status === "failed";

  const titleMap: Record<string, { running: string; completed: string; failed: string }> = {
    extraction: {
      running: "Reading your document",
      completed: "Your breakdown is ready",
      failed: "Something went wrong",
    },
    "re-extraction": {
      running: "Re-reading your document",
      completed: "Updated breakdown ready",
      failed: "Something went wrong",
    },
    reindex: {
      running: "Rebuilding search index",
      completed: "Reindex complete",
      failed: "Something went wrong",
    },
    merge: {
      running: "Merging your documents",
      completed: "Your merged breakdown is ready",
      failed: "Something went wrong",
    },
  };

  const titles = titleMap[task.type] ?? titleMap["extraction"];
  const title = isRunning
    ? titles.running
    : isCompleted
      ? titles.completed
      : titles.failed;

  const steps = task.steps as Step[];

  return (
    <div className="flex min-h-dvh flex-col items-center justify-start bg-background px-6 pb-12 pt-16">
      <div className="w-full max-w-[440px]">
        {/* Logo */}
        <div className="mb-10 flex items-center justify-center">
          <span className="font-logo text-xl tracking-wide text-foreground">
            SPOT
          </span>
        </div>

        {/* Title + time estimate */}
        <div className="mb-6 text-center">
          <h1 className="mb-2 font-heading text-3xl tracking-tight text-foreground">
            {title}
          </h1>
          <TimeEstimate
            taskType={task.type}
            startedAt={task.startedAt}
            running={isRunning}
          />
        </div>

        {/* Progress bar */}
        <div className="mb-8">
          <ProgressBar steps={steps} />
        </div>

        {/* Vertical stepper */}
        <div className="relative ml-4 mb-8">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const labelClass =
              step.status === "completed"
                ? "text-foreground"
                : step.status === "active"
                  ? "font-medium text-foreground"
                  : step.status === "failed"
                    ? "text-red-600"
                    : "text-muted-foreground/60";

            return (
              <div key={step.key} className="relative flex gap-4 pb-8 last:pb-0">
                {/* Vertical connector line */}
                {!isLast && (
                  <div className="absolute bottom-0 left-[15px] top-8 w-0.5 bg-border">
                    <div
                      className="h-full w-full bg-brand-blue transition-all duration-500"
                      style={{
                        transform: `scaleY(${step.status === "completed" ? 1 : 0})`,
                        transformOrigin: "top",
                      }}
                    />
                  </div>
                )}
                <StepIcon status={step.status} />
                <div className="flex min-h-8 items-center">
                  <p className={`text-[0.95rem] leading-relaxed ${labelClass}`}>
                    {step.label}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Result card */}
        {(isCompleted || isFailed) && task.result && (
          <div className="mb-8">
            <ResultCard result={task.result} />
          </div>
        )}

        {/* Footer */}
        <p className="mt-2 text-center text-xs text-muted-foreground/70">
          Your documents are encrypted and only used to help you understand your
          coverage.
        </p>
        <div className="mt-6 flex items-center justify-center text-xs text-muted-foreground/50">
          <span>Spot from Clarity Labs</span>
        </div>
      </div>
    </div>
  );
}
