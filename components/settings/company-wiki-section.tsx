"use client";
import { MarkdownReview } from "@/components/ui/markdown-review";
import type { IntakeApplication } from "@/lib/intake-application";
import { companyNotesMarkdown } from "@/lib/intake-application";
import { IntakeCompanyReview } from "@/components/insurance-intake/company-review";
import { splitEditorMarkdown, replaceEditorBody } from "@/lib/markdown-editor";

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Download, Loader2, FileInput } from "lucide-react";
import { toast } from "sonner";
import { ProseMarkdown } from "@/components/prose-markdown";
import { EmptyStateCard } from "@claritylabs-inc/ui/components/empty-state-card";
import {
  OperationalPanel,
  OperationalPanelHeader,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
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
import dayjs from "dayjs";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { leadsSharedRoom, mergeText, useSharedDoc } from "@/lib/collab/doc";
import { useSharedValue } from "@/hooks/use-shared-value";

/**
 * How long a browser sharing the notes waits for the room to say a new
 * revision was saved by one of its own before treating it as an edit from
 * elsewhere (the Spot agent, an MCP client).
 */
const ROOM_SAVE_SETTLE_MS = 2_000;

function WikiEditor({
  sourceMarkdown,
  sourceRevision,
  filename,
  canManage,
  onSave,
  toolbarTarget,
  businessProfile,
  legacyBusinessProfile,
  showViewSwitcher = true,
  inlineEditing = false,
}: {
  showViewSwitcher?: boolean;
  inlineEditing?: boolean;
  toolbarTarget?: HTMLElement | null;
  businessProfile?: Pick<IntakeApplication, "answers" | "details"> | null;
  legacyBusinessProfile?: Pick<IntakeApplication, "answers" | "details"> | null;
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
  // Shared live, the room's text is what every screen shows; the server only
  // moves the revision. A teammate's save that missed edits (it can carry an
  // older snapshot) is saved over with the full text, never shown; a save
  // from outside the room is merged into it.
  const shared = useSharedDoc() !== null;
  const current = useRef(markdown);
  const latest = useRef({ revision: sourceRevision, markdown: sourceMarkdown });
  const saveNow = useRef<(() => Promise<boolean>) | null>(null);
  const lastSaveOver = useRef(0);
  // The latest revision a browser in the room saved, so the others can tell
  // their teammates' saves from edits made elsewhere.
  const [roomSaved, setRoomSaved] = useState(sourceRevision);
  useSharedValue(`notes:${filename}:saved-revision`, roomSaved, setRoomSaved);
  const roomSavedRef = useRef(roomSaved);
  useEffect(() => {
    current.current = markdown;
    latest.current = { revision: sourceRevision, markdown: sourceMarkdown };
    roomSavedRef.current = roomSaved;
  });
  useEffect(() => {
    if (sourceRevision <= revision.current) return;
    if (shared) {
      const base = savedMarkdown.current;
      const saved = { revision: sourceRevision, markdown: sourceMarkdown };
      revision.current = sourceRevision;
      savedMarkdown.current = sourceMarkdown;
      if (sourceMarkdown === markdown) return;
      window.setTimeout(() => {
        if (current.current === saved.markdown) return;
        if (roomSavedRef.current < saved.revision) {
          // Saved from outside the room: the leading browser adds it to the
          // room's text, which carries it to everyone, and saves the result.
          if (leadsSharedRoom()) {
            edit(mergeText(base, current.current, saved.markdown));
          }
          return;
        }
        // At most every 2s, so two browsers never trade saves in a loop.
        const now = dayjs().valueOf();
        if (now - lastSaveOver.current > 2000) {
          lastSaveOver.current = now;
          void saveNow.current?.();
        }
      }, ROOM_SAVE_SETTLE_MS);
      return;
    }
    if (markdown !== savedMarkdown.current) return;
    revision.current = sourceRevision;
    savedMarkdown.current = sourceMarkdown;
    setMarkdown(sourceMarkdown);
  }, [markdown, shared, sourceMarkdown, sourceRevision]);
  function edit(value: string) {
    setMarkdown(value);
    setEditSequence((sequence) => sequence + 1);
  }
  const autoSave = useLocalFirstAutoSave({
    mutationName: "orgWiki.save",
    args: markdown,
    valueKey: String(editSequence),
    enabled: canManage,
    flush: async (snapshot) => {
      // Shared, save the text as it is now, not as it was when queued.
      const value = shared ? current.current : snapshot;
      if (value === savedMarkdown.current) return;
      const expected = revision.current;
      try {
        revision.current = (await onSave(value, expected)).revision;
        savedMarkdown.current = value;
        setRoomSaved(revision.current);
      } catch (error) {
        // A teammate's save landed first: build on their revision.
        if (!shared) throw error;
        const deadline = dayjs().add(3, "second");
        while (
          latest.current.revision <= expected &&
          dayjs().isBefore(deadline)
        ) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        const newer = latest.current;
        if (newer.revision <= expected) throw error;
        const text = current.current;
        revision.current =
          newer.markdown === text
            ? newer.revision
            : (await onSave(text, newer.revision)).revision;
        savedMarkdown.current = text;
        setRoomSaved(revision.current);
      }
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Failed to save the notes"),
  });
  useEffect(() => {
    saveNow.current = () => autoSave.saveNow({ force: true });
  });
  return (
    <>
      {canManage ? <AutoSaveStatus status={autoSave.status} /> : null}
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
        showToolbar
        showProperties={false}
        showViewSwitcher={showViewSwitcher}
        preview={
          inlineEditing ? undefined : (
            <MarkdownReview>
              {companyNotesMarkdown(
                companyNotesMarkdown(
                  splitEditorMarkdown(markdown).body,
                  legacyBusinessProfile,
                ),
                businessProfile,
              )}
            </MarkdownReview>
          )
        }
        label="Company notes"
        value={
          inlineEditing
            ? replaceEditorBody(
                markdown,
                companyNotesMarkdown(
                  companyNotesMarkdown(
                    splitEditorMarkdown(markdown).body,
                    legacyBusinessProfile,
                  ),
                  businessProfile,
                ),
              )
            : markdown
        }
        onChange={edit}
        readOnly={!canManage}
        toolbarTarget={toolbarTarget}
        toolbarActions={
          <>
            {canManage ? (
              <PillButton
                size="compact"
                expandLabel
                label="Import"
                type="button"
                variant="secondary"
                onClick={() => fileInput.current?.click()}
              >
                <FileInput className="size-3.5" />
              </PillButton>
            ) : null}
            <PillButton
              size="compact"
              variant="secondary"
              expandLabel
              label="Download"
              href={`data:text/markdown;charset=utf-8,${encodeURIComponent(markdown)}`}
              download={filename}
            >
              <Download className="size-3.5" />
            </PillButton>
          </>
        }
        footer={
          canManage && autoSave.status === "error" ? (
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
          ) : null
        }
      />
    </>
  );
}

export function CompanyWikiSection({
  clientOrgId,
  operator = false,
  notesOnly = false,
  sidebar = false,
  readOnly = false,
  toolbarTarget,
}: {
  toolbarTarget?: HTMLElement | null;
  clientOrgId?: Id<"organizations">;
  operator?: boolean;
  notesOnly?: boolean;
  sidebar?: boolean;
  readOnly?: boolean;
} = {}) {
  const [notesToolbarTarget, setNotesToolbarTarget] =
    useState<HTMLDivElement | null>(null);
  const currentOrg = useCurrentOrg();
  const orgId = clientOrgId ?? currentOrg?.orgId;
  const tenantWiki = useQuery(
    api.orgWiki.get,
    orgId && !operator ? { orgId } : "skip",
  );
  const tenantBusinessProfile = useQuery(
    api.orgWiki.businessProfile,
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
    return tenantBusinessProfile ? (
      <IntakeCompanyReview
        answers={tenantBusinessProfile.answers}
        details={tenantBusinessProfile.details}
      />
    ) : (
      <EmptyStateCard title="No notes shared yet" />
    );
  const notesContent = (
    <>
      <WikiEditor
        key={String(orgId)}
        showViewSwitcher={!operator}
        inlineEditing={operator}
        toolbarTarget={
          operator
            ? sidebar
              ? toolbarTarget
              : notesToolbarTarget
            : toolbarTarget
        }
        businessProfile={wiki.businessProfile}
        legacyBusinessProfile={wiki.legacyBusinessProfile}
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
    </>
  );
  if (sidebar) return notesContent;
  return (
    <div className="space-y-4">
      {!notesOnly && wiki.businessProfile ? (
        <IntakeCompanyReview
          answers={wiki.businessProfile.answers}
          details={wiki.businessProfile.details}
        />
      ) : null}
      <OperationalPanel aria-label="Company notes">
        <OperationalPanelHeader
          title="Notes"
          action={
            operator ? (
              <div
                ref={setNotesToolbarTarget}
                className="flex items-center gap-2"
              />
            ) : undefined
          }
        />
        <OperationalPanelBody>{notesContent}</OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}
