"use client";

import { useEffect, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@claritylabs-inc/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { SearchableSelect } from "@claritylabs-inc/ui/components/searchable-select";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PROVIDER_ACORD_LOB_CODES,
  lobLabel,
} from "@/convex/lib/linesOfBusiness";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const coverageOptions = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: lobLabel(value),
})).sort((a, b) => a.label.localeCompare(b.label));

export function AttachmentSubmissionDialog({
  open,
  onOpenChange,
  source,
  file,
  defaultBrokerOrgId,
  defaultBrokerName,
  defaultCoverageCodes = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: {
    threadId: Id<"teamEmailThreads">;
    messageId: Id<"teamEmailMessages">;
  };
  file: {
    name: string;
    clientFileId?: Id<"clientFiles">;
    storageId?: Id<"_storage">;
  };
  defaultBrokerOrgId?: Id<"organizations">;
  defaultBrokerName?: string;
  /** Coverage lines of the request this email belongs to. */
  defaultCoverageCodes?: string[];
}) {
  const key = `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:defaults`;
  const [providerId, setProviderId] = useFollowedState<string>(
    `${key}:provider`,
    defaultBrokerOrgId ?? "",
  );
  // A single-line request decides the coverage; several lines ask Jev below.
  const [coverageCode, setCoverageCode] = useFollowedState(
    `${key}:coverage`,
    defaultCoverageCodes.length === 1 ? defaultCoverageCodes[0] : "",
  );
  const [saving, setSaving] = useState(false);
  const brokers = useCachedOperatorBrokers();
  const options: Array<{
    value: string;
    label: string;
    icon?: React.ReactNode;
  }> = (brokers ?? []).map((broker) => ({
    value: String(broker._id),
    label: broker.name,
    icon: (
      <OrgBrandIcon
        name={broker.name}
        iconUrl={broker.iconUrl}
        website={broker.website}
        size="sm"
      />
    ),
  }));
  if (
    defaultBrokerOrgId &&
    !options.some((broker) => broker.value === defaultBrokerOrgId)
  ) {
    options.push({
      value: defaultBrokerOrgId,
      label: defaultBrokerName ?? "Provider",
    });
  }
  const providerName = options.find((broker) => broker.value === providerId)?.label;
  const saved = useQuery(
    api.providerSubmissionDefaults.get,
    open && providerId && coverageCode
      ? { brokerOrgId: providerId as Id<"organizations">, coverageCode }
      : "skip",
  );
  const suggestCoverage = useAction(api.actions.submissionCoverage.suggest);
  const candidates = defaultCoverageCodes.join(",");
  const needsSuggestion =
    open && !coverageCode && defaultCoverageCodes.length > 1;
  useEffect(() => {
    if (!needsSuggestion) return;
    let cancelled = false;
    void suggestCoverage({
      threadId: source.threadId,
      fileName: file.name,
      candidates: candidates.split(","),
    })
      .then((code) => {
        if (!cancelled && code) setCoverageCode((current) => current || code);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsSuggestion, candidates, file.name, source.threadId]);
  const saveForm = useAction(api.providerSubmissionDefaults.saveFromAttachment);

  async function save() {
    if (saving || !providerId || !coverageCode || saved === undefined) return;
    setSaving(true);
    try {
      await saveForm({
        brokerOrgId: providerId as Id<"organizations">,
        coverageCode,
        expectedRevision: saved?.revision ?? 0,
        instructions:
          saved?.instructions ??
          `Complete ${file.name} when submitting ${lobLabel(coverageCode)} to ${providerName ?? "this provider"}.`,
        requirements: saved?.requirements ?? [],
        // Preserve the existing process's provenance when only adding a form.
        ...(saved
          ? {}
          : {
              sourceThreadId: source.threadId,
              sourceMessageId: source.messageId,
            }),
        attachment: {
          ...source,
          ...(file.clientFileId
            ? { clientFileId: file.clientFileId }
            : { storageId: file.storageId }),
        },
      });
      toast.success(
        `Application form saved for ${providerName ?? "provider"} · ${lobLabel(coverageCode)}`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the application form"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent data-collab-scope={`attachment-form:${key}`}>
        <form
          className="contents"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <DialogHeader>
            <DialogTitle>Use as default application form</DialogTitle>
            <DialogDescription>{file.name}</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>Provider</FieldLabel>
              <SearchableSelect
                ariaLabel="Provider"
                typographyRole="control.menu"
                value={providerId}
                options={options}
                onChange={setProviderId}
                disabled={saving}
                placeholder="Choose provider"
              />
            </Field>
            <Field>
              <FieldLabel>Coverage line</FieldLabel>
              <SearchableSelect
                ariaLabel="Coverage line"
                typographyRole="control.menu"
                value={coverageCode}
                options={coverageOptions}
                onChange={setCoverageCode}
                disabled={saving}
                placeholder="Choose coverage"
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <PillButton
              type="button"
              variant="secondary"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </PillButton>
            <PillButton
              type="submit"
              disabled={
                saving || !providerId || !coverageCode || saved === undefined
              }
            >
              {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Save form
            </PillButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
