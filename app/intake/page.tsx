import { redirect } from "next/navigation";
import { InsuranceIntake } from "@/components/insurance-intake/application";

export default async function IntakePage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const params = await searchParams;
  if (!params.request) redirect("/signup");
  return <InsuranceIntake />;
}
