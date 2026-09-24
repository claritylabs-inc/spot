"use client";

import { Fragment, useMemo, useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { usePdf } from "@/components/pdf-context";
import { ProseMarkdown } from "@/components/prose-markdown";
import {
  Table as UiTable,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import {
  OperationalPanel,
  OperationalPanelHeader,
} from "@claritylabs-inc/ui/components/operational-panel";
import { lobLabel, policyLobCodes } from "@/convex/lib/linesOfBusiness";
import {
  formatCarrierLegalEntityNames,
  readCarrierIdentity,
  sameCarrierIdentityName,
  type CarrierIdentity,
} from "@/convex/lib/carrierIdentity";
import type { Id } from "@/convex/_generated/dataModel";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  formatDisplayDate,
  formatDisplayPolicyPeriod,
} from "@/lib/date-format";
import {
  SourceEvidenceButton,
  collectSourceSpanIds,
  sourceSpanIdsFrom,
  usePolicySourceSpans,
  type SourceSpanDoc,
} from "./source-provenance";
import { typeStyle } from "@/lib/typography";

// ─── Internal types for policy document data ──────────────────────────────────

type PolicySubsection = {
  sectionNumber?: string;
  title?: string;
  content: string;
  pageNumber?: number;
  documentNodeId?: string;
  sourceSpanIds?: string[];
};

type PolicySection = {
  type: string;
  title?: string;
  sectionNumber?: string;
  content: string;
  pageStart: number;
  pageEnd?: number;
  subsections?: PolicySubsection[];
  documentNodeId?: string;
  sourceSpanIds?: string[];
  sourceTextHash?: string;
};

type DocumentOutlineNode = {
  id: string;
  nodeId?: string;
  title?: string;
  originalTitle?: string;
  type?: string;
  label?: string;
  sectionNumber?: string;
  pageStart?: number;
  pageEnd?: number;
  formNumber?: string;
  formTitle?: string;
  excerpt?: string;
  content?: string;
  sourceSpanIds?: string[];
  children?: DocumentOutlineNode[];
  metadata?: Record<string, unknown>;
  hasChildren?: boolean;
  order?: number;
};

type DocumentMetadata = {
  tableOfContents?: Array<{
    title?: string;
    level?: number;
    pageStart?: number;
    pageEnd?: number;
    documentNodeId?: string;
    sourceSpanIds?: string[];
  }>;
  pageMap?: Array<{
    page?: number;
    label?: string;
    formNumber?: string;
    formTitle?: string;
    sectionTitle?: string;
    extractorNames?: string[];
    sourceSpanIds?: string[];
  }>;
};

type ContactEntry = {
  name?: string;
  title?: string;
  type?: string;
  phone?: string;
  fax?: string;
  email?: string;
  hours?: string;
  address?: string;
};

type PolicyExclusion = {
  name?: string;
  title?: string;
  content?: string;
  isAbsolute?: boolean;
  buybackAvailable?: boolean;
  buybackEndorsement?: string;
  appliesTo?: string | string[];
  formNumber?: string;
  pageNumber?: number;
  pageStart?: number;
};

type PolicyCondition = {
  name?: string;
  title?: string;
  content?: string;
  conditionType?: string;
  keyValues?: { key: string; value: string }[];
  pageNumber?: number;
};

type PolicyEndorsement = {
  title?: string;
  name?: string;
  formNumber?: string;
  editionDate?: string;
  effectiveDate?: string;
  premiumImpact?: string;
  endorsementType?: string;
  content?: string;
  pageStart?: number;
};

type FeeEntry = {
  name: string;
  amount?: string;
  type?: string;
  description?: string;
  sourceSpanIds?: string[];
};

type PolicyFee = {
  content?: string;
  pageNumber?: number;
  fees?: FeeEntry[];
};

type CoverageEntry = {
  name?: string;
  coverageSourceContext?: string;
  coverageCode?: string;
  limit?: string;
  limitType?: string;
  deductible?: string;
  formNumber?: string;
  pageNumber?: number;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type DefinitionEntry = {
  term?: string;
  definition?: string;
  pageNumber?: number;
  formNumber?: string;
  formTitle?: string;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type CoveredReasonEntry = {
  coverageName?: string;
  reasonNumber?: string;
  title?: string;
  content?: string;
  conditions?: string[];
  exceptions?: string[];
  appliesTo?: string[];
  pageNumber?: number;
  formNumber?: string;
  formTitle?: string;
  sectionRef?: string;
  originalContent?: string;
  sourceSpanIds?: string[];
};

type DeclarationField = {
  field?: string;
  value?: string;
  section?: string;
  pageNumber?: number;
  pageStart?: number;
  sourceSpanIds?: string[];
};

type FormInventoryEntry = {
  formNumber?: string;
  editionDate?: string;
  title?: string;
  formType?: string;
  pageStart?: number;
  pageEnd?: number;
  sourceSpanIds?: string[];
};

type SupplementaryFact = {
  key?: string;
  value?: string;
  subject?: string;
  context?: string;
  sourceSpanIds?: string[];
};

type PremiumLine = {
  line?: string;
  amount?: string;
  sourceSpanIds?: string[];
};

type RegulatoryDetail = { label: string; value: string };

type RegulatoryContext = {
  content: string;
  pageNumber?: number;
  jurisdiction?: string;
  regulatoryBody?: string;
  governingLaw?: string;
  details?: RegulatoryDetail[];
  sourceSpanIds?: string[];
};

type ClaimsContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
  processSteps?: string[];
  reportingTimeLimit?: string;
  sourceSpanIds?: string[];
};

type ComplaintContact = {
  content: string;
  pageNumber?: number;
  contacts?: ContactEntry[];
  sourceSpanIds?: string[];
};

type PolicyDocument = {
  carrier?: string;
  carrierIdentity?: CarrierIdentity;
  carrierLegalName?: string;
  security?: string;
  mga?: string;
  generalAgent?: { agencyName?: string; licenseNumber?: string };
  insurer?: { naicNumber?: string };
  producer?: { agencyName?: string; licenseNumber?: string };
  policyNumber?: string;
  insuredName?: string;
  effectiveDate?: string;
  expirationDate?: string;
  policyTermType?: string;
  linesOfBusiness?: string[];
  coverages?: CoverageEntry[];
  premium?: string;
  taxesAndFees?: FeeEntry[];
  premiumBreakdown?: PremiumLine[];
  limits?: Record<string, unknown>;
  deductibles?: Record<string, unknown>;
  declarations?: { fields?: DeclarationField[] } | Record<string, unknown>;
  formInventory?: FormInventoryEntry[];
  supplementaryFacts?: SupplementaryFact[];
  sections?: PolicySection[];
  definitions?: DefinitionEntry[];
  coveredReasons?: CoveredReasonEntry[];
  endorsements?: PolicyEndorsement[];
  costsAndFees?: PolicyFee;
  exclusions?: (PolicyExclusion | string)[];
  conditions?: PolicyCondition[];
  claimsContact?: ClaimsContact;
  complaintContact?: ComplaintContact;
  regulatoryContext?: RegulatoryContext;
  documentMetadata?: DocumentMetadata;
  documentOutline?: DocumentOutlineNode[];
  sourceTreeStatus?: string;
  operationalProfile?: unknown;
};

// ─── Shared sub-components (moved from page.tsx) ─────────────────────────────

function PageRef({ page }: { page: number }) {
  const pdf = usePdf();

  if (!pdf.fileUrl) {
    return (
      <span className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground/60 ${typeStyle("caption.medium")}`}>
        p.{page}
      </span>
    );
  }

  return (
    <span
      role="button"
      tabIndex={0}
      onClick={(e) => {
        e.stopPropagation();
        pdf.navigateToPage(page);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          pdf.navigateToPage(page);
        }
      }}
      className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground/60 hover:bg-blue-100 hover:text-blue-600 transition-colors ${typeStyle("caption.medium")}`}
    >
      p.{page}
    </span>
  );
}

function DocContent({ children }: { children: string }) {
  return (
    <ProseMarkdown gfm className={`text-foreground ${typeStyle("body.default")}`}>
      {children}
    </ProseMarkdown>
  );
}

function formatStructuredLabel(value?: string | null) {
  if (!value) return null;
  const acronyms = new Set(["dba", "fein", "vin", "naic"]);
  return value
    .replace(/\bmga\b/gi, "general agent")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d)/g, "$1 $2")
    .replace(/(\d)([A-Za-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (acronyms.has(lower)) return lower.toUpperCase();
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}

function stringifyValue(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value))
    return value.map(stringifyValue).filter(Boolean).join(", ");
  return JSON.stringify(value);
}

function objectEntries(value?: Record<string, unknown>) {
  if (!value) return [] as { label: string; value: string }[];
  return Object.entries(value)
    .map(([key, raw]) => ({
      label: formatStructuredLabel(key) ?? key,
      value: stringifyValue(raw),
    }))
    .filter((entry) => entry.value);
}

function compactRows(rows: unknown[]) {
  return rows.filter(
    (row): row is DataRow =>
      typeof row === "object" &&
      row !== null &&
      "label" in row &&
      "value" in row &&
      Boolean(row.label && row.value),
  );
}

function useTopLevelSourceNodes(
  policyId: Id<"policies"> | undefined,
  allowOperatorAccess?: boolean,
) {
  return useCachedQuery(
    "sourceNodes.listOutlineByPolicy.policy-detail.v3",
    api.sourceNodes.listOutlineByPolicy,
    policyId ? { policyId, allowOperatorAccess } : "skip",
  ) as DocumentOutlineNode[] | undefined;
}

function useSourceNodeChildren(
  policyId: Id<"policies"> | undefined,
  parentNodeId: string | undefined,
  enabled: boolean,
  allowOperatorAccess?: boolean,
) {
  return useCachedQuery(
    "sourceNodes.listChildrenByPolicyAndParentNodeId.policy-detail.v5",
    api.sourceNodes.listChildrenByPolicyAndParentNodeId,
    policyId && parentNodeId && enabled
      ? { policyId, parentNodeId, allowOperatorAccess }
      : "skip",
  ) as DocumentOutlineNode[] | undefined;
}

function sourceNodeId(node: DocumentOutlineNode) {
  return node.nodeId ?? node.id;
}

function hasSourceNodeChildren(node: DocumentOutlineNode) {
  return Boolean(node.hasChildren || node.children?.length);
}

function mergeSourceSpans(
  primary: SourceSpanDoc[] | undefined,
  secondary: SourceSpanDoc[] | undefined,
) {
  if (!primary?.length) return secondary;
  if (!secondary?.length) return primary;
  const byId = new Map<string, SourceSpanDoc>();
  for (const span of primary) byId.set(span.spanId, span);
  for (const span of secondary) byId.set(span.spanId, span);
  return [...byId.values()];
}

type DataRow = {
  label: string;
  value: string;
  section?: string;
  pageNumber?: number;
  sourceSpanIds?: string[];
};
type DataSection = { label: string; rows: DataRow[] };

const STRUCTURED_BODY_LABEL_CLASS = "sm:pl-[2.625rem]";
const STRUCTURED_BODY_VALUE_CLASS = "sm:pr-5";
const STRUCTURED_BODY_TEXT_CLASS =
  "border-t border-border-subtle px-5 pt-3 sm:pl-[2.625rem] sm:pr-5";

function firstNumericPage(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function declarationsFallbackPage(sections: PolicySection[]) {
  const declarationsSection = sections.find((section) => {
    const title = section.title?.toLowerCase() ?? "";
    return section.type === "declarations" || title.includes("declaration");
  });
  return declarationsSection?.pageStart;
}

function groupRowsBySection(rows: DataRow[]) {
  const sections: DataSection[] = [];
  const sectionIndexes = new Map<string, number>();

  for (const row of rows) {
    const label = row.section || "Other";
    const index = sectionIndexes.get(label);
    const rowWithoutSection = { ...row, section: undefined };

    if (index == null) {
      sectionIndexes.set(label, sections.length);
      sections.push({ label, rows: [rowWithoutSection] });
    } else {
      sections[index]?.rows.push(rowWithoutSection);
    }
  }

  return sections;
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function extractedFactRowsForNode(
  policyDocument: PolicyDocument,
  nodeId: string,
): DataRow[] {
  const rows: DataRow[] = [];
  const push = (row: DataRow) => {
    if (row.label && row.value) rows.push(row);
  };

  for (const coverage of policyDocument.coverages ?? []) {
    if ((coverage as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: coverage.name ?? "Coverage",
      value: [
        coverage.limit ? `Limit ${coverage.limit}` : undefined,
        coverage.deductible ? `Deductible ${coverage.deductible}` : undefined,
      ]
        .filter(Boolean)
        .join(" | "),
      sourceSpanIds: sourceSpanIdsFrom(coverage),
      pageNumber: coverage.pageNumber,
    });
  }

  for (const definition of policyDocument.definitions ?? []) {
    if ((definition as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: definition.term ?? "Definition",
      value: definition.definition ?? definition.originalContent ?? "",
      sourceSpanIds: sourceSpanIdsFrom(definition),
      pageNumber: definition.pageNumber,
    });
  }

  for (const reason of policyDocument.coveredReasons ?? []) {
    if ((reason as { documentNodeId?: string }).documentNodeId !== nodeId)
      continue;
    push({
      label: reason.title ?? reason.coverageName ?? "Covered reason",
      value: reason.content ?? "",
      sourceSpanIds: sourceSpanIdsFrom(reason),
      pageNumber: reason.pageNumber,
    });
  }

  for (const item of [
    ...recordArray(policyDocument.endorsements),
    ...recordArray(policyDocument.exclusions),
    ...recordArray(policyDocument.conditions),
    ...recordArray(policyDocument.taxesAndFees),
    ...recordArray(policyDocument.premiumBreakdown),
    ...recordArray(policyDocument.supplementaryFacts),
  ]) {
    if (item.documentNodeId !== nodeId) continue;
    push({
      label:
        stringifyValue(
          item.title ?? item.name ?? item.line ?? item.key ?? item.term,
        ) || "Extracted detail",
      value:
        stringifyValue(
          item.content ??
            item.value ??
            item.amount ??
            item.description ??
            item.excerpt,
        ) || stringifyValue(item),
      sourceSpanIds: sourceSpanIdsFrom(item),
      pageNumber: firstNumericPage(item.pageNumber, item.pageStart),
    });
  }

  return rows;
}

// ─── Exclusion / Condition / Endorsement cards ───────────────────────────────

function ExclusionBody({ ex }: { ex: PolicyExclusion }) {
  const metaItems = [
    ex?.formNumber && { label: "Form", value: ex.formNumber },
    ex?.appliesTo && {
      label: "Applies to",
      value: Array.isArray(ex.appliesTo)
        ? ex.appliesTo.join(", ")
        : ex.appliesTo,
    },
    ex?.buybackAvailable &&
      ex?.buybackEndorsement && {
        label: "Buyback",
        value: ex.buybackEndorsement,
      },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {ex?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{ex.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function ConditionBody({ c }: { c: PolicyCondition }) {
  const keyValues = c?.keyValues as
    | { key: string; value: string }[]
    | undefined;
  return (
    <div className="space-y-3">
      {keyValues && keyValues.length > 0 && (
        <KeyValueTable
          rows={keyValues.map((entry) => ({
            label: formatStructuredLabel(entry.key) ?? entry.key,
            value: entry.value,
          }))}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {c?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{c.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function EndorsementBody({ e }: { e: PolicyEndorsement }) {
  const metaItems = [
    e?.formNumber && { label: "Form", value: e.formNumber },
    e?.editionDate && {
      label: "Edition",
      value: formatDisplayDate(e.editionDate, e.editionDate),
    },
    e?.effectiveDate && {
      label: "Effective",
      value: formatDisplayDate(e.effectiveDate, e.effectiveDate),
    },
    e?.premiumImpact && { label: "Premium", value: e.premiumImpact },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {e?.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{e.content}</DocContent>
        </div>
      )}
    </div>
  );
}

function CoverageBody({
  coverage,
}: {
  coverage: CoverageEntry;
}) {
  const normalizedOriginalContent = coverage.originalContent?.trim();
  const repeatedOriginalContent =
    normalizedOriginalContent &&
    [
      coverage.name,
      coverage.limit,
      coverage.name && coverage.limit
        ? `${coverage.name} ${coverage.limit}`
        : undefined,
      coverage.name && coverage.limit
        ? `${coverage.name} | ${coverage.limit}`
        : undefined,
    ].some((value) => value?.trim() === normalizedOriginalContent);
  const metaItems = [
    coverage.coverageCode && { label: "Code", value: coverage.coverageCode },
    coverage.limitType && {
      label: "Limit type",
      value: formatStructuredLabel(coverage.limitType) ?? coverage.limitType,
    },
    coverage.deductible && { label: "Deductible", value: coverage.deductible },
    coverage.formNumber && { label: "Form", value: coverage.formNumber },
    coverage.sectionRef && { label: "Section", value: coverage.sectionRef },
  ].filter(Boolean) as { label: string; value: string }[];
  if (metaItems.length === 0 && (!normalizedOriginalContent || repeatedOriginalContent)) {
    return null;
  }

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {normalizedOriginalContent && !repeatedOriginalContent && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{normalizedOriginalContent}</DocContent>
        </div>
      )}
    </div>
  );
}

function coverageHasExtraDetails(coverage: CoverageEntry) {
  const originalContent = coverage.originalContent?.trim();
  const repeatedOriginalContent =
    originalContent &&
    [
      coverage.name,
      coverage.limit,
      coverage.name && coverage.limit
        ? `${coverage.name} ${coverage.limit}`
        : undefined,
      coverage.name && coverage.limit
        ? `${coverage.name} | ${coverage.limit}`
        : undefined,
    ].some((value) => value?.trim() === originalContent);
  return Boolean(
    coverage.coverageCode ||
      coverage.limitType ||
      coverage.deductible ||
      coverage.formNumber ||
      coverage.sectionRef ||
      (originalContent && !repeatedOriginalContent),
  );
}

function enrichedCoverageRows(policyDocument: PolicyDocument | null | undefined) {
  const coverages = policyDocument?.coverages ?? [];
  const operationalCoverages = Array.isArray(
    (policyDocument as { operationalProfile?: { coverages?: unknown } } | null | undefined)
      ?.operationalProfile?.coverages,
  )
    ? ((policyDocument as { operationalProfile?: { coverages?: CoverageEntry[] } })
        .operationalProfile?.coverages ?? [])
    : [];
  if (coverages.length === 0 || operationalCoverages.length === 0) {
    return coverages;
  }
  const operationalByKey = new Map(
    operationalCoverages.map((coverage) => [
      `${coverage.name ?? ""}::${coverage.limit ?? ""}`,
      coverage,
    ]),
  );
  return coverages.map((coverage) => ({
    ...coverage,
    coverageSourceContext:
      coverage.coverageSourceContext ??
      operationalByKey.get(`${coverage.name ?? ""}::${coverage.limit ?? ""}`)
        ?.coverageSourceContext,
  }));
}

function DefinitionBody({ definition }: { definition: DefinitionEntry }) {
  const metaItems = [
    definition.formNumber && { label: "Form", value: definition.formNumber },
    definition.formTitle && {
      label: "Form title",
      value: definition.formTitle,
    },
    definition.sectionRef && { label: "Section", value: definition.sectionRef },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {definition.definition && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{definition.definition}</DocContent>
        </div>
      )}
    </div>
  );
}

function splitLabeledText(value: string) {
  const match = value.match(/^([^:]{2,64}):\s*(.+)$/);
  if (!match) return null;
  return {
    label: match[1].trim(),
    value: match[2].trim(),
  };
}

function CoveredReasonDetailSection({
  title,
  items,
}: {
  title: string;
  items?: string[];
}) {
  if (!items?.length) return null;
  const labeledRows = items
    .map(splitLabeledText)
    .filter((row): row is { label: string; value: string } => Boolean(row));
  const shouldUseTable = labeledRows.length === items.length;

  return (
    <div className="border-t border-border-subtle px-5 pt-3 sm:pl-[2.625rem] sm:pr-5">
      <p className={`mb-2 text-muted-foreground ${typeStyle("caption.medium")}`}>{title}</p>
      {shouldUseTable ? (
        <div className="overflow-hidden rounded-md border border-border">
          <KeyValueTable
            rows={labeledRows}
            labelCellClassName="!pl-3 sm:!pl-3"
            valueCellClassName="!pr-3 sm:!pr-3"
          />
        </div>
      ) : (
        <div className={`space-y-1.5 text-foreground ${typeStyle("body.default")}`}>
          {items.map((item, i) => (
            <p key={`${title}-${i}`}>{item}</p>
          ))}
        </div>
      )}
    </div>
  );
}

function CoveredReasonBody({ reason }: { reason: CoveredReasonEntry }) {
  const metaItems = [
    reason.coverageName && { label: "Coverage", value: reason.coverageName },
    reason.formNumber && { label: "Form", value: reason.formNumber },
    reason.formTitle && { label: "Form title", value: reason.formTitle },
    reason.sectionRef && { label: "Section", value: reason.sectionRef },
    reason.appliesTo?.length && {
      label: "Applies to",
      value: reason.appliesTo.join(", "),
    },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="space-y-3">
      {metaItems.length > 0 && (
        <KeyValueTable
          rows={metaItems}
          labelCellClassName={STRUCTURED_BODY_LABEL_CLASS}
          valueCellClassName={STRUCTURED_BODY_VALUE_CLASS}
        />
      )}
      {reason.content && (
        <div className={STRUCTURED_BODY_TEXT_CLASS}>
          <DocContent>{reason.content}</DocContent>
        </div>
      )}
      <CoveredReasonDetailSection
        title="Conditions"
        items={reason.conditions}
      />
      <CoveredReasonDetailSection
        title="Exceptions"
        items={reason.exceptions}
      />
    </div>
  );
}

function StructuredItemsCard<T>({
  id,
  title,
  items,
  getTitle,
  getPage,
  getBadges,
  getTrailing,
  hasBody,
  renderBody,
  getSourceSpanIds,
  sourceSpans,
  fileUrl,
  defaultExpanded,
}: {
  id: string;
  title: string;
  items: T[];
  getTitle: (item: T) => string;
  getPage?: (item: T) => number | undefined;
  getBadges?: (item: T) => { label: string; className: string }[];
  getTrailing?: (item: T) => React.ReactNode;
  hasBody?: (item: T) => boolean;
  renderBody: (item: T) => React.ReactNode;
  getSourceSpanIds?: (item: T) => string[] | undefined;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(defaultExpanded ? items.map((_, index) => index) : []),
  );
  if (!items?.length) return null;

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) {
        next.delete(i);
      } else {
        next.add(i);
      }
      return next;
    });

  return (
    <OperationalPanel as="div" id={id}>
      <OperationalPanelHeader title={`${title} (${items.length})`} />
      {items.map((item, i) => {
        const badges = getBadges?.(item) ?? [];
        const trailing = getTrailing?.(item);
        const canExpand = hasBody?.(item) ?? true;
        const page = getPage?.(item);
        const sourceSpanIds = getSourceSpanIds?.(item) ?? [];
        return (
          <div
            key={i}
            className="border-t border-border-subtle first:border-t-0"
          >
            <div className="flex items-center gap-2 px-4 py-3 hover:bg-foreground/[0.015] transition-colors">
              <button
                type="button"
                onClick={() => canExpand && toggle(i)}
                disabled={!canExpand}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
              >
                {canExpand ? (
                  expanded.has(i) ? (
                    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  )
                ) : null}
                <span className={`text-foreground flex-1 min-w-0 truncate ${typeStyle("body.default")}`}>
                  {getTitle(item)}
                </span>
                {trailing ? (
                  <span className={`shrink-0 text-foreground ${typeStyle("data.numeric")}`}>
                    {trailing}
                  </span>
                ) : null}
                {badges.length > 0 && (
                  <div className="hidden md:flex items-center gap-1.5 shrink-0">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full ${typeStyle("label.tag")} ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
              </button>
              <SourceEvidenceButton
                sourceSpanIds={sourceSpanIds}
                sourceSpans={sourceSpans}
                fallbackPage={page}
                fileUrl={fileUrl}
              />
              {page != null && sourceSpanIds.length === 0 && (
                <PageRef page={page} />
              )}
            </div>
            {canExpand && expanded.has(i) && (
              <div className="space-y-3 pt-2 pb-3">
                {badges.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 px-5 md:hidden">
                    {badges.map((badge) => (
                      <span
                        key={badge.label}
                        className={`inline-flex items-center px-2 py-0.5 rounded-full ${typeStyle("label.tag")} ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    ))}
                  </div>
                )}
                {renderBody(item)}
              </div>
            )}
          </div>
        );
      })}
    </OperationalPanel>
  );
}

// ─── Supplementary cards ──────────────────────────────────────────────────────

function ContactCard({
  contact,
  showType,
}: {
  contact: ContactEntry;
  showType?: boolean;
}) {
  const fields = [
    contact.phone && { label: "Phone", value: contact.phone },
    contact.fax && { label: "Fax", value: contact.fax },
    contact.email && { label: "Email", value: contact.email },
    contact.hours && { label: "Hours", value: contact.hours },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="border-t border-border-subtle first:border-t-0 px-4 py-3">
      <div className="flex items-center gap-2">
        {contact.name && (
          <p className={`text-foreground ${typeStyle("body.medium")}`}>{contact.name}</p>
        )}
        {showType && contact.type && (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full bg-foreground/5 text-muted-foreground ${typeStyle("label.tag")}`}>
            {contact.type}
          </span>
        )}
      </div>
      {contact.title && (
        <p className={`text-muted-foreground mt-0.5 ${typeStyle("body.default")}`}>{contact.title}</p>
      )}
      {fields.length > 0 && (
        <div className="flex flex-wrap gap-x-5 gap-y-0.5 mt-1">
          {fields.map((f) => (
            <p key={f.label} className={`text-foreground ${typeStyle("body.default")}`}>
              <span className="text-muted-foreground">{f.label}:</span>{" "}
              {f.value}
            </p>
          ))}
        </div>
      )}
      {contact.address && (
        <p className={`text-muted-foreground mt-1 ${typeStyle("body.default")}`}>{contact.address}</p>
      )}
    </div>
  );
}

function SupplementaryCard({
  title,
  pageNumber,
  content,
  hasStructured,
  children,
}: {
  title: string;
  pageNumber?: number;
  content: string;
  hasStructured: boolean;
  children: React.ReactNode;
}) {
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader
        title={
          <span className="flex items-center gap-2">
            <span>{title}</span>
            {pageNumber != null && <PageRef page={pageNumber} />}
          </span>
        }
      />
      {hasStructured ? (
        <>
          <div className="px-5 py-3">{children}</div>
          <details className="group/raw border-t border-border-subtle">
            <summary className={`flex items-center gap-2 px-5 py-2.5 text-muted-foreground/50 hover:text-muted-foreground hover:bg-foreground/[0.015] transition-colors select-none [&::-webkit-details-marker]:hidden [&::marker]:hidden list-none ${typeStyle("control.tab")}`}>
              <ChevronRight className="w-3.5 h-3.5 shrink-0 transition-transform duration-200 group-open/raw:rotate-90" />
              View raw text
            </summary>
            <div className="px-5 pt-1 pb-3">
              <p className={`whitespace-pre-wrap break-words text-muted-foreground [overflow-wrap:anywhere] ${typeStyle("body.default")}`}>
                {content}
              </p>
            </div>
          </details>
        </>
      ) : (
        <div className="px-5 py-3">
          <p className={`whitespace-pre-wrap break-words text-foreground [overflow-wrap:anywhere] ${typeStyle("body.default")}`}>
            {content}
          </p>
        </div>
      )}
    </OperationalPanel>
  );
}

function RegulatoryContextStructured({ data }: { data: RegulatoryContext }) {
  const gridItems = [
    { label: "Jurisdiction", value: data.jurisdiction },
    { label: "Regulatory Body", value: data.regulatoryBody },
    { label: "Governing Law", value: data.governingLaw },
  ].filter((item) => item.value);

  return (
    <div className="-mx-4 -mt-3">
      {gridItems.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:divide-x divide-border border-b border-border-subtle">
          {gridItems.map((item) => (
            <div key={item.label} className="flex-1 px-4 py-2.5">
              <p className={`text-muted-foreground mb-0.5 ${typeStyle("caption.medium")}`}>
                {item.label}
              </p>
              <p className={`text-foreground ${typeStyle("body.medium")}`}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}
      {(data.details?.length ?? 0) > 0 && (
        <table className="w-full text-left">
          <tbody>
            {(data.details ?? []).map((d: RegulatoryDetail, i: number) => (
              <tr
                key={i}
                className="border-t border-border-subtle first:border-t-0 hover:bg-foreground/[0.015] transition-colors"
              >
                <td className={`px-4 py-2.5 text-muted-foreground align-top ${typeStyle("body.default")}`}>
                  {d.label}
                </td>
                <td className={`px-4 py-2.5 text-foreground ${typeStyle("body.medium")}`}>
                  {d.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ComplaintContactStructured({
  contacts,
}: {
  contacts?: ContactEntry[];
}) {
  if (!contacts?.length) return null;
  return (
    <div className="-mx-4 -mt-3">
      {contacts.map((c: ContactEntry, i: number) => (
        <ContactCard key={i} contact={c} showType />
      ))}
    </div>
  );
}

function ClaimsContactStructured({ data }: { data: ClaimsContact }) {
  return (
    <div className="-mx-4 -mt-3">
      {(data.contacts?.length ?? 0) > 0 && (
        <div>
          {(data.contacts ?? []).map((c: ContactEntry, i: number) => (
            <ContactCard key={i} contact={c} />
          ))}
        </div>
      )}
      {(data.processSteps?.length ?? 0) > 0 && (
        <div className="border-t border-border-subtle px-4 py-3">
          <p className={`text-muted-foreground mb-2 ${typeStyle("caption.medium")}`}>
            Claims Process
          </p>
          <ol className="space-y-1.5">
            {(data.processSteps ?? []).map((step: string, i: number) => (
              <li key={i} className={`flex gap-2.5 text-foreground ${typeStyle("body.default")}`}>
                <span className={`text-muted-foreground/60 mt-px shrink-0 ${typeStyle("caption.default")}`}>
                  {i + 1}.
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
      {data.reportingTimeLimit && (
        <div className="border-t border-border-subtle px-4 py-3">
          <p className={`text-muted-foreground mb-1 ${typeStyle("caption.medium")}`}>
            Reporting Time Limit
          </p>
          <p className={`text-foreground ${typeStyle("body.medium")}`}>
            {data.reportingTimeLimit}
          </p>
        </div>
      )}
    </div>
  );
}

function KeyValueTable({
  rows,
  sourceSpans,
  fileUrl,
  className = "",
  labelCellClassName = "",
  valueCellClassName = "",
}: {
  rows: DataRow[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  className?: string;
  labelCellClassName?: string;
  valueCellClassName?: string;
}) {
  if (!rows.length) return null;
  return (
    <table className={`w-full text-left ${className}`}>
      <tbody>
        {rows.map((row, i) => (
          <tr
            key={`${row.section ?? ""}-${row.label}-${i}`}
            className="block border-t border-border-subtle first:border-t-0 hover:bg-foreground/[0.015] transition-colors sm:table-row"
          >
            <td
              className={`block px-5 pt-3 pb-1 text-muted-foreground align-top sm:table-cell sm:w-1/3 sm:py-2.5 ${labelCellClassName}`}
            >
              <span className={`sm:hidden ${typeStyle("caption.medium")}`}>{row.label}</span>
              <span className={`hidden sm:inline ${typeStyle("body.default")}`}>{row.label}</span>
              {row.section && (
                <span className={`block text-muted-foreground/60 mt-0.5 ${typeStyle("caption.default")}`}>
                  {row.section}
                </span>
              )}
            </td>
            <td
              className={`block px-5 pt-0 pb-3 text-foreground sm:table-cell sm:py-2.5 ${typeStyle("body.default")} ${valueCellClassName}`}
            >
              <span className="inline-flex items-center gap-1.5 break-words">
                <span>{row.value}</span>
                <SourceEvidenceButton
                  sourceSpanIds={row.sourceSpanIds}
                  sourceSpans={sourceSpans}
                  fallbackPage={row.pageNumber}
                  fileUrl={fileUrl}
                />
                {row.pageNumber != null && !row.sourceSpanIds?.length && (
                  <PageRef page={row.pageNumber} />
                )}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DataCard({
  title,
  rows,
  sourceSpans,
  fileUrl,
}: {
  title: string;
  rows: DataRow[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (!rows.length) return null;
  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader title={title} />
      <KeyValueTable rows={rows} sourceSpans={sourceSpans} fileUrl={fileUrl} />
    </OperationalPanel>
  );
}

function SectionedDataCard({
  title,
  sections,
  sourceSpans,
  fileUrl,
}: {
  title: string;
  sections: DataSection[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  const nonEmptySections = sections.filter(
    (section) => section.rows.length > 0,
  );
  if (!nonEmptySections.length) return null;

  return (
    <OperationalPanel as="div">
      <OperationalPanelHeader title={title} />
      {nonEmptySections.map((section, index) => (
        <GroupSection
          key={`${section.label}-${index}`}
          label={`${section.label} (${section.rows.length})`}
          defaultOpen={index === 0}
        >
          <KeyValueTable
            rows={section.rows}
            sourceSpans={sourceSpans}
            fileUrl={fileUrl}
            labelCellClassName="sm:pl-11"
          />
        </GroupSection>
      ))}
    </OperationalPanel>
  );
}

function nodeKind(node: DocumentOutlineNode) {
  return node.type ?? node.label;
}

function nodeKindLabel(node: DocumentOutlineNode) {
  return formatStructuredLabel(nodeKind(node)) ?? "Source span";
}

function isNodeKind(node: DocumentOutlineNode, kind: string) {
  return nodeKind(node) === kind;
}

function metadataNumber(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function metadataBoolean(
  metadata: Record<string, unknown> | undefined,
  key: string,
) {
  const value = metadata?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return undefined;
}

function truncateInline(value: string, maxLength = 96) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1).trimEnd()}…`
    : text;
}

function normalizeSourceDisplayText(value: string | undefined) {
  return (value ?? "")
    .replace(/\s+/g, " ")
    .replace(/([A-Za-z])-\s+([A-Za-z])/g, "$1-$2")
    .trim();
}

function isGenericNodeTitle(title: string | undefined, kind: string | undefined) {
  if (!title || !kind) return false;
  const normalizedTitle = title.toLowerCase().replace(/\s+/g, "_");
  return (
    normalizedTitle === kind ||
    /^(text|table|row|column|header row|table row|table cell)(\s+\d+)?$/i.test(
      title,
    )
  );
}

function nodeDisplayTitle(node: DocumentOutlineNode) {
  const title = node.title ?? node.originalTitle;
  const kind = nodeKind(node);
  if (title && !isGenericNodeTitle(title, kind)) return title;
  const text = node.excerpt ?? node.content;
  if (text) return truncateInline(text);
  return title ?? nodeKindLabel(node);
}

function sourceTableTitle(node: DocumentOutlineNode) {
  const title = normalizeSourceDisplayText(node.title ?? node.originalTitle);
  return title && !isGenericNodeTitle(title, nodeKind(node)) ? title : undefined;
}

function nodeBodyText(node: DocumentOutlineNode) {
  const text = node.excerpt ?? node.content;
  if (!text) return undefined;
  return text.trim() === nodeDisplayTitle(node).trim() ? undefined : text;
}

function normalizedNodeText(node: DocumentOutlineNode) {
  return normalizeSourceDisplayText(nodeBodyText(node) ?? nodeDisplayTitle(node));
}

function isDecorativeTextNode(node: DocumentOutlineNode) {
  const text = normalizedNodeText(node);
  return /^[-_=\s]{6,}$/.test(text);
}

function sortedTableCells(cells: DocumentOutlineNode[]) {
  return [...cells].sort((left, right) => {
    const leftIndex = metadataNumber(left.metadata, "columnIndex");
    const rightIndex = metadataNumber(right.metadata, "columnIndex");
    if (leftIndex !== undefined && rightIndex !== undefined) {
      return leftIndex - rightIndex || left.id.localeCompare(right.id);
    }
    if (leftIndex !== undefined) return -1;
    if (rightIndex !== undefined) return 1;
    return (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id);
  });
}

function parsedTableCellsFromRow(row: DocumentOutlineNode): DocumentOutlineNode[] {
  const text = row.excerpt ?? row.content;
  if (!text?.includes("Column ")) return [];
  const matches = [...text.matchAll(/Column\s+(\d+):\s*([\s\S]*?)(?=\s*\|\s*Column\s+\d+:|$)/g)];
  if (matches.length === 0) return [];
  return matches.map((match, index) => {
    const columnIndex = Number.parseInt(match[1] ?? "", 10) - 1;
    const value = match[2]?.trim() ?? "";
    return {
      id: `${row.id}:parsed-cell:${Number.isFinite(columnIndex) ? columnIndex : index}`,
      title: `Column ${Number.isFinite(columnIndex) ? columnIndex + 1 : index + 1}`,
      type: "table_cell",
      label: "table_cell",
      excerpt: value,
      content: value,
      pageStart: row.pageStart,
      pageEnd: row.pageEnd,
      sourceSpanIds: row.sourceSpanIds,
      metadata: {
        columnIndex: Number.isFinite(columnIndex) ? columnIndex : index,
        sourceUnit: "table_cell",
        derivedFromRowExcerpt: true,
      },
    };
  }).filter((cell) => Boolean(cell.excerpt));
}

function tableCellsForRow(row: DocumentOutlineNode) {
  const childCells = sortedTableCells(
    (row.children ?? []).filter((child) =>
      isNodeKind(child, "table_cell"),
    ),
  );
  const parsedCells = parsedTableCellsFromRow(row);
  if (parsedCells.length > childCells.length) return parsedCells;
  return childCells;
}

function tableRowsForNode(node: DocumentOutlineNode) {
  const rows = (node.children ?? []).filter((child) =>
    isNodeKind(child, "table_row"),
  );
  if (rows.length > 0) {
    return rows.map((row) => ({
      row,
      cells: tableCellsForRow(row),
    }));
  }
  const directCells = sortedTableCells(
    (node.children ?? []).filter((child) => isNodeKind(child, "table_cell")),
  );
  return directCells.length > 0 ? [{ row: node, cells: directCells }] : [];
}

function tableCellValue(cell: DocumentOutlineNode) {
  return normalizeSourceDisplayText(cell.excerpt ?? cell.content ?? nodeDisplayTitle(cell));
}

function isTextLeafNode(node: DocumentOutlineNode) {
  return (isNodeKind(node, "text") || isNodeKind(node, "table_cell")) && !hasSourceNodeChildren(node);
}

function isTitleBlockNode(node: DocumentOutlineNode) {
  return isNodeKind(node, "text") &&
    node.metadata &&
    typeof node.metadata === "object" &&
    !Array.isArray(node.metadata) &&
    (node.metadata as Record<string, unknown>).organizer === "title_block";
}

function titleBlockHeadingNode(node: DocumentOutlineNode) {
  const title = nodeDisplayTitle(node);
  if (!title || isGenericNodeTitle(title, nodeKind(node))) return undefined;
  return {
    ...node,
    id: `${node.id}:heading`,
    excerpt: title,
    content: title,
    sourceSpanIds: sourceSpanIdsFrom(node).slice(0, 1),
    children: undefined,
    hasChildren: false,
  } satisfies DocumentOutlineNode;
}

function inlineTextNodesForDisplay(node: DocumentOutlineNode): DocumentOutlineNode[] {
  if (isTextLeafNode(node)) return [node];
  if (!isTitleBlockNode(node)) return [];
  const heading = titleBlockHeadingNode(node);
  return heading ? [heading] : [];
}

type InlineSourceContentItem =
  | { id: string; type: "text"; nodes: DocumentOutlineNode[] }
  | {
      id: string;
      type: "table";
      node: DocumentOutlineNode;
      trailingTextNodes?: DocumentOutlineNode[];
    };

function isContinuationText(previousText: string, nextText: string) {
  const previous = normalizeSourceDisplayText(previousText);
  const next = normalizeSourceDisplayText(nextText);
  if (!previous || !next || /^item\s+\d+[a-z]?\./i.test(next)) return false;
  if (/^[a-z]/.test(next)) return true;
  if (
    /\b(?:and|or|of|in|to|the|under|part|see|sub-|applicable)$/i.test(previous)
  ) {
    return true;
  }
  return /^(?:addition\b|aggregate limit\)?|coverage part\s+[A-Z]\b|endorsement no\.|sub-limit\b|period\b|regardless\b)/i.test(next);
}

function shouldAttachTextNodeToPreviousTable(
  item: InlineSourceContentItem,
  node: DocumentOutlineNode,
) {
  if (item.type !== "table") return false;
  const text = normalizedNodeText(node);
  if (!text || text.length > 140) return false;
  if ((item.trailingTextNodes?.length ?? 0) > 0) {
    return !/^item\s+\d+[a-z]?\./i.test(text);
  }
  const rows = tableRowsForNode(item.node);
  const lastRow = rows[rows.length - 1];
  if (!lastRow || isTableHeaderRow(lastRow) || lastRow.cells.length > 1) {
    return false;
  }
  return isContinuationText(tableRowText(lastRow), text);
}

function inlineContentForDisplay(nodes: DocumentOutlineNode[]) {
  const items: InlineSourceContentItem[] = [];
  let pendingTextNodes: DocumentOutlineNode[] = [];

  const flushTextNodes = () => {
    if (pendingTextNodes.length === 0) return;
    items.push({
      id: `text-${pendingTextNodes[0]?.id ?? items.length}`,
      type: "text",
      nodes: pendingTextNodes,
    });
    pendingTextNodes = [];
  };

  for (const node of nodes) {
    if (isTitleBlockNode(node) && node.children?.length) {
      const nestedItems = inlineContentForDisplay([
        ...inlineTextNodesForDisplay(node),
        ...node.children,
      ]);
      for (const item of nestedItems) {
        if (item.type === "text") {
          pendingTextNodes.push(...item.nodes);
        } else {
          flushTextNodes();
          items.push(item);
        }
      }
      continue;
    }
    const textNodes = inlineTextNodesForDisplay(node);
    if (textNodes.length > 0) {
      if (
        pendingTextNodes.length === 0 &&
        textNodes.length === 1 &&
        items.length > 0
      ) {
        const previousItem = items[items.length - 1]!;
        if (shouldAttachTextNodeToPreviousTable(previousItem, textNodes[0]!)) {
          if (previousItem.type === "table") {
            previousItem.trailingTextNodes = [
              ...(previousItem.trailingTextNodes ?? []),
              textNodes[0]!,
            ];
          }
          continue;
        }
      }
      pendingTextNodes.push(...textNodes);
      continue;
    }
    if (isNodeKind(node, "table")) {
      flushTextNodes();
      items.push({ id: `table-${node.id}`, type: "table", node });
    }
  }

  flushTextNodes();
  return items;
}

function shouldRenderTextChild(parent: DocumentOutlineNode) {
  const kind = nodeKind(parent);
  return kind === undefined || !["document", "table"].includes(kind);
}

function sourceSpanIdsForTableRow(
  row: DocumentOutlineNode,
  cells: DocumentOutlineNode[],
) {
  return [
    ...new Set([
      ...sourceSpanIdsFrom(row),
      ...cells.flatMap((cell) => sourceSpanIdsFrom(cell)),
    ]),
  ];
}

type SourceTableRow = ReturnType<typeof tableRowsForNode>[number];

function isTableHeaderRow(row: SourceTableRow) {
  return Boolean(
    metadataBoolean(row.row.metadata, "isHeader") ??
      row.cells.some((cell) => metadataBoolean(cell.metadata, "isHeader")),
  );
}

function isGenericTableColumnName(value: string | undefined) {
  return !value || /^column\s+\d+$/i.test(value.trim());
}

function tableCellColumnName(cell: DocumentOutlineNode) {
  const raw = cell.metadata?.columnName;
  return typeof raw === "string" && raw.trim() ? raw.trim() : cell.title;
}

function tableRowText(row: SourceTableRow) {
  if (row.cells.length > 0) {
    return row.cells.map(tableCellValue).filter(Boolean).join(" ");
  }
  return normalizeSourceDisplayText(
    row.row.excerpt ?? row.row.content ?? nodeDisplayTitle(row.row),
  );
}

function isGenericCellRow(row: SourceTableRow) {
  return row.cells.length > 0 &&
    row.cells.every((cell) => isGenericTableColumnName(tableCellColumnName(cell)));
}

function isGridContinuationRow(row: SourceTableRow, previous: SourceTableRow | undefined) {
  if (!previous || previous.cells.length <= 1 || isTableHeaderRow(row)) return false;
  if (!isGenericCellRow(row) || row.cells.length >= previous.cells.length) return false;
  const firstText = tableCellValue(row.cells[0]!);
  if (/^item\s+\d+[a-z]?\./i.test(firstText)) return false;
  return isContinuationText(tableCellValue(previous.cells[0]!), firstText) ||
    isContinuationText(tableCellValue(previous.cells[previous.cells.length - 1]!), tableRowText(row));
}

function withAppendedCellText(
  cell: DocumentOutlineNode,
  text: string,
  sourceSpanIds: string[],
) {
  const value = normalizeSourceDisplayText(`${tableCellValue(cell)} ${text}`);
  return {
    ...cell,
    excerpt: value,
    content: value,
    sourceSpanIds: [
      ...new Set([
        ...sourceSpanIdsFrom(cell),
        ...sourceSpanIds,
      ]),
    ],
  };
}

function appendContinuationToRow(
  target: SourceTableRow,
  continuation: SourceTableRow,
) {
  if (!target.cells.length) return target;
  const continuationSpanIds = sourceSpanIdsForTableRow(
    continuation.row,
    continuation.cells,
  );
  const cells = [...target.cells];
  continuation.cells.forEach((cell, index) => {
    const targetIndex = index === 0
      ? 0
      : index === continuation.cells.length - 1
        ? cells.length - 1
        : Math.min(index, cells.length - 1);
    cells[targetIndex] = withAppendedCellText(
      cells[targetIndex]!,
      tableCellValue(cell),
      sourceSpanIdsFrom(cell),
    );
  });
  return {
    row: {
      ...target.row,
      sourceSpanIds: [
        ...new Set([
          ...sourceSpanIdsFrom(target.row),
          ...continuationSpanIds,
        ]),
      ],
    },
    cells,
  };
}

function compactGridContinuationRows(rows: SourceTableRow[]) {
  const compacted: SourceTableRow[] = [];
  for (const row of rows) {
    const previous = compacted[compacted.length - 1];
    if (isGridContinuationRow(row, previous)) {
      compacted[compacted.length - 1] = appendContinuationToRow(
        previous!,
        row,
      );
      continue;
    }
    compacted.push(row);
  }
  return compacted;
}

function mergeTrailingTextIntoTableRows(
  rows: SourceTableRow[],
  trailingTextNodes: DocumentOutlineNode[] | undefined,
) {
  const trailingText = (trailingTextNodes ?? [])
    .map(normalizedNodeText)
    .filter(Boolean)
    .join(" ");
  if (!trailingText) return rows;

  const lastTextRowIndex = rows.findLastIndex((row) =>
    !isTableHeaderRow(row) && row.cells.length <= 1,
  );
  if (lastTextRowIndex < 0) return rows;

  const trailingSpanIds = trailingTextNodes!.flatMap((node) => sourceSpanIdsFrom(node));
  return rows.map((row, index) => {
    if (index !== lastTextRowIndex) return row;
    if (row.cells.length === 0) {
      const text = normalizeSourceDisplayText(`${tableRowText(row)} ${trailingText}`);
      return {
        row: {
          ...row.row,
          excerpt: text,
          content: text,
          sourceSpanIds: [
            ...new Set([...sourceSpanIdsFrom(row.row), ...trailingSpanIds]),
          ],
        },
        cells: [],
      };
    }
    const cells = [...row.cells];
    cells[0] = withAppendedCellText(cells[0]!, trailingText, trailingSpanIds);
    return {
      row: {
        ...row.row,
        sourceSpanIds: [
          ...new Set([...sourceSpanIdsFrom(row.row), ...trailingSpanIds]),
        ],
      },
      cells,
    };
  });
}

function splitMixedTableRows(rows: SourceTableRow[]) {
  const segments: Array<
    | { type: "key_value"; rows: SourceTableRow[] }
    | { type: "text"; rows: SourceTableRow[] }
    | { type: "grid"; rows: SourceTableRow[] }
  > = [];
  let index = 0;

  while (index < rows.length) {
    const row = rows[index]!;
    if (isTableHeaderRow(row) && row.cells.length > 1) {
      const gridRows = [row];
      index += 1;
      while (index < rows.length) {
        const next = rows[index]!;
        if (isTableHeaderRow(next) && next.cells.length > 1) break;
        const continuationBase = [...gridRows]
          .reverse()
          .find((candidate) => candidate.cells.length > 1);
        if (
          next.cells.length <= 1 &&
          !isTableHeaderRow(next) &&
          !isGridContinuationRow(next, continuationBase)
        ) {
          break;
        }
        gridRows.push(next);
        index += 1;
      }
      segments.push({ type: "grid", rows: gridRows });
      continue;
    }

    if (
      row.cells.length === 2 &&
      row.cells.every((cell) => isGenericTableColumnName(tableCellColumnName(cell)))
    ) {
      const keyValueRows = [row];
      index += 1;
      while (index < rows.length) {
        const next = rows[index]!;
        if (
          next.cells.length !== 2 ||
          isTableHeaderRow(next) ||
          !next.cells.every((cell) => isGenericTableColumnName(tableCellColumnName(cell)))
        ) {
          break;
        }
        keyValueRows.push(next);
        index += 1;
      }
      segments.push({ type: "key_value", rows: keyValueRows });
      continue;
    }

    const textRows = [row];
    index += 1;
    while (index < rows.length) {
      const next = rows[index]!;
      if (
        isTableHeaderRow(next) ||
        (
          next.cells.length === 2 &&
          next.cells.every((cell) => isGenericTableColumnName(tableCellColumnName(cell)))
        )
      ) {
        break;
      }
      if (next.cells.length > 1) break;
      textRows.push(next);
      index += 1;
    }
    segments.push({ type: "text", rows: textRows });
  }

  return segments;
}

function SourceTableTextRows({
  rows,
  sourceSpans,
  fileUrl,
}: {
  rows: SourceTableRow[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1 px-5 py-2.5">
      {rows.map((row) => (
        <div key={row.row.id} className="flex min-w-0 items-start gap-3">
          <p className={`min-w-0 flex-1 text-foreground ${typeStyle("body.default")}`}>
            {tableRowText(row)}
          </p>
          <SourceEvidenceButton
            sourceSpanIds={sourceSpanIdsForTableRow(row.row, row.cells)}
            sourceSpans={sourceSpans}
            fallbackPage={row.row.pageStart}
            fileUrl={fileUrl}
          />
        </div>
      ))}
    </div>
  );
}

function SourceTableKeyValueRows({
  rows,
  sourceSpans,
  fileUrl,
}: {
  rows: SourceTableRow[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  const keyValueRows = rows
    .map((row) => ({
      label: tableCellValue(row.cells[0]!),
      value: tableCellValue(row.cells[1]!),
      sourceSpanIds: sourceSpanIdsForTableRow(row.row, row.cells),
      pageNumber: row.row.pageStart,
    }))
    .filter((row) => row.label && row.value);
  if (keyValueRows.length === 0) return null;
  return (
    <KeyValueTable
      rows={keyValueRows}
      sourceSpans={sourceSpans}
      fileUrl={fileUrl}
      className="border-0"
    />
  );
}

function SourceTableGrid({
  rows,
  sourceSpans,
  fileUrl,
}: {
  rows: SourceTableRow[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
}) {
  if (rows.length === 0) return null;
  const firstRow = rows[0];
  const firstRowIsHeader = Boolean(firstRow) && isTableHeaderRow(firstRow);
  const headerCells = firstRowIsHeader ? firstRow!.cells.map(tableCellValue) : [];
  const compactedRows = compactGridContinuationRows(rows);
  const bodyRows = firstRowIsHeader ? compactedRows.slice(1) : compactedRows;
  const maxColumnCount = Math.max(...rows.map((row) => row.cells.length), 1);
  const fitToCard = maxColumnCount <= 4;
  const sourceColumnWidth = "4.25rem";
  const dataColumnWidths = fitToCard
    ? maxColumnCount === 1
      ? ["calc(100% - 4.25rem)"]
      : maxColumnCount === 2
        ? ["34%", `calc(66% - ${sourceColumnWidth})`]
        : maxColumnCount === 3
          ? ["40%", "24%", `calc(36% - ${sourceColumnWidth})`]
          : ["38%", "18%", "18%", `calc(26% - ${sourceColumnWidth})`]
    : [];
  return (
    <UiTable
      className={`${fitToCard ? "w-full table-fixed" : "w-max min-w-full"} [&_td]:whitespace-normal [&_th]:whitespace-normal ${typeStyle("body.default")}`}
      style={fitToCard ? undefined : { minWidth: `${Math.max(34, maxColumnCount * 12 + 7)}rem` }}
    >
      {fitToCard ? (
        <colgroup>
          {dataColumnWidths.map((width, index) => (
            <col key={`col-${index}`} style={{ width }} />
          ))}
          <col style={{ width: sourceColumnWidth }} />
        </colgroup>
      ) : null}
      {firstRowIsHeader ? (
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {Array.from({ length: maxColumnCount }, (_, index) => (
              <TableHead
                key={`head-${index}`}
                className={`h-8 bg-muted/30 px-3 text-muted-foreground ${typeStyle("label.table")}`}
              >
                {headerCells[index] ?? ""}
              </TableHead>
            ))}
            <TableHead className={`h-8 w-px bg-muted/30 px-3 text-muted-foreground ${typeStyle("label.table")}`}>
              Source
            </TableHead>
          </TableRow>
        </TableHeader>
      ) : null}
      <TableBody>
        {bodyRows.map(({ row, cells }, rowIndex) => (
          <TableRow key={row.id || `row-${rowIndex}`} className="hover:bg-foreground/[0.015]">
            {Array.from({ length: maxColumnCount }, (_, index) => (
              <TableCell
                key={`${row.id}-${index}`}
                className="px-3 py-2.5 align-top text-foreground"
              >
                {cells[index] ? tableCellValue(cells[index]) : ""}
              </TableCell>
            ))}
            <TableCell className="w-px px-3 py-2.5 align-top">
              <SourceEvidenceButton
                sourceSpanIds={sourceSpanIdsForTableRow(row, cells)}
                sourceSpans={sourceSpans}
                fallbackPage={row.pageStart}
                fileUrl={fileUrl}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </UiTable>
  );
}

function SourceNodeTable({
  policyId,
  node,
  sourceSpans,
  fileUrl,
  allowOperatorSourceAccess,
  trailingTextNodes,
}: {
  policyId?: Id<"policies">;
  node: DocumentOutlineNode;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
  trailingTextNodes?: DocumentOutlineNode[];
}) {
  const rows = mergeTrailingTextIntoTableRows(
    tableRowsForNode(node),
    trailingTextNodes,
  );
  const tableSourceSpanIds = useMemo(
    () => [
      ...new Set([
        ...collectSourceSpanIds(node),
        ...(trailingTextNodes ?? []).flatMap((textNode) =>
          sourceSpanIdsFrom(textNode),
        ),
      ]),
    ],
    [node, trailingTextNodes],
  );
  const queriedTableSourceSpans = usePolicySourceSpans(
    policyId,
    tableSourceSpanIds,
    { allowOperatorAccess: allowOperatorSourceAccess },
  );
  const tableSourceSpans = mergeSourceSpans(sourceSpans, queriedTableSourceSpans);
  if (!rows.length) return null;
  const segments = splitMixedTableRows(rows);
  const title = sourceTableTitle(node);

  return (
    <div className="overflow-hidden rounded-md border border-border bg-card">
      {title ? (
        <div className="flex min-w-0 items-center gap-2 px-4 py-2.5">
          <p className={`min-w-0 flex-1 truncate text-foreground ${typeStyle("body.medium")}`}>
            {title}
          </p>
          <span className={`text-muted-foreground ${typeStyle("caption.default")}`}>Table</span>
        </div>
      ) : null}
      <div className={title ? "border-t border-border" : undefined}>
        {segments.map((segment, index) => (
          <Fragment key={`${segment.type}-${index}`}>
            {index > 0 ? <div className="border-t border-border" /> : null}
            {segment.type === "key_value" ? (
              <SourceTableKeyValueRows
                rows={segment.rows}
                sourceSpans={tableSourceSpans}
                fileUrl={fileUrl}
              />
            ) : segment.type === "text" ? (
              <SourceTableTextRows
                rows={segment.rows}
                sourceSpans={tableSourceSpans}
                fileUrl={fileUrl}
              />
            ) : (
              <SourceTableGrid
                rows={segment.rows}
                sourceSpans={tableSourceSpans}
                fileUrl={fileUrl}
              />
            )}
          </Fragment>
        ))}
      </div>
    </div>
  );
}

function InlineSourceNodeTable({
  policyId,
  node,
  sourceSpans,
  fileUrl,
  allowOperatorSourceAccess,
  trailingTextNodes,
}: {
  policyId?: Id<"policies">;
  node: DocumentOutlineNode;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
  trailingTextNodes?: DocumentOutlineNode[];
}) {
  const parentNodeId = sourceNodeId(node);
  const hasHydratedChildren = Boolean(node.children?.length);
  const lazyChildren = useSourceNodeChildren(
    policyId,
    parentNodeId,
    hasSourceNodeChildren(node) && !hasHydratedChildren,
    allowOperatorSourceAccess,
  );
  const waitingForChildren =
    hasSourceNodeChildren(node) &&
    !hasHydratedChildren &&
    lazyChildren === undefined &&
    policyId !== undefined;
  const children = lazyChildren ?? node.children ?? [];
  const hydratedNode = children === node.children ? node : { ...node, children };
  const rendersTable = tableRowsForNode(hydratedNode).some(
    (row) => row.cells.length > 0,
  );

  if (waitingForChildren) return <SourceNodeChildrenSkeleton />;
  if (!rendersTable) return null;

  return (
    <SourceNodeTable
      policyId={policyId}
      node={hydratedNode}
      sourceSpans={sourceSpans}
      fileUrl={fileUrl}
      allowOperatorSourceAccess={allowOperatorSourceAccess}
      trailingTextNodes={trailingTextNodes}
    />
  );
}

function SourceTextParagraphs({
  policyId,
  nodes,
  sourceSpans,
  fileUrl,
  allowOperatorSourceAccess,
}: {
  policyId?: Id<"policies">;
  nodes: DocumentOutlineNode[];
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
}) {
  const contentNodes = useMemo(
    () => nodes.filter((node) => !isDecorativeTextNode(node)),
    [nodes],
  );
  const paragraphSpanIds = useMemo(
    () => [...new Set(contentNodes.flatMap((node) => sourceSpanIdsFrom(node)))],
    [contentNodes],
  );
  const queriedParagraphSpans = usePolicySourceSpans(policyId, paragraphSpanIds, {
    allowOperatorAccess: allowOperatorSourceAccess,
  });
  const paragraphSourceSpans = mergeSourceSpans(sourceSpans, queriedParagraphSpans);
  if (!contentNodes.length) return null;
  return (
    <div className="space-y-1 py-1">
      {contentNodes.map((node) => {
        const text = isTitleBlockNode(node)
          ? nodeDisplayTitle(node)
          : normalizedNodeText(node);
        return (
          <div key={node.id} className="flex min-w-0 items-start gap-3 py-0.5">
            <p className={`min-w-0 flex-1 text-foreground ${typeStyle("body.default")}`}>
              {text}
            </p>
            <SourceEvidenceButton
              sourceSpanIds={sourceSpanIdsFrom(node)}
              sourceSpans={paragraphSourceSpans}
              fallbackPage={node.pageStart}
              fileUrl={fileUrl}
            />
          </div>
        );
      })}
    </div>
  );
}

function visibleRenderableSourceChildren(
  node: DocumentOutlineNode,
  children: DocumentOutlineNode[],
  policyDocument: PolicyDocument,
) {
  const directChildren = isNodeKind(node, "table_row")
    ? children
    : children.filter((child) => !isNodeKind(child, "table_cell"));
  const tableRows = isNodeKind(node, "table")
    ? tableRowsForNode({ ...node, children })
    : [];
  const rendersTable = tableRows.some((row) => row.cells.length > 0);
  const standaloneChildren = isNodeKind(node, "table") && rendersTable
    ? directChildren.filter((child) => !isNodeKind(child, "table_row"))
    : directChildren;

  return standaloneChildren.filter((child) => {
    if (isTextLeafNode(child)) {
      return shouldRenderTextChild(node) && !isDecorativeTextNode(child);
    }
    return sourceNodeHasRenderableContent(child, policyDocument);
  });
}

function sourceNodeHasRenderableContent(
  node: DocumentOutlineNode,
  policyDocument: PolicyDocument,
): boolean {
  if (hasSourceNodeChildren(node)) return true;
  if (isTextLeafNode(node)) return !isDecorativeTextNode(node);
  if (extractedFactRowsForNode(policyDocument, node.id).length > 0) return true;
  if (isNodeKind(node, "table")) {
    return tableRowsForNode(node).some((row) => row.cells.length > 0);
  }
  return visibleRenderableSourceChildren(
    node,
    node.children ?? [],
    policyDocument,
  ).length > 0;
}

function SourceNodeChildrenSkeleton() {
  return (
    <div className="space-y-2 py-1">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex items-center gap-2 py-1.5">
          <span className="size-3.5 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-[min(28rem,70%)]" />
            <Skeleton className="h-2.5 w-16" />
          </div>
          <Skeleton className="h-6 w-14 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function OutlineNodeRow({
  policyId,
  node,
  policyDocument,
  sourceSpans,
  fileUrl,
  allowOperatorSourceAccess,
}: {
  policyId?: Id<"policies">;
  node: DocumentOutlineNode;
  policyDocument: PolicyDocument;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const parentNodeId = sourceNodeId(node);
  const hasHydratedChildren = Boolean(node.children?.length);
  const lazyChildren = useSourceNodeChildren(
    policyId,
    parentNodeId,
    open && hasSourceNodeChildren(node) && !hasHydratedChildren,
    allowOperatorSourceAccess,
  );
  const factRows = extractedFactRowsForNode(policyDocument, node.id);
  const sourceSpanIds = sourceSpanIdsFrom(node);
  const queriedSourceSpans = usePolicySourceSpans(policyId, sourceSpanIds, {
    allowOperatorAccess: allowOperatorSourceAccess,
  });
  const rowSourceSpans = mergeSourceSpans(
    policyId ? undefined : sourceSpans,
    queriedSourceSpans,
  );
  const kind = nodeKind(node);
  const isTable = kind === "table";
  const waitingForLazyChildren =
    hasSourceNodeChildren(node) &&
    !hasHydratedChildren &&
    lazyChildren === undefined &&
    policyId !== undefined;
  const loadingChildren =
    open &&
    waitingForLazyChildren;
  const children = lazyChildren ?? node.children ?? [];
  const hydratedNode = children === node.children ? node : { ...node, children };
  const tableRows = isTable ? tableRowsForNode(hydratedNode) : [];
  const rendersTable = tableRows.some((row) => row.cells.length > 0);
  const allVisibleChildren = isNodeKind(node, "table_row")
    ? children
    : children.filter((child) => !isNodeKind(child, "table_cell"));
  const visibleChildren = isTable && rendersTable
    ? allVisibleChildren.filter((child) => !isNodeKind(child, "table_row"))
    : allVisibleChildren;
  const renderableChildren = visibleChildren.filter((child) => {
    if (isTextLeafNode(child)) {
      return shouldRenderTextChild(node) && !isDecorativeTextNode(child);
    }
    return sourceNodeHasRenderableContent(child, policyDocument);
  });
  const inlineContent = inlineContentForDisplay(renderableChildren);
  const structuredChildren = renderableChildren.filter((child) =>
    !isTextLeafNode(child) && !isTitleBlockNode(child) && !isNodeKind(child, "table"),
  );
  const shouldFrameStructuredChildren =
    kind === "document" ||
    kind === "page_group" ||
    kind === "form";
  const canExpand =
    factRows.length > 0 ||
    waitingForLazyChildren ||
    rendersTable ||
    renderableChildren.length > 0;

  return (
    <div className="border-t border-border first:border-t-0">
      <div className="flex min-w-0 items-center gap-2 px-5 py-2.5 transition-colors hover:bg-foreground/[0.015]">
        <button
          type="button"
          onClick={() => canExpand && setOpen((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {canExpand ? (
            open ? (
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
            )
          ) : (
            <span className="size-3.5 shrink-0" />
          )}
          <div className="min-w-0 flex-1">
            <p className={`min-w-0 truncate text-foreground ${typeStyle("body.medium")}`}>
              {nodeDisplayTitle(node)}
            </p>
            <div className={`mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground ${typeStyle("caption.default")}`}>
              <span>{nodeKindLabel(node)}</span>
              {node.formNumber ? <span>{node.formNumber}</span> : null}
            </div>
          </div>
        </button>
        <SourceEvidenceButton
          sourceSpanIds={sourceSpanIds}
          sourceSpans={rowSourceSpans}
          fallbackPage={node.pageStart}
          fileUrl={fileUrl}
        />
      </div>
      {open && canExpand ? (
        <div className="space-y-3 px-5 pb-4">
          {loadingChildren ? (
            <SourceNodeChildrenSkeleton />
          ) : null}
          {rendersTable ? (
            <SourceNodeTable
              policyId={policyId}
              node={hydratedNode}
              sourceSpans={rowSourceSpans}
              fileUrl={fileUrl}
              allowOperatorSourceAccess={allowOperatorSourceAccess}
            />
          ) : null}
          {factRows.length > 0 ? (
            <div className="overflow-hidden rounded-md border border-border">
              <KeyValueTable
                rows={factRows}
                sourceSpans={rowSourceSpans}
                fileUrl={fileUrl}
                className="border-0"
              />
            </div>
          ) : null}
          {inlineContent.map((item) =>
            item.type === "text" ? (
              <SourceTextParagraphs
                key={item.id}
                policyId={policyId}
                nodes={item.nodes}
                sourceSpans={rowSourceSpans}
                fileUrl={fileUrl}
                allowOperatorSourceAccess={allowOperatorSourceAccess}
              />
            ) : (
              <InlineSourceNodeTable
                key={item.id}
                policyId={policyId}
                node={item.node}
                sourceSpans={rowSourceSpans}
                fileUrl={fileUrl}
                allowOperatorSourceAccess={allowOperatorSourceAccess}
                trailingTextNodes={item.trailingTextNodes}
              />
            ),
          )}
          {structuredChildren.length > 0 ? (
            <div
              className={
                shouldFrameStructuredChildren
                  ? "overflow-hidden rounded-md border border-border bg-background"
                  : "-mx-5 border-t border-border bg-background"
              }
            >
              {structuredChildren.map((child) => (
                <OutlineNodeRow
                  key={child.id}
                  policyId={policyId}
                  node={child}
                  policyDocument={policyDocument}
                  sourceSpans={rowSourceSpans}
                  fileUrl={fileUrl}
                  allowOperatorSourceAccess={allowOperatorSourceAccess}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SourceBackedBreakdown({
  policyId,
  policyDocument,
  sourceSpans,
  fileUrl,
  allowOperatorSourceAccess,
}: {
  policyId?: Id<"policies">;
  policyDocument: PolicyDocument;
  sourceSpans?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
}) {
  const topLevelSourceNodes = useTopLevelSourceNodes(policyId, allowOperatorSourceAccess);
  const loadingSourceNodes = policyId !== undefined && topLevelSourceNodes === undefined;
  const usingSourceNodes = Boolean(topLevelSourceNodes?.length);
  const renderableOutline = useMemo(
    () => {
      const outline = topLevelSourceNodes && topLevelSourceNodes.length > 0
        ? topLevelSourceNodes
        : policyId && loadingSourceNodes
          ? []
          : policyDocument.documentOutline ?? [];
      return outline.filter((node) => sourceNodeHasRenderableContent(node, policyDocument));
    },
    [loadingSourceNodes, policyDocument, policyId, topLevelSourceNodes],
  );

  return (
    <div className="space-y-4">
      <OperationalPanel as="div">
        <OperationalPanelHeader title="Source hierarchy" />
        <div>
          {loadingSourceNodes ? (
            <p className={`px-5 py-4 text-muted-foreground ${typeStyle("caption.default")}`}>
              Loading source hierarchy...
            </p>
          ) : null}
          {!loadingSourceNodes && renderableOutline.length === 0 ? (
            <p className={`px-5 py-4 text-muted-foreground ${typeStyle("caption.default")}`}>
              Source hierarchy is unavailable for this policy.
            </p>
          ) : null}
          {renderableOutline.map((node) => (
            <OutlineNodeRow
              key={node.id}
              policyId={usingSourceNodes ? policyId : undefined}
              node={node}
              policyDocument={policyDocument}
              sourceSpans={sourceSpans}
              fileUrl={fileUrl}
              allowOperatorSourceAccess={allowOperatorSourceAccess}
            />
          ))}
        </div>
      </OperationalPanel>
    </div>
  );
}

function SourceNativeBreakdownUnavailable() {
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-50/60 p-4 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
      <div className="flex gap-2">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className={`${typeStyle("body.medium")}`}>Source document outline unavailable</p>
          <p className={`mt-1 opacity-80 ${typeStyle("caption.default")}`}>
            This policy does not have the top-level document outline generated by
            the current extraction pipeline. Re-extract it from the original PDF
            to see the source-order breakdown. The legacy extracted fields below
            are shown for reference.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Group wrapper ─────────────────────────────────────────────────────────────

export function GroupSection({
  label,
  children,
  defaultOpen,
}: {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-foreground/[0.02] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
        )}
        <span className={`text-foreground flex-1 ${typeStyle("body.medium")}`}>
          {label}
        </span>
      </button>
      {open && <div className="space-y-0">{children}</div>}
    </div>
  );
}

// ─── Public component ─────────────────────────────────────────────────────────

export interface ExtractionPanelProps {
  policyId?: Id<"policies">;
  /** The full `document` field from the policy record */
  policyDocument: PolicyDocument | null | undefined;
  /** page number that triggered the URL (for section highlighting) */
  initialPage?: number;
  sourceSpansOverride?: SourceSpanDoc[];
  fileUrl?: string;
  allowOperatorSourceAccess?: boolean;
}

/** Renders extraction details as separate, flat cards — one per data type */
export function ExtractionCards({
  policyId,
  policyDocument,
  initialPage: _initialPage,
  sourceSpansOverride,
  fileUrl,
  allowOperatorSourceAccess,
}: ExtractionPanelProps) {
  const allSourceSpanIds = useMemo(
    () => collectSourceSpanIds(policyDocument),
    [policyDocument],
  );
  const queriedSourceSpans = usePolicySourceSpans(
    policyId,
    sourceSpansOverride ? [] : allSourceSpanIds,
    { allowOperatorAccess: allowOperatorSourceAccess },
  );
  const sourceSpans = sourceSpansOverride ?? queriedSourceSpans;
  const coverages = enrichedCoverageRows(policyDocument);
  const declarations = Array.isArray(
    (
      policyDocument?.declarations as
        | { fields?: DeclarationField[] }
        | undefined
    )?.fields,
  )
    ? ((policyDocument?.declarations as { fields?: DeclarationField[] })
        .fields ?? [])
    : [];
  const premiumRows = [
    policyDocument?.premium && {
      label: "Premium",
      value: policyDocument.premium,
    },
  ].filter(Boolean) as { label: string; value: string }[];
  const taxesAndFees = policyDocument?.taxesAndFees ?? [];
  const premiumBreakdown = policyDocument?.premiumBreakdown ?? [];
  const limits = objectEntries(policyDocument?.limits);
  const deductibles = objectEntries(policyDocument?.deductibles);
  const formInventory = policyDocument?.formInventory ?? [];
  const supplementaryFacts = policyDocument?.supplementaryFacts ?? [];
  const sections = policyDocument?.sections ?? [];
  const declarationsPage = declarationsFallbackPage(sections);
  const definitions = policyDocument?.definitions ?? [];
  const coveredReasons = policyDocument?.coveredReasons ?? [];
  const endorsements = policyDocument?.endorsements ?? [];
  const costsAndFees = policyDocument?.costsAndFees;
  const fees = costsAndFees?.fees ?? [];
  const exclusions = policyDocument?.exclusions ?? [];
  const conditions = policyDocument?.conditions ?? [];
  const documentOutline = policyDocument?.documentOutline ?? [];
  const carrierIdentity = readCarrierIdentity(
    policyDocument?.carrierIdentity,
  );
  const carrierDisplay =
    carrierIdentity?.displayName ||
    policyDocument?.carrier ||
    policyDocument?.security ||
    policyDocument?.carrierLegalName;
  const generalAgentDisplay =
    policyDocument?.generalAgent?.agencyName || policyDocument?.mga;
  const topLevelRows = compactRows([
    carrierDisplay && { label: "Carrier", value: carrierDisplay },
    formatCarrierLegalEntityNames(carrierIdentity) && {
      label: carrierIdentity?.legalEntities.length === 1
        ? "Legal entity"
        : "Legal entities",
      value: formatCarrierLegalEntityNames(carrierIdentity),
    },
    generalAgentDisplay &&
      !sameCarrierIdentityName(
        generalAgentDisplay,
        carrierIdentity?.operatingName,
      ) && {
      label: "General Agent",
      value: generalAgentDisplay,
    },
    policyDocument?.insurer?.naicNumber && {
      label: "Insurer NAIC number",
      value: policyDocument.insurer.naicNumber,
    },
    policyDocument?.producer?.licenseNumber && {
      label: "Producer license number",
      value: policyDocument.producer.licenseNumber,
    },
    policyDocument?.generalAgent?.licenseNumber && {
      label: "General Agent license number",
      value: policyDocument.generalAgent.licenseNumber,
    },
    policyDocument?.policyNumber && {
      label: "Policy number",
      value: policyDocument.policyNumber,
    },
    policyDocument?.insuredName && {
      label: "Named insured",
      value: policyDocument.insuredName,
    },
    (policyDocument?.effectiveDate || policyDocument?.expirationDate) && {
      label: "Policy period",
      value: formatDisplayPolicyPeriod(
        policyDocument.effectiveDate,
        policyDocument.expirationDate,
        policyDocument.policyTermType,
      ),
    },
    policyLobCodes(policyDocument ?? {}).filter((code) => code !== "UN").length && {
      label: "Lines of business",
      value: policyLobCodes(policyDocument ?? {})
        .filter((code) => code !== "UN")
        .map((code) => lobLabel(code) ?? formatStructuredLabel(code) ?? code)
        .join(", "),
    },
    policyDocument?.premium && {
      label: "Premium",
      value: policyDocument.premium,
    },
  ]);
  const declarationRows = declarations
    .map((field) => ({
      label: formatStructuredLabel(field.field) ?? field.field ?? "Field",
      value: field.value ?? "",
      section: field.section
        ? (formatStructuredLabel(field.section) ?? field.section)
        : undefined,
      pageNumber: firstNumericPage(
        field.pageNumber,
        field.pageStart,
        declarationsPage,
      ),
      sourceSpanIds: sourceSpanIdsFrom(field),
    }))
    .filter((row) => row.value);

  const hasAnyData =
    Boolean(policyId) ||
    documentOutline.length > 0 ||
    Boolean(policyDocument?.documentMetadata) ||
    topLevelRows.length > 0 ||
    coverages.length > 0 ||
    declarations.length > 0 ||
    premiumRows.length > 0 ||
    taxesAndFees.length > 0 ||
    premiumBreakdown.length > 0 ||
    limits.length > 0 ||
    deductibles.length > 0 ||
    formInventory.length > 0 ||
    supplementaryFacts.length > 0 ||
    definitions.length > 0 ||
    coveredReasons.length > 0 ||
    endorsements.length > 0 ||
    costsAndFees ||
    exclusions.length > 0 ||
    conditions.length > 0 ||
    policyDocument?.claimsContact ||
    policyDocument?.complaintContact ||
    policyDocument?.regulatoryContext;

  if (!hasAnyData) return null;
  if (!policyDocument) return null;

  return (
    <div className="space-y-4">
      {topLevelRows.length > 0 && (
        <DataCard
          title="Policy details"
          rows={topLevelRows}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
        />
      )}

      {policyId || documentOutline.length > 0 ? (
        <SourceBackedBreakdown
          policyId={policyId}
          policyDocument={policyDocument}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          allowOperatorSourceAccess={allowOperatorSourceAccess}
        />
      ) : (
        <SourceNativeBreakdownUnavailable />
      )}

      {coverages.length > 0 && (
        <StructuredItemsCard
          id="ep-coverages"
          title="Coverages"
          items={coverages}
          getTitle={(coverage) =>
            coverage.name ??
            coverage.coverageSourceContext ??
            "Unnamed coverage"
          }
          getTrailing={(coverage) => coverage.limit}
          hasBody={coverageHasExtraDetails}
          getPage={(coverage) => coverage.pageNumber}
          getSourceSpanIds={(coverage) => coverage.sourceSpanIds}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(coverage) =>
            [
              coverage.coverageCode
                ? {
                    label: coverage.coverageCode,
                    className: "bg-foreground/5 text-muted-foreground",
                  }
                : undefined,
              coverage.formNumber
                ? {
                    label: coverage.formNumber,
                    className: "bg-foreground/5 text-muted-foreground",
                  }
                : undefined,
            ].filter(Boolean) as { label: string; className: string }[]
          }
          renderBody={(coverage) => (
            <CoverageBody coverage={coverage} />
          )}
        />
      )}

      {limits.length > 0 && (
        <DataCard title="Limits" rows={limits} sourceSpans={sourceSpans} fileUrl={fileUrl} />
      )}
      {deductibles.length > 0 && (
        <DataCard
          title="Deductibles"
          rows={deductibles}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
        />
      )}

      {(premiumRows.length > 0 ||
        taxesAndFees.length > 0 ||
        premiumBreakdown.length > 0) && (
        <SectionedDataCard
          title="Premium"
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          sections={[
            {
              label: "Summary",
              rows: premiumRows,
            },
            {
              label: "Taxes & fees",
              rows: taxesAndFees
                .map((item) => ({
                  label: item.name,
                  value: item.amount ?? "",
                  section: item.type
                    ? (formatStructuredLabel(item.type) ?? item.type)
                    : item.description,
                  sourceSpanIds: sourceSpanIdsFrom(item),
                }))
                .filter((row) => row.label && row.value),
            },
            {
              label: "Breakdown",
              rows: premiumBreakdown
                .map((item) => ({
                  label: item.line ?? "Premium line",
                  value: item.amount ?? "",
                  sourceSpanIds: sourceSpanIdsFrom(item),
                }))
                .filter((row) => row.value),
            },
          ]}
        />
      )}

      {declarations.length > 0 && (
        <SectionedDataCard
          title="Declarations"
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          sections={groupRowsBySection(declarationRows)}
        />
      )}

      {definitions.length > 0 && (
        <StructuredItemsCard
          id="ep-definitions"
          title="Definitions"
          items={definitions}
          getTitle={(definition) => definition.term ?? "Unnamed definition"}
          getPage={(definition) => definition.pageNumber}
          getSourceSpanIds={(definition) => definition.sourceSpanIds}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(definition) =>
            definition.sectionRef
              ? [
                  {
                    label: definition.sectionRef,
                    className:
                      "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400",
                  },
                ]
              : []
          }
          renderBody={(definition) => <DefinitionBody definition={definition} />}
        />
      )}

      {coveredReasons.length > 0 && (
        <StructuredItemsCard
          id="ep-covered-reasons"
          title="Covered reasons"
          items={coveredReasons}
          getTitle={(reason) =>
            [
              reason.reasonNumber,
              reason.title ?? reason.coverageName ?? "Covered reason",
            ]
              .filter(Boolean)
              .join(". ")
          }
          getPage={(reason) => reason.pageNumber}
          getSourceSpanIds={(reason) => reason.sourceSpanIds}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(reason) =>
            [
              reason.coverageName
                ? {
                    label: reason.coverageName,
                    className:
                      "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
                  }
                : undefined,
              reason.conditions?.length
                ? {
                    label: "Conditions",
                    className:
                      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                  }
                : undefined,
            ].filter(Boolean) as { label: string; className: string }[]
          }
          renderBody={(reason) => <CoveredReasonBody reason={reason} />}
        />
      )}

      {formInventory.length > 0 && (
        <DataCard
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          title="Form inventory"
          rows={formInventory
            .map((form) => ({
              label: form.title || form.formNumber || "Untitled form",
              value: [
                form.formType
                  ? (formatStructuredLabel(form.formType) ?? form.formType)
                  : null,
                form.formNumber,
                form.editionDate,
                form.pageStart != null
                  ? `Pages ${form.pageStart}${form.pageEnd && form.pageEnd !== form.pageStart ? `-${form.pageEnd}` : ""}`
                  : null,
              ]
                .filter(Boolean)
                .join(" | "),
              sourceSpanIds: sourceSpanIdsFrom(form),
            }))
            .filter((row) => row.value)}
        />
      )}

      {supplementaryFacts.length > 0 && (
        <DataCard
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          title="Supplementary facts"
          rows={supplementaryFacts
            .map((fact) => ({
              label: formatStructuredLabel(fact.key) ?? fact.key ?? "Fact",
              value: fact.value ?? "",
              section:
                [fact.subject, fact.context].filter(Boolean).join(" | ") ||
                undefined,
              sourceSpanIds: sourceSpanIdsFrom(fact),
            }))
            .filter((row) => row.value)}
        />
      )}

      {/* Endorsements */}
      {endorsements.length > 0 && (
        <StructuredItemsCard
          id="ep-endorsements"
          title="Endorsements"
          items={endorsements}
          getTitle={(e) =>
            e.title ?? e.name ?? e.formNumber ?? "Unnamed endorsement"
          }
          getPage={(e) => e.pageStart}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(e) =>
            [
              e?.endorsementType
                ? {
                    label:
                      formatStructuredLabel(e.endorsementType) ??
                      e.endorsementType,
                    className:
                      e.endorsementType === "restriction" ||
                      e.endorsementType === "exclusion"
                        ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400"
                        : e.endorsementType === "broadening"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400",
                  }
                : undefined,
              e?.effectiveDate
                ? {
                    label: `Eff. ${formatDisplayDate(e.effectiveDate, e.effectiveDate)}`,
                    className: "bg-foreground/5 text-muted-foreground",
                  }
                : undefined,
            ].filter(Boolean) as { label: string; className: string }[]
          }
          renderBody={(e) => <EndorsementBody e={e} />}
        />
      )}

      {/* Costs & Fees */}
      {costsAndFees && (
        <SupplementaryCard
          title="Costs & fees"
          pageNumber={costsAndFees.pageNumber}
          content={costsAndFees.content ?? ""}
          hasStructured={fees.length > 0}
        >
          {fees.length > 0 && (
            <div className="-mx-4 -mt-3">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-foreground/[0.02]">
                    <th className={`px-4 py-2.5 text-muted-foreground ${typeStyle("label.table")}`}>
                      Name
                    </th>
                    <th className={`px-4 py-2.5 text-muted-foreground text-right ${typeStyle("label.table")}`}>
                      Amount
                    </th>
                    <th className={`hidden sm:table-cell px-4 py-2.5 text-muted-foreground ${typeStyle("label.table")}`}>
                      Type
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {(fees as Record<string, unknown>[]).map((f, i: number) => (
                    <tr
                      key={i}
                      className="border-t border-border-subtle hover:bg-foreground/[0.015] transition-colors"
                    >
                      <td className={`px-4 py-2.5 text-foreground ${typeStyle("body.medium")}`}>
                        {String(f.name ?? "—")}
                      </td>
                      <td className={`px-4 py-2.5 text-foreground text-right ${typeStyle("body.medium")}`}>
                        {String(f.amount ?? "—")}
                      </td>
                      <td className={`hidden sm:table-cell px-4 py-2.5 text-muted-foreground ${typeStyle("body.default")}`}>
                        {String(f.type ?? "—")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SupplementaryCard>
      )}

      {/* Exclusions */}
      {exclusions.length > 0 && (
        <StructuredItemsCard
          id="ep-exclusions"
          title="Exclusions"
          items={exclusions}
          getTitle={(ex) =>
            typeof ex === "string"
              ? ex
              : (ex?.name ?? ex?.title ?? "Unnamed exclusion")
          }
          getPage={(ex) =>
            typeof ex === "string" ? undefined : (ex.pageNumber ?? ex.pageStart)
          }
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(ex) => {
            if (typeof ex === "string") return [];
            return [
              ex?.buybackAvailable
                ? {
                    label: "Buyback",
                    className:
                      "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
                  }
                : undefined,
            ].filter(Boolean) as { label: string; className: string }[];
          }}
          renderBody={(ex) => {
            if (typeof ex === "string") {
              return <DocContent>{ex}</DocContent>;
            }
            return <ExclusionBody ex={ex} />;
          }}
        />
      )}

      {/* Conditions */}
      {conditions.length > 0 && (
        <StructuredItemsCard
          id="ep-conditions"
          title="Conditions"
          items={conditions}
          getTitle={(c) => c.name ?? c.title ?? "Unnamed condition"}
          getPage={(c) => c.pageNumber}
          sourceSpans={sourceSpans}
          fileUrl={fileUrl}
          getBadges={(c) =>
            c?.conditionType
              ? [
                  {
                    label:
                      formatStructuredLabel(c.conditionType) ??
                      c.conditionType,
                    className:
                      "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
                  },
                ]
              : []
          }
          renderBody={(c) => <ConditionBody c={c} />}
        />
      )}

      {/* Claims contact */}
      {policyDocument?.claimsContact && (
        <SupplementaryCard
          title="Claims contact"
          pageNumber={policyDocument.claimsContact.pageNumber}
          content={policyDocument.claimsContact.content}
          hasStructured={
            !!(
              policyDocument.claimsContact.contacts?.length ||
              policyDocument.claimsContact.processSteps?.length ||
              policyDocument.claimsContact.reportingTimeLimit
            )
          }
        >
          <ClaimsContactStructured data={policyDocument.claimsContact} />
        </SupplementaryCard>
      )}

      {/* Complaint contact */}
      {policyDocument?.complaintContact && (
        <SupplementaryCard
          title="Complaint contact"
          pageNumber={policyDocument.complaintContact.pageNumber}
          content={policyDocument.complaintContact.content}
          hasStructured={!!policyDocument.complaintContact.contacts?.length}
        >
          <ComplaintContactStructured
            contacts={policyDocument.complaintContact.contacts}
          />
        </SupplementaryCard>
      )}

      {/* Regulatory context */}
      {policyDocument?.regulatoryContext && (
        <SupplementaryCard
          title="Regulatory context"
          pageNumber={policyDocument.regulatoryContext.pageNumber}
          content={policyDocument.regulatoryContext.content}
          hasStructured={
            !!(
              policyDocument.regulatoryContext.jurisdiction ||
              policyDocument.regulatoryContext.regulatoryBody ||
              policyDocument.regulatoryContext.governingLaw ||
              policyDocument.regulatoryContext.details?.length
            )
          }
        >
          <RegulatoryContextStructured data={policyDocument.regulatoryContext} />
        </SupplementaryCard>
      )}
    </div>
  );
}
