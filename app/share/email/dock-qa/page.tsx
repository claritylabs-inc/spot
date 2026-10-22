"use client";

// TEMPORARY QA preview — not committed.
import { useState } from "react";
import { AppShellPortal, AppShellSlotsProvider } from "@/components/app-shell-slots";
import { AgentDockProvider } from "@/components/agent-dock/agent-dock-provider";
import { AgentDockLayout } from "@/components/agent-dock/agent-dock-layout";
import type { AgentDockAdapter } from "@/components/agent-dock/types";
import { ChatAssistantTurn } from "@/components/chat/chat-message";
import { useAppShellSlot } from "@/components/app-shell-slots";
import { useMediaQuery } from "@/components/app-sidebar/utils";
import {
  OperatorEmailDraftCards,
  OperatorEmailDraftPanel,
} from "@/components/operator-agent/operator-email-drafts";
import type { OperatorEmailDraftView } from "@/lib/operator-email-draft";

const html = `<p>Hi Jose,</p><p>We're close to submitting your commercial auto, general liability, property and umbrella application. To get accurate quotes, please reply with:</p><ol><li><strong>Current insurance:</strong> declarations pages and recent loss runs.</li><li><strong>Vehicles:</strong> year, make, model and VIN for the F-350 and trailer.</li><li><strong>Operations:</strong> states and regular routes.</li><li><strong>Payroll:</strong> 2025 total payroll and subcontractor share.</li></ol><p>Thanks,<br/>Terry Wang<br/>Spot</p>`;
const draft: OperatorEmailDraftView = {
  id: "d1", messageId: "m1", status: "draft",
  subject: "A few details to finish your insurance quote",
  to: ["jose@rightawayenterprises.com"], cc: [], bcc: [],
  replyTo: ["terry@claritylabs.inc", "req-7f3k2@agent.spot.insure"],
  from: "Spot <rightaway@agent.spot.insure>", html, text: html.replace(/<[^>]+>/g, " "),
  attachments: [], organizationName: "Right away Enterprises", updatedAt: Date.now(),
};

function QaChat() {
  const [open, setOpen] = useState(true);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
      <div className="ml-auto w-fit rounded-2xl bg-muted px-3 py-2 text-sm">Draft an email to Jose asking for what we're missing. Let me see it first.</div>
      <ChatAssistantTurn
        working={false}
        audience="operator"
        presentation={undefined}
        content="I drafted a short email to Jose with the four items we still need. It isn't sent; tell me when to send it."
        after={<OperatorEmailDraftCards drafts={[draft]} threadId="t1" openDraftId={open ? draft.id : null} onOpen={() => setOpen(true)} />}
      />
      <AppShellPortal slot="artifactPanel" active={open}>
        {open ? <OperatorEmailDraftPanel draft={draft} threadId="t1" onClose={() => setOpen(false)} /> : null}
      </AppShellPortal>
    </div>
  );
}

const adapter: AgentDockAdapter = {
  newChatLabel: "New chat",
  useThreads: () => [],
  useTabSummary: () => null,
  useArchiveActions: () => ({ archive: async () => {}, restore: async () => {} }),
  Chat: QaChat,
};

function Layout() {
  const { filled, setTarget } = useAppShellSlot("artifactPanel");
  const desktop = useMediaQuery("(min-width: 1024px)");
  return (
    <AgentDockLayout
      app={<div className="p-8 text-sm text-muted-foreground">Procurement · Right away Enterprises (page behind the dock)</div>}
      adapter={adapter}
      artifactPanelRef={setTarget}
      artifactPlacement={desktop ? "side" : "overlay"}
      artifactOpen={filled}
      detailPanelOpen={false}
    />
  );
}

export default function DockQa() {
  return (
    <AppShellSlotsProvider>
      <AgentDockProvider surface="operator" userId="qa">
        <Layout />
      </AgentDockProvider>
    </AppShellSlotsProvider>
  );
}
