type AuthResponse = {
  error?: string;
  tokens?: {
    token?: string;
  } | null;
};

async function completeSignIn(provider: string, params: Record<string, string>): Promise<void> {
  const response = await fetch("/api/auth", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "auth:signIn",
      args: {
        provider,
        params,
      },
    }),
  });
  const result = (await response.json()) as AuthResponse;

  if (!response.ok) {
    throw new Error(result.error ?? "Could not verify code");
  }
  if (!result.tokens?.token) {
    throw new Error("Could not complete sign-in");
  }
}

export function completeOtpSignIn(email: string, code: string): Promise<void> {
  return completeSignIn("resend-otp", { email, code });
}

export function completePasswordSignIn(email: string, password: string): Promise<void> {
  return completeSignIn("password", { flow: "signIn", email: email.trim().toLowerCase(), password });
}
