"use client";

import { useEffect, useRef, useState } from "react";
import { useAction, useConvexAuth, useMutation } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/convex/_generated/api";
import {
  AuthCard,
  AuthMinimalShell,
  BrandWordmark,
  PoweredBySpotWordmark,
} from "@/components/auth-shell";
import { OtpField } from "@/components/ui/otp-field";
import { PillButton } from "@/components/ui/pill-button";
import { completeOtpSignIn } from "@/lib/otp-auth";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { ArrowRight, Loader2 } from "lucide-react";
import { typeStyle } from "@/lib/typography";

type ConnectedOrgsApi = {
  connectedOrgs: {
    getInvitationByToken: FunctionReference<"action">;
    getInvitationOtpCode: FunctionReference<"action">;
    acceptInvitation: FunctionReference<"mutation">;
  };
};

type RequestData = {
  _id: string;
  status: "pending" | "accepted" | "expired" | "revoked";
  vendorEmail: string;
  relationshipLabel?: string;
  note?: string;
  clientOrg?: { name: string } | null;
  vendorOrg?: { name: string } | null;
};

const connectedOrgsApi = api as unknown as ConnectedOrgsApi;
const INPUT_CLASSES =
  `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("body.default")}`;
const LABEL_CLASSES = `text-muted-foreground block mb-1.5 ${typeStyle("caption.medium")}`;

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function friendlyError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes("expired")) return "This vendor invite has expired. Ask the client to resend it.";
  if (lower.includes("admin")) return "You need to be an admin of the vendor org to accept this invite.";
  if (lower.includes("invalid code")) return "That code didn't work. Please double-check and try again.";
  return raw || "Something went wrong. Please try again.";
}

export default function VendorRequestAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const getInvitationByToken = useAction(connectedOrgsApi.connectedOrgs.getInvitationByToken);
  const getInvitationOtpCode = useAction(connectedOrgsApi.connectedOrgs.getInvitationOtpCode);
  const acceptInvitation = useMutation(connectedOrgsApi.connectedOrgs.acceptInvitation);
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();

  const [requestData, setRequestData] = useState<RequestData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [step, setStep] = useState<"details" | "code">("details");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [autoVerifying, setAutoVerifying] = useState(false);
  const acceptingRef = useRef(false);
  const autoStartedRef = useRef(false);

  useEffect(() => {
    getInvitationByToken({ token })
      .then((data) => {
        const typed = data as RequestData | null;
        if (!typed) throw new Error("Invite not found");
        setRequestData(typed);
        setEmail(typed.vendorEmail ?? "");
      })
      .catch((err: unknown) =>
        setFetchError(
          getUserFacingErrorMessage(err, "Could not load this access request."),
        ),
      )
      .finally(() => setFetching(false));
  }, [getInvitationByToken, token]);

  useEffect(() => {
    if (!requestData?.vendorEmail) return;
    if (requestData.status !== "pending") return;
    if (isAuthenticated) return;
    if (autoStartedRef.current) return;
    autoStartedRef.current = true;
    const targetEmail = requestData.vendorEmail;
    void (async () => {
      setAutoVerifying(true);
      try {
        await signIn("resend-otp", { email: targetEmail });
        let stashed: { email: string; code: string } | null = null;
        for (let i = 0; i < 10; i++) {
          stashed = (await getInvitationOtpCode({ token })) as {
            email: string;
            code: string;
          } | null;
          if (stashed) break;
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
        if (!stashed) throw new Error("Could not auto-verify. Please try again.");
        await completeOtpSignIn(stashed.email, stashed.code);
        window.location.reload();
      } catch (err) {
        setError(
          getUserFacingErrorMessage(
            err,
            "Could not auto-verify. Please try again.",
          ),
        );
        autoStartedRef.current = false;
      } finally {
        setAutoVerifying(false);
      }
    })();
  }, [requestData, isAuthenticated, signIn, getInvitationOtpCode, token]);

  useEffect(() => {
    if (!requestData) return;
    if (!isAuthenticated || acceptingRef.current) return;
    acceptingRef.current = true;
    acceptInvitation({ token })
      .then(() => {
        const params = new URLSearchParams({ source: "vendor-invite" });
        if (requestData.clientOrg?.name) {
          params.set("client", requestData.clientOrg.name);
        }
        router.replace(`/onboarding?${params.toString()}`);
      })
      .catch((err: unknown) => {
        setError(
          friendlyError(getUserFacingErrorMessage(err, "Could not accept invite")),
        );
        acceptingRef.current = false;
      });
  }, [requestData, isAuthenticated, acceptInvitation, token, router]);

  async function handleDetailsSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    if (!isEmailLike(email)) {
      setError("Enter a valid email address.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await signIn("resend-otp", { email });
      setStep("code");
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
    } finally {
      setLoading(false);
    }
  }

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await completeOtpSignIn(email, code);
      window.location.reload();
    } catch (err: unknown) {
      setError(friendlyError(getUserFacingErrorMessage(err, "")));
      setLoading(false);
    }
  }

  if (fetching) {
    return (
      <AuthMinimalShell footer={<PoweredBySpotWordmark />}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </AuthMinimalShell>
    );
  }

  if (fetchError || !requestData) {
    return (
      <AuthMinimalShell footer={<PoweredBySpotWordmark />}>
        <AuthCard title="Invite unavailable" subtitle={fetchError ?? "Invite not found"} logo={<BrandWordmark />}>
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>Ask the client to resend the vendor invite.</p>
        </AuthCard>
      </AuthMinimalShell>
    );
  }

  const clientName = requestData.clientOrg?.name ?? "A client";
  const title =
    requestData.vendorEmail || step === "details"
      ? `${clientName} invited you as a vendor`
      : "Verify your email";
  const subtitle =
    requestData.vendorEmail || step === "details"
      ? "Connect with this client to share insurance records and verify your coverage against their vendor requirements."
      : undefined;

  return (
    <AuthMinimalShell footer={<PoweredBySpotWordmark />}>
      <AuthCard title={title} subtitle={subtitle} logo={<BrandWordmark />}>
        {autoVerifying ? (
          <div className={`flex items-center gap-3 text-muted-foreground ${typeStyle("body.default")}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Opening your vendor invite...</span>
          </div>
        ) : requestData.status !== "pending" ? (
          <p className={`text-muted-foreground ${typeStyle("body.default")}`}>This vendor invite is {requestData.status}.</p>
        ) : step === "details" ? (
          <form onSubmit={handleDetailsSubmit} className="space-y-4">
            {requestData.note ? (
              <p className={`rounded-lg border border-border bg-foreground/3 p-3 text-muted-foreground ${typeStyle("body.default")}`}>
                {requestData.note}
              </p>
            ) : null}
            <div>
              <label htmlFor="vendor-email" className={LABEL_CLASSES}>Vendor email</label>
              <input
                id="vendor-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className={INPUT_CLASSES}
              />
            </div>
            {error ? <p className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}>{error}</p> : null}
            <PillButton type="submit" disabled={loading || !email.trim()} className="w-full justify-center shadow-none sm:w-auto">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Sending code..." : "Continue"}
              {!loading ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4">
            <div>
              <label htmlFor="connected-org-verification-code" className={LABEL_CLASSES}>Verification code</label>
              <OtpField id="connected-org-verification-code" value={code} onValueChange={setCode} autoFocus required />
            </div>
            {error ? <p className={`px-1 py-1 text-muted-foreground ${typeStyle("body.default")}`}>{error}</p> : null}
            <PillButton type="submit" disabled={loading || code.length < 6} className="w-full justify-center shadow-none sm:w-auto">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? "Accepting..." : "Accept invite"}
            </PillButton>
          </form>
        )}
      </AuthCard>
    </AuthMinimalShell>
  );
}
