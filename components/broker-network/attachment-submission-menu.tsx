"use client";

import { useState, type KeyboardEvent } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, FileInput, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@claritylabs-inc/ui/components/dropdown-menu";
import { Input } from "@claritylabs-inc/ui/components/input";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PROVIDER_ACORD_LOB_CODES,
  lobLabel,
} from "@/convex/lib/linesOfBusiness";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const coverages = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: lobLabel(value),
})).sort((a, b) => a.label.localeCompare(b.label));

// Let text entry use its own keys; keep menu navigation and Escape available.
function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (!["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.stopPropagation();
  }
}

export function AttachmentSubmissionMenu({
  source,
  file,
  defaultBrokerOrgId,
  defaultBrokerName,
  onSaved,
}: {
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
  onSaved: () => void;
}) {
  const key = `email:${source.messageId}:attachment:${file.clientFileId ?? file.storageId}:defaults`;
  const [providerId, setProviderId] = useFollowedState<string>(
    `${key}:provider`,
    defaultBrokerOrgId ?? "",
  );
  const [coverageCode, setCoverageCode] = useFollowedState(
    `${key}:coverage`,
    "",
  );
  const [providerOpen, setProviderOpen] = useFollowedState(
    `${key}:provider-open`,
    false,
  );
  const [coverageOpen, setCoverageOpen] = useFollowedState(
    `${key}:coverage-open`,
    false,
  );
  const [formOpen, setFormOpen] = useFollowedState(`${key}:open`, false);
  const [providerSearch, setProviderSearch] = useState("");
  const [coverageSearch, setCoverageSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const brokers = useCachedOperatorBrokers();
  const options: Array<{
    id: string;
    name: string;
    iconUrl?: string | null;
    website?: string;
  }> = (brokers ?? []).map((broker) => ({
    id: String(broker._id),
    name: broker.name,
    iconUrl: broker.iconUrl,
    website: broker.website,
  }));
  if (
    defaultBrokerOrgId &&
    !options.some((broker) => broker.id === defaultBrokerOrgId)
  ) {
    options.push({
      id: defaultBrokerOrgId,
      name: defaultBrokerName ?? "Provider",
    });
  }
  const selectedProvider = options.find((broker) => broker.id === providerId);
  const saved = useQuery(
    api.providerSubmissionDefaults.get,
    providerId && coverageCode
      ? { brokerOrgId: providerId as Id<"organizations">, coverageCode }
      : "skip",
  );
  const saveForm = useAction(api.providerSubmissionDefaults.saveFromAttachment);
  const matchingProviders = options.filter((broker) =>
    broker.name.toLowerCase().includes(providerSearch.trim().toLowerCase()),
  );
  const matchingCoverages = coverages.filter((coverage) =>
    `${coverage.label} ${coverage.value}`
      .toLowerCase()
      .includes(coverageSearch.trim().toLowerCase()),
  );

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
          `Complete ${file.name} when submitting ${lobLabel(coverageCode)} to ${selectedProvider?.name ?? "this provider"}.`,
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
        `Application form saved for ${selectedProvider?.name ?? "provider"} · ${lobLabel(coverageCode)}`,
      );
      onSaved();
    } catch (error) {
      toast.error(
        getUserFacingErrorMessage(error, "Could not save the application form"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <DropdownMenuSub
      open={formOpen}
      onOpenChange={(open) => {
        if (!saving) setFormOpen(open);
      }}
    >
      <DropdownMenuSubTrigger openOnHover={false}>
        <FileInput /> Use as default application form
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuSub open={providerOpen} onOpenChange={setProviderOpen}>
          <DropdownMenuSubTrigger openOnHover={false} disabled={saving}>
            Provider:{" "}
            <span className="truncate">
              {selectedProvider?.name ?? "Choose provider"}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72 max-w-[calc(100vw-2rem)]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Provider</DropdownMenuLabel>
              <Input
                aria-label="Search providers"
                placeholder="Search providers…"
                value={providerSearch}
                onChange={(event) => setProviderSearch(event.target.value)}
                onKeyDown={searchKeys}
              />
              {brokers === undefined && !options.length ? (
                <DropdownMenuItem disabled>Loading providers…</DropdownMenuItem>
              ) : null}
              {matchingProviders.map((broker) => (
                <DropdownMenuItem
                  key={broker.id}
                  label={broker.name}
                  closeOnClick={false}
                  onClick={() => {
                    setProviderId(broker.id);
                    setProviderOpen(false);
                  }}
                >
                  <OrgBrandIcon {...broker} size="xs" />
                  <span className="min-w-0 flex-1 truncate">{broker.name}</span>
                  {providerId === broker.id ? <Check /> : null}
                </DropdownMenuItem>
              ))}
              {brokers !== undefined && !matchingProviders.length ? (
                <DropdownMenuItem disabled>No providers found</DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub open={coverageOpen} onOpenChange={setCoverageOpen}>
          <DropdownMenuSubTrigger openOnHover={false} disabled={saving}>
            Coverage:{" "}
            <span className="truncate">
              {coverageCode ? lobLabel(coverageCode) : "Choose coverage"}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-72 max-w-[calc(100vw-2rem)]">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Coverage line</DropdownMenuLabel>
              <Input
                aria-label="Search coverage lines"
                placeholder="Search coverage lines…"
                value={coverageSearch}
                onChange={(event) => setCoverageSearch(event.target.value)}
                onKeyDown={searchKeys}
              />
              {matchingCoverages.map((coverage) => (
                <DropdownMenuItem
                  key={coverage.value}
                  label={coverage.label}
                  closeOnClick={false}
                  onClick={() => {
                    setCoverageCode(coverage.value);
                    setCoverageOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {coverage.label}
                  </span>
                  {coverageCode === coverage.value ? <Check /> : null}
                </DropdownMenuItem>
              ))}
              {!matchingCoverages.length ? (
                <DropdownMenuItem disabled>
                  No coverage lines found
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          closeOnClick={false}
          disabled={
            saving || !providerId || !coverageCode || saved === undefined
          }
          onClick={() => void save()}
        >
          {saving ? <Loader2 className="animate-spin" /> : <FileInput />}
          {saving ? "Saving…" : "Save application form"}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
