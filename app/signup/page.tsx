import type { Metadata } from "next";
import { IntakeSignup } from "@/components/insurance-intake/signup";

export const metadata: Metadata = {
  alternates: { canonical: "/signup/client" },
};

export default function SignupPage() {
  return <IntakeSignup />;
}
