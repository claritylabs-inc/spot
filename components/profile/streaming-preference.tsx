"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { SettingsToggleRow } from "@/components/settings/settings-toggle-row";

export function useChatDisplayPreferences() {
  const viewer = useQuery(api.users.viewer);
  return {
    loaded: viewer != null,
    streamResponses: viewer != null && viewer.streamResponses !== false,
    showThinking: viewer?.showThinking === true,
  };
}

export function StreamingPreference() {
  const preferences = useChatDisplayPreferences();
  const update = useMutation(api.users.updateProfile);
  const [saving, setSaving] = useState(false);
  async function save(patch: {
    streamResponses?: boolean;
    showThinking?: boolean;
  }) {
    setSaving(true);
    try {
      await update(patch);
    } catch {
      toast.error("Could not save chat preferences.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <SettingsToggleRow
        title="Stream responses"
        description="Show replies as Spot writes them in web chat."
        checked={preferences.streamResponses}
        disabled={!preferences.loaded || saving}
        onCheckedChange={(streamResponses) => {
          void save({ streamResponses });
        }}
      />
      <SettingsToggleRow
        title="Show thinking"
        description="Show a collapsible summary of Spot’s activity."
        checked={preferences.showThinking}
        disabled={!preferences.loaded || saving}
        onCheckedChange={(showThinking) => {
          void save({ showThinking });
        }}
      />
    </>
  );
}
