import { redirect } from "next/navigation";

/** Retired Google sender setup; correspondence uses the operator’s Resend inbox. */
export default function EmailHealthPage() {
  redirect("/operator/inbox");
}
