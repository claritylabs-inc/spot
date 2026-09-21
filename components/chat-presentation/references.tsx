"use client";

import { useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import type { PresentationReference } from "@/lib/chat-presentation";
import { REQUIREMENT_SOURCE_TYPE_LABELS } from "@/convex/lib/complianceTypes";
import { getOperatorBrokerHref } from "@/lib/operator-navigation";
import { useEntityPreview } from "@/hooks/use-entity-preview";
import { usePdf } from "@/components/pdf-context";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";
import { usePresentation } from "./context";

// Only supported record destinations are navigable. File URLs come from Convex.
export function referenceHref(
  reference: PresentationReference,
): string | undefined {
  if (reference.kind === "file" || reference.kind === "source")
    return undefined;
  if (reference.kind === "vendor")
    return `/connect/vendors/${encodeURIComponent(reference.recordId)}/policies`;
  const href = reference.href;
  if (href && !/[\\\s%#]/.test(href)) {
    const id = reference.recordId;
    const parts = href.split("?");
    if (parts.length > 2) return undefined;
    const path = parts[0];
    const query = new URLSearchParams(parts[1]);
    if (
      reference.kind === "policy" &&
      /^(?:\/(?:operator\/clients|connect\/vendors)\/[a-zA-Z0-9_-]+)?\/policies\/[a-zA-Z0-9_-]+$/.test(
        path,
      ) &&
      path.endsWith(`/${id}`) &&
      !parts[1]
    )
      return href;
    if (
      reference.kind === "request" &&
      (/^\/requests\/[a-zA-Z0-9_-]+$/.test(path) ||
        /^\/operator\/clients\/[a-zA-Z0-9_-]+\/procurement\/[a-zA-Z0-9_-]+$/.test(
          path,
        )) &&
      path.endsWith(`/${id}`) &&
      !parts[1]
    )
      return href;
    if (
      reference.kind === "requirement" &&
      /^(?:\/operator\/clients\/[a-zA-Z0-9_-]+)?\/compliance$/.test(path) &&
      ((query.size === 1 && query.get("tab") === "requirements") ||
        (query.size === 2 &&
          query.get("tab") === "requirements" &&
          query.get("requirement") === id))
    )
      return href;
    if (reference.kind === "provider" && href === getOperatorBrokerHref(id))
      return href;
    if (
      reference.kind === "proposal" &&
      /^\/operator\/clients\/[a-zA-Z0-9_-]+\/procurement\/[a-zA-Z0-9_-]+$/.test(
        path,
      ) &&
      query.get("view") === "proposals" &&
      (query.size === 1 || (query.size === 2 && query.get("proposal") === id))
    )
      return href;
  }
  return undefined;
}

function FileLink({
  reference,
  label,
}: {
  reference: PresentationReference;
  label: string;
}) {
  const convex = useConvex();
  const pdf = usePdf();
  const { audience, references, closeRecord } = usePresentation();
  const requestReference = reference.requestId
    ? [...references.values()].find(
        (item) =>
          item.kind === "request" && item.recordId === reference.requestId,
      )
    : undefined;
  const requestHref = requestReference
    ? referenceHref(requestReference)
    : reference.requestId && audience !== "operator"
      ? `/requests/${encodeURIComponent(reference.requestId)}`
      : undefined;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const resolve = async () => {
    if (pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(false);
    try {
      let result: string | null;
      let contentType: string | undefined;
      if (reference.requestId) {
        const args = {
          requestId: reference.requestId as Id<"procurementRequests">,
        };
        if (audience === "operator") {
          const request = await convex.query(api.procurementRequests.get, args);
          const file = request?.files.find(
            (item) => item.clientFileId === reference.recordId,
          )?.clientFile;
          result = file?.url ?? null;
          contentType = file?.contentType;
        } else {
          const request = await convex.query(
            api.clientProcurementRequests.get,
            args,
          );
          const file = request.files.find(
            (item) => item.clientFileId === reference.recordId,
          );
          result = file?.url ?? null;
          contentType = file?.contentType;
        }
      } else {
        result = await convex.query(api.clientFiles.getUrl, {
          clientFileId: reference.recordId as Id<"clientFiles">,
        });
      }
      if (
        result &&
        (contentType === "application/pdf" || /\.pdf$/i.test(reference.label))
      ) {
        closeRecord?.();
        pdf.openWithUrl(result, reference.page);
      }
      setUrl(result);
      setError(!result);
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      {url ? (
        <PillButton
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          download={reference.label}
          size="compact"
          variant="secondary"
          className="max-w-full"
          title={`Download ${label}`}
        >
          <span className="truncate">Download {label}</span>
        </PillButton>
      ) : (
        <PillButton
          type="button"
          size="compact"
          variant="secondary"
          disabled={loading}
          className="max-w-full"
          title={label}
          onClick={() => void resolve()}
        >
          <span className="truncate">{loading ? "Loading file…" : label}</span>
        </PillButton>
      )}
      {error ? (
        <span
          role="alert"
          className={`text-destructive ${typeStyle("caption.default")}`}
        >
          File unavailable. Try again.
        </span>
      ) : null}
      {error && requestHref ? (
        <PillButton href={requestHref} variant="secondary" size="compact">
          Open request
        </PillButton>
      ) : null}
    </span>
  );
}

function RequirementSourceLink({
  reference,
  label,
}: {
  reference: PresentationReference;
  label: string;
}) {
  const convex = useConvex();
  const { organizationId, openEvidence } = usePresentation();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const pending = useRef(false);
  const path = reference.href?.split("?")[0];
  const match = path?.match(
    /^(?:\/operator\/clients\/([a-zA-Z0-9_-]+))?\/compliance$/,
  );
  const orgId = match?.[1] ?? organizationId;
  const inspect = async () => {
    if (pending.current) return;
    if (!orgId) {
      setError(true);
      return;
    }
    pending.current = true;
    setLoading(true);
    setError(false);
    try {
      const sources = await convex.query(
        api.compliance.listRequirementSources,
        { orgId: orgId as Id<"organizations"> },
      );
      const source = sources.find((item) => item._id === reference.recordId);
      if (!source) {
        setError(true);
        return;
      }
      openEvidence?.({
        title: source.title,
        values: [
          {
            label: "Source type",
            value: REQUIREMENT_SOURCE_TYPE_LABELS[source.sourceType],
          },
          ...(source.fileName
            ? [{ label: "File", value: source.fileName }]
            : []),
          {
            label: "Source excerpt",
            value: source.sourceTextExcerpt || "No text excerpt available.",
          },
        ],
        sourceIds: [],
      });
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  if (!match) return <span>{label}</span>;
  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <PillButton
        type="button"
        variant="ghost"
        size="compact"
        className="max-w-full"
        title={label}
        disabled={loading}
        onClick={() => void inspect()}
      >
        <span className="truncate">{loading ? "Loading source…" : label}</span>
      </PillButton>
      {error ? (
        <span
          role="alert"
          className={`text-destructive ${typeStyle("caption.default")}`}
        >
          Source unavailable. Try again.
        </span>
      ) : null}
    </span>
  );
}

export function ReferenceLink({
  referenceId,
  label,
}: {
  referenceId: string;
  label?: string;
}) {
  const { references, openRecord, closeRecord } = usePresentation();
  const { openPreview } = useEntityPreview();
  const reference = references.get(referenceId);
  if (!reference) return null;
  const name = label ?? reference.label;
  if (reference.kind === "file")
    return <FileLink reference={reference} label={name} />;
  if (reference.kind === "source" && reference.sourceUrl)
    return (
      <PillButton
        href={reference.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        size="compact"
        variant="ghost"
        className="max-w-full"
        title={name}
      >
        <span className="truncate">{name}</span>
      </PillButton>
    );
  const policyId =
    reference.kind === "policy"
      ? reference.recordId
      : reference.kind === "source"
        ? reference.policyId
        : undefined;
  if (policyId)
    return (
      <PillButton
        type="button"
        size="compact"
        variant="ghost"
        className="max-w-full"
        title={name}
        onClick={() => {
          closeRecord?.();
          openPreview({
            type: "policy",
            id: policyId,
            page: reference.page,
            citedSourceSpanIds: reference.sourceSpanIds,
          });
        }}
      >
        <span className="truncate">
          {name}
          {reference.page ? ` · p. ${reference.page}` : ""}
        </span>
      </PillButton>
    );
  const href = referenceHref(reference);
  if (href)
    return (
      <PillButton
        href={href}
        size="compact"
        variant="secondary"
        className="max-w-full"
        title={name}
      >
        <span className="truncate">{name}</span>
      </PillButton>
    );
  if (reference.kind === "source")
    return <RequirementSourceLink reference={reference} label={name} />;
  return (
    <PillButton
      type="button"
      size="compact"
      variant="ghost"
      onClick={() => openRecord(reference)}
      className="max-w-full"
      title={name}
    >
      <span className="truncate">{name}</span>
    </PillButton>
  );
}

export function Sources({ ids }: { ids: string[] }) {
  if (!ids.length) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-1">
      {[...new Set(ids)].map((id) => (
        <ReferenceLink key={id} referenceId={id} />
      ))}
    </div>
  );
}
