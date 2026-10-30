"use client";

import { useMutation, useQuery } from "convex/react";
import { ChevronDown, Loader2 } from "lucide-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@claritylabs-inc/ui/components/collapsible";
import {
  OperationalPanel,
  OperationalPanelBody,
} from "@claritylabs-inc/ui/components/operational-panel";
import { Badge } from "@claritylabs-inc/ui/components/badge";
import { TabsContent, TabsTrigger } from "@claritylabs-inc/ui/components/tabs";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { PageTabs, PageTabsList } from "@/components/ui/folder-tabs";
import { api } from "@/convex/_generated/api";
import {
  EMAIL_PROMPT_VARIABLES,
  MAX_EMAIL_PROMPT_CHARS,
  unknownEmailPromptVariables,
  type EmailPromptKey,
  type EmailPrompts,
} from "@/convex/lib/emailSkill";
import {
  useFollowedOpen,
  useFollowedState,
  useLeaderOnly,
} from "@/hooks/use-followed-state";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { cn } from "@/lib/utils";

type PromptRow = { key: EmailPromptKey; title: string; description: string };

const SHARED_PROMPTS: PromptRow[] = [
  {
    key: "provider_introduction",
    title: "Provider introduction",
    description:
      "Opens first emails to providers without an active relationship, and fills {{introduction}} in provider mail merge.",
  },
  {
    key: "signature",
    title: "Signature",
    description: "Ends every email an operator sends.",
  },
  {
    key: "provider_signature_note",
    title: "Provider signature note",
    description:
      "Goes below the signature on emails to providers. Leave empty to drop it.",
  },
  {
    key: "writing_rules",
    title: "Writing rules",
    description:
      "Every email Spot drafts follows these: provider outreach, suggested inbox replies and drafts in Spot chats.",
  },
  {
    key: "provider_rules",
    title: "Provider rules",
    description:
      "Added to the writing rules for emails to brokers, carriers and wholesalers.",
  },
  {
    key: "provider_nudge",
    title: "Provider follow-up",
    description: "The short automated nudge to providers who have not replied.",
  },
];

const PERSONAL_PROMPTS: PromptRow[] = [
  {
    key: "writing_rules",
    title: "Writing preferences",
    description:
      "Added to the shared writing rules when Spot drafts email in your chats.",
  },
  {
    key: "signature",
    title: "Signature",
    description:
      "Replaces the shared signature on email you send. Leave empty to use the shared one.",
  },
];

export function EmailPromptSettings({ disabled }: { disabled: boolean }) {
  const prompts = useQuery(api.emailPrompts.get);
  const [tab, setTab] = useFollowedState(
    "settings:email-prompts:tab",
    "shared",
  );

  return (
    <PageTabs value={tab} onValueChange={(value) => setTab(String(value))}>
      <PageTabsList aria-label="Email prompts">
        <TabsTrigger value="shared">Shared</TabsTrigger>
        <TabsTrigger value="personal">Personal</TabsTrigger>
      </PageTabsList>
      {!prompts ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <TabsContent value="shared">
            <PromptList
              intro="Used for every operator. Spot's defaults apply until you change them."
              rows={SHARED_PROMPTS}
              personal={false}
              saved={prompts.shared}
              defaults={prompts.defaults}
              disabled={disabled}
            />
          </TabsContent>
          <TabsContent value="personal">
            <PromptList
              intro="Applied to your own email, alongside the shared prompts."
              rows={PERSONAL_PROMPTS}
              personal
              saved={prompts.personal}
              defaults={prompts.defaults}
              disabled={disabled}
            />
          </TabsContent>
        </>
      )}
    </PageTabs>
  );
}

function PromptList(props: {
  intro: string;
  rows: PromptRow[];
  personal: boolean;
  saved: Partial<EmailPrompts>;
  defaults: EmailPrompts;
  disabled: boolean;
}) {
  return (
    <OperationalPanel>
      <OperationalPanelBody>
        <p className={cn("text-muted-foreground", typeStyle("body.default"))}>
          {props.intro}
        </p>
        <div className="mt-2 divide-y divide-border">
          {props.rows.map((row) => (
            <PromptField
              key={row.key}
              row={row}
              personal={props.personal}
              saved={props.saved[row.key]}
              defaultValue={props.defaults[row.key]}
              disabled={props.disabled}
            />
          ))}
        </div>
      </OperationalPanelBody>
    </OperationalPanel>
  );
}

function PromptField({
  row,
  personal,
  saved,
  defaultValue,
  disabled,
}: {
  row: PromptRow;
  personal: boolean;
  saved: string | undefined;
  defaultValue: string;
  disabled: boolean;
}) {
  const scope = personal ? "personal" : "shared";
  const serverValue = saved ?? (personal ? "" : defaultValue);
  const [value, setValue] = useState(serverValue);
  const { open, onOpenChange } = useFollowedOpen(
    `settings:email-prompts:${scope}:${row.key}`,
    saved !== undefined,
  );
  const unknown = unknownEmailPromptVariables(row.key, value);
  const problem = unknown.length
    ? `Unknown variable ${unknown.map((name) => `{{${name}}}`).join(", ")}. It won't save until it's fixed.`
    : null;
  const save = useLeaderOnly(useMutation(api.emailPrompts.save));
  const autoSave = useLocalFirstAutoSave({
    mutationName: `settings.emailPrompts.${scope}.${row.key}`,
    args: { value },
    source: { value: serverValue },
    adopt: (next) => setValue(next.value),
    canSave: !disabled && !problem,
    flush: (args) => save({ key: row.key, personal, value: args.value }),
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "This prompt could not be saved."),
  });
  const customized = personal
    ? value.trim() !== ""
    : value.trim() !== defaultValue.trim();
  const variables = EMAIL_PROMPT_VARIABLES[row.key];

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="py-3">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-left">
        <span className={cn("text-foreground", typeStyle("body.medium"))}>
          {row.title}
        </span>
        {customized ? <Badge variant="secondary">Customized</Badge> : null}
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 pt-2">
        <p
          className={cn("text-muted-foreground", typeStyle("caption.default"))}
        >
          {row.description}
        </p>
        <Textarea
          aria-label={row.title}
          value={value}
          rows={row.key.endsWith("rules") ? 8 : 4}
          maxLength={MAX_EMAIL_PROMPT_CHARS}
          disabled={disabled}
          placeholder={
            personal && row.key === "signature" ? defaultValue : undefined
          }
          aria-invalid={problem ? true : undefined}
          onChange={(event) => setValue(event.target.value)}
          className="resize-y"
        />
        {problem ? (
          <p className={cn("text-destructive", typeStyle("caption.default"))}>
            {problem}
          </p>
        ) : null}
        <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1">
          {variables.length ? (
            <span
              className={cn(
                "text-muted-foreground",
                typeStyle("caption.default"),
              )}
            >
              Variables: {variables.map((name) => `{{${name}}}`).join(", ")}
            </span>
          ) : null}
          <AutoSaveStatus status={autoSave.status} />
          {customized && !disabled ? (
            <button
              type="button"
              onClick={() => setValue(personal ? "" : defaultValue)}
              className={cn(
                "ml-auto text-muted-foreground transition-colors hover:text-foreground",
                typeStyle("caption.default"),
              )}
            >
              {personal ? "Clear" : "Reset to default"}
            </button>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
