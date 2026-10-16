"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { AgentDockBar } from "@/components/agent-dock/agent-dock-bar";
import { BrandWordmark } from "@/components/auth-shell";
import { BROWSER_EXTENSION_WELCOME_URL, notifyBrowserExtension } from "@/lib/browser-extension";
import { AgentDockContextChip } from "@/components/agent-dock/agent-dock-context-chip";
import { AGENT_CHAT_SURFACE, DockBody } from "@/components/agent-dock/agent-dock-layout";
import {
  AgentDockProvider,
  useAgentDock,
} from "@/components/agent-dock/agent-dock-provider";
import { clientDockAdapter } from "@/components/agent-thread/client-dock-adapter";
import {
  AppShellPortal,
  AppShellSlotsProvider,
  useAppShellSlot,
} from "@/components/app-shell-slots";
import { EntityPreviewPanel } from "@/components/entity-preview-panel";
import { PdfProvider, usePdf } from "@/components/pdf-context";
import { PillButton } from "@/components/ui/pill-button";
import { api } from "@/convex/_generated/api";
import { EntityPreviewProvider, useEntityPreview } from "@/hooks/use-entity-preview";
import { PageContextProvider } from "@/hooks/use-page-context";
import { useSpotSync } from "@/lib/sync/spot-sync";
import { typeStyle } from "@/lib/typography";
import { cn } from "@/lib/utils";
import { PageCaptureProvider, usePageCapture } from "./page-capture";

const PdfPanel = dynamic(
  () =>
    import("@/components/ui/pdf-panel").then((m) => ({ default: m.PdfPanel })),
  { ssr: false },
);

/**
 * Links never navigate the sidebar frame; they open in a normal browser tab.
 * Installed on the document while the route is mounted so dialogs and other
 * portaled content are covered too.
 */
function openLinksInTab(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const anchor =
    event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (
    !(anchor instanceof HTMLAnchorElement) ||
    anchor.target === "_blank" ||
    anchor.hasAttribute("download")
  ) {
    return;
  }
  const url = new URL(anchor.href);
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (url.origin === window.location.origin && url.pathname === window.location.pathname && url.hash) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  window.open(url.href, "_blank", "noopener,noreferrer");
}

function OpenSpotButton() {
  return (
    <PillButton
      href="/"
      target="_blank"
      rel="noopener noreferrer"
      variant="secondary"
      size="compact"
    >
      Open Spot
      <ExternalLink className="size-3" />
    </PillButton>
  );
}

function ExtensionNotice({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div
      className="flex h-dvh w-full flex-col justify-center gap-3 bg-background px-5 text-foreground"
    >
      <h1 className={typeStyle("heading.micro")}>{title}</h1>
      <p className={cn("text-muted-foreground", typeStyle("body.default"))}>
        {body}
      </p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ReloadButton() {
  return (
    <PillButton
      variant="secondary"
      size="compact"
      onClick={() => window.location.reload()}
    >
      Reload
    </PillButton>
  );
}

function ExtensionWelcome() {
  const [signingIn, setSigningIn] = useState(false);
  return (
    <main className="flex min-h-dvh flex-col bg-background px-6 py-8 text-foreground">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <BrandWordmark />
        <h1 className={cn("mt-8 max-w-xs text-balance", typeStyle("heading.page"))}>
          Your insurance agent, right here.
        </h1>
        <p className={cn("mt-3 max-w-xs text-pretty text-muted-foreground", typeStyle("body.default"))}>
          Ask questions, review documents, and bring the page you’re reading into your Spot conversation.
        </p>
        <PillButton
          href="/login?from=extension"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-7"
          size="large"
          onClick={() => {
            setSigningIn(true);
            notifyBrowserExtension("spot:sign-in");
          }}
        >
          Sign in to Spot
          <ExternalLink className="size-4" />
        </PillButton>
        <p role="status" className={cn("mt-4 max-w-xs text-muted-foreground", typeStyle("caption.default"))}>
          {signingIn ? "Finish signing in in the new tab. Your sidebar will reconnect." : "Requires an active Spot client workspace."}
        </p>
      </div>
      <a href={BROWSER_EXTENSION_WELCOME_URL} target="_blank" rel="noopener noreferrer"
        className={cn("mt-8 self-center text-muted-foreground underline underline-offset-4 hover:text-foreground", typeStyle("body.default"))}>
        See how it works
      </a>
    </main>
  );
}

function CapturePreviewPanel() {
  const capture = usePageCapture();
  const text = capture?.preview;
  return (
    <AppShellPortal slot="artifactPanel" active={text != null}>
      <div className="flex h-full w-full min-w-0 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
          <span className={cn("text-foreground", typeStyle("body.medium"))}>
            Page context
          </span>
          <button
            type="button"
            aria-label="Close page context"
            onClick={capture?.closePreview}
            className="flex size-7 items-center justify-center rounded-md text-muted-foreground/40 transition-colors hover:bg-foreground/4 hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        <div
          className={cn(
            "ph-no-capture min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words p-4",
            typeStyle("body.default"),
          )}
        >
          {text}
        </div>
      </div>
    </AppShellPortal>
  );
}

function ExtensionLayout({ orgName }: { orgName: string }) {
  const dock = useAgentDock();
  const { setTarget } = useAppShellSlot("artifactPanel");
  const [actions, setActions] = useState<ReactNode>(null);
  const { isPdfOpen, fileUrl } = usePdf();
  const { preview } = useEntityPreview();
  const capture = usePageCapture();
  const closePreview = capture?.closePreview;

  // A page preview belongs to the chat it was opened from.
  useEffect(() => {
    closePreview?.();
  }, [closePreview, dock.activeThreadId, dock.view]);

  return (
    <div
      className={cn(
        "relative flex h-dvh w-full min-w-0 flex-col overflow-hidden text-foreground",
        AGENT_CHAT_SURFACE,
      )}
    >
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
        <span
          title={orgName}
          className={cn("min-w-0 truncate text-foreground", typeStyle("body.medium"))}
        >
          {orgName}
        </span>
        <OpenSpotButton />
      </header>
      {capture?.pending ? (
        <div className="flex shrink-0 items-center border-b border-border px-3 py-1.5">
          <AgentDockContextChip
            label="Page waiting for a chat"
            onRemove={capture.dismiss}
          />
        </div>
      ) : null}
      <DockBody
        adapter={clientDockAdapter}
        mode="expanded"
        onActions={setActions}
        artifactPanelRef={setTarget}
      />
      <AgentDockBar
        adapter={clientDockAdapter}
        mode="expanded"
        mobile
        actions={actions}
        sizeControls={false}
      />
      <CapturePreviewPanel />
      {preview ? (
        <div className="absolute inset-0 z-30 flex bg-background">
          <EntityPreviewPanel />
        </div>
      ) : null}
      {isPdfOpen && fileUrl ? (
        <div className="absolute inset-0 z-40 flex bg-background">
          <PdfPanel />
        </div>
      ) : null}
    </div>
  );
}

function ExtensionWorkspace({
  userId,
  orgId,
  orgName,
}: {
  userId: string;
  orgId: string;
  orgName: string;
}) {
  return (
    <PageContextProvider>
      <PdfProvider>
        <EntityPreviewProvider>
          <AppShellSlotsProvider>
            <AgentDockProvider
              surface="client"
              userId={userId}
              standaloneOrgId={orgId}
            >
              <PageCaptureProvider>
                <ExtensionLayout orgName={orgName} />
              </PageCaptureProvider>
            </AgentDockProvider>
          </AppShellSlotsProvider>
        </EntityPreviewProvider>
      </PdfProvider>
    </PageContextProvider>
  );
}

type OrgType = "broker" | "client" | "partner";

/**
 * Active client workspaces only. The server enforces the same boundaries; this
 * keeps the sidebar from mounting agent data for accounts it cannot serve.
 */
function ineligibleReason(
  viewer: { accountKind?: string; onboardingComplete?: boolean; intakeRestricted?: boolean } | null,
  viewerOrg: {
    org: {
      type?: OrgType;
      clientAccessStatus?: string;
    };
  } | null,
) {
  if (!viewer) return { title: "Account unavailable", body: "Reload, or open Spot to check your account." };
  if (viewer.accountKind === "operator") {
    return { title: "Client workspaces only", body: "The browser sidebar works with client accounts. Open Spot to continue with your operator account." };
  }
  if (viewer.intakeRestricted) {
    return { title: "Finish your request first", body: "Your Spot workspace isn't open yet. Open Spot to finish your request." };
  }
  if (!viewer.onboardingComplete) {
    return { title: "Finish setting up", body: "Complete account setup in Spot, then reload this sidebar." };
  }
  if (!viewerOrg) {
    return { title: "No workspace found", body: "Open Spot to choose or create a workspace." };
  }
  const type = viewerOrg.org.type ?? "client";
  if (type !== "client") {
    return { title: "Client workspaces only", body: "The browser sidebar is available for client workspaces." };
  }
  if (viewerOrg.org.clientAccessStatus !== "active") {
    return { title: "Workspace not open yet", body: "Your Spot workspace isn't open yet. Open Spot to finish your request." };
  }
  return null;
}

export function ExtensionApp() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { scope } = useSpotSync();
  useEffect(() => {
    notifyBrowserExtension("spot:mounted");
    document.addEventListener("click", openLinksInTab, true);
    return () => document.removeEventListener("click", openLinksInTab, true);
  }, []);
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const viewerOrg = useQuery(api.orgs.viewerOrg, isAuthenticated ? {} : "skip");

  if (isLoading || (isAuthenticated && (viewer === undefined || viewerOrg === undefined))) {
    return (
      <div className="flex h-dvh w-full items-center justify-center bg-background">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <ExtensionWelcome />;
  }

  const reason = ineligibleReason(viewer ?? null, viewerOrg ?? null);
  if (reason || !viewer || !viewerOrg) {
    return (
      <ExtensionNotice {...(reason ?? { title: "Account unavailable", body: "Reload, or open Spot to check your account." })}>
        <OpenSpotButton />
        <ReloadButton />
      </ExtensionNotice>
    );
  }

  if (scope.userId !== String(viewer._id) || scope.orgId !== String(viewerOrg.org._id)) {
    return null;
  }

  return (
    <ExtensionWorkspace
      key={`${viewer._id}:${viewerOrg.org._id}`}
      userId={String(viewer._id)}
      orgId={String(viewerOrg.org._id)}
      orgName={viewerOrg.org.name}
    />
  );
}
