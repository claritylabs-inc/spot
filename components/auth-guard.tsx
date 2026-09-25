"use client";

import { useConvexAuth, useMutation } from "convex/react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api } from "@/convex/_generated/api";
import { AppShellLayout } from "@/components/app-shell";
import { Skeleton } from "@claritylabs-inc/ui/components/skeleton";
import { useOnboardingCache } from "@/hooks/use-onboarding-cache";
import { Loader2 } from "lucide-react";
import {
  useCachedShell,
  useCacheShellRecord,
  useSpotSync,
} from "@/lib/sync/spot-sync";
import { appShellRoute } from "@/lib/app-shell-routes";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import {
  endOperatorImpersonationStop,
  useOperatorImpersonationStopReturnHref,
} from "@/lib/operator-impersonation-stop-state";
import { typeStyle } from "@/lib/typography";

const BOOT_STATE_KEY = "spot:boot-state";

type BootState = {
  accountKind?: "customer" | "operator";
  onboardingComplete?: boolean;
  membershipRole?: "admin" | "member";
  userId?: string;
  orgId?: string;
};

declare global {
  interface Window {
    __SPOT_BOOT__?: BootState;
  }
}

function subscribeToBootStateSnapshot() {
  return () => {};
}

function getBootStateSnapshot() {
  return window.__SPOT_BOOT__ ?? null;
}

function getServerBootStateSnapshot() {
  return null;
}

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/operator/login",
  "/oauth/authorize",
  "/share/imessage",
  "/share/email",
  "/share/packet",
  "/connect/request",
];
const AUTH_AGNOSTIC_PATHS: string[] = [];
const ONBOARDING_PATH = "/onboarding";
const ADMIN_PATHS = ["/settings"];
const OPERATOR_PATH = "/operator";

/**
 * Loading state shown when we know the user needs onboarding.
 * Matches the onboarding page Shell layout for visual consistency.
 */
function OnboardingLoading() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="w-full px-6 py-6 sm:px-8">
        <div
          className={`grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-muted-foreground ${typeStyle("body.default")}`}
        >
          <div className="justify-self-start min-w-0">
            <div className="h-5 w-24 bg-foreground/10 rounded" />
          </div>
          <div className="justify-self-center flex items-center gap-2">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-foreground/10"
              />
            ))}
          </div>
          <div className="justify-self-end min-w-0">
            <div className="h-4 w-32 bg-foreground/10 rounded" />
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </main>
    </div>
  );
}

/**
 * Loading state shown when we know the user is onboarded: the app shell for
 * the requested route with skeleton content and no agent data yet.
 */
function ShellLoading({
  pathname,
  children,
}: {
  pathname: string;
  children: React.ReactNode;
}) {
  const route = appShellRoute(pathname) ?? appShellRoute("/");
  if (!route) return null;
  return (
    <AppShellLayout route={route} loading>
      {children}
    </AppShellLayout>
  );
}

function DashboardLoading({ pathname }: { pathname: string }) {
  return (
    <ShellLoading pathname={pathname}>
      <div className="mb-6">
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
        <Skeleton className="h-10 w-full rounded-lg" />
      </div>
    </ShellLoading>
  );
}

function OperatorLoading({ pathname }: { pathname: string }) {
  return (
    <ShellLoading pathname={pathname}>
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-lg" />
        <div className="rounded-lg border border-input">
          <Skeleton className="h-10 w-full rounded-none border-b border-input" />
          <div className="p-4">
            <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        </div>
      </div>
    </ShellLoading>
  );
}

function PendingLiveScreen() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-6">
        <div className="rounded-lg border border-input bg-card p-6">
          <h1 className={`text-foreground ${typeStyle("heading.micro")}`}>
            Workspace is being prepared
          </h1>
          <p
            className={`mt-2 text-muted-foreground ${typeStyle("body.default")}`}
          >
            Your Spot workspace is not live yet. You will receive an email when
            it is ready.
          </p>
        </div>
      </div>
    </div>
  );
}

export function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const pathname = usePathname();
  const router = useRouter();
  const {
    onboardingComplete: cachedOnboarding,
    setOnboardingComplete,
    clearCache: clearOnboardingCache,
  } = useOnboardingCache();
  const { scope, updateScope, clearScope } = useSpotSync();
  const cachedShell = useCachedShell();
  const cacheShellRecord = useCacheShellRecord();
  const acceptInvitation = useMutation(api.orgs.acceptInvitation);
  const handledInvitationIdRef = useRef<string | null>(null);
  const [inviteAcceptError, setInviteAcceptError] = useState(false);
  const impersonationStopReturnHref = useOperatorImpersonationStopReturnHref();
  const initialBootState = useSyncExternalStore(
    subscribeToBootStateSnapshot,
    getBootStateSnapshot,
    getServerBootStateSnapshot,
  );

  const isAuthAgnostic = AUTH_AGNOSTIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  const isPublic =
    isAuthAgnostic ||
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const isOnboarding =
    pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
  const isBrokerPortalPath =
    pathname === "/broker" ||
    pathname.startsWith("/broker/team") ||
    pathname === "/onboarding/broker";
  const isAdminPath = ADMIN_PATHS.some((p) => pathname.startsWith(p));
  const isOperatorPath =
    pathname === OPERATOR_PATH || pathname.startsWith(`${OPERATOR_PATH}/`);
  const isOperatorLogin = pathname === "/operator/login";

  // Only query viewer when authenticated
  const viewer = useCachedQuery(
    "authGuard.viewer",
    api.users.viewer,
    isAuthenticated ? {} : "skip",
  );
  const viewerOrg = useCachedQuery(
    "authGuard.viewerOrg",
    api.orgs.viewerOrg,
    isAuthenticated ? {} : "skip",
  );
  const operatorContext = useCachedQuery(
    "authGuard.operator.current",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (api as any).operator.current,
    isAuthenticated && viewer?.accountKind === "operator" ? {} : "skip",
  );
  const pendingInvitation = useCachedQuery(
    "authGuard.pendingInvitationForViewer",
    api.orgs.pendingInvitationForViewer,
    isAuthenticated && viewer?.accountKind !== "operator" ? {} : "skip",
  );

  // Update cached onboarding state when we learn it from the server
  useEffect(() => {
    if (viewer !== undefined && viewer !== null) {
      setOnboardingComplete(!!viewer.onboardingComplete);
    }
  }, [viewer, setOnboardingComplete]);

  useEffect(() => {
    if (!viewer) return;
    const userId = String(viewer._id);
    const orgId =
      viewer.accountKind === "operator"
        ? undefined
        : viewerOrg?.org
          ? String(viewerOrg.org._id)
          : undefined;
    if (viewer.accountKind !== "operator" && !orgId) return;
    if (scope.userId === userId && scope.orgId === orgId) return;
    updateScope({ userId, orgId });
  }, [scope.orgId, scope.userId, updateScope, viewer, viewerOrg]);

  useEffect(() => {
    if (!viewer) return;
    const accountKind =
      viewer.accountKind === "operator" ? "operator" : "customer";
    const orgId =
      accountKind === "operator"
        ? undefined
        : viewerOrg?.org
          ? String(viewerOrg.org._id)
          : undefined;
    if (accountKind !== "operator" && !viewerOrg?.org) return;
    if (scope.userId !== String(viewer._id) || scope.orgId !== orgId) {
      return;
    }
    const nextBootState = {
      accountKind,
      onboardingComplete: !!viewer.onboardingComplete,
      membershipRole: viewerOrg?.membership.role,
      userId: String(viewer._id),
      orgId,
    };
    try {
      localStorage.setItem(BOOT_STATE_KEY, JSON.stringify(nextBootState));
    } catch {}
    void cacheShellRecord({
      accountKind,
      viewer,
      viewerOrg,
      onboardingComplete: !!viewer.onboardingComplete,
      membershipRole: viewerOrg?.membership.role,
    });
  }, [cacheShellRecord, scope.orgId, scope.userId, viewer, viewerOrg]);

  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    clearOnboardingCache();
    try {
      localStorage.removeItem(BOOT_STATE_KEY);
    } catch {}
    void clearScope();
  }, [clearOnboardingCache, clearScope, isAuthenticated, isLoading]);

  useEffect(() => {
    if (isAuthAgnostic) return;
    if (!isAuthenticated || !pendingInvitation || inviteAcceptError) return;
    const invitationId = String(pendingInvitation.invitationId);
    if (handledInvitationIdRef.current === invitationId) return;

    handledInvitationIdRef.current = invitationId;
    acceptInvitation({ invitationId: pendingInvitation.invitationId })
      .then(() => {
        setOnboardingComplete(true);
        router.replace("/");
      })
      .catch((error) => {
        setInviteAcceptError(true);
        console.warn(
          "[AuthGuard] Failed to accept pending team invitation",
          error,
        );
      });
  }, [
    acceptInvitation,
    inviteAcceptError,
    isAuthAgnostic,
    isAuthenticated,
    pendingInvitation,
    router,
    setOnboardingComplete,
  ]);

  useEffect(() => {
    if (isLoading || isAuthAgnostic) return;

    if (!isAuthenticated && !isPublic) {
      router.replace("/login");
      return;
    }

    if (isAuthenticated && pendingInvitation && !inviteAcceptError) {
      return;
    }

    if (isAuthenticated && viewer !== undefined) {
      const hasOperatorImpersonation = !!operatorContext?.activeImpersonation;
      if (
        viewer?.accountKind === "operator" &&
        operatorContext !== undefined &&
        !hasOperatorImpersonation &&
        impersonationStopReturnHref
      ) {
        const returnPathname = impersonationStopReturnHref.split("?", 1)[0];
        if (pathname !== returnPathname) {
          router.replace(impersonationStopReturnHref);
        } else {
          endOperatorImpersonationStop();
        }
        return;
      }
      if (
        viewer?.accountKind === "operator" &&
        operatorContext !== undefined &&
        !isOperatorPath &&
        !isPublic &&
        !hasOperatorImpersonation
      ) {
        router.replace("/operator");
        return;
      }
      if (
        viewer?.accountKind !== "operator" &&
        viewerOrg?.org?.type === "broker" &&
        !isBrokerPortalPath &&
        !isPublic
      ) {
        router.replace("/broker");
        return;
      }
      if (
        isOperatorPath &&
        !isOperatorLogin &&
        viewer?.accountKind !== "operator"
      ) {
        router.replace("/");
        return;
      }
      if (
        viewer?.accountKind !== "operator" &&
        !!viewerOrg?.org &&
        ((
          viewerOrg.org as {
            operatorStatus?: "onboarding" | "live" | "lost" | "churned";
          }
        ).operatorStatus ?? "live") === "onboarding" &&
        !isPublic
      ) {
        return;
      }
      // Redirect to onboarding if not complete
      if (
        viewer &&
        viewer.accountKind !== "operator" &&
        !viewer.onboardingComplete &&
        !isOnboarding &&
        !isPublic
      ) {
        router.replace("/onboarding");
        return;
      }
      // Redirect away from onboarding if already complete
      if (viewer && viewer.onboardingComplete && isOnboarding) {
        router.replace("/");
        return;
      }
    }

    // Redirect non-admins away from admin-only paths
    if (isAuthenticated && viewerOrg !== undefined && isAdminPath) {
      if (!viewerOrg || viewerOrg.membership.role !== "admin") {
        router.replace("/");
        return;
      }
    }
  }, [
    inviteAcceptError,
    isAuthAgnostic,
    isLoading,
    isAuthenticated,
    isPublic,
    isOnboarding,
    isBrokerPortalPath,
    isAdminPath,
    isOperatorPath,
    isOperatorLogin,
    pendingInvitation,
    viewer,
    viewerOrg,
    operatorContext,
    impersonationStopReturnHref,
    router,
    pathname,
  ]);

  const scopedBootState =
    initialBootState?.userId === scope.userId &&
    initialBootState?.orgId === scope.orgId
      ? initialBootState
      : undefined;
  const bootOnboardingComplete = scopedBootState?.onboardingComplete;
  const cachedAccountKind =
    scopedBootState?.accountKind ?? cachedShell?.accountKind;
  const shouldShowOperatorLoading =
    !isOperatorLogin &&
    isOperatorPath &&
    (viewer?.accountKind === "operator" ||
      cachedAccountKind === "operator" ||
      (isAuthenticated &&
        viewer === undefined &&
        cachedAccountKind !== "customer"));

  // Auth-agnostic pages stay visible while auth initializes and never inherit
  // account, onboarding, invitation, or impersonation redirects.
  if (isAuthAgnostic) return <>{children}</>;

  // Loading state - cached boot state can choose the correct skeleton, but
  // protected children wait for the current Convex viewer/org checks.
  if (
    isLoading ||
    (isAuthenticated && viewer === undefined) ||
    (isAuthenticated &&
      viewer?.accountKind === "operator" &&
      operatorContext === undefined) ||
    (isAuthenticated && pendingInvitation && !inviteAcceptError)
  ) {
    if (isPublic) return null;

    if (shouldShowOperatorLoading) {
      return <OperatorLoading pathname={pathname} />;
    }

    // If we know from cache that onboarding is NOT complete, show onboarding loading
    // This prevents the flash of dashboard for new users
    if (cachedOnboarding === false || bootOnboardingComplete === false) {
      return <OnboardingLoading />;
    }

    // Default to dashboard loading for:
    // - cachedOnboarding === true (user is onboarded)
    // - cachedOnboarding === null (unknown, first visit - assume onboarded for safety)
    return <DashboardLoading pathname={pathname} />;
  }

  if (!isAuthenticated && !isPublic) {
    return null;
  }

  if (
    isAuthenticated &&
    viewer?.accountKind !== "operator" &&
    !!viewerOrg?.org &&
    ((
      viewerOrg.org as {
        operatorStatus?: "onboarding" | "live" | "lost" | "churned";
      }
    ).operatorStatus ?? "live") === "onboarding" &&
    !isPublic
  ) {
    return <PendingLiveScreen />;
  }

  if (
    isAuthenticated &&
    viewer?.accountKind === "operator" &&
    !isOperatorPath &&
    !isPublic &&
    !operatorContext?.activeImpersonation &&
    !impersonationStopReturnHref
  ) {
    return null;
  }

  if (
    isAuthenticated &&
    viewer?.accountKind !== "operator" &&
    viewerOrg?.org?.type === "broker" &&
    !isBrokerPortalPath &&
    !isPublic
  ) {
    return null;
  }

  if (
    isAuthenticated &&
    isOperatorPath &&
    !isOperatorLogin &&
    viewer?.accountKind !== "operator"
  ) {
    return null;
  }

  // Waiting for redirect to onboarding
  if (
    isAuthenticated &&
    viewer &&
    viewer.accountKind !== "operator" &&
    !viewer.onboardingComplete &&
    !isOnboarding &&
    !isPublic
  ) {
    return null;
  }

  // Waiting for redirect away from onboarding
  if (isAuthenticated && viewer && viewer.onboardingComplete && isOnboarding) {
    return null;
  }

  // Waiting for redirect away from admin paths
  if (
    isAdminPath &&
    viewerOrg !== undefined &&
    (!viewerOrg || viewerOrg.membership.role !== "admin")
  ) {
    return null;
  }

  return <>{children}</>;
}
