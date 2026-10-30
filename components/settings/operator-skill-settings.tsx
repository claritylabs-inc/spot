"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  FileCode2,
  FileText,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@claritylabs-inc/ui/components/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { FileDropZone } from "@claritylabs-inc/ui/components/file-drop";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { StatusTag } from "@claritylabs-inc/ui/components/status-tag";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@claritylabs-inc/ui/components/tooltip";
import { TokenListField } from "@/components/broker-network/token-list-field";
import { SettingsDrawer } from "@/components/settings/settings-drawer";
import { SettingsSwitch } from "@/components/settings/settings-switch";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { MarkdownReview } from "@/components/ui/markdown-review";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  SKILL_INSTRUCTIONS_PATH,
  parseSkillInstructions,
  type SkillScope,
} from "@/convex/lib/operatorSkills";
import {
  useFollowedOpen,
  useFollowedState,
  useLeaderOnly,
} from "@/hooks/use-followed-state";
import {
  draftFromFiles,
  draftFromPaste,
  draftFromZip,
  droppedFolderFiles,
  type SkillImportDraft,
} from "@/lib/operator-skill-import";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type SkillLists = FunctionReturnType<typeof api.operatorSkills.list>;
type SkillRow = SkillLists["personal"][number];

const SCRIPTS_TOOLTIP =
  "Spot runs these scripts in an isolated sandbox only after an operator approves each run, once script execution is enabled.";
const KIND_LABELS = {
  instructions: "Instructions",
  reference: "Reference",
  script: "Script",
  asset: "Asset",
} as const;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fileCountLabel(count: number) {
  return `${count} file${count === 1 ? "" : "s"}`;
}

function ScriptsTag() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            tabIndex={0}
            aria-label={`Has scripts: ${SCRIPTS_TOOLTIP}`}
            className="inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <StatusTag tone="warning">Has scripts</StatusTag>
      </TooltipTrigger>
      <TooltipContent>{SCRIPTS_TOOLTIP}</TooltipContent>
    </Tooltip>
  );
}

/** Text of a stored skill file, fetched for preview. */
function useStoredText(url: string | null | undefined) {
  const [state, setState] = useState<{ url: string; text: string | null } | null>(
    null,
  );
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then((response) => (response.ok ? response.text() : null))
      .catch(() => null)
      .then((text) => {
        if (!cancelled) setState({ url, text });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state && state.url === url ? state.text : undefined;
}

/**
 * Settings → Skills: Personal | Shared top-bar tabs, each a searchable list of
 * imported skills, plus the detail drawer and import dialog.
 */
export function useOperatorSkillSettings(disabled: boolean, active: boolean) {
  const skills = useQuery(api.operatorSkills.list, active ? {} : "skip");
  const [tab, setTab] = useFollowedState<string>("settings:skills:tab", "personal");
  const [selectedId, setSelectedId] = useFollowedState<string | null>(
    "settings:skills:selected",
    null,
  );
  const [importTarget, setImportTarget] = useFollowedState<string | null>(
    "settings:skills:import",
    null,
  );
  const [removeId, setRemoveId] = useFollowedState<string | null>(
    "settings:skills:remove",
    null,
  );
  const all = skills ? [...skills.personal, ...skills.shared] : [];
  const selected = all.find((skill) => skill._id === selectedId);
  const replacing = importTarget?.startsWith("replace:")
    ? all.find((skill) => `replace:${skill._id}` === importTarget)
    : undefined;
  const removing = all.find((skill) => skill._id === removeId);
  const actions = {
    disabled,
    open: (id: string) => setSelectedId(id),
    replace: (id: string) => setImportTarget(`replace:${id}`),
    remove: (id: string) => setRemoveId(id),
  };

  return {
    panel: (
      <PageTabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <PageTabsList aria-label="Skills">
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="shared">Shared</TabsTrigger>
        </PageTabsList>
        {!skills ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {(["personal", "shared"] as const).map((scope) => (
              <TabsContent key={scope} value={scope}>
                <SkillList
                  scope={scope}
                  rows={skills[scope]}
                  onImport={() => setImportTarget(scope)}
                  {...actions}
                />
              </TabsContent>
            ))}
          </>
        )}
        <ImportSkillDialog
          key={importTarget ?? "closed"}
          open={importTarget !== null && (!importTarget.startsWith("replace:") || Boolean(replacing))}
          scope={
            replacing?.scope ?? (importTarget === "shared" ? "shared" : "personal")
          }
          replacing={replacing}
          existing={skills}
          disabled={disabled}
          onClose={() => setImportTarget(null)}
        />
        <RemoveSkillDialog
          skill={removing}
          onClose={() => setRemoveId(null)}
          onRemoved={(id) => {
            if (selectedId === id) setSelectedId(null);
          }}
        />
      </PageTabs>
    ),
    drawer: selected ? (
      <SkillDrawer
        key={selected._id}
        skill={selected}
        onClose={() => setSelectedId(null)}
      />
    ) : null,
  };
}

function SkillList({
  scope,
  rows,
  onImport,
  ...actions
}: {
  scope: SkillScope;
  rows: SkillRow[];
  onImport: () => void;
  disabled: boolean;
  open: (id: string) => void;
  replace: (id: string) => void;
  remove: (id: string) => void;
}) {
  const [search, setSearch] = useFollowedState(`settings:skills:${scope}:search`, "");
  const query = search.trim().toLowerCase();
  const visible = query
    ? rows.filter(
        (row) =>
          row.name.includes(query) ||
          row.description.toLowerCase().includes(query),
      )
    : rows;
  return (
    <div className="space-y-3">
      <ListToolbar
        followKey={`settings:skills:${scope}`}
        search={{
          value: search,
          onChange: setSearch,
          label: `Search ${scope} skills`,
          placeholder: "Search skills",
        }}
        actions={
          <PillButton
            size="compact"
            disabled={actions.disabled}
            onClick={onImport}
          >
            <Upload />
            Import
          </PillButton>
        }
      />
      <OperationalPanel>
        <OperationalPanelBody className="py-0">
          {visible.length === 0 ? (
            <div className="py-8 text-center">
              <p className={cn("text-muted-foreground", typeStyle("body.default"))}>
                {rows.length
                  ? "No skills match your search"
                  : scope === "personal"
                    ? "No personal skills yet"
                    : "No shared skills yet"}
              </p>
              {rows.length === 0 ? (
                <p
                  className={cn(
                    "mt-1 text-muted-foreground/70",
                    typeStyle("caption.default"),
                  )}
                >
                  {scope === "personal"
                    ? "Import a Claude Code or Codex skill (a folder with SKILL.md). Only you see it, and Spot loads it when a request matches."
                    : "Share one of your personal skills, or import one here for every operator."}
                </p>
              ) : null}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visible.map((row) => (
                <SkillListRow key={row._id} row={row} {...actions} />
              ))}
            </div>
          )}
        </OperationalPanelBody>
      </OperationalPanel>
    </div>
  );
}

function SkillListRow({
  row,
  disabled,
  open,
  replace,
  remove,
}: {
  row: SkillRow;
  disabled: boolean;
  open: (id: string) => void;
  replace: (id: string) => void;
  remove: (id: string) => void;
}) {
  const setEnabled = useLeaderOnly(useMutation(api.operatorSkills.setEnabled));
  const setScope = useLeaderOnly(useMutation(api.operatorSkills.setScope));
  const [busy, setBusy] = useState(false);
  const run = (work: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    void work()
      .then(() => toast.success(success))
      .catch((error) => toast.error(getUserFacingErrorMessage(error, failure)))
      .finally(() => setBusy(false));
  };
  const nextScope = row.scope === "personal" ? "shared" : "personal";
  const scopeLabel = nextScope === "shared" ? "Share" : "Make personal";
  const menu = useFollowedOpen(`settings:skills:${row._id}:menu`);
  const moveScope = () =>
    run(
      () => setScope({ skillId: row._id, scope: nextScope }),
      nextScope === "shared"
        ? `Shared ${row.name} with the team`
        : `${row.name} is personal again`,
      "The skill could not be moved.",
    );
  return (
    <div className="flex items-center gap-3 py-3" data-collab-scope={`skill:${row._id}`}>
      <button
        type="button"
        onClick={() => open(row._id)}
        className="min-w-0 flex-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex flex-wrap items-center gap-2">
          <span className={cn("truncate text-foreground", typeStyle("body.medium"))}>
            {row.name}
          </span>
          {row.hasScripts ? <ScriptsTag /> : null}
          {row.hasScripts && row.scope === "shared" && !row.scriptsReview ? (
            <StatusTag tone="neutral">Scripts need review</StatusTag>
          ) : null}
        </span>
        <span
          className={cn(
            "mt-0.5 line-clamp-2 text-muted-foreground",
            typeStyle("caption.default"),
          )}
        >
          {row.description}
        </span>
        <span
          className={cn(
            "mt-0.5 block text-muted-foreground/70",
            typeStyle("caption.default"),
          )}
        >
          {fileCountLabel(row.fileCount)}
          {row.scope === "shared" ? ` · ${row.isOwner ? "You" : row.ownerName}` : ""}
          {row.revision > 1 ? ` · Revision ${row.revision}` : ""}
        </span>
      </button>
      {row.isOwner ? (
        <>
          <div className="flex shrink-0 items-center gap-1 max-sm:hidden">
            <PillButton
              variant="ghost"
              size="compact"
              disabled={disabled || busy}
              onClick={moveScope}
            >
              {scopeLabel}
            </PillButton>
            <PillButton
              variant="ghost"
              size="compact"
              disabled={disabled || busy}
              onClick={() => replace(row._id)}
            >
              Replace
            </PillButton>
          </div>
          <DropdownMenu {...menu}>
            <DropdownMenuTrigger
              disabled={disabled || busy}
              render={
                <PillButton
                  variant="icon"
                  size="compact"
                  iconOnly
                  label={`More options for ${row.name}`}
                  className="sm:hidden"
                />
              }
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={moveScope}>{scopeLabel}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => replace(row._id)}>Replace</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      ) : null}
      <SettingsSwitch
        label={`${row.enabled ? "Turn off" : "Turn on"} ${row.name}${row.scope === "shared" ? " for the team" : ""}`}
        checked={row.enabled}
        disabled={disabled || busy}
        onCheckedChange={() =>
          run(
            () => setEnabled({ skillId: row._id, enabled: !row.enabled }),
            row.enabled ? `Turned off ${row.name}` : `Turned on ${row.name}`,
            "The skill could not be updated.",
          )
        }
      />
      {row.isOwner ? (
        <RemoveButton
          label={`Remove ${row.name}`}
          disabled={disabled || busy}
          className="ml-0"
          onClick={() => remove(row._id)}
        />
      ) : (
        <span className="size-8 shrink-0" aria-hidden />
      )}
    </div>
  );
}

function RemoveSkillDialog({
  skill,
  onClose,
  onRemoved,
}: {
  skill: SkillRow | undefined;
  onClose: () => void;
  onRemoved: (id: string) => void;
}) {
  const remove = useLeaderOnly(useMutation(api.operatorSkills.remove));
  const [removing, setRemoving] = useState(false);
  return (
    <AlertDialog
      open={Boolean(skill)}
      onOpenChange={(next) => {
        if (!next && !removing) onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {skill?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {skill?.scope === "shared"
              ? "This deletes the skill and its files for every operator. Spot's agent stops using it right away."
              : "This deletes the skill and its files. Spot's agent stops using it right away."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <PillButton variant="secondary" disabled={removing} onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton
            variant="destructive"
            disabled={removing || !skill}
            onClick={() => {
              if (!skill) return;
              setRemoving(true);
              void remove({ skillId: skill._id })
                .then(() => {
                  onRemoved(skill._id);
                  toast.success(`Removed ${skill.name}`);
                  onClose();
                })
                .catch((error) =>
                  toast.error(
                    getUserFacingErrorMessage(error, "The skill could not be removed."),
                  ),
                )
                .finally(() => setRemoving(false));
            }}
          >
            {removing ? "Removing…" : "Remove skill"}
          </PillButton>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Who may run the scripts, the review a shared skill needs and its network allowlist. */
function SkillScriptsSection({ skill }: { skill: SkillRow }) {
  const setReviewed = useLeaderOnly(useMutation(api.operatorSkills.setScriptsReviewed));
  const setAllowedDomains = useLeaderOnly(
    useMutation(api.operatorSkills.setAllowedDomains),
  );
  const [busy, setBusy] = useState(false);
  const review = skill.scriptsReview;
  const run = (work: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(true);
    void work()
      .then(() => toast.success(success))
      .catch((error) => toast.error(getUserFacingErrorMessage(error, failure)))
      .finally(() => setBusy(false));
  };
  const caption = cn("text-muted-foreground", typeStyle("caption.default"));
  return (
    <section className="space-y-3" data-collab-scope={`skill-scripts:${skill._id}`}>
      <h3 className={cn("text-muted-foreground", typeStyle("heading.micro"))}>
        Scripts
      </h3>
      {skill.scope === "personal" ? (
        <p className={caption}>
          Only you can run these, and Spot asks you to approve every run.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {review ? (
            <StatusTag tone="success">
              Reviewed by {review.reviewedByViewer ? "you" : review.reviewerName}
            </StatusTag>
          ) : (
            <StatusTag tone="warning">Not reviewed</StatusTag>
          )}
          <span className={caption}>
            {review
              ? `Revision ${skill.revision}. Any operator can run them after approving each run.`
              : skill.importedByViewer
                ? `Revision ${skill.revision} can't run until another operator reviews its scripts.`
                : `Revision ${skill.revision}, imported by ${skill.importedByName}. Read the scripts below, then mark them reviewed so operators can run them.`}
          </span>
          {!review && !skill.importedByViewer ? (
            <PillButton
              size="compact"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    setReviewed({
                      skillId: skill._id,
                      revision: skill.revision,
                      reviewed: true,
                    }),
                  `Marked the scripts of ${skill.name} reviewed`,
                  "The review could not be saved.",
                )
              }
            >
              Mark scripts reviewed
            </PillButton>
          ) : null}
          {review && (review.reviewedByViewer || skill.isOwner) ? (
            <PillButton
              variant="ghost"
              size="compact"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    setReviewed({
                      skillId: skill._id,
                      revision: skill.revision,
                      reviewed: false,
                    }),
                  `Cleared the script review of ${skill.name}`,
                  "The review could not be cleared.",
                )
              }
            >
              Clear review
            </PillButton>
          ) : null}
        </div>
      )}
      <div className="space-y-1.5">
        <p className={cn("text-foreground", typeStyle("label.field"))}>
          Allowed domains
        </p>
        {skill.isOwner ? (
          <TokenListField
            ariaLabel={`Allowed domains for ${skill.name}`}
            placeholder="api.example.com"
            value={skill.allowedDomains}
            disabled={busy}
            normalize={(item) => item.toLowerCase()}
            onChange={(domains) =>
              run(
                () => setAllowedDomains({ skillId: skill._id, domains }),
                "Allowed domains saved",
                "The domains could not be saved.",
              )
            }
          />
        ) : (
          <p className={cn("text-foreground", typeStyle("body.default"))}>
            {skill.allowedDomains.join(", ") || "None"}
          </p>
        )}
        <p className={caption}>
          Runs have no network unless the approved run asks for some of these
          public hostnames.{skill.isOwner ? "" : " Only the owner can change them."}
        </p>
      </div>
    </section>
  );
}

function SkillDrawer({ skill, onClose }: { skill: SkillRow; onClose: () => void }) {
  const detail = useQuery(api.operatorSkills.get, { skillId: skill._id });
  const [openPath, setOpenPath] = useFollowedState<string | null>(
    `settings:skills:${skill._id}:file`,
    null,
  );
  const instructionsFile = detail?.files.find(
    (file) => file.path === SKILL_INSTRUCTIONS_PATH,
  );
  const instructions = useStoredText(instructionsFile?.url);
  let body: string | null | undefined = instructions;
  if (instructions) {
    try {
      body = parseSkillInstructions(instructions).body;
    } catch {
      body = instructions;
    }
  }
  const others = detail?.files.filter((file) => file.path !== SKILL_INSTRUCTIONS_PATH) ?? [];
  return (
    <SettingsDrawer
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={skill.name}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className={cn("text-foreground", typeStyle("body.default"))}>
            {skill.description}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusTag tone={skill.enabled ? "success" : "neutral"}>
              {skill.enabled ? "On" : "Off"}
            </StatusTag>
            {skill.hasScripts ? <ScriptsTag /> : null}
          </div>
          <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
            {skill.scope === "shared" ? "Shared" : "Personal"} · {skill.isOwner ? "You" : skill.ownerName} ·{" "}
            {fileCountLabel(skill.fileCount)} · {formatSize(skill.totalBytes)} · Revision{" "}
            {skill.revision} · {skill.sourceLabel}
          </p>
        </div>
        {skill.warnings.length ? (
          <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
            {skill.warnings.map((warning) => (
              <li
                key={warning}
                className={cn("text-amber-800 dark:text-amber-300", typeStyle("caption.default"))}
              >
                {warning}
              </li>
            ))}
          </ul>
        ) : null}
        {skill.hasScripts ? <SkillScriptsSection skill={skill} /> : null}
        <section className="space-y-2">
          <h3 className={cn("text-muted-foreground", typeStyle("heading.micro"))}>
            SKILL.md
          </h3>
          {body === undefined ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : body === null ? (
            <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
              SKILL.md could not be loaded.
            </p>
          ) : (
            <div className="rounded-lg border border-border px-4 py-3">
              <MarkdownReview>{body}</MarkdownReview>
            </div>
          )}
        </section>
        <section className="space-y-2">
          <h3 className={cn("text-muted-foreground", typeStyle("heading.micro"))}>
            Files
          </h3>
          {!detail ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : others.length === 0 ? (
            <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
              Only SKILL.md.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {others.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    disabled={!file.text}
                    onClick={() => setOpenPath(openPath === file.path ? null : file.path)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
                    style={{ paddingLeft: `${0.75 + (file.path.split("/").length - 1) * 0.75}rem` }}
                  >
                    {file.kind === "script" ? (
                      <FileCode2 className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn("min-w-0 flex-1 truncate", typeStyle("technical.codeCompact"))}>
                      {file.path}
                    </span>
                    <span className={cn("shrink-0 text-muted-foreground", typeStyle("caption.default"))}>
                      {KIND_LABELS[file.kind]} · {formatSize(file.size)}
                    </span>
                  </button>
                  {openPath === file.path && file.text ? (
                    <FilePreview url={file.url} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </SettingsDrawer>
  );
}

function FilePreview({ url }: { url: string | null }) {
  const text = useStoredText(url);
  return (
    <div className="border-t border-border bg-foreground/[0.02] px-3 py-2">
      {text === undefined ? (
        <Loader2 className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <pre
          className={cn(
            "max-h-80 overflow-auto whitespace-pre-wrap break-words text-foreground",
            typeStyle("technical.codeCompact"),
          )}
        >
          {text === null ? "This file could not be loaded." : text.slice(0, 64 * 1024)}
        </pre>
      )}
    </div>
  );
}

const UPLOAD_CONCURRENCY = 6;

function ImportSkillDialog({
  open,
  scope,
  replacing,
  existing,
  disabled,
  onClose,
}: {
  open: boolean;
  scope: SkillScope;
  replacing?: SkillRow;
  existing: SkillLists | undefined;
  disabled: boolean;
  onClose: () => void;
}) {
  const generateUploadUrl = useLeaderOnly(useMutation(api.operatorSkills.generateUploadUrl));
  const importSkill = useLeaderOnly(useAction(api.operatorSkills.importSkill));
  const [draft, setDraft] = useState<SkillImportDraft | null>(null);
  const [pasted, setPasted] = useState("");
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const folderInput = useRef<HTMLInputElement | null>(null);

  const read = (work: () => Promise<SkillImportDraft>) => {
    setReading(true);
    void work()
      .then(setDraft)
      .catch((error) =>
        setDraft({
          sourceLabel: "",
          files: [],
          totalBytes: 0,
          warnings: [],
          error: error instanceof Error ? error.message : "The skill could not be read.",
        }),
      )
      .finally(() => setReading(false));
  };

  const pickFiles = (files: File[]) => {
    const [first] = files;
    if (!first) return;
    if (files.length === 1 && /\.zip$/i.test(first.name)) {
      read(() => draftFromZip(first));
      return;
    }
    if (files.length === 1 && /\.md$/i.test(first.name)) {
      read(async () => draftFromPaste(await first.text()));
      return;
    }
    read(() =>
      draftFromFiles(
        files.map((file) => ({ path: file.webkitRelativePath || file.name, file })),
        files[0].webkitRelativePath.split("/")[0] || "Selected files",
      ),
    );
  };

  const target = replacing ?? undefined;
  const clash =
    draft?.name && !target
      ? (scope === "personal" ? existing?.personal : existing?.shared)?.find(
          (skill) => skill.name === draft.name,
        )
      : undefined;
  const blockedByClash = Boolean(clash && !clash.isOwner);
  const willReplace = target ?? (clash?.isOwner ? clash : undefined);

  async function confirm() {
    if (!draft || draft.error) return;
    setImporting(true);
    try {
      const urls = await generateUploadUrl({ count: draft.files.length });
      const storageIds: string[] = new Array(draft.files.length);
      let next = 0;
      const worker = async () => {
        while (next < draft.files.length) {
          const index = next++;
          const file = draft.files[index];
          const response = await fetch(urls[index], {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: file.data,
          });
          if (!response.ok) throw new Error(`${file.path} could not be uploaded.`);
          storageIds[index] = ((await response.json()) as { storageId: string }).storageId;
        }
      };
      await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker));
      const result = await importSkill({
        scope,
        replaceSkillId: target?._id,
        sourceLabel: draft.sourceLabel,
        files: draft.files.map((file, index) => ({
          path: file.path,
          storageId: storageIds[index] as Id<"_storage">,
        })),
      });
      toast.success(
        result.replaced
          ? `Replaced ${result.name} (revision ${result.revision})`
          : `Imported ${result.name}`,
      );
      onClose();
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "The skill could not be imported."));
    } finally {
      setImporting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !importing) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {target ? `Replace ${target.name}` : scope === "shared" ? "Import a shared skill" : "Import a skill"}
          </DialogTitle>
          <DialogDescription>
            {target
              ? "Its files are replaced together and its revision goes up."
              : "A Claude Code or Codex skill: a folder with SKILL.md and optional references, scripts and assets."}
          </DialogDescription>
        </DialogHeader>
        {!draft ? (
          <div className="space-y-3" data-follow-private>
            <div
              onDropCapture={(event) => {
                if (disabled || reading) return;
                const items = event.dataTransfer.items;
                if (!Array.from(items).some((item) => item.kind === "file")) return;
                event.preventDefault();
                event.stopPropagation();
                const files = Array.from(event.dataTransfer.files);
                read(async () => {
                  const folder = await droppedFolderFiles(items);
                  if (folder) return draftFromFiles(folder.files, folder.label);
                  const [first] = files;
                  if (first && /\.zip$/i.test(first.name)) return draftFromZip(first);
                  if (first && /\.md$/i.test(first.name))
                    return draftFromPaste(await first.text());
                  return draftFromFiles(
                    files.map((file) => ({ path: file.name, file })),
                    "Dropped files",
                  );
                });
              }}
            >
              <FileDropZone
                multiple
                accept=".zip,application/zip,.md,text/markdown"
                disabled={disabled || reading}
                idleLabel="Drop a skill folder or .zip"
                activeLabel="Drop to read the skill"
                busyLabel="Reading…"
                hint="or click to choose a .zip or SKILL.md"
                onFiles={pickFiles}
              />
            </div>
            <div className="flex justify-center">
              <PillButton
                variant="ghost"
                size="compact"
                disabled={disabled || reading}
                onClick={() => folderInput.current?.click()}
              >
                <FolderOpen />
                Choose a folder
              </PillButton>
              <input
                ref={folderInput}
                type="file"
                className="hidden"
                multiple
                {...{ webkitdirectory: "", directory: "" }}
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.currentTarget.value = "";
                  if (files.length) pickFiles(files);
                }}
              />
            </div>
            <div className="space-y-2">
              <p className={cn("text-muted-foreground", typeStyle("label.field"))}>
                Or paste SKILL.md
              </p>
              <Textarea
                aria-label="Paste SKILL.md"
                value={pasted}
                rows={6}
                disabled={disabled || reading}
                placeholder={"---\nname: my-skill\ndescription: When to use it\n---\n\nInstructions…"}
                onChange={(event) => setPasted(event.target.value)}
                className={cn("resize-y", typeStyle("technical.codeCompact"))}
              />
            </div>
          </div>
        ) : (
          <SkillImportPreview
            draft={draft}
            willReplace={willReplace}
            blockedBy={blockedByClash ? clash : undefined}
            renameExpected={target && draft.name && draft.name !== target.name ? target.name : undefined}
          />
        )}
        <DialogFooter>
          {draft ? (
            <>
              <PillButton
                variant="secondary"
                disabled={importing}
                onClick={() => setDraft(null)}
              >
                Back
              </PillButton>
              <PillButton
                disabled={disabled || importing || Boolean(draft.error) || blockedByClash}
                onClick={() => void confirm()}
              >
                {importing ? "Importing…" : willReplace ? "Replace skill" : "Import skill"}
              </PillButton>
            </>
          ) : (
            <>
              <PillButton variant="secondary" onClick={onClose}>
                Cancel
              </PillButton>
              <PillButton
                disabled={disabled || reading || !pasted.trim()}
                onClick={() => read(() => draftFromPaste(pasted))}
              >
                Preview
              </PillButton>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillImportPreview({
  draft,
  willReplace,
  blockedBy,
  renameExpected,
}: {
  draft: SkillImportDraft;
  willReplace?: SkillRow;
  blockedBy?: SkillRow;
  renameExpected?: string;
}) {
  if (draft.error)
    return (
      <p className={cn("text-destructive", typeStyle("body.default"))}>{draft.error}</p>
    );
  const notes = [
    ...(blockedBy
      ? [`${blockedBy.ownerName} already shares a skill named ${blockedBy.name}. Rename yours in SKILL.md, or ask them to replace it.`]
      : []),
    ...(renameExpected
      ? [`SKILL.md names this skill ${draft.name}, so ${renameExpected} will be renamed.`]
      : []),
  ];
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-foreground", typeStyle("body.medium"))}>{draft.name}</span>
          {willReplace ? (
            <StatusTag tone="info">Replaces revision {willReplace.revision}</StatusTag>
          ) : null}
          {draft.files.some((file) => file.kind === "script") ? <ScriptsTag /> : null}
        </div>
        <p className={cn("text-muted-foreground", typeStyle("caption.default"))}>
          {draft.description}
        </p>
        <p className={cn("text-muted-foreground/70", typeStyle("caption.default"))}>
          {fileCountLabel(draft.files.length)} · {formatSize(draft.totalBytes)} · {draft.sourceLabel}
        </p>
      </div>
      {notes.length || draft.warnings.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
          {[...notes, ...draft.warnings].map((warning) => (
            <li
              key={warning}
              className={cn("text-amber-800 dark:text-amber-300", typeStyle("caption.default"))}
            >
              {warning}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="max-h-56 divide-y divide-border overflow-auto rounded-lg border border-border">
        {draft.files.map((file) => (
          <li key={file.path} className="flex items-center gap-2 px-3 py-1.5">
            <span className={cn("min-w-0 flex-1 truncate", typeStyle("technical.codeCompact"))}>
              {file.path}
            </span>
            <span className={cn("shrink-0 text-muted-foreground", typeStyle("caption.default"))}>
              {KIND_LABELS[file.kind]} · {formatSize(file.size)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
