import type { PageContext } from "@/hooks/use-page-context";

/** `normalizeOperatorPageContext` rejects longer summaries and keeps 10 related records. */
const MAX_SUMMARY_LENGTH = 500;
const MAX_RELATED = 10;

export type ProcurementContextRef = NonNullable<PageContext["related"]>[number];

export type ProcurementContextPart = {
  text: string;
  /** The records the part names, in `related`. */
  refs?: readonly ProcurementContextRef[];
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Joins summary parts within the normalizer's bounds and collects their
 * records. Earlier parts' records come first, so the open drawer's record is
 * the first of its kind.
 */
function describe(
  parts: ReadonlyArray<ProcurementContextPart | null | undefined>,
) {
  const present = parts.filter(
    (part): part is ProcurementContextPart => part != null,
  );
  const related = present
    .flatMap((part) => part.refs ?? [])
    .slice(0, MAX_RELATED)
    .map((ref) => (ref.label ? { ...ref, label: clip(ref.label, 200) } : ref));
  return {
    summary: clip(
      present
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join(" · "),
      MAX_SUMMARY_LENGTH,
    ),
    ...(related.length ? { related } : {}),
  };
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
  section?: ProcurementContextPart;
  open?: ProcurementContextPart | null;
}): PageContext {
  return {
    pageType: "procurement_request",
    entityId: args.requestId,
    ...describe([
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
      {
        text: "",
        refs: [
          {
            kind: "organization",
            id: args.clientOrgId,
            ...(args.clientName ? { label: args.clientName } : {}),
          },
        ],
      },
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
  const named = args.checked.slice(0, 3);
  return {
    pageType: args.clientOrgId
      ? "operator_client_procurement"
      : "operator_procurement",
    ...(args.clientOrgId ? { entityId: args.clientOrgId } : {}),
    ...describe([
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
      args.checked.length
        ? {
            text: `Checked ${args.checked.length}: ${named.map((row) => clip(row.title, 60)).join(", ")}${args.checked.length > named.length ? ", …" : ""}`,
            refs: args.checked.map((row) => ({
              kind: "procurement_request",
              id: row.id,
              label: row.title,
            })),
          }
        : null,
      args.open ? { text: `Open drawer: ${args.open}` } : null,
    ]),
  };
}
