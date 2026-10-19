import { withQuoteProvider } from "@/lib/quote-provider";
import { redirect } from "next/navigation";
import { InsuranceIntake } from "@/components/insurance-intake/application";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string; provider?: string }>;
}) {
  const params = await searchParams;
  if (!params.request) redirect(withQuoteProvider("/signup", params.provider ?? null));
  return <InsuranceIntake />;
}
