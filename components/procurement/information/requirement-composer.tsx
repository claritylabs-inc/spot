"use client";
import { useState } from "react";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { COVERAGE_OPTIONS } from "@/lib/insurance-intake-details";
import { type IntakeFollowupQuestion } from "@/lib/intake-followups";
import { InlineFieldRow, InlineFieldList } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  type Panel,
  type Question,
  KINDS,
  KIND_LABELS,
  Choice,
  attempt,
} from "./shared";

export function RequirementComposer({
  requestId,
  panel,
  onDone,
  initialQuestionId,
  mode,
}: {
  requestId: Id<"procurementRequests">;
  panel: Panel;
  onDone: () => void;
  initialQuestionId?: Question["_id"];
  mode?: "email";
}) {
  const add = useMutation(api.procurementInformation.addRequirement);
  const extract = useMutation(api.procurementInformationEmail.startExtraction);
  const [outreachId, setOutreachId] = useState<
    Id<"procurementBrokerOutreaches"> | ""
  >("");
  const [reuse, setReuse] = useState<Question["_id"] | "new">(
    initialQuestionId ?? "new",
  );
  const [label, setLabel] = useState("");
  const [kind, setKind] =
    useState<IntakeFollowupQuestion["kind"]>("short_text");
  const [options, setOptions] = useState("");
  const [subject, setSubject] = useState("company");
  const [period, setPeriod] = useState("current");
  const [coverage, setCoverage] = useState("");
  const [currency, setCurrency] = useState(panel.currency);
  const [parentId, setParentId] = useState("");
  const [parentAnswer, setParentAnswer] = useState("Yes");
  const [carrier, setCarrier] = useState("");
  const followKey = `procurement:${requestId}:information:composer:${initialQuestionId ?? mode ?? "new"}`;
  const [threadId, setThreadId] = useFollowedState<Id<"teamEmailThreads"> | "">(
    `${followKey}:thread`,
    "",
  );
  const [messageId, setMessageId] = useFollowedState<
    Id<"teamEmailMessages"> | ""
  >(`${followKey}:message`, "");
  const [quote, setQuote] = useState("");
  const [existing, setExisting] = useState<string | null>(null);
  const [manualEntry, setManualEntry] = useFollowedState(
    `${followKey}:manual`,
    false,
  );
  const [extractionId, setExtractionId] =
    useFollowedState<Id<"procurementInformationExtractions"> | null>(
      `${followKey}:extraction`,
      null,
    );
  const extraction = useQuery(
    api.procurementInformationEmail.extraction,
    extractionId ? { extractionId } : "skip",
  );
  const proposals = extraction?.questions ?? [];
  const extracting = extraction?.status === "running";
  const [busy, setBusy] = useState(false);
  const messages = useQuery(
    api.procurementInformation.messages,
    threadId ? { requestId, threadId } : "skip",
  );
  const selectedMessage = messages?.find((m) => m.id === messageId);
  function resetSource() {
    setMessageId("");
    setQuote("");
    setExtractionId(null);
    setExisting(null);
  }
  return (
    <InlineFieldList>
      <InlineFieldRow label="Provider">
        <Choice
          label="Provider"
          value={outreachId}
          onChange={(v) => {
            setOutreachId(v);
            setThreadId("");
            resetSource();
          }}
          options={panel.outreaches.map((o) => ({
            value: o._id,
            label: o.brokerName,
          }))}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Carrier (if known)">
        <Input
          aria-label="Carrier"
          value={carrier}
          onChange={(e) => setCarrier(e.target.value)}
        />
      </InlineFieldRow>
      <InlineFieldRow
        label={mode === "email" ? "Provider email" : "Source email (optional)"}
      >
        <Choice<Id<"teamEmailThreads"> | "manual">
          label="Source email thread"
          value={threadId || (mode === "email" ? "" : "manual")}
          onChange={(v) => {
            setThreadId(v === "manual" ? "" : v);
            resetSource();
          }}
          options={[
            ...(mode === "email"
              ? []
              : [
                  { value: "manual" as const, label: "Manual / phone request" },
                ]),
            ...panel.threads
              .filter((t) => t.outreachId === outreachId)
              .map((t) => ({ value: t.id, label: t.subject })),
          ]}
        />
      </InlineFieldRow>
      {threadId && (
        <>
          <InlineFieldRow label="Provider message">
            <Choice
              label="Provider message"
              value={messageId}
              onChange={(v) => {
                setMessageId(v);
                setQuote("");
                setExtractionId(null);
              }}
              options={(messages ?? [])
                .filter((m) => m.direction === "inbound")
                .map((m) => ({
                  value: m.id,
                  label: m.text.slice(0, 100) || "Empty message",
                }))}
            />
          </InlineFieldRow>
          {selectedMessage && (
            <InlineFieldRow label="Email text">
              <p className="max-h-64 overflow-y-auto whitespace-pre-wrap">
                {selectedMessage.text}
              </p>
            </InlineFieldRow>
          )}
          <InlineFieldRow label="Exact supporting quote">
            <Textarea
              aria-label="Exact provider quote"
              value={quote}
              onChange={(e) => setQuote(e.target.value)}
            />
          </InlineFieldRow>
          <InlineFieldRow label="Extract questions">
            <PillButton
              disabled={
                !messageId ||
                busy ||
                extracting ||
                extraction?.status === "failed"
              }
              variant="secondary"
              onClick={() => {
                if (!messageId) return;
                void attempt(async () => {
                  setBusy(true);
                  try {
                    const rows = await extract({
                      requestId,
                      messageId,
                    });
                    setExtractionId(rows);
                  } finally {
                    setBusy(false);
                  }
                });
              }}
            >
              {busy || extracting
                ? "Extracting…"
                : "Extract requested information"}
            </PillButton>
          </InlineFieldRow>
          {extraction?.status === "failed" && (
            <InlineFieldRow label="Extraction unavailable">
              <p role="alert">
                We couldn’t extract these questions. You can add them manually;
                this email will not be processed again automatically.
              </p>
              <PillButton
                variant="secondary"
                onClick={() => setManualEntry(true)}
              >
                Add manually
              </PillButton>
            </InlineFieldRow>
          )}
          {extraction?.status === "complete" && !proposals.length && (
            <InlineFieldRow label="No questions found">
              No explicit information requests were found in this message.
            </InlineFieldRow>
          )}
          {proposals.map((p, i) => (
            <InlineFieldRow key={i} label={p.label}>
              <div className="space-y-2">
                <p className="text-muted-foreground">“{p.quote}”</p>
                <PillButton
                  variant="secondary"
                  onClick={() => {
                    setReuse("new");
                    setLabel(p.label);
                    setKind(p.kind);
                    setCurrency(p.currency ?? panel.currency);
                    setOptions(p.options.join("\n"));
                    setSubject(p.subject);
                    setPeriod(p.period);
                    setCoverage(p.coverage);
                    setQuote(p.quote);
                    setExisting(p.existingAnswer);
                  }}
                >
                  Review this question
                </PillButton>
              </div>
            </InlineFieldRow>
          ))}
        </>
      )}
      <InlineFieldRow label="Question">
        <Choice
          label="New or existing question"
          value={reuse}
          onChange={setReuse}
          options={[
            { value: "new", label: "New question" },
            ...panel.questions.map((q) => ({
              value: q._id,
              label: `${q.question.label} · ${q.scope.period}`,
            })),
          ]}
        />
      </InlineFieldRow>
      {reuse === "new" &&
        (mode !== "email" || !!label.trim() || manualEntry) && (
          <>
            <InlineFieldRow label="Client wording">
              <Textarea
                aria-label="Client question"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Input">
              <Choice
                label="Input type"
                value={kind}
                onChange={setKind}
                options={KINDS.map((k) => ({
                  value: k,
                  label: KIND_LABELS[k],
                }))}
              />
            </InlineFieldRow>
            {kind === "currency" && (
              <InlineFieldRow label="Currency">
                <Choice
                  label="Answer currency"
                  value={currency}
                  onChange={setCurrency}
                  options={[
                    "USD",
                    "CAD",
                    "EUR",
                    "GBP",
                    "AUD",
                    "NZD",
                    "CHF",
                    "JPY",
                  ].map((code) => ({ value: code, label: code }))}
                />
              </InlineFieldRow>
            )}
            {kind === "dropdown" && (
              <InlineFieldRow label="Options (one per line)">
                <Textarea
                  aria-label="Dropdown options"
                  value={options}
                  onChange={(e) => setOptions(e.target.value)}
                />
              </InlineFieldRow>
            )}
            <InlineFieldRow label="Coverage">
              <Choice
                label="Coverage"
                value={coverage}
                onChange={setCoverage}
                options={COVERAGE_OPTIONS.map((c) => ({
                  value: c.id,
                  label: c.label,
                }))}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Ask only when">
              <Choice
                label="Prerequisite question"
                value={parentId || "always"}
                onChange={(v) => setParentId(v === "always" ? "" : v)}
                options={[
                  { value: "always", label: "Always" },
                  ...panel.questions
                    .filter((q) => q.question.kind === "yes_no")
                    .map((q) => ({ value: q._id, label: q.question.label })),
                ]}
              />
            </InlineFieldRow>
            {parentId && (
              <InlineFieldRow label="Prerequisite answer">
                <Choice
                  label="Prerequisite answer"
                  value={parentAnswer}
                  onChange={setParentAnswer}
                  options={[
                    { value: "Yes", label: "Yes" },
                    { value: "No", label: "No" },
                  ]}
                />
              </InlineFieldRow>
            )}
            <InlineFieldRow label="Subject">
              <Input
                aria-label="Question subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </InlineFieldRow>
            <InlineFieldRow label="Reporting period">
              <Input
                aria-label="Reporting period"
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              />
            </InlineFieldRow>
          </>
        )}
      {existing && (
        <InlineFieldRow label="Possible existing answer">
          <p>
            {existing} — verify its scope against the accepted application
            before recording it.
          </p>
        </InlineFieldRow>
      )}
      <InlineFieldRow label="">
        <PillButton
          disabled={
            busy ||
            !outreachId ||
            (reuse === "new" && (!label.trim() || !coverage.trim())) ||
            (!!threadId && (!messageId || !quote.trim()))
          }
          onClick={() => {
            if (!outreachId) return;
            void attempt(async () => {
              setBusy(true);
              try {
                await add({
                  requestId,
                  outreachId,
                  questionId: reuse === "new" ? undefined : reuse,
                  question: {
                    id: "provider_question",
                    conditions: parentId
                      ? [{ questionId: parentId, answer: parentAnswer }]
                      : undefined,
                    section: "additional",
                    label,
                    kind,
                    options:
                      kind === "dropdown"
                        ? options
                            .split("\n")
                            .map((s) => s.trim())
                            .filter(Boolean)
                        : [],
                  },
                  scope: {
                    subject,
                    period,
                    coverage,
                    currency: kind === "currency" ? currency : undefined,
                  },
                  carrier: carrier.trim() || undefined,
                  sourceMessageId: messageId || undefined,
                  sourceQuote: quote || undefined,
                });
                setLabel("");
                setExisting(null);
                toast.success("Requirement added");
                onDone();
              } finally {
                setBusy(false);
              }
            });
          }}
        >
          {initialQuestionId ? "Add provider" : "Add question"}
        </PillButton>
      </InlineFieldRow>
    </InlineFieldList>
  );
}
