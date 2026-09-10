"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import { isValidPhoneNumber } from "react-phone-number-input";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/convex/_generated/api";
import { BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { LogoIcon } from "@/components/ui/logo-icon";
import { PhoneInput } from "@/components/ui/phone-input";
import { ArrowRight, Check, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getPublicAgentDomain } from "@/lib/domains";
import { AGENT_TEXT_NUMBER } from "@/lib/imessage-config";
import {
  useCachedViewerOrg,
  useViewerCacheActions,
} from "@/lib/sync/spot-cached-queries";
import { useCachedQuery } from "@/lib/sync/use-cached-query";
import { getUserFacingErrorMessage } from "@/lib/user-facing-error";
import { typeStyle } from "@/lib/typography";

const AGENT_DOMAIN = getPublicAgentDomain();
const SPOT_IMESSAGE_NUMBER = AGENT_TEXT_NUMBER;

function companyNameFromEmail(email?: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return "";
  const root = domain
    .split(".")[0]
    ?.replace(/[^a-z0-9-_ ]/gi, "")
    .trim();
  if (!root) return "";
  return root
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase() + p.slice(1))
    .join(" ")
    .slice(0, 80);
}

function websiteFromEmail(email?: string | null): string {
  if (!email) return "";
  const domain = email.split("@")[1]?.toLowerCase().trim();
  if (!domain) return "";
  const free = new Set([
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "icloud.com",
    "proton.me",
    "protonmail.com",
    "aol.com",
    "me.com",
    "live.com",
  ]);
  if (free.has(domain)) return "";
  return domain;
}

type Step = 0 | 1 | 2;

const STEPS: ReadonlyArray<{ label: string; subtitle?: string }> = [
  {
    label: "Welcome to Spot",
    subtitle: "Start by telling us a little about yourself.",
  },
  {
    label: "Your organization",
    subtitle: "Confirm your company name and website.",
  },
  { label: "You're all set", subtitle: "Here's what you can do next." },
] as const;

const inputClass = `h-9 w-full rounded-lg border border-input bg-popover px-3 placeholder:text-muted-foreground/40 focus:outline-none focus:border-border-focus focus:ring-1 focus:ring-input transition-colors ${typeStyle("body.default")}`;

const labelClass = `text-muted-foreground block mb-1.5 ${typeStyle("caption.medium")}`;

function StepDots({ currentStep }: { currentStep: Step }) {
  return (
    <div className="flex items-center justify-center gap-2">
      {STEPS.map((step, index) => (
        <div
          key={step.label}
          className={`rounded-full transition-colors duration-100 ${
            index === currentStep
              ? "h-1.5 w-6 bg-foreground sm:h-1.5 sm:w-7"
              : "h-1.5 w-1.5 bg-foreground/15 sm:h-1.5 sm:w-1.5"
          }`}
        />
      ))}
    </div>
  );
}

function Shell({
  children,
  currentStep,
  email,
  onLogout,
}: {
  children: ReactNode;
  currentStep?: Step;
  email?: string;
  onLogout?: () => Promise<void> | void;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 w-full bg-background px-6 py-6 sm:px-8">
        <div
          className={`grid grid-cols-[1fr_auto_1fr] items-center gap-4 text-muted-foreground ${typeStyle("body.default")}`}
        >
          <div className="justify-self-start min-w-0">
            <div className="sm:hidden">
              <LogoIcon size={18} static />
            </div>
            <div className="hidden sm:block">
              <BrandWordmark />
            </div>
          </div>
          <div className="justify-self-center">
            {typeof currentStep === "number" ? (
              <StepDots currentStep={currentStep} />
            ) : null}
          </div>
          <div
            className={`justify-self-end text-right text-muted-foreground min-w-0 ${typeStyle("body.default")}`}
          >
            {email ? (
              <div className="flex items-center gap-3">
                <span className="hidden sm:inline">{email}</span>
                {onLogout ? (
                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className={`text-foreground transition hover:opacity-70 ${typeStyle("control.button")}`}
                  >
                    Log out
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl justify-center px-6 pt-20 pb-12 sm:px-8 sm:pt-24 sm:pb-16">
        {children}
      </main>
    </div>
  );
}

export default function ClientOnboardingSetupPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { signOut } = useAuthActions();

  const viewer = useCachedQuery(
    "onboarding.setup.viewer",
    api.users.viewer,
    {},
  );
  const viewerOrg = useCachedViewerOrg();
  const { patchViewer, patchViewerOrg } = useViewerCacheActions();
  const updateProfile = useMutation(api.users.updateProfile);
  const updateOrg = useMutation(api.orgs.updateOrg);
  const createClientOrg = useMutation(api.orgs.createClientOrg);
  const completeOnboarding = useMutation(api.users.completeOnboarding);
  const extractCompanyInfo = useAction(
    api.actions.extractCompanyInfo.extractCompanyInfo,
  );

  const [currentStep, setCurrentStep] = useState<Step>(0);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState("");
  const [userPhone, setUserPhone] = useState("");
  const [debouncedUserPhone, setDebouncedUserPhone] = useState("");
  const [orgName, setOrgName] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const isVendorInvite = searchParams?.get("source") === "vendor-invite";
  const invitingClientName =
    searchParams?.get("client")?.trim() || "your client";
  const trimmedUserPhone = userPhone.trim();
  const phoneHasDigits = /\d/.test(trimmedUserPhone);
  const phoneValid =
    trimmedUserPhone.length > 0 && isValidPhoneNumber(trimmedUserPhone);
  const phoneInvalid =
    phoneHasDigits &&
    !phoneValid &&
    trimmedUserPhone.replace(/\D/g, "").length >= 7;
  const shouldCheckPhone =
    phoneValid && trimmedUserPhone !== (viewer?.phone ?? "");
  const phoneAvailability = useQuery(
    api.users.checkPhoneAvailability,
    shouldCheckPhone && debouncedUserPhone === trimmedUserPhone
      ? { phone: debouncedUserPhone }
      : "skip",
  );
  const phoneChecking =
    shouldCheckPhone &&
    (debouncedUserPhone !== trimmedUserPhone ||
      phoneAvailability === undefined);
  const phoneUnavailable =
    shouldCheckPhone && phoneAvailability?.available === false;
  const phoneBlocked = phoneInvalid || phoneChecking || phoneUnavailable;

  // If already complete, bounce home.
  useEffect(() => {
    if (viewer?.onboardingComplete) router.replace("/");
  }, [viewer, router]);

  // If somehow this is a broker, redirect.
  useEffect(() => {
    const type = (viewerOrg?.org as { type?: "broker" | "client" } | undefined)
      ?.type;
    if (type === "broker") router.replace("/onboarding/broker");
  }, [viewerOrg, router]);

  // Hydrate inputs from server data.
  useEffect(() => {
    if (!viewer) return;
    queueMicrotask(() => {
      setUserName((v) => v || viewer.name || "");
      setUserRole((v) => v || viewer.title || "");
      setUserPhone((v) => v || viewer.phone || "");
    });
  }, [viewer]);

  useEffect(() => {
    const org = viewerOrg?.org;
    const email = viewer?.email;
    queueMicrotask(() => {
      setOrgName((v) => v || org?.name || companyNameFromEmail(email));
      setWebsite((v) => v || org?.website || websiteFromEmail(email));
    });
  }, [viewerOrg, viewer]);

  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedUserPhone(trimmedUserPhone),
      300,
    );
    return () => clearTimeout(timer);
  }, [trimmedUserPhone]);

  const spotAgentHandle = viewerOrg?.org?.agentHandle;
  const spotAgentEmail = spotAgentHandle
    ? `${spotAgentHandle}@${AGENT_DOMAIN}`
    : null;

  const handleLogout = useCallback(async () => {
    await signOut();
    router.replace("/login");
  }, [signOut, router]);

  const handleStep0Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await updateProfile({
        name: userName.trim(),
        title: userRole.trim(),
        phone: trimmedUserPhone || undefined,
      });
      patchViewer({
        name: userName.trim(),
        title: userRole.trim(),
        phone: trimmedUserPhone || undefined,
      });
      setCurrentStep(1);
    } catch (e) {
      const message = getUserFacingErrorMessage(e, "Failed to save");
      setError(
        message.includes("This phone number is already used")
          ? "This phone number is already used by another user."
          : message.includes("Enter a valid phone number")
            ? "Enter a valid phone number with country code."
            : message,
      );
    } finally {
      setSubmitting(false);
    }
  }, [patchViewer, updateProfile, userName, userRole, trimmedUserPhone]);

  const handleStep1Next = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      const trimmedName = orgName.trim();
      const trimmedSite = website.trim();
      if (viewerOrg?.org) {
        await updateOrg({
          name: trimmedName || undefined,
          website: trimmedSite || undefined,
        });
        patchViewerOrg({
          name: trimmedName || undefined,
          website: trimmedSite || undefined,
        });
      } else {
        await createClientOrg({
          name: trimmedName,
          website: trimmedSite || undefined,
        });
      }
      if (trimmedSite) {
        const enrichToast = toast.loading(
          "Enriching your profile from your website…",
        );
        void extractCompanyInfo({ url: trimmedSite })
          .then(() =>
            toast.success("Profile enriched from your website.", {
              id: enrichToast,
            }),
          )
          .catch(() => toast.dismiss(enrichToast));
      }
      setCurrentStep(2);
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Failed to save"));
    } finally {
      setSubmitting(false);
    }
  }, [
    updateOrg,
    createClientOrg,
    viewerOrg,
    orgName,
    website,
    extractCompanyInfo,
    patchViewerOrg,
  ]);

  const handleFinish = useCallback(async () => {
    setSubmitting(true);
    setError("");
    try {
      await completeOnboarding();
      patchViewer({ onboardingComplete: true });
      patchViewerOrg({ onboardingComplete: true });
      router.replace(isVendorInvite ? "/connect/clients" : "/");
    } catch (e) {
      setError(getUserFacingErrorMessage(e, "Failed to finish"));
      setSubmitting(false);
    }
  }, [completeOnboarding, isVendorInvite, patchViewer, patchViewerOrg, router]);

  const canContinueStep0 =
    userName.trim().length > 0 && userRole.trim().length > 0 && !phoneBlocked;
  const canContinueStep1 = orgName.trim().length > 0;

  const stepContent = isVendorInvite
    ? ([
        {
          label: "Set up your vendor account",
          subtitle: `${invitingClientName} invited you to share insurance records and verify your coverage.`,
        },
        {
          label: "Your organization",
          subtitle:
            "Confirm the company that will share insurance records with this client.",
        },
        {
          label: "You're connected",
          subtitle:
            "Your client can now review the insurance records you choose to keep in Spot.",
        },
      ] satisfies ReadonlyArray<{ label: string; subtitle?: string }>)
    : STEPS;

  return (
    <Shell
      currentStep={currentStep}
      email={viewer?.email}
      onLogout={handleLogout}
    >
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3 text-left">
          <h1 className={`${typeStyle("heading.micro")}`}>
            {stepContent[currentStep].label}
          </h1>
          {stepContent[currentStep].subtitle ? (
            <p className={`text-muted-foreground ${typeStyle("body.default")}`}>
              {stepContent[currentStep].subtitle}
            </p>
          ) : null}
        </div>

        {currentStep === 0 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinueStep0 || submitting) return;
              void handleStep0Next();
            }}
            className="space-y-10"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="onboarding-name" className={labelClass}>
                  Your name
                </label>
                <input
                  type="text"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  id="onboarding-name"
                  placeholder="Full name"
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="onboarding-role" className={labelClass}>
                  Your role
                </label>
                <input
                  type="text"
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value)}
                  id="onboarding-role"
                  placeholder="Job title"
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="onboarding-phone" className={labelClass}>
                  Mobile number (optional)
                </label>
                <PhoneInput
                  value={userPhone || undefined}
                  onChange={(value) => setUserPhone(value ?? "")}
                  defaultCountry="US"
                  id="onboarding-phone"
                  placeholder="Enter phone number"
                />
                <p
                  className={`text-muted-foreground/70 ${typeStyle("caption.default")}`}
                >
                  {phoneInvalid ? (
                    <span className="text-red-500/80">
                      Enter a valid phone number with country code.
                    </span>
                  ) : phoneChecking ? (
                    "Checking phone number"
                  ) : phoneUnavailable ? (
                    <span className="text-red-500/80">
                      This phone number is already used by another user.
                    </span>
                  ) : shouldCheckPhone && phoneAvailability?.available ? (
                    "Phone number is available for iMessage."
                  ) : (
                    "Used for iMessage access to your Spot agent."
                  )}
                </p>
              </div>
            </div>

            {error ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                {error}
              </p>
            ) : null}

            <PillButton
              type="submit"
              disabled={!canContinueStep0 || submitting}
              className={`w-full justify-center shadow-none sm:w-auto ${typeStyle("control.button")}`}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 1 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!canContinueStep1 || submitting) return;
              void handleStep1Next();
            }}
            className="space-y-10"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="onboarding-organization" className={labelClass}>
                  Organization name
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  id="onboarding-organization"
                  placeholder="Organization name"
                  autoFocus
                  className={inputClass}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="onboarding-website" className={labelClass}>
                  Website (optional)
                </label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  id="onboarding-website"
                  placeholder="https://example.com"
                  className={inputClass}
                />
                <p
                  className={`text-muted-foreground/70 ${typeStyle("caption.default")}`}
                >
                  We&apos;ll use this to enrich your company profile
                  automatically.
                </p>
              </div>
            </div>

            {error ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                {error}
              </p>
            ) : null}

            <PillButton
              type="submit"
              disabled={!canContinueStep1 || submitting}
              className={`w-full justify-center shadow-none sm:w-auto ${typeStyle("control.button")}`}
            >
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Continue
              {!submitting ? <ArrowRight className="h-4 w-4" /> : null}
            </PillButton>
          </form>
        )}

        {currentStep === 2 && (
          <div className="space-y-10">
            <ol
              className={`list-none space-y-4 text-muted-foreground [&>li]:flex [&>li]:gap-4 ${typeStyle("body.default")}`}
            >
              {(isVendorInvite
                ? [
                    `Share policies and certificates with ${invitingClientName}.`,
                    "Keep your insurance records current for vendor compliance reviews.",
                    "Generate certificates of insurance when clients need proof of coverage.",
                  ]
                : [
                    "See all of your policies, organized, in one place.",
                    "Get proactive alerts about expiring policies and renewals.",
                    "Generate certificates of insurance for customers, vendors and investors.",
                  ]
              ).map((item, index) => (
                <li key={item}>
                  <span
                    className={`shrink-0 text-foreground/30 ${typeStyle("data.numeric")}`}
                  >
                    {index + 1}.
                  </span>
                  <span>{item}</span>
                </li>
              ))}
              {spotAgentEmail ? (
                <li>
                  <span
                    className={`shrink-0 text-foreground/30 ${typeStyle("data.numeric")}`}
                  >
                    4.
                  </span>
                  <span>
                    Email{" "}
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(spotAgentEmail)
                          .then(() => toast.success("Copied to clipboard"))
                          .catch(() => toast.error("Couldn't copy"));
                      }}
                      className={`mx-1 inline-flex items-center gap-1 text-foreground underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground/50 transition-colors ${typeStyle("control.button")}`}
                    >
                      {spotAgentEmail}
                      <Copy className="h-3.5 w-3.5" />
                    </button>{" "}
                    to get instant answers about your insurance coverage.
                  </span>
                </li>
              ) : null}
              {SPOT_IMESSAGE_NUMBER ? (
                <li>
                  <span
                    className={`shrink-0 text-foreground/30 ${typeStyle("data.numeric")}`}
                  >
                    {spotAgentEmail ? "5." : "4."}
                  </span>
                  <span>
                    Text{" "}
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(SPOT_IMESSAGE_NUMBER)
                          .then(() => toast.success("Copied to clipboard"))
                          .catch(() => toast.error("Couldn't copy"));
                      }}
                      className={`mx-1 inline-flex items-center gap-1 text-foreground underline decoration-foreground/20 underline-offset-4 hover:decoration-foreground/50 transition-colors ${typeStyle("control.button")}`}
                    >
                      {SPOT_IMESSAGE_NUMBER}
                      <Copy className="h-3.5 w-3.5" />
                    </button>{" "}
                    via iMessage to ask questions from your phone.
                  </span>
                </li>
              ) : null}
            </ol>

            {error ? (
              <p
                className={`text-muted-foreground ${typeStyle("body.default")}`}
              >
                {error}
              </p>
            ) : null}

            <PillButton
              type="button"
              onClick={handleFinish}
              disabled={submitting}
              className={`w-full justify-center shadow-none sm:w-auto ${typeStyle("control.button")}`}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {submitting ? "Finishing…" : "Finish setup"}
            </PillButton>
          </div>
        )}
      </div>
    </Shell>
  );
}
