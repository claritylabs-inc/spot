"use client";

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import dayjs from "dayjs";
import { Plus, Trash2 } from "lucide-react";

import { Input } from "@claritylabs-inc/ui/components/input";
import { Label } from "@claritylabs-inc/ui/components/label";
import { PillButton } from "@/components/ui/pill-button";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  cachedQueryArgsKey,
  cachedQueryCollectionFor,
  cachedQueryResult,
} from "@/lib/sync/use-cached-query";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { FormSection } from "@claritylabs-inc/ui/components/form-section";

import {
  SourceEvidenceButton,
  collectSourceSpanIds,
  sourceSpanIdsFrom,
  usePolicySourceSpans,
} from "./source-provenance";
import { typeStyle } from "@/lib/typography";

function stringValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value : "";
}

function parseMoneyInput(value: unknown): number | undefined {
  if (typeof value === "number")
    return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  const match = normalized.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!match) return undefined;
  const parsed = Number.parseFloat(match[0].replace(/,/g, ""));
  return Number.isFinite(parsed)
    ? Math.round((parsed + Number.EPSILON) * 100) / 100
    : undefined;
}

function formatMoneyInput(value: unknown) {
  const amount = parseMoneyInput(value);
  if (amount === undefined) return stringValue(value);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function normalizeDateInput(value: unknown) {
  const raw = stringValue(value);
  if (!raw || raw.toLowerCase() === "unknown") return "";
  const parsed = dayjs(
    raw,
    [
      "YYYY-MM-DD",
      "MM/DD/YYYY",
      "M/D/YYYY",
      "YYYY/M/D",
      "MMM D, YYYY",
      "MMMM D, YYYY",
    ],
    true,
  );
  return parsed.isValid() ? parsed.format("YYYY-MM-DD") : "";
}

function dateValueFromInput(value: string) {
  const parsed = dayjs(value, "YYYY-MM-DD", true);
  return parsed.isValid() ? parsed.format("MM/DD/YYYY") : "";
}

function normalizeCoverageRows(value: unknown): EditableCoverage[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        ...row,
        name: stringValue(row.name),
        limit: stringValue(row.limit) || undefined,
        limitAmount:
          typeof row.limitAmount === "number"
            ? row.limitAmount
            : parseMoneyInput(row.limit),
        deductible: stringValue(row.deductible) || undefined,
        deductibleAmount:
          typeof row.deductibleAmount === "number"
            ? row.deductibleAmount
            : parseMoneyInput(row.deductible),
        coverageCode: stringValue(row.coverageCode) || undefined,
        originalContent: stringValue(row.originalContent) || undefined,
        sourceSpanIds: sourceSpanIdsFrom(row),
      };
    })
    .filter((row) => row.name.trim());
}

function normalizePremiumRows(value: unknown): EditablePremiumLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        line: stringValue(row.line),
        amount: stringValue(row.amount),
        amountValue:
          typeof row.amountValue === "number"
            ? row.amountValue
            : parseMoneyInput(row.amount),
        sourceSpanIds: sourceSpanIdsFrom(row),
      };
    })
    .filter((row) => row.line.trim() || row.amount.trim());
}

function normalizeTaxRows(value: unknown): EditableTaxFee[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        name: stringValue(row.name),
        amount: stringValue(row.amount),
        amountValue:
          typeof row.amountValue === "number"
            ? row.amountValue
            : parseMoneyInput(row.amount),
        type: stringValue(row.type) || undefined,
        description: stringValue(row.description) || undefined,
        sourceSpanIds: sourceSpanIdsFrom(row),
      };
    })
    .filter((row) => row.name.trim() || row.amount.trim());
}

function withoutFlushedFields(
  current: Record<string, unknown>,
  flushed: Record<string, unknown>,
) {
  const next = { ...current };
  for (const [key, value] of Object.entries(flushed)) {
    if (JSON.stringify(current[key]) === JSON.stringify(value)) delete next[key];
  }
  return next;
}

type EditableCoverage = {
  name: string;
  limit?: string;
  limitAmount?: number;
  deductible?: string;
  deductibleAmount?: number;
  coverageCode?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type EditablePremiumLine = {
  line: string;
  amount: string;
  amountValue?: number;
  sourceSpanIds?: string[];
};

type EditableTaxFee = {
  name: string;
  amount: string;
  amountValue?: number;
  type?: string;
  description?: string;
  sourceSpanIds?: string[];
};

export function PolicyBreakdownEditor({
  policy,
  readOnly,
  open,
  onOpenChange,
}: {
  policy: Record<string, unknown> & { _id: Id<"policies"> };
  readOnly: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const updateExtractedFields = useMutation(api.policies.updateExtractedFields);
  const [pendingFields, setPendingFields] = useState<Record<string, unknown>>(
    {},
  );
  const [draft, setDraft] = useState(() => ({
    carrier: stringValue(policy.carrier),
    policyNumber: stringValue(policy.policyNumber),
    insuredName: stringValue(policy.insuredName),
    effectiveDate: stringValue(policy.effectiveDate),
    expirationDate: stringValue(policy.expirationDate),
    premium: stringValue(policy.premium),
    premiumBreakdown: normalizePremiumRows(policy.premiumBreakdown),
    taxesAndFees: normalizeTaxRows(policy.taxesAndFees),
    coverages: normalizeCoverageRows(policy.coverages),
  }));

  const savePolicyFields = useCallback(
    async (args: { id: Id<"policies">; fields: Record<string, unknown> }) => {
      await updateExtractedFields(args);
    },
    [updateExtractedFields],
  );

  const policyFieldAutoSave = useLocalFirstAutoSave({
    mutationName: `policy.updateExtractedFields.${policy._id}`,
    args: {
      id: policy._id,
      fields: pendingFields,
    },
    valueKey: JSON.stringify({ id: policy._id, draft }),
    enabled: !readOnly,
    canSave: !readOnly,
    delayMs: 500,
    applyLocal: (store, args) => {
      for (const cacheName of ["policies.get", "policies.getSummary"]) {
        const collection = cachedQueryCollectionFor<Record<
          string,
          unknown
        > | null>(cacheName);
        const argsKey = cachedQueryArgsKey({ id: args.id });
        const current = store.getCollection(collection, argsKey)?.[0]?.value;
        if (!current || typeof current !== "object") continue;
        void store.upsertCollection(collection, argsKey, [
          cachedQueryResult(argsKey, {
            ...current,
            ...args.fields,
          }),
        ]);
      }
    },
    flush: savePolicyFields,
    onFlushed: (_result, args) =>
      setPendingFields((current) => withoutFlushedFields(current, args.fields)),
    errorMessage: "Policy fields could not be saved.",
  });

  const allSourceSpanIds = useMemo(
    () => collectSourceSpanIds(policy),
    [policy],
  );
  const sourceSpans = usePolicySourceSpans(policy._id, allSourceSpanIds);

  const saveFields = useCallback(
    (fields: Record<string, unknown>) => {
      if (readOnly) return;
      setPendingFields((current) => ({ ...current, ...fields }));
    },
    [readOnly],
  );

  const setScalar = (key: keyof typeof draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    const moneyKey = key === "premium";
    const amount = moneyKey ? parseMoneyInput(value) : undefined;
    saveFields({
      [key]: value,
      ...(key === "premium" && amount !== undefined
        ? { premiumAmount: amount }
        : {}),
    });
  };

  const setDateScalar = (
    key: "effectiveDate" | "expirationDate",
    value: string,
  ) => {
    setScalar(key, dateValueFromInput(value));
  };

  const formatScalarMoney = (key: "premium") => {
    const formatted = formatMoneyInput(draft[key]);
    if (formatted !== draft[key]) setScalar(key, formatted);
  };

  const updatePremiumBreakdown = (next: EditablePremiumLine[]) => {
    const rows = next.filter((row) => row.line.trim() || row.amount.trim());
    setDraft((current) => ({ ...current, premiumBreakdown: next }));
    saveFields({
      premiumBreakdown: rows.map((row) => ({
        line: row.line.trim() || "Premium line",
        amount: row.amount.trim(),
        ...(row.sourceSpanIds?.length
          ? { sourceSpanIds: row.sourceSpanIds }
          : {}),
        ...(parseMoneyInput(row.amount) !== undefined
          ? { amountValue: parseMoneyInput(row.amount) }
          : {}),
      })),
    });
  };

  const updateTaxesAndFees = (next: EditableTaxFee[]) => {
    const rows = next.filter((row) => row.name.trim() || row.amount.trim());
    setDraft((current) => ({ ...current, taxesAndFees: next }));
    saveFields({
      taxesAndFees: rows.map((row) => ({
        name: row.name.trim() || "Fee",
        amount: row.amount.trim(),
        ...(parseMoneyInput(row.amount) !== undefined
          ? { amountValue: parseMoneyInput(row.amount) }
          : {}),
        ...(row.type?.trim() ? { type: row.type.trim() } : {}),
        ...(row.sourceSpanIds?.length
          ? { sourceSpanIds: row.sourceSpanIds }
          : {}),
        ...(row.description?.trim()
          ? { description: row.description.trim() }
          : {}),
      })),
    });
  };

  const updateCoverages = (next: EditableCoverage[]) => {
    const rows = next.filter((row) => row.name.trim());
    setDraft((current) => ({ ...current, coverages: next }));
    saveFields({
      coverages: rows.map((row) => ({
        ...row,
        name: row.name.trim(),
        ...(row.limit?.trim() ? { limit: row.limit.trim() } : {}),
        ...(parseMoneyInput(row.limit) !== undefined
          ? { limitAmount: parseMoneyInput(row.limit) }
          : {}),
        ...(row.deductible?.trim()
          ? { deductible: row.deductible.trim() }
          : {}),
        ...(parseMoneyInput(row.deductible) !== undefined
          ? { deductibleAmount: parseMoneyInput(row.deductible) }
          : {}),
        ...(row.coverageCode?.trim()
          ? { coverageCode: row.coverageCode.trim() }
          : {}),
        ...(row.originalContent?.trim()
          ? { originalContent: row.originalContent.trim() }
          : {}),
      })),
    });
  };

  if (readOnly) return null;

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen || Object.keys(pendingFields).length === 0) {
      onOpenChange(nextOpen);
      return;
    }
    void policyFieldAutoSave.saveNow().then((saved) => {
      if (saved) onOpenChange(false);
    });
  }

  const fields = [
    { key: "carrier", label: "Carrier", kind: "text" },
    { key: "policyNumber", label: "Policy number", kind: "text" },
    { key: "insuredName", label: "Named insured", kind: "text" },
    { key: "effectiveDate", label: "Effective date", kind: "date" },
    { key: "expirationDate", label: "Expiration date", kind: "date" },
    { key: "premium", label: "Premium", kind: "money" },
  ] as const;

  return (
    <SettingsDrawer
      open={open}
      onOpenChange={handleOpenChange}
      title="Edit extracted fields"
    >
      <AutoSaveStatus status={policyFieldAutoSave.status} />
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-3">
          {fields.map(({ key, label, kind }) => (
            <div key={key} className="space-y-1.5">
              <Label className={`text-muted-foreground ${typeStyle("label.field")}`}>{label}</Label>
              <Input
                type={kind === "date" ? "date" : "text"}
                inputMode={kind === "money" ? "decimal" : undefined}
                value={
                  kind === "date" ? normalizeDateInput(draft[key]) : draft[key]
                }
                onChange={(event) => {
                  if (kind === "date") {
                    setDateScalar(key, event.target.value);
                    return;
                  }
                  setScalar(key, event.target.value);
                }}
                onBlur={() => {
                  if (kind === "money") formatScalarMoney(key);
                }}
              />
            </div>
          ))}
        </div>

        <FormSection
          title="Premium breakdown"
          action={
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updatePremiumBreakdown([
                  ...draft.premiumBreakdown,
                  { line: "", amount: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          }
        >
          <div className="space-y-2">
            {draft.premiumBreakdown.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1fr_160px_auto] gap-2"
              >
                <Input
                  placeholder="Line"
                  value={row.line}
                  onChange={(event) => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = { ...row, line: event.target.value };
                    updatePremiumBreakdown(next);
                  }}
                />
                <Input
                  placeholder="Amount"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = { ...row, amount: event.target.value };
                    updatePremiumBreakdown(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.premiumBreakdown];
                    next[index] = {
                      ...row,
                      amount: formatMoneyInput(row.amount),
                    };
                    updatePremiumBreakdown(next);
                  }}
                />
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updatePremiumBreakdown(
                      draft.premiumBreakdown.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </FormSection>

        <FormSection
          title="Taxes and fees"
          action={
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updateTaxesAndFees([
                  ...draft.taxesAndFees,
                  { name: "", amount: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          }
        >
          <div className="space-y-2">
            {draft.taxesAndFees.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1fr_140px_120px_auto] gap-2"
              >
                <Input
                  placeholder="Name"
                  value={row.name}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, name: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                />
                <Input
                  placeholder="Amount"
                  inputMode="decimal"
                  value={row.amount}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, amount: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.taxesAndFees];
                    next[index] = {
                      ...row,
                      amount: formatMoneyInput(row.amount),
                    };
                    updateTaxesAndFees(next);
                  }}
                />
                <Input
                  placeholder="Type"
                  value={row.type ?? ""}
                  onChange={(event) => {
                    const next = [...draft.taxesAndFees];
                    next[index] = { ...row, type: event.target.value };
                    updateTaxesAndFees(next);
                  }}
                />
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updateTaxesAndFees(
                      draft.taxesAndFees.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </FormSection>

        <FormSection
          title="Coverages"
          action={
            <PillButton
              size="compact"
              variant="secondary"
              onClick={() =>
                updateCoverages([
                  ...draft.coverages,
                  { name: "", limit: "", deductible: "" },
                ])
              }
            >
              <Plus className="size-3.5" />
              Add
            </PillButton>
          }
        >
          <div className="space-y-2">
            {draft.coverages.map((row, index) => (
              <div
                key={index}
                className="grid grid-cols-1 sm:grid-cols-[1.2fr_1fr_1fr_auto_auto] gap-2"
              >
                <Input
                  placeholder="Coverage"
                  value={row.name}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, name: event.target.value };
                    updateCoverages(next);
                  }}
                />
                <Input
                  placeholder="Limit"
                  inputMode="decimal"
                  value={row.limit ?? ""}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, limit: event.target.value };
                    updateCoverages(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.coverages];
                    next[index] = {
                      ...row,
                      limit: formatMoneyInput(row.limit),
                    };
                    updateCoverages(next);
                  }}
                />
                <Input
                  placeholder="Deductible"
                  inputMode="decimal"
                  value={row.deductible ?? ""}
                  onChange={(event) => {
                    const next = [...draft.coverages];
                    next[index] = { ...row, deductible: event.target.value };
                    updateCoverages(next);
                  }}
                  onBlur={() => {
                    const next = [...draft.coverages];
                    next[index] = {
                      ...row,
                      deductible: formatMoneyInput(row.deductible),
                    };
                    updateCoverages(next);
                  }}
                />
                <div className="flex items-center gap-2">
                  <SourceEvidenceButton
                    sourceSpanIds={row.sourceSpanIds}
                    sourceSpans={sourceSpans}
                  />
                </div>
                <PillButton
                  size="compact"
                  variant="icon"
                  label="Remove"
                  onClick={() =>
                    updateCoverages(
                      draft.coverages.filter((_, i) => i !== index),
                    )
                  }
                >
                  <Trash2 className="size-3.5" />
                </PillButton>
              </div>
            ))}
          </div>
        </FormSection>
      </div>
    </SettingsDrawer>
  );
}
