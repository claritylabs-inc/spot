"use client";

import { useMutation } from "convex/react";
import { PanelBottom, PanelRight } from "lucide-react";
import { toast } from "sonner";
import { ToggleGroup } from "@claritylabs-inc/ui/components/marketing/toggle-group";
import type { AgentDockPlacement } from "@/components/agent-dock/agent-dock-layout";
import { api } from "@/convex/_generated/api";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { typeStyle } from "@/lib/typography";

const OPTIONS = [
  {
    value: "bottom",
    label: "Below",
    ariaLabel: "Show the AI panel below the page",
    icon: <PanelBottom className="size-4 shrink-0" aria-hidden />,
  },
  {
    value: "right",
    label: "Right",
    ariaLabel: "Show the AI panel to the right of the page",
    icon: <PanelRight className="size-4 shrink-0" aria-hidden />,
  },
] as const;

/** Where the AI panel docks on desktop; mobile always docks it below. */
export function AgentDockPlacementPreference() {
  const viewer = useCachedQuery("users.viewer", api.users.viewer, {});
  const update = useMutation(api.users.updateProfile).withOptimisticUpdate(
    (store, { agentDockPlacement }) => {
      const current = store.getQuery(api.users.viewer, {});
      if (current && agentDockPlacement) {
        store.setQuery(api.users.viewer, {}, { ...current, agentDockPlacement });
      }
    },
  );
  const value: AgentDockPlacement = viewer?.agentDockPlacement ?? "bottom";

  return (
    <div className="flex items-center justify-between gap-4 py-3.5">
      <div className="min-w-0">
        <p className={`text-foreground ${typeStyle("body.medium")}`}>
          AI panel position
        </p>
        <p
          className={`mt-0.5 max-w-md text-muted-foreground/60 ${typeStyle("caption.default")}`}
        >
          Dock Spot below the page, or to its right with chats as vertical tabs.
        </p>
      </div>
      <ToggleGroup
        aria-label="AI panel position"
        value={value}
        showLabels
        onChange={(agentDockPlacement) => {
          if (!viewer || agentDockPlacement === value) return;
          update({ agentDockPlacement }).catch(() =>
            toast.error("Could not save the AI panel position."),
          );
        }}
        className="ml-4 shrink-0"
        options={OPTIONS}
      />
    </div>
  );
}
