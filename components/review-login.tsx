"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useConvexAuth } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { Field, FieldLabel } from "@claritylabs-inc/ui/components/field";
import { Input } from "@claritylabs-inc/ui/components/input";
import { AuthCard, AuthMinimalShell, BrandWordmark } from "@/components/auth-shell";
import { PillButton } from "@/components/ui/pill-button";
import { typeStyle } from "@/lib/typography";

type AuthResponse = { error?: string; tokens?: { token?: string } | null };

/** Password sign-in for the demonstration reviewer account; nothing else uses it. */
export function ReviewLogin() {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const nextParam = useSearchParams().get("next");
  const next =
    nextParam && nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) router.replace(next);
  }, [isAuthenticated, next, router]);

  if (isAuthenticated) return null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "auth:signIn",
          args: {
            provider: "review-password",
            params: { flow: "signIn", email: email.trim(), password },
          },
        }),
      });
      const result = (await response.json()) as AuthResponse;
      if (!response.ok || !result.tokens?.token) throw new Error("Sign-in failed");
      window.location.assign(next);
    } catch {
      setError("Those credentials didn't work. Check them and try again.");
      setLoading(false);
    }
  }

  return (
    <AuthMinimalShell>
      <AuthCard
        title="Reviewer sign-in"
        subtitle="Use the review credentials provided with the submission."
        logo={<BrandWordmark />}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field>
            <FieldLabel htmlFor="review-email" className={typeStyle("body.root")}>
              Email
            </FieldLabel>
            <Input
              id="review-email"
              type="email"
              autoComplete="username"
              className="mt-2 h-12"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="review-password" className={typeStyle("body.root")}>
              Password
            </FieldLabel>
            <Input
              id="review-password"
              type="password"
              autoComplete="current-password"
              className="mt-2 h-12"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {error ? (
            <p role="alert" className={`text-muted-foreground ${typeStyle("body.default")}`}>
              {error}
            </p>
          ) : null}
          <PillButton
            type="submit"
            disabled={loading || !email || !password}
            className="w-full justify-center shadow-none sm:w-auto"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? "Signing in..." : "Sign in"}
            {!loading ? <ArrowRight className="h-4 w-4" /> : null}
          </PillButton>
        </form>
      </AuthCard>
    </AuthMinimalShell>
  );
}
