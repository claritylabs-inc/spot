"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { Download, Loader2, Pencil, Upload } from "lucide-react";
import { toast } from "sonner";
import { ProseMarkdown } from "@/components/prose-markdown";
import { useSettingsActions } from "@/components/settings/settings-actions-context";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { Textarea } from "@/components/ui/textarea";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  MAX_MARKDOWN_BYTES,
  parseMarkdownDocument,
} from "@/convex/lib/markdownDocument";
import { useCurrentOrg } from "@/hooks/use-current-org";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";

function WikiDrawer({
  initialMarkdown,
  initialRevision,
  onSave,
  onClose,
}: {
  initialMarkdown: string;
  initialRevision: number;
  onSave: (
    markdown: string,
    expectedRevision: number,
  ) => Promise<{ revision: number }>;
  onClose: () => void;
}) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(initialRevision);
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgWiki.save",
    args: markdown,
    flush: async (value) => {
      const result = await onSave(value, revision.current);
      revision.current = result.revision;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Failed to save the company wiki"),
  });
  return (
    <SettingsDrawer
      open
      title="company-wiki.md"
      actions={
        <div className="flex items-center gap-2">
          <AutoSaveStatus status={autoSave.status} />
          {autoSave.status === "error" ? (
            <PillButton
              variant="destructive"
              onClick={() => {
                revision.current = initialRevision;
                setMarkdown(initialMarkdown);
              }}
            >
              Discard edits
            </PillButton>
          ) : null}
        </div>
      }
      onOpenChange={(open) => {
        if (!open)
          void autoSave.saveNow().then((saved) => {
            if (saved) onClose();
          });
      }}
    >
      <div className="space-y-3">
        <div className="flex justify-end">
          <input
            ref={fileInput}
            type="file"
            accept=".md,text/markdown"
            aria-label="Import company-wiki.md"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              if (
                !file.name.toLowerCase().endsWith(".md") ||
                file.size > MAX_MARKDOWN_BYTES
              ) {
                toast.error("Choose a .md file under 512 KiB");
                event.target.value = "";
                return;
              }
              try {
                const nextMarkdown = await file.text();
                parseMarkdownDocument(nextMarkdown);
                setMarkdown(nextMarkdown);
              } catch (error) {
                toast.error(
                  getUserFacingErrorMessage(
                    error,
                    "Could not read this Markdown file",
                  ),
                );
              }
              event.target.value = "";
            }}
          />
          <PillButton
            type="button"
            size="compact"
            variant="secondary"
            onClick={() => fileInput.current?.click()}
          >
            <Upload className="size-3.5" />
            Import
          </PillButton>
        </div>
        <Textarea
          aria-label="Company wiki Markdown"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          className="min-h-96"
        />
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
  const saveTenant = useMutation(api.orgWiki.save);
  const saveOperator = useMutation(api.orgWiki.saveForOperator);
  const resolveTenant = useMutation(api.orgWiki.resolveProposal);
  const resolveOperator = useMutation(api.orgWiki.resolveProposalForOperator);
  const settings = useSettingsActions();
  const setActions = onActions ?? settings.setActions;
  const setRightPanel = onRightPanel ?? settings.setRightPanel;
  const wiki = operator ? operatorWiki : tenantWiki;
  const canManage = Boolean(
    orgId &&
    wiki !== null &&
    !readOnly &&
    (operator || currentOrg?.role === "admin"),
  );
  const [editing, setEditing] = useState(false);
  const closeDrawer = useCallback(() => setEditing(false), []);
  const save = useCallback(
    async (markdown: string, expectedRevision: number) => {
      if (!orgId) throw new Error("Organization not found");
      return operator
        ? saveOperator({ orgId, markdown, expectedRevision })
        : saveTenant({ orgId, markdown, expectedRevision });
    },
    [operator, orgId, saveOperator, saveTenant],
  );

  useEffect(() => {
    setActions(
      wiki ? (
        <div className="flex gap-2">
          <PillButton
            variant="secondary"
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(wiki.markdown)}`}
            download={wiki.filename}
          >
            <Download className="size-3.5" />
            Download
          </PillButton>
          {canManage ? (
            <PillButton onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" />
              Edit
            </PillButton>
          ) : null}
        </div>
      ) : null,
    );
    return () => setActions(null);
  }, [wiki, canManage, setActions]);

  useEffect(() => {
    setRightPanel(
      editing && canManage && wiki ? (
        <WikiDrawer
          key={String(orgId)}
          initialMarkdown={wiki.markdown}
          initialRevision={wiki.revision}
          onSave={save}
          onClose={closeDrawer}
        />
      ) : null,
    );
    return () => setRightPanel(null);
  }, [editing, canManage, wiki, orgId, save, closeDrawer, setRightPanel]);

  if (!orgId || wiki === undefined)
    return (
      <OperationalPanel
        as="div"
        className="flex h-40 items-center justify-center"
      >
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </OperationalPanel>
    );
  if (wiki === null)
    return <EmptyStateCard title="No company wiki shared yet" />;
  if (!wiki.body.trim())
    return (
      <EmptyStateCard
        title="No company wiki yet"
        actionLabel={canManage ? "Write company wiki" : undefined}
        onAction={canManage ? () => setEditing(true) : undefined}
      />
    );
  return (
    <div className="space-y-4">
      <ProseMarkdown gfm>{wiki.body}</ProseMarkdown>
      {wiki.proposals.map((proposal) => (
        <OperationalPanel
          as="div"
          key={proposal.heading}
          className="space-y-3 p-4"
        >
          <p>{proposal.rationale}</p>
          <ProseMarkdown gfm>{proposal.body}</ProseMarkdown>
          {canManage ? (
            <div className="flex gap-2">
              {[true, false].map((accept) => (
                <PillButton
                  key={String(accept)}
                  variant={accept ? "primary" : "secondary"}
                  onClick={async () => {
                    try {
                      await (operator ? resolveOperator : resolveTenant)({
                        orgId,
                        heading: proposal.heading,
                        accept,
                        expectedRevision: wiki.revision,
                      });
                      toast.success(
                        accept ? "Suggestion applied" : "Suggestion dismissed",
                      );
                    } catch (error) {
                      toast.error(
                        getUserFacingErrorMessage(
                          error,
                          "Could not update the wiki",
                        ),
                      );
                    }
                  }}
                >
                  {accept ? "Apply" : "Dismiss"}
                </PillButton>
              ))}
            </div>
          ) : null}
        </OperationalPanel>
      ))}
    </div>
  );
}
