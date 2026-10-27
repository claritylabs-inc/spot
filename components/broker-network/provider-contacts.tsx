"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { PhoneInput } from "@claritylabs-inc/ui/components/marketing/phone-input";
import { Input } from "@claritylabs-inc/ui/components/input";
import { Textarea } from "@claritylabs-inc/ui/components/textarea";
import { ListToolbar } from "@/components/ui/list-toolbar";
import { InlineFieldCard, InlineFieldRow } from "@/components/ui/inline-fields";
import { PillButton } from "@/components/ui/pill-button";
import { RemoveButton } from "@/components/ui/remove-button";
import { AutoSaveStatus } from "@/components/ui/auto-save-status";
import { AcordLinesField } from "./acord-lines-field";
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
    <div className="space-y-4">
      <ListToolbar
      followKey={`provider:${brokerOrgId}:contacts:actions`}
      actions={
        <PillButton
          variant="primary"
          size="compact"
          disabled={
            adding || result === undefined || result.contacts.length >= 200
          }
          onClick={() => void add()}
        >
          {adding ? "Adding…" : "Add contact"}
        </PillButton>
      }
      />
      <div className="space-y-5">
        {result === undefined ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Loading contacts…
          </p>
        ) : !result.contacts.length ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
            Add submission inboxes, individual contacts and notes about when to
            reach each one.
          </p>
        ) : null}
        {result?.contacts.map((contact) => (
          <ContactEditor key={contact._id} contact={contact} />
        ))}
        {result?.bounded && (
          <p className={typeStyle("caption.default")}>
            Showing the first 200 contacts.
          </p>
        )}
      </div>
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
    email: contact.email ?? "",
    phone: contact.phone ?? "",
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
        title: contact.title,
        role: contact.role,
        contactUrl: contact.contactUrl,
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
      <InlineFieldRow label="Name">
        <Input
          aria-label="Contact name"
          value={values.name}
          onChange={(e) => set("name", e.target.value)}
          onBlur={() => void autoSave.saveNow()}
        />
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
        <PhoneInput
          aria-label="Contact phone"
          value={values.phone || undefined}
          defaultCountry="US"
          autoComplete="tel"
          onChange={(phone) => set("phone", phone ?? "")}
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
    </InlineFieldCard>
  );
}
