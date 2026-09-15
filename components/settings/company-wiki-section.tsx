"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Download, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { ProseMarkdown } from "@/components/prose-markdown";
import { EmptyStateCard } from "@/components/ui/empty-state-card";
import { OperationalPanel } from "@/components/ui/operational-panel";
import { PillButton } from "@/components/ui/pill-button";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
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

function WikiEditor({
  sourceMarkdown,
  sourceRevision,
  filename,
  canManage,
  onSave,
}: {
  sourceMarkdown: string;
  sourceRevision: number;
  filename: string;
  canManage: boolean;
  onSave: (
    markdown: string,
    expectedRevision: number,
  ) => Promise<{ revision: number }>;
}) {
  const [markdown, setMarkdown] = useState(sourceMarkdown);
  const [editSequence, setEditSequence] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const revision = useRef(sourceRevision);
  const savedMarkdown = useRef(sourceMarkdown);
  useEffect(() => {
    if (
      sourceRevision <= revision.current ||
      markdown !== savedMarkdown.current
    )
      return;
    revision.current = sourceRevision;
    savedMarkdown.current = sourceMarkdown;
    setMarkdown(sourceMarkdown);
  }, [markdown, sourceMarkdown, sourceRevision]);
  function edit(value: string) {
    setMarkdown(value);
    setEditSequence((sequence) => sequence + 1);
  }
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgWiki.save",
    args: markdown,
    valueKey: String(editSequence),
    enabled: canManage,
    flush: async (value) => {
      if (value === savedMarkdown.current) return;
      const result = await onSave(value, revision.current);
      revision.current = result.revision;
      savedMarkdown.current = value;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Failed to save the company wiki"),
  });
  return (
    <>
      {canManage ? (
        <input
          ref={fileInput}
          type="file"
          accept=".md,text/markdown"
          aria-label="Import company-wiki.md"
          className="sr-only"
          onChange={async (event) => {
            const input = event.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            if (
              !file.name.toLowerCase().endsWith(".md") ||
              file.size > MAX_MARKDOWN_BYTES
            ) {
              toast.error("Choose a .md file under 512 KiB");
              input.value = "";
              return;
            }
            try {
              const nextMarkdown = await file.text();
              parseMarkdownDocument(nextMarkdown);
              edit(nextMarkdown);
            } catch (error) {
              toast.error(
                getUserFacingErrorMessage(
                  error,
                  "Could not read this Markdown file",
                ),
              );
            }
            input.value = "";
          }}
        />
      ) : null}
      <MarkdownEditor
        label="Company wiki Markdown"
        value={markdown}
        onChange={edit}
        defaultMode="preview"
        readOnly={!canManage}
        footer={
          <>
            {canManage ? <AutoSaveStatus status={autoSave.status} /> : null}
            {canManage && autoSave.status === "error" ? (
              <>
                <PillButton
                  variant="secondary"
                  onClick={() => void autoSave.saveNow()}
                >
                  Retry
                </PillButton>
                <PillButton
                  variant="destructive"
                  onClick={() => {
                    revision.current = sourceRevision;
                    savedMarkdown.current = sourceMarkdown;
                    edit(sourceMarkdown);
                  }}
                >
                  Discard edits
                </PillButton>
              </>
            ) : null}
            {canManage ? (
              <PillButton
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
              >
                <Upload className="size-3.5" />
                Import
              </PillButton>
            ) : null}
            <PillButton
              variant="secondary"
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`}
              download={filename}
            >
              <Download className="size-3.5" />
              Download
            </PillButton>
          </>
        }
      />
    </>
  );
}

export function CompanyWikiSection({
  clientOrgId,
  operator = false,
  readOnly = false,
}: {
  clientOrgId?: Id<"organizations">;
  operator?: boolean;
  readOnly?: boolean;
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
  const wiki = operator ? operatorWiki : tenantWiki;
  const canManage = Boolean(
    orgId &&
    wiki !== null &&
    !readOnly &&
    (operator || currentOrg?.role === "admin"),
  );
  const save = useCallback(
    async (markdown: string, expectedRevision: number) => {
      if (!orgId) throw new Error("Organization not found");
      return operator
        ? saveOperator({ orgId, markdown, expectedRevision })
        : saveTenant({ orgId, markdown, expectedRevision });
    },
    [operator, orgId, saveOperator, saveTenant],
  );

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
  return (
    <div className="space-y-4">
      <WikiEditor
        key={String(orgId)}
        sourceMarkdown={wiki.markdown}
        sourceRevision={wiki.revision}
        filename={wiki.filename}
        canManage={canManage}
        onSave={save}
      />
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
