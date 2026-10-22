"use client";

import { useRef, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@claritylabs-inc/ui/components/select";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { AcordLinesField } from "./acord-lines-field";
import { BROKER_CONTACT_ROLE_LABELS } from "@/convex/lib/brokerContactFields";
import { useLocalFirstAutoSave } from "@/lib/sync/use-local-first-auto-save";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

export function ProviderContacts({
  brokerOrgId,
}: {
  brokerOrgId: Id<"organizations">;
}) {
  const result = useQuery(api.brokerContacts.list, { brokerOrgId });
  const save = useMutation(api.brokerContacts.save);
  const [adding, setAdding] = useState(false);
  async function add() {
    setAdding(true);
    try {
      await save({
        brokerOrgId,
        name: "New contact",
        role: "general",
        lineOfBusinessCodes: [],
        sources: [],
        sourceKind: "manual",
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not add contact"));
    } finally {
      setAdding(false);
    }
  }
  return (
    <div className="space-y-5">
      <InlineFieldCard
        title="Contacts"
        actions={
          <PillButton
            variant="secondary"
            size="compact"
            disabled={
              adding || result === undefined || result.contacts.length >= 200
            }
            onClick={() => void add()}
          >
            {adding ? "Adding…" : "Add contact"}
          </PillButton>
        }
      >
        {result === undefined ? (
          <p
            className={`px-4 py-4 text-muted-foreground ${typeStyle("body.default")}`}
          >
            Loading contacts…
          </p>
        ) : !result.contacts.length ? (
          <p
            className={`px-4 py-4 text-muted-foreground ${typeStyle("body.default")}`}
          >
            Add submission inboxes, individual contacts and notes about when to
            reach each one.
          </p>
        ) : null}
      </InlineFieldCard>
      {result?.contacts.map((contact) => (
        <ContactEditor key={contact._id} contact={contact} />
      ))}
      {result?.bounded && (
        <p className={typeStyle("caption.default")}>
          Showing the first 200 contacts.
        </p>
      )}
    </div>
  );
}

function ContactEditor({ contact }: { contact: Doc<"brokerContacts"> }) {
  const save = useMutation(api.brokerContacts.save);
  const archive = useMutation(api.brokerContacts.setArchived);
  const revision = useRef(contact.revision);
  const [removing, setRemoving] = useState(false);
  const [values, setValues] = useState({
    name: contact.name,
    title: contact.title ?? "",
    role: contact.role,
    email: contact.email ?? "",
    phone: contact.phone ?? "",
    contactUrl: contact.contactUrl ?? "",
    lineOfBusinessCodes: contact.lineOfBusinessCodes,
    notes: contact.notes ?? "",
  });
  const set = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((current) => ({ ...current, [key]: value }));
  const autoSave = useLocalFirstAutoSave({
    mutationName: "brokerContacts.save",
    resetKey: contact._id,
    args: values,
    canSave:
      !!values.name.trim() &&
      (!values.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())),
    flush: async (next) => {
      const result = await save({
        ...next,
        brokerOrgId: contact.brokerOrgId,
        contactId: contact._id,
        expectedRevision: revision.current,
        sources: contact.sources,
        sourceKind: "manual",
      });
      revision.current = result.revision;
    },
    errorMessage: (error) =>
      getUserFacingErrorMessage(error, "Could not save contact"),
  });
  async function remove() {
    setRemoving(true);
    try {
      if (!(await autoSave.saveNow())) return;
      const result = await archive({
        contactId: contact._id,
        expectedRevision: revision.current,
        archived: true,
      });
      toast.success("Contact removed", {
        action: {
          label: "Undo",
          onClick: () => {
            void archive({
              contactId: contact._id,
              expectedRevision: result.revision,
              archived: false,
            }).catch((error) =>
              toast.error(
                getUserFacingErrorMessage(error, "Could not restore contact"),
              ),
            );
          },
        },
      });
    } catch (error) {
      toast.error(getUserFacingErrorMessage(error, "Could not remove contact"));
    } finally {
      setRemoving(false);
    }
  }
  return (
    <InlineFieldCard
      title={values.name || "Contact"}
      actions={
        <div className="flex items-center gap-2">
          <AutoSaveStatus status={autoSave.status} />
          <RemoveButton
            label={`Remove ${values.name || "contact"}`}
            busy={removing}
            onClick={() => void remove()}
          />
        </div>
      }
    >
      <InlineFieldRow label="Name or team">
        <Input
          aria-label="Contact name or team"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Title">
        <Input
          aria-label="Contact title"
          value={values.title}
          onChange={(e) => set("title", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Contact type">
        <Select
          items={BROKER_CONTACT_ROLE_LABELS}
          value={values.role}
          onValueChange={(value) => {
            if (value && value in BROKER_CONTACT_ROLE_LABELS)
              set("role", value as typeof values.role);
          }}
        >
          <SelectTrigger aria-label="Contact type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(BROKER_CONTACT_ROLE_LABELS).map(
              ([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </InlineFieldRow>
      <InlineFieldRow label="Email">
        <Input
          aria-label="Contact email"
          type="email"
          value={values.email}
          onChange={(e) => set("email", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Phone">
        <Input
          aria-label="Contact phone"
          type="tel"
          value={values.phone}
          onChange={(e) => set("phone", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Contact page">
        <Input
          aria-label="Contact page"
          type="url"
          value={values.contactUrl}
          onChange={(e) => set("contactUrl", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Best for">
        <AcordLinesField
          value={values.lineOfBusinessCodes}
          onChange={(value) => set("lineOfBusinessCodes", value)}
        />
      </InlineFieldRow>
      <InlineFieldRow label="Notes">
        <Textarea
          aria-label="Contact notes"
          placeholder="When to use this contact, submission preferences, relationships…"
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
      </InlineFieldRow>
      {!!contact.sources.length && (
        <InlineFieldRow label="Sources">
          <div className="space-y-1 px-3 py-2">
            {contact.sources.map((source) => (
              <a
                key={source}
                href={source}
                target="_blank"
                rel="noreferrer"
                className="block underline underline-offset-4"
              >
                {new URL(source).hostname}
              </a>
            ))}
            {contact.researchedAt && (
              <p
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Source checked{" "}
                {dayjs(contact.researchedAt).format("MMM D, YYYY")}
                {contact.sourceKind === "manual" ? " · Edited by operator" : ""}
              </p>
            )}
            {contact.sourceQuote && (
              <p
                className={`text-muted-foreground ${typeStyle("caption.default")}`}
              >
                {contact.sourceQuote}
              </p>
            )}
          </div>
        </InlineFieldRow>
      )}
    </InlineFieldCard>
  );
}
