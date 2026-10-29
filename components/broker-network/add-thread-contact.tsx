"use client";

import { useEffect, useMemo, useState } from "react";
import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Checkbox } from "@claritylabs-inc/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { useFollowedOpen } from "@/hooks/use-followed-state";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

export type ThreadContactSuggestion = FunctionReturnType<
  typeof api.brokerContacts.suggestionsForThread
>[number];

type PrimaryDefault = FunctionReturnType<
  typeof api.actions.brokerContactDefaults.primaryDefault
>;

/**
 * Icon button that saves a new conversation participant as a provider contact.
 * The dialog picks the provider (defaulting to the conversation's) and whether
 * they become its primary contact (defaulting to Jev's seniority check).
 */
export function AddThreadContact({
  threadId,
  name,
  suggestion,
}: {
  threadId: Id<"teamEmailThreads">;
  name?: string;
  suggestion: ThreadContactSuggestion;
}) {
  const { open, onOpenChange } = useFollowedOpen(
    `procurement:email:${threadId}:add-contact:${suggestion.email}`,
  );
  const defaultName = name?.trim() || suggestion.email.split("@")[0];
  return (
    <>
      <PillButton
        type="button"
        variant="icon"
        size="compact"
        iconOnly
        label={`Add ${defaultName} to ${suggestion.brokerName}`}
        className="shrink-0"
        onClick={() => onOpenChange(true)}
      >
        <UserPlus />
      </PillButton>
      <AddThreadContactDialog
        threadId={threadId}
        name={defaultName}
        email={suggestion.email}
        suggestion={suggestion}
        open={open}
        onOpenChange={onOpenChange}
      />
    </>
  );
}

export function AddThreadContactDialog({
  threadId,
  name,
  email,
  suggestion,
  open,
  onOpenChange,
  primaryDefault = false,
}: {
  threadId: Id<"teamEmailThreads">;
  name?: string;
  email: string;
  suggestion?: ThreadContactSuggestion;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primaryDefault?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-collab-scope={`add-contact:${threadId}:${email}`}>
        {open ? (
          <AddThreadContactForm
            threadId={threadId}
            defaultName={name?.trim() || email.split("@")[0]}
            email={email}
            suggestion={suggestion}
            primaryDefault={primaryDefault}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddThreadContactForm({
  threadId,
  defaultName,
  email,
  suggestion,
  onDone,
  primaryDefault,
}: {
  threadId: Id<"teamEmailThreads">;
  defaultName: string;
  email: string;
  suggestion?: ThreadContactSuggestion;
  onDone: () => void;
  primaryDefault: boolean;
}) {
  const brokers = useCachedOperatorBrokers();
  const save = useMutation(api.brokerContacts.save);
  const suggestPrimary = useAction(
    api.actions.brokerContactDefaults.primaryDefault,
  );
  const [contactName, setContactName] = useState(defaultName);
  const [brokerOrgId, setBrokerOrgId] = useState<string>(
    suggestion?.brokerOrgId ?? "",
  );
  // Jev's default applies until the operator sets the checkbox themselves.
  const [primaryChoice, setPrimaryChoice] = useState<boolean | null>(
    primaryDefault ? true : null,
  );
  const [defaults, setDefaults] = useState<
    Record<string, PrimaryDefault | "failed">
  >({});
  const [saving, setSaving] = useState(false);
  const suggested = defaults[brokerOrgId];

  useEffect(() => {
    if (primaryDefault || !brokerOrgId || defaults[brokerOrgId]) return;
    let cancelled = false;
    suggestPrimary({
      threadId,
      brokerOrgId: brokerOrgId as Id<"organizations">,
      email,
      name: defaultName,
    })
      .then((result) => result as PrimaryDefault | "failed")
      .catch(() => "failed" as const)
      .then((result) => {
        if (!cancelled)
          setDefaults((current) => ({ ...current, [brokerOrgId]: result }));
      });
    return () => {
      cancelled = true;
    };
  }, [
    brokerOrgId,
    defaultName,
    defaults,
    primaryDefault,
    suggestPrimary,
    email,
    threadId,
  ]);

  const options = useMemo(() => {
    const rows = (brokers ?? []).map((broker) => ({
      value: String(broker._id),
      label: broker.name,
      icon: <OrgBrandIcon {...broker} size="xs" />,
    }));
    if (
      suggestion &&
      !rows.some((row) => row.value === suggestion.brokerOrgId)
    ) {
      rows.push({
        value: suggestion.brokerOrgId,
        label: suggestion.brokerName,
        icon: <OrgBrandIcon name={suggestion.brokerName} size="xs" />,
      });
    }
    return rows;
  }, [brokers, suggestion]);
  const brokerName =
    options.find((broker) => broker.value === brokerOrgId)?.label ?? "provider";
  const primary =
    primaryChoice ??
    (suggested && suggested !== "failed" ? suggested.primary : false);
  const primaryHint = !brokerOrgId
    ? "Choose the provider this contact belongs to."
    : primaryDefault
      ? "Use this contact by default for future provider outreach."
      : suggested === undefined
        ? "Checking existing contacts…"
        : suggested === "failed"
          ? "Outreach goes to the primary contact first."
          : suggested.moreSenior
            ? `${suggested.moreSenior} looks more senior.`
            : suggested.primary
              ? "No existing contact looks more senior."
              : "Outreach goes to the primary contact first.";

  async function submit() {
    if (saving || !brokerOrgId || !contactName.trim()) return;
    setSaving(true);
    try {
      const result = await save({
        threadId,
        brokerOrgId: brokerOrgId as Id<"organizations">,
        name: contactName,
        email,
        role: "general",
        lineOfBusinessCodes: [],
        sources: [],
        sourceKind: "manual",
        ...(primary ? { primary: true } : {}),
      });
      toast.success(
        result.existing
          ? `${contactName.trim()} is saved${primary ? " as the primary outreach contact" : ""} for ${brokerName}`
          : `Added ${contactName.trim()} to ${brokerName}`,
      );
      onDone();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not add the contact"),
      );
      setSaving(false);
    }
  }

  return (
    <form
      className="contents"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {primaryDefault
            ? "Make primary outreach contact"
            : "Add provider contact"}
        </DialogTitle>
        <DialogDescription>{email}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="add-thread-contact-name">Name</FieldLabel>
          <Input
            id="add-thread-contact-name"
            value={contactName}
            onChange={(event) => setContactName(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel>Provider</FieldLabel>
          <SearchableSelect
            ariaLabel="Provider"
            typographyRole="control.menu"
            value={brokerOrgId}
            options={options}
            onChange={(value) => {
              if (!value) return;
              setBrokerOrgId(value);
              setPrimaryChoice(primaryDefault ? true : null);
            }}
            disabled={saving}
            placeholder="Choose provider"
          />
        </Field>
        <Field orientation="horizontal">
          <Checkbox
            id="add-thread-contact-primary"
            checked={primary}
            disabled={saving}
            onCheckedChange={(value) => setPrimaryChoice(value === true)}
          />
          <FieldContent>
            <FieldLabel htmlFor="add-thread-contact-primary">
              <FieldTitle>Primary outreach contact</FieldTitle>
            </FieldLabel>
            <FieldDescription>{primaryHint}</FieldDescription>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <PillButton
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={onDone}
        >
          Cancel
        </PillButton>
        <PillButton
          type="submit"
          disabled={saving || !contactName.trim() || !brokerOrgId}
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Add contact
        </PillButton>
      </DialogFooter>
    </form>
  );
}
