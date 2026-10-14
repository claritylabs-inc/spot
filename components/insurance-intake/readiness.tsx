"use client";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";
import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { PillButton } from "@/components/ui/pill-button";
export function IntakeReadiness({
  requestId,
  readiness,
  missing,
  readOnly,
}: {
  requestId: Id<"procurementRequests">;
  readiness?: string;
  missing?: string[];
  readOnly: boolean;
}) {
  const update = useMutation(api.requestIntake.setReadiness);
  const [editing, setEditing] = useState(false);
  const [items, setItems] = useState((missing ?? []).join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(value: "needs_information" | "ready_for_market") {
    setBusy(true);
    setError("");
    try {
      await update({
        requestId,
        readiness: value,
        missing: value === "ready_for_market" ? [] : items.split("\n"),
      });
      setEditing(false);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Could not save"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rounded-xl border p-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={`text-wrap-pretty ${typeStyle("body.large")}`}>
          Intake readiness:{" "}
          {(readiness ?? "ready_for_review").replaceAll("_", " ")}
        </h2>
        {!readOnly && (
          <PillButton
            variant="secondary"
            onClick={() => {
              setItems((missing ?? []).join("\n"));
              setEditing(!editing);
            }}
          >
            Review readiness
          </PillButton>
        )}
      </div>
      {missing?.length ? (
        <ul className={`list-disc pl-5 ${typeStyle("body.large")}`}>
          {missing.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className={`text-muted-foreground ${typeStyle("body.large")}`}>
          The application is submitted. Confirm supporting evidence and
          requirements before approaching insurers.
        </p>
      )}
      {editing && (
        <>
          <Field>
            <FieldLabel htmlFor="readiness-missing">
              Outstanding information, one item per line
            </FieldLabel>
            <Textarea
              placeholder="List outstanding information"
              id="readiness-missing"
              className="mt-2"
              value={items}
              onChange={(e) => setItems(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-3">
            <PillButton
              variant="secondary"
              disabled={busy}
              onClick={() => void save("needs_information")}
            >
              Needs information
            </PillButton>
            <PillButton
              disabled={busy || !!items.trim()}
              onClick={() => void save("ready_for_market")}
            >
              Confirm ready for market
            </PillButton>
          </div>
        </>
      )}
      {error && (
        <p
          role="alert"
          className={`text-destructive ${typeStyle("body.large")}`}
        >
          {error}
        </p>
      )}
    </section>
  );
}
