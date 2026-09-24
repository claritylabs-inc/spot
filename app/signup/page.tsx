import type { Metadata } from "next";
import { AuthEntryPage } from "@/components/auth-entry-page";

export const metadata: Metadata = {
  alternates: { canonical: "/signup/client" },
};

export default function SignupPage() {
  return <AuthEntryPage mode="signup" role="client" />;
}
