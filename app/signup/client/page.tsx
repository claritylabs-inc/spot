import type { Metadata } from "next";
import { IntakeSignup } from "@/components/insurance-intake/signup";

export const metadata: Metadata = {
  title: "Create a client account",
  description:
    "Sign up for Spot with your work email. Verify a 6-digit code, add your company, and manage policies, certificates, and insurance requests in one workspace.",
  alternates: { canonical: "/signup/client" },
};

export default function ClientSignupPage() {
  return <IntakeSignup />;
}
