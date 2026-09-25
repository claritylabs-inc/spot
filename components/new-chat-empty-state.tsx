"use client";

import { useMemo } from "react";
import Link from "next/link";
import type { Id } from "@/convex/_generated/dataModel";
import {
  useCachedAgentTargets,
  useCachedConnectedVendors,
} from "@/lib/sync/spot-cached-queries";
import { AgentDockSuggestions } from "@/components/agent-dock/agent-dock-suggestions";
import { typeStyle } from "@/lib/typography";

type ExamplePrompt = {
  label: string;
  prompt: string;
  requires: Array<"policies" | "requirements" | "mailboxes" | "activeVendors">;
};

type ConnectedVendorRow = {
  kind?: string;
  status?: string;
};

const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    label: "Summarize my active coverage",
    prompt:
      "Summarize my active policies, key limits, deductibles, carriers, and renewal dates",
    requires: ["policies"],
  },
  {
    label: "Check requirements against current coverage",
    prompt:
      "Compare my current policies against active requirements and flag coverage gaps with policy evidence",
    requires: ["policies", "requirements"],
  },
  {
    label: "Find source-backed policy wording",
    prompt:
      "Find the source-backed wording for cancellation notice, additional insured, waiver of subrogation, and primary noncontributory status",
    requires: ["policies"],
  },
  {
    label: "Draft a COI request with required endorsements",
    prompt:
      "Draft a COI request that includes certificate holder details, required limits, additional insured, waiver, and primary noncontributory wording",
    requires: ["policies"],
  },
  {
    label: "Review connected vendor compliance",
    prompt:
      "Show which connected vendors are missing required coverage or have expiring policies, with requirement-by-requirement gaps",
    requires: ["requirements", "activeVendors"],
  },
  {
    label: "Draft a coverage update",
    prompt:
      "Draft a concise email summarizing my current coverage, open questions, and next servicing steps",
    requires: ["policies"],
  },
  {
    label: "Find the latest policy or renewal attachment",
    prompt:
      "Search connected email for my latest policy, certificate, or renewal attachment and save the relevant files to this thread",
    requires: ["mailboxes"],
  },
];

const GET_STARTED_ACTIONS = [
  {
    label: "Upload a policy",
    href: "/policies",
  },
  {
    label: "Add requirements",
    href: "/compliance",
  },
  {
    label: "Connect a mailbox",
    href: "/settings?section=mailboxes",
  },
  {
    label: "Invite a vendor",
    href: "/connect/vendors",
  },
];

export function NewChatEmptyState({
  onSelectPrompt,
  orgId,
  leadingPrompts = [],
}: {
  onSelectPrompt: (prompt: string) => void;
  orgId?: Id<"organizations">;
  /** Prompts for the page the chat starts from, shown first. */
  leadingPrompts?: Array<{ label: string; prompt: string }>;
}) {
  const targets = useCachedAgentTargets(orgId);
  const vendorRows = useCachedConnectedVendors(orgId) as
    | ConnectedVendorRow[]
    | undefined;
  const isLoadingContext =
    Boolean(orgId) && (targets === undefined || vendorRows === undefined);
  const prompts = useMemo(() => {
    const counts = {
      policies: targets?.policies.length ?? 0,
      requirements: targets?.requirements.length ?? 0,
      mailboxes: targets?.mailboxes.length ?? 0,
      activeVendors:
        vendorRows?.filter(
          (row) => row.kind === "relationship" && row.status === "active",
        ).length ?? 0,
    };
    const has = {
      policies: counts.policies > 0,
      requirements: counts.requirements > 0,
      mailboxes: counts.mailboxes > 0,
      activeVendors: counts.activeVendors > 0,
    };

    const dataPrompts = EXAMPLE_PROMPTS.filter((item) =>
      item.requires.every((requirement) => has[requirement]),
    );
    return [...leadingPrompts, ...dataPrompts]
      .filter(
        (item, index, all) =>
          all.findIndex((other) => other.label === item.label) === index,
      )
      .slice(0, 4);
  }, [leadingPrompts, targets, vendorRows]);

  if (isLoadingContext) {
    return null;
  }

  if (prompts.length === 0) {
    return (
      <div className="mt-auto pb-2">
        <p className={`mb-1 text-muted-foreground/60 ${typeStyle("caption.medium")}`}>
          Get started
        </p>
        {GET_STARTED_ACTIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`block py-1.5 text-muted-foreground transition-colors hover:text-foreground ${typeStyle("body.default")}`}
          >
            {item.label}
          </Link>
        ))}
      </div>
    );
  }

  return (
    <AgentDockSuggestions
      items={prompts.map((item) => ({ id: item.label, label: item.label }))}
      onSelect={(label) => {
        const item = prompts.find((prompt) => prompt.label === label);
        if (item) onSelectPrompt(item.prompt);
      }}
    />
  );
}
