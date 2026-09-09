"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";

import { ProseMarkdown } from "@/components/prose-markdown";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import {
  ORG_WIKI_SECTIONS,
  type OrgWikiSectionKey,
} from "@/convex/lib/orgWiki";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { formatDisplayDate } from "@/lib/date-format";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

type WikiSection = Doc<"orgWikiSections">;

type SectionRow = {
  key: OrgWikiSectionKey;
  heading: string;
  section?: WikiSection;
};

const SOURCE_LABELS: Record<string, string> = {
  chat: "Chat",
  email: "Email",
  imessage: "iMessage",
  extraction: "Extraction",
  analysis: "Analysis",
  slack: "Slack",
  manual: "Manual",
  operator: "Operator",
  mcp: "MCP",
};

function SectionDrawer({
  heading,
  initialBody,
  onSave,
  onClose,
}: {
  heading: string;
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  onClose: () => void;
}) {
  const [body, setBody] = useState(initialBody);
  const trimmedBody = body.trim();
  const emptyDraft = !trimmedBody && body !== initialBody;
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgWiki.upsertSection",
    args: trimmedBody,
    canSave: !emptyDraft,
    flush: onSave,
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Failed to save the wiki section"),
  });

  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onClose();
          });
      }}
      title={heading}
      actions={<AutoSaveStatus status={autoSave.status} />}
    >
      <div className="space-y-5">
        <label className="block space-y-1.5">
          <span
            className={`text-muted-foreground ${typeStyle("caption.default")}`}
          >
            Section markdown
          </span>
          <Textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            className="min-h-64"
            maxLength={20_000}
            placeholder="- Cove operates a commercial vehicle fleet."
            aria-invalid={emptyDraft}
            aria-describedby={emptyDraft ? "wiki-section-error" : undefined}
          />
        </label>
        {emptyDraft ? (
          <p
            id="wiki-section-error"
            role="alert"
            className={`text-destructive ${typeStyle("body.default")}`}
          >
            Enter company facts before closing this section.
          </p>
        ) : null}
      </div>
    </SettingsDrawer>
  );
}

export function CompanyWikiSection({
  clientOrgId,
  operator = false,
  readOnly = false,
  onActions,
  onRightPanel,
}: {
  clientOrgId?: Id<"organizations">;
  operator?: boolean;
  readOnly?: boolean;
  onActions?: (node: ReactNode) => void;
  onRightPanel?: (node: ReactNode) => void;
} = {}) {
  const currentOrg = useCurrentOrg();
  const orgId = clientOrgId ?? currentOrg?.orgId;
  const tenantWiki = useQuery(
    api.orgWiki.get,
    orgId && !operator ? { orgId } : "skip",
  );
  const operatorWiki = useQuery(
    api.orgWiki.getForOperator,
    orgId && operator ? { orgId } : "skip",
  );
  const upsertTenant = useMutation(api.orgWiki.upsertSection);
  const upsertOperator = useMutation(api.orgWiki.upsertSectionForOperator);
  const acceptProposal = useMutation(api.orgWiki.acceptProposal);
  const rejectProposal = useMutation(api.orgWiki.rejectProposal);
  const settingsActions = useSettingsActions();
  const setActions = onActions ?? settingsActions.setActions;
  const setRightPanel = onRightPanel ?? settingsActions.setRightPanel;

  const wiki = operator ? operatorWiki : tenantWiki;
  const canManage = Boolean(
    orgId && !readOnly && (operator || currentOrg?.role === "admin"),
  );
  const [editingKey, setEditingKey] = useState<OrgWikiSectionKey | null>(null);

  const rows = useMemo<SectionRow[]>(() => {
    const sections: WikiSection[] = wiki?.sections ?? [];
    return ORG_WIKI_SECTIONS.map(([key, heading]) => ({
      key,
      heading,
      section: sections.find((section) => section.key === key),
    }));
  }, [wiki]);

  const closeDrawer = useCallback(() => setEditingKey(null), []);
  const editing = rows.find((row) => row.key === editingKey);
  const editingHeading = editing?.heading;
  const editingBody = editing?.section?.body ?? "";

  useEffect(() => {
    setActions(null);
    return () => setActions(null);
  }, [setActions]);

  useEffect(() => {
    if (!orgId || !canManage || !editingKey || !editingHeading) {
      setRightPanel(null);
      return;
    }
    setRightPanel(
      <SectionDrawer
        key={editingKey}
        heading={editingHeading}
        initialBody={editingBody}
        onSave={async (body) => {
          await (operator
            ? upsertOperator({ orgId, key: editingKey, body })
            : upsertTenant({ orgId, key: editingKey, body }));
        }}
        onClose={closeDrawer}
      />,
    );
    return () => setRightPanel(null);
  }, [
    canManage,
    closeDrawer,
    editingBody,
    editingHeading,
    editingKey,
    operator,
    orgId,
    setRightPanel,
    upsertOperator,
    upsertTenant,
  ]);

  async function resolveProposal(key: OrgWikiSectionKey, accept: boolean) {
    if (!orgId) return;
    try {
      await (accept
        ? acceptProposal({ orgId, key })
        : rejectProposal({ orgId, key }));
      toast.success(accept ? "Extraction applied" : "Extraction dismissed");
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Failed to resolve the proposal"),
      );
    }
  }

  if (!orgId || wiki === undefined) {
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  }

  if (rows.every((row) => !row.section?.body.trim())) {
    return (
      <EmptyStateCard
        title="No company wiki yet"
        description="The company wiki is one markdown document of stable company facts. Agents read it whole on every conversation, and extraction keeps it current from documents and email."
        actionLabel={canManage ? "Write a section" : undefined}
        onAction={
          canManage ? () => setEditingKey(ORG_WIKI_SECTIONS[0][0]) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {!canManage ? (
        <OperationalPanel as="div" className="px-5 py-4">
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            {readOnly
              ? "The company wiki is read-only while an operator impersonation is active."
              : "All organization members can read the company wiki. Only admins can rewrite a section or resolve a proposal."}
          </p>
        </OperationalPanel>
      ) : null}

      {rows.map((row) => (
        <OperationalPanel as="div" key={row.key} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className={`text-foreground ${typeStyle("body.medium")}`}>
                {row.heading}
              </h3>
              {row.section ? (
                <span
                  className={`text-muted-foreground ${typeStyle("caption.default")}`}
                >
                  {SOURCE_LABELS[row.section.source] ?? row.section.source} ·{" "}
                  {formatDisplayDate(row.section.updatedAt, "—")}
                </span>
              ) : null}
            </div>
            {canManage ? (
              <button
                type="button"
                onClick={() => setEditingKey(row.key)}
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-emphasized"
                aria-label={`Edit ${row.heading}`}
              >
                <Pencil className="size-4" />
              </button>
            ) : null}
          </div>

          {row.section?.body.trim() ? (
            <ProseMarkdown>{row.section.body}</ProseMarkdown>
          ) : (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              Not written yet.
            </p>
          )}

          {row.section?.proposedBody ? (
            <div className="space-y-2 rounded-md border border-border-emphasized/40 bg-muted/40 p-3">
              <p
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {row.section.proposedRationale ?? "Extracted update pending"}
              </p>
              <ProseMarkdown>{row.section.proposedBody}</ProseMarkdown>
              {canManage ? (
                <div className="flex gap-2">
                  <PillButton onClick={() => void resolveProposal(row.key, true)}>
                    Apply
                  </PillButton>
                  <PillButton
                    variant="secondary"
                    onClick={() => void resolveProposal(row.key, false)}
                  >
                    Dismiss
                  </PillButton>
                </div>
              ) : null}
            </div>
          ) : null}
        </OperationalPanel>
      ))}
    </div>
  );
}
