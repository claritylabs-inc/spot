"use client";

import { useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useAction, useQuery } from "convex/react";
import { Check, FileInput, Layers, Loader2, Search } from "lucide-react";
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@claritylabs-inc/ui/components/input-group";
import { ScrollArea } from "@claritylabs-inc/ui/components/scroll-area";
import { OrgBrandIcon } from "@/components/ui/org-brand-icon";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  PROVIDER_ACORD_LOB_CODES,
  lobLabel,
} from "@/convex/lib/linesOfBusiness";
import { useFollowedState } from "@/hooks/use-followed-state";
import { useCachedOperatorBrokers } from "@/lib/sync/operator-cached-queries";
import { typeStyle } from "@/lib/typography";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";

const coverages = PROVIDER_ACORD_LOB_CODES.map((value) => ({
  value,
  label: lobLabel(value),
})).sort((a, b) => a.label.localeCompare(b.label));

const menuWidth = "w-88 max-w-[min(var(--available-width),calc(100vw-2rem))]";
const pickerLayout = `${menuWidth} max-h-[min(24rem,var(--available-height))] overflow-hidden p-0`;
const resultScroll =
  "max-h-[min(18rem,calc(var(--available-height)-5.5rem))] [&>[data-slot=scroll-area-viewport]]:max-h-[inherit]";
const choiceRow = "gap-3 px-2.5 py-2";

// Let text entry use its own keys; keep menu navigation and Escape available.
function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
  if (!["Escape", "Tab", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.stopPropagation();
  }
}

export function AttachmentSubmissionMenu({
  parentMenuRef,
  source,
  file,
  defaultBrokerOrgId,
  defaultBrokerName,
  onSaved,
}: {
  parentMenuRef: RefObject<HTMLDivElement | null>;
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
  const formMenuRef = useRef<HTMLDivElement>(null);
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
      <DropdownMenuSubTrigger openOnHover={false} className="gap-2 px-2.5 py-2">
        <FileInput /> Use as default application form
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={formMenuRef}
        anchor={parentMenuRef}
        alignOffset={0}
        sideOffset={8}
        className={`${menuWidth} p-1.5`}
      >
        <DropdownMenuSub open={providerOpen} onOpenChange={setProviderOpen}>
          <DropdownMenuSubTrigger
            openOnHover={false}
            disabled={saving}
            className="gap-3 px-2.5 py-2.5 [&>svg:last-child]:text-muted-foreground"
          >
            <OrgBrandIcon
              name={selectedProvider?.name ?? "Provider"}
              iconUrl={selectedProvider?.iconUrl}
              website={selectedProvider?.website}
              size="sm"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={`block text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Provider
              </span>
              <span className="block truncate">
                {selectedProvider?.name ?? "Choose provider"}
              </span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            anchor={formMenuRef}
            alignOffset={0}
            sideOffset={8}
            className={pickerLayout}
          >
            <DropdownMenuGroup>
              <div className="space-y-2 px-3 pt-3 pb-2.5">
                <DropdownMenuLabel className="p-0">Provider</DropdownMenuLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search providers"
                    placeholder="Search providers…"
                    value={providerSearch}
                    onChange={(event) => setProviderSearch(event.target.value)}
                    onKeyDown={searchKeys}
                  />
                </InputGroup>
              </div>
              <DropdownMenuSeparator className="m-0" />
              <ScrollArea className={resultScroll}>
                <div className="p-1.5 pr-3">
                  {brokers === undefined && !options.length ? (
                    <DropdownMenuItem disabled>
                      Loading providers…
                    </DropdownMenuItem>
                  ) : null}
                  {matchingProviders.map((broker) => (
                    <DropdownMenuItem
                      key={broker.id}
                      label={broker.name}
                      closeOnClick={false}
                      className={choiceRow}
                      onClick={() => {
                        setProviderId(broker.id);
                        setProviderOpen(false);
                      }}
                    >
                      <OrgBrandIcon {...broker} size="sm" />
                      <span className="min-w-0 flex-1 break-words">
                        {broker.name}
                      </span>
                      {providerId === broker.id ? (
                        <Check className="text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {brokers !== undefined && !matchingProviders.length ? (
                    <DropdownMenuItem disabled>
                      No providers found
                    </DropdownMenuItem>
                  ) : null}
                </div>
              </ScrollArea>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub open={coverageOpen} onOpenChange={setCoverageOpen}>
          <DropdownMenuSubTrigger
            openOnHover={false}
            disabled={saving}
            className="gap-3 px-2.5 py-2.5 [&>svg:last-child]:text-muted-foreground"
          >
            <Layers className="size-6 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span
                className={`block text-muted-foreground ${typeStyle("caption.default")}`}
              >
                Coverage line
              </span>
              <span className="block truncate">
                {coverageCode ? lobLabel(coverageCode) : "Choose coverage"}
              </span>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent
            anchor={formMenuRef}
            alignOffset={0}
            sideOffset={8}
            className={pickerLayout}
          >
            <DropdownMenuGroup>
              <div className="space-y-2 px-3 pt-3 pb-2.5">
                <DropdownMenuLabel className="p-0">
                  Coverage line
                </DropdownMenuLabel>
                <InputGroup>
                  <InputGroupAddon>
                    <Search />
                  </InputGroupAddon>
                  <InputGroupInput
                    aria-label="Search coverage lines"
                    placeholder="Search coverage lines…"
                    value={coverageSearch}
                    onChange={(event) => setCoverageSearch(event.target.value)}
                    onKeyDown={searchKeys}
                  />
                </InputGroup>
              </div>
              <DropdownMenuSeparator className="m-0" />
              <ScrollArea className={resultScroll}>
                <div className="p-1.5 pr-3">
                  {matchingCoverages.map((coverage) => (
                    <DropdownMenuItem
                      key={coverage.value}
                      label={coverage.label}
                      closeOnClick={false}
                      className={choiceRow}
                      onClick={() => {
                        setCoverageCode(coverage.value);
                        setCoverageOpen(false);
                      }}
                    >
                      <span className="min-w-0 flex-1 break-words">
                        {coverage.label}
                      </span>
                      {coverageCode === coverage.value ? (
                        <Check className="text-muted-foreground" />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                  {!matchingCoverages.length ? (
                    <DropdownMenuItem disabled>
                      No coverage lines found
                    </DropdownMenuItem>
                  ) : null}
                </div>
              </ScrollArea>
            </DropdownMenuGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator className="mx-1 my-1.5" />
        <DropdownMenuItem
          className="gap-3 px-2.5 py-2"
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
