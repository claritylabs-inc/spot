import type { PageContext } from "@/hooks/use-page-context";

/** `normalizeOperatorPageContext` rejects longer summaries. */
const MAX_SUMMARY_LENGTH = 500;

/** IDs are named after the operator tool arguments that take them. */
export type ProcurementContextRef = {
  arg:
    | "orgId"
    | "procurementOutreachId"
    | "procurementProposalId"
    | "procurementFileItemId"
    | "clientFileId"
    | "informationFormId"
    | "questionId"
    | "procurementRequestId";
  id: string;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

type SummaryPart = { text: string; refs?: readonly ProcurementContextRef[] };

const renderPart = (part: SummaryPart) =>
  part.refs?.length
    ? `${part.text} (${part.refs.map((ref) => `${ref.arg} ${ref.id}`).join(", ")})`
    : part.text;

/**
 * Joins summary parts within the normalizer's bound. The first part's text
 * (the record's name) gives way first so trailing IDs are never cut.
 */
function summary(parts: ReadonlyArray<SummaryPart | null | undefined>) {
  const [first, ...rest] = parts.filter((part): part is SummaryPart =>
    Boolean(part?.text.trim()),
  );
  if (!first) return "";
  const tail = rest.map(renderPart);
  const overflow =
    [renderPart(first), ...tail].join(" · ").length - MAX_SUMMARY_LENGTH;
  const head =
    overflow > 0
      ? {
          ...first,
          text: clip(first.text, Math.max(20, first.text.length - overflow)),
        }
      : first;
  return clip([renderPart(head), ...tail].join(" · "), MAX_SUMMARY_LENGTH);
}

/**
 * The open request: its client, status, the section on screen and the drawer
 * the operator has open, so the agent starts from the record in view.
 */
export function procurementRequestPageContext(args: {
  requestId: string;
  clientOrgId: string;
  title?: string;
  clientName?: string;
  status?: string;
  section?: SummaryPart;
  open?: SummaryPart | null;
}): PageContext {
  return {
    pageType: "procurement_request",
    entityId: args.requestId,
    summary: summary([
      {
        text: args.title
          ? `${clip(args.title, 120)} procurement for ${clip(args.clientName ?? "client", 80)}`
          : "Current procurement request",
      },
      args.status ? { text: `Status: ${args.status}` } : null,
      args.section
        ? { ...args.section, text: `Viewing ${args.section.text}` }
        : null,
      args.open
        ? { ...args.open, text: `Open drawer: ${args.open.text}` }
        : null,
      { text: "Client", refs: [{ arg: "orgId", id: args.clientOrgId }] },
    ]),
  };
}

/**
 * A procurement list (one client's, or every client's without `clientOrgId`)
 * with its active filters and checked rows. An open preview is the request.
 */
export function procurementListPageContext(args: {
  clientOrgId?: string;
  clientName?: string;
  filters: string[];
  shown: number;
  total: number;
  checked: ReadonlyArray<{ id: string; title: string }>;
  open?: string;
}): PageContext {
  const checked = args.checked.slice(0, 3);
  return {
    pageType: args.clientOrgId
      ? "operator_client_procurement"
      : "operator_procurement",
    ...(args.clientOrgId ? { entityId: args.clientOrgId } : {}),
    summary: summary([
      {
        text: args.clientOrgId
          ? `New-policy procurement for ${clip(args.clientName ?? "client", 80)}`
          : "Procurement requests across clients",
      },
      args.filters.length
        ? {
            text: `Filtered by ${args.filters.join("; ")}: ${args.shown} of ${args.total} requests shown`,
          }
        : null,
      checked.length
        ? {
            text: `Checked ${args.checked.length}: ${checked.map((row) => clip(row.title, 60)).join(", ")}${args.checked.length > checked.length ? ", …" : ""}`,
            refs: checked.map((row) => ({
              arg: "procurementRequestId" as const,
              id: row.id,
            })),
          }
        : null,
      args.open ? { text: `Open drawer: ${args.open}` } : null,
    ]),
  };
}
